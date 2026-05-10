# 桌喵 v1.0.5 深度诊断报告

> 审视视角：假设这是一个实习生写的项目，从逻辑框架与技术细节层面系统性诊断  
> 日期：2026-05-10  
> 核心问题：**重构后面板和设置界面进不去，卡在"加载中"**

---

## 〇、最紧急的问题：面板/设置界面为什么进不去

### 现象

用户点击 📋 或 ⚙️ 按钮，panel/settings 窗口弹出，但只显示"加载中..."，界面永远无法渲染。

### 根因链路追踪

panel 和 settings 页面的代码结构完全一致：

```svelte
// panel/+page.svelte 与 settings/+page.svelte
let ready = $state(false);

onMount(async () => {
    await initStoreSync();    // ①
    await loadAllFromDB();    // ②
    ready = true;             // ③ 如果①或②抛异常，永远到不了这里
});

{#if ready}
  <TaskPanel />  <!-- 永远不会渲染 -->
{:else}
  <div class="loading">加载中...</div>
{/if}
```

**只要 `initStoreSync()` 或 `loadAllFromDB()` 中任意一个抛出未捕获异常，`ready` 就永远为 `false`，界面就永远卡在"加载中"。**

#### 可能卡死的场景分析

| 场景 | 触发条件 | 后果 |
|------|----------|------|
| **S1: DB 连接失败** | `.env` 中 `DATABASE_URL` 指向的 MySQL 不可达（密码错、MySQL 未启动等） | `loadAllFromDB()` 中 `tryDbOperation` 调用 `invoke('db_task_list')` → Rust 返回 `Err("数据库连接不可用")` → `tryDbOperation` 走 fallback 逻辑... 但如果 fallback 之后的 `loadAll()` 也抛异常？ |
| **S2: `isDbUnavailableError` 误判** | `tryDbOperation` 中的错误消息匹配逻辑过于宽泛：`msg.includes('Database') \|\| msg.includes('connect')` — 这会匹配到任何包含 "Database" 或 "connect" 的错误，包括前端自己的网络错误 | 误触发 `fallbackToFileMode()`，将全局 `isDbAvailable` 设为 `false`，后续所有 DB 操作直接短路 |
| **S3: `loadAllFromDB` 的第二次 DB 检查** | 第 189-191 行：`if (!isDbAvailable) { await loadAll(); }` — 如果第一个 `tryDbOperation` 抛出的不是 DB 错误（比如 serde 反序列化错误），`isDbAvailable` 仍为 `true`，但 DB 操作实际已失败，此时既不走 fallback 也不重试 | **静默数据丢失** — store 保持空数组，但无报错 |
| **S4: `initStoreSync` 的 `listen` 失败** | Tauri event API 在某些环境下可能抛异常（窗口未完全初始化时调用 `getCurrentWindow()`） | `await listen(...)` 抛异常 → `onMount` 中未 catch → `ready` 永远不设为 `true` |
| **S5: `persistence.ts` 模块加载时副作用** | `persistence.ts` 顶层 import 了 `sync.ts`，而 `sync.ts` 顶层执行 `const WINDOW_LABEL = getCurrentWindow().label` — 如果 `getCurrentWindow()` 在模块加载时无法获取窗口实例 | **模块加载就崩溃**，连 `loadAllFromDB` 函数都拿不到 |

### 关键发现：S5 是最可能的元凶

```typescript
// sync.ts 第 7 行
const WINDOW_LABEL = getCurrentWindow().label;
```

这是一个**模块顶层副作用**。当 `sync.ts` 被 import 时（哪怕只是 import type），这行代码就会执行。而 `getCurrentWindow()` 是 Tauri API，在以下情况下会失败：

1. **模块在 SSR 阶段被求值**（SvelteKit 即使是 SPA 模式，构建时也会跑 SSR pass）
2. **Webview 还未完全就绪时就 import 该模块**
3. **在非 Tauri 环境中**（比如 `npm run dev` 的 Vite dev server 首次加载时，Tauri API 还不存在）

虽然 SvelteKit 用了 `adapter-static` + SSR disabled，但 `vite build` 仍会跑 SSR build pass（从构建日志可见 "building SSR bundle for production"）。如果在 SSR 阶段 `getCurrentWindow()` 被调用，它会抛异常。

**但更隐蔽的问题是**：即使构建不出错，在运行时，panel/settings 窗口的 WebviewWindow 启动后立即 import `sync.ts`，如果 `getCurrentWindow()` 在窗口完全初始化前就被调用，也可能返回不正确的结果或抛异常。

### 次要但同样致命的问题：`loadAllFromDB` 无 try-catch 包裹

```typescript
// panel/+page.svelte
onMount(async () => {
    await initStoreSync();    // 无 try-catch
    await loadAllFromDB();    // 无 try-catch
    ready = true;
});
```

**任何一步失败，整个初始化链路断裂，界面永远卡在加载中**。这是一个典型的"实习生错误"——只考虑了 happy path，完全没有错误恢复机制。

---

## 一、架构层面的根本问题

### 1.1 三窗口架构的天然困境

Tauri 的三窗口架构（pet / panel / settings）本质上意味着**三个独立的 JS 运行时**。Svelte store 是内存中的响应式对象，天然不跨窗口共享。

这个项目用"事件广播"（`emit`/`listen`）来同步状态，这是一个**拼凑的方案**，有以下根本缺陷：

| 缺陷 | 说明 |
|------|------|
| **最终一致性问题** | `broadcastStoreChange` 是 fire-and-forget（`catch {} 空 catch`），没有确认机制。窗口 B 可能永远收不到窗口 A 的更新 |
| **循环广播** | `watchAndSyncStores` 在 pet 窗口订阅 store 变化并广播；`initStoreSync` 在 panel 窗口监听事件并 `store.set()`。但 `store.set()` 又会触发 `subscribe` 回调——**pet 窗口也会收到自己广播出去的事件的回声**（虽然 `source === WINDOW_LABEL` 的检查防止了直接回声，但时间差内可能出现多轮广播） |
| **初始化竞态** | panel 窗口 `initStoreSync` 注册监听后，可能立即收到 pet 窗口广播的旧数据，覆盖掉 `loadAllFromDB` 刚加载的新数据 |
| **subscribe 不 unsubscribe** | `watchAndSyncStores` 中的 `subscribe` 返回值被丢弃，组件销毁时仍在广播，造成内存泄漏和幽灵广播 |

**正确方案应该是**：用 Tauri 的 `State` 管理在 Rust 侧维护单一数据源，前端窗口通过 `invoke` 读写，Rust 侧通过 `emit` 通知变更。或者用 Tauri 2 的 `webviewWindow.emit` 做定向通知而非全局广播。

### 1.2 双持久化模式的灾难性设计

这个项目试图同时支持 MySQL 和 JSON 文件两种持久化，但实现中充满了逻辑漏洞：

#### 问题 1：`isDbAvailable` 是全局模块变量，但各窗口有独立的模块实例

```
pet 窗口的 persistence.ts: isDbAvailable = true（连上了 DB）
panel 窗口的 persistence.ts: isDbAvailable = true（初始值，从未连过 DB）
```

**每个 WebviewWindow 加载的是独立的 JS 模块实例**。pet 窗口 `fallbackToFileMode()` 将自己的 `isDbAvailable` 设为 `false`，但 panel 窗口的 `isDbAvailable` 仍然是 `true`。Panel 窗口调用 `loadAllFromDB()` 时，`isDbAvailable` 为 `true`，于是走 DB 路径，但 DB 实际已不可用——Rust 端返回 `Err("数据库连接不可用")`，`tryDbOperation` 再走 fallback... **但每个窗口独立 fallback，时间线不同步。**

#### 问题 2：`saveAll()` 在 DB 模式下仍然被调用

```typescript
export async function saveMonitorRules(): Promise<void> {
  const currentRules = get(monitorRules);
  broadcastStoreChange('monitorRules', currentRules);
  const dbResult = await tryDbOperation(() => invoke('db_rule_save', { rules: currentRules }));
  if (!dbResult.ok) {
    await saveAll();  // ← 这里把所有数据写 JSON，包括 tasks/activityRecords 等
  }
}
```

当 DB 不可用时，`saveMonitorRules` 触发 `saveAll()`，把整个应用状态写一遍 JSON——包括未被修改的 tasks 和 activityRecords。这既是**性能浪费**，又是**数据一致性风险**（如果另一个窗口刚通过 DB 修改了 tasks，这里用 store 的内存值覆盖了 JSON 文件）。

#### 问题 3：`saveAiConfig` 在 persistence 层的实现先 `broadcastStoreChange` 再调 DB

```typescript
export async function saveAiConfig(): Promise<void> {
  const currentConfig = get(aiConfig);
  broadcastStoreChange('aiConfig', currentConfig);  // ← 先广播
  const dbResult = await tryDbOperation(() => invoke('db_config_save', { config: currentConfig }));
  // ...
}
```

但 `SettingsPanel.svelte` 中的本地 `saveAiConfig` 函数先 `aiConfig.set(localAiConfig)` 设置 store，然后调 `persistAiConfig()`。此时 `persistAiConfig` 读 `get(aiConfig)` 拿到的已经是新值。**但 `watchAndSyncStores` 的 subscribe 也会广播一次**——所以一次保存操作产生了**两次广播**（一次来自 `persistAiConfig` 中的 `broadcastStoreChange`，一次来自 `subscribe` 回调）。

### 1.3 Rust 后端：所有 DB 命令在 DB 不可用时返回 Err 而非降级

```rust
pub async fn db_task_list(state: State<'_, DbState>) -> Result<Vec<DbTask>, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    // ...
}
```

每个 Rust command 在 `pool` 为 `None` 时直接返回 `Err`。前端 `tryDbOperation` 捕获后走 fallback——**但 fallback 逻辑在前端，且每个窗口独立**。这意味着：

- Rust 侧无法知道前端是否真的 fallback 成功了
- 前端 fallback 到 file mode 后，`isDbAvailable` 设为 `false`，但 Rust 侧的 `DbState.is_file_mode` 可能仍是 `false`
- **Rust 和前端对"当前是什么模式"的认知可能不一致**

---

## 二、代码质量层面的系统性问题

### 2.1 错误处理：几乎不存在的防御性编程

| 位置 | 问题 |
|------|------|
| `panel/+page.svelte` 的 `onMount` | 无 try-catch，任一步失败即界面卡死 |
| `settings/+page.svelte` 的 `onMount` | 同上 |
| `sync.ts` 的 `broadcastStoreChange` | `catch {}` — 完全静默错误，广播失败无任何反馈 |
| `persistence.ts` 的 `loadAll` | 多处 `catch { }` — 静默吞掉所有加载错误 |
| `+page.svelte` 的 `loadAllFromDB().then(...)` | `.then` 中无 `.catch`，如果 `loadAllFromDB` reject，整个初始化链路断裂且无报错 |

**实习生最典型的错误模式**：只写 happy path，不处理任何异常。结果就是"编译能过但运行时用不了"。

### 2.2 模块顶层副作用

```typescript
// sync.ts
const WINDOW_LABEL = getCurrentWindow().label;  // 模块加载时立即执行

// persistence.ts
let isSaving = false;          // 模块级状态
let currentDataVersion = 0;    // 模块级状态
let isDbAvailable = true;      // 模块级状态 — 但每个窗口有独立副本
```

**模块级可变状态在多窗口应用中是灾难**。每个 WebviewWindow 加载的是同一份源码但独立的运行时，所以这些变量在每个窗口有独立的值。

`isDbAvailable` 就是典型案例：pet 窗口 fallback 到 file mode 后，panel 窗口仍然认为 DB 可用。

### 2.3 数据序列化的 snake_case / camelCase 不一致

Rust 侧用 `#[serde(rename_all = "camelCase")]`，前端 TypeScript 接口也用 camelCase。看起来一致——**但 `invoke` 的参数名是 snake_case**：

```typescript
// 前端
await invoke('db_task_create', { task });  // { task: {...} }
await invoke('db_activity_create', { record: newRecord });  // { record: {...} }
await invoke('db_rule_save', { rules: currentRules });  // { rules: [...] }
await invoke('db_config_save', { config: currentConfig });  // { config: {...} }
```

```rust
// Rust
pub async fn db_task_create(state: State<'_, DbState>, task: TaskInput) -> Result<DbTask, String>
pub async fn db_activity_create(state: State<'_, DbState>, record: ActivityInput) -> Result<(), String>
pub async fn db_rule_save(state: State<'_, DbState>, rules: Vec<DbMonitorRule>) -> Result<(), String>
pub async fn db_config_save(state: State<'_, DbState>, config: Value) -> Result<(), String>
```

Tauri 2 的 `invoke` 默认对参数名做 camelCase → snake_case 转换。所以前端 `{ task }` 对应 Rust 参数 `task`（恰好一致），`{ record }` 对应 `record`（也一致）。**但 `db_config_save` 接收的是 `Value` 类型，前端直接把 `AIConfig` 对象传过去**——如果 `AIConfig` 的字段是 camelCase（`apiKey`, `systemPrompt`），而 Rust 侧用 `config.get("apiKey")` 手动解析——**只要字段名对得上就 OK，但这是隐式约定，非常脆弱。**

同样，`db_rule_save` 接收 `Vec<DbMonitorRule>`，前端传的是 `MonitorRule[]`。`MonitorRule` 的 TypeScript 接口用 `ruleType`、`isBlacklist`，Rust 的 `DbMonitorRule` 用 `rule_type`、`is_blacklist` + `#[serde(rename_all = "camelCase")]`。**serde 的 rename_all 会处理反序列化，所以 camelCase JSON → snake_case struct 是 OK 的。** 但这只在 serde 正常工作时成立——如果某个字段名拼错或类型不匹配，只会在运行时报错，编译时完全检测不到。

### 2.4 `watchAndSyncStores` 的无限广播循环风险

```typescript
export function watchAndSyncStores() {
    tasks.subscribe(($tasks) => {
        broadcastStoreChange('tasks', $tasks);  // 每次 store 变化都广播
    });
    // ... 其他 store 同理
}
```

而 `persistence.ts` 中每个操作也在手动调用 `broadcastStoreChange`：

```typescript
export async function createTask(task: Task): Promise<void> {
  tasks.add(task);                              // ← 触发 subscribe → broadcastStoreChange
  broadcastStoreChange('tasks', get(tasks));    // ← 手动又广播一次
  // ...
}
```

**一次 `createTask` 产生了两次 `broadcastStoreChange`**。如果 panel 窗口的 `initStoreSync` 收到后执行 `tasks.set(data)`，又会触发 panel 窗口自己的 subscribe（如果 panel 也调了 `watchAndSyncStores` 的话）——不过 panel 没调，所以不会。**但 pet 窗口自己的 subscribe 确实会在 `tasks.set(data)` 时再次触发广播**——只是因为 `source === WINDOW_LABEL` 的检查，panel 端会忽略来自自己的广播。

**但问题是**：如果 pet 窗口 A 广播 → panel 窗口 B 收到 → `tasks.set(data)` → 如果 panel 也注册了 subscribe → panel 广播 → pet 收到 → pet 的 `tasks.set(data)` → pet 的 subscribe 触发 → pet 广播... **无限循环**。

当前 panel 没调 `watchAndSyncStores`，所以不会无限循环。**但这个设计非常脆弱**——任何维护者只需在 panel 中加一行 `watchAndSyncStores()` 就会触发无限循环。

### 2.5 定时器和订阅的清理问题

`+page.svelte` 的 `onMount` 返回了清理函数来清理 `monitorTimer` 和 `autoSaveTimer`，但：

- `watchAndSyncStores` 中的 `subscribe` 返回值被丢弃，**无法 unsubscribe**
- `initStoreSync` 中 `listen` 返回的 `UnlistenFn` 被丢弃，**无法 unlisten**
- `speechTimer` 在 `onMount` 清理函数中清理，但 `speechTimer` 是组件顶层变量，可能在 `onMount` 之后才被赋值

---

## 三、为什么 Bug 这么多——根因分析

### 3.1 缺乏对 Tauri 多窗口运行模型的理解

这是最根本的问题。Tauri 的多窗口架构意味着：

1. **每个窗口是独立的 JS 运行时** — Svelte store、模块级变量、甚至 `Date.now()` 都在各窗口独立运行
2. **Rust `State` 是进程级共享的** — `DbState` 在所有窗口间共享，但前端的 `isDbAvailable` 等变量不是
3. **`emit`/`listen` 是异步的** — 事件传递有延迟，不是即时同步

实习生把这当成"一个网页应用"来写，忽略了多进程（多 Webview）的本质。

### 3.2 缺乏分层架构意识

当前代码的"分层"是这样的：

```
UI 组件 (+page.svelte, TaskPanel, SettingsPanel)
  ↓ 直接调用
持久化层 (persistence.ts)
  ↓ 直接调用
Tauri invoke (Rust backend)
```

但**每一层都有泄漏**：

- UI 组件直接 import `invoke`（`+page.svelte` 中 `invoke('get_active_window')`）
- 持久化层直接 import 并修改 store（`tasks.add()`, `monitorRules.set()`）
- 同步层直接 import 并订阅 store（`tasks.subscribe()`）
- 所有层都交织在一起，没有清晰的依赖方向

**结果**：改一个地方需要同时理解所有层的交互，任何修改都可能产生蝴蝶效应。

### 3.3 "先让它跑起来"的开发模式

大量代码明显是"先写个能编译的版本"：

- 假 UI（disabled 的 input）
- `catch {}` 空 catch
- 死代码（定义但未消费的 store）
- 重复代码（`getCompletionHint` 在两个文件中定义）
- 双重监控周期（Rust 线程 + JS setInterval）
- `let _ =` 丢弃 DB 连接结果

**这些都是"让它编译通过"的产物，而非"让它正确运行"的产物。**

### 3.4 缺乏运行时测试

项目没有任何自动化测试。`svelte-check` 和 `cargo check` 只验证类型和编译，不验证运行时逻辑。所有 Bug 都是运行时 Bug——编译器帮不上忙。

---

## 四、具体 Bug 清单（当前代码中仍存在的）

### 🔴 致命（会导致功能完全不可用）

| # | Bug | 位置 | 说明 |
|---|-----|------|------|
| C1 | **面板/设置窗口可能永远卡在"加载中"** | `panel/+page.svelte:9-12`, `settings/+page.svelte:9-12` | `initStoreSync()` 或 `loadAllFromDB()` 抛异常时 `ready` 永远不设为 `true`，无 try-catch |
| C2 | **`sync.ts` 模块顶层 `getCurrentWindow()` 可能在某些时机崩溃** | `sync.ts:7` | 模块加载时的副作用，如果 Tauri API 未就绪则抛异常，导致整个 sync 模块不可用 |
| C3 | **`isDbAvailable` 在各窗口间不一致** | `persistence.ts:9` | 模块级变量，每个窗口独立。pet 窗口 fallback 后 panel 窗口仍认为 DB 可用 |
| C4 | **DB 命令在 DB 不可用时返回 Err 而非空结果** | `commands/*.rs` 所有命令 | `pool().ok_or("数据库连接不可用")` 直接返回 Err，前端必须逐个 tryDbOperation 处理，遗漏一个就崩溃 |

### 🟠 严重（会导致数据不一致或功能降级）

| # | Bug | 位置 | 说明 |
|---|-----|------|------|
| S1 | **双重广播：persistence 手动 broadcast + subscribe 回调自动 broadcast** | `persistence.ts` + `sync.ts:47-58` | 每次 store 变化产生两次事件广播 |
| S2 | **`watchAndSyncStores` 的 subscribe 不 unsubscribe** | `sync.ts:47-58` | 返回值被丢弃，组件销毁后仍在广播 |
| S3 | **`initStoreSync` 的 listen 不 unlisten** | `sync.ts:16` | 返回的 `UnlistenFn` 被丢弃，窗口关闭后监听器泄漏 |
| S4 | **`isDbUnavailableError` 匹配过于宽泛** | `persistence.ts:30-35` | `msg.includes('Database') \|\| msg.includes('connect')` 会误匹配非 DB 错误 |
| S5 | **`saveMonitorRules`/`saveAiConfig` fallback 时调用 `saveAll()`** | `persistence.ts:139, 148` | 把所有数据重写 JSON，包括未被修改的数据，有数据覆盖风险 |
| S6 | **`loadAllFromDB` 中非 DB 错误被静默忽略** | `persistence.ts:169-187` | 如果 `tryDbOperation` 抛出非 DB 错误（如 serde 错误），`isDbAvailable` 仍为 true，但数据未加载 |
| S7 | **`db_config_get` 返回 `Value` 而非类型化结构体** | `commands/config.rs:7` | 手动拼 JSON map，与 TypeScript 接口的字段名是隐式约定，无编译时检查 |
| S8 | **`db_rule_save` 接收 `Vec<DbMonitorRule>` 但前端传的是 `MonitorRule[]`** | `commands/rule.rs:17` | 依赖 serde rename_all 正确工作，但 `MonitorRule.ruleType` → Rust `rule_type` 的映射是隐式的 |

### 🟡 中等（不影响核心功能但体验差）

| # | Bug | 位置 | 说明 |
|---|-----|------|------|
| M1 | **`validateAiConfig` 发送真实 API 请求来验证** | `ai.ts:25-37` | 应该只验证 endpoint 可达（HEAD 请求），不应消耗 token |
| M2 | **`getCompletionHint` 每次添加任务都调 AI** | `ai.ts:240-252` | 即使用户只是快速添加"买菜"这种简单任务，也要等 AI 响应 |
| M3 | **`loadAll` 的版本检查逻辑** | `persistence.ts:218-222` | `diskVersion < currentDataVersion` 时跳过加载——但刚启动时 `currentDataVersion = 0`，所以总是加载。这个机制实际上没起作用 |
| M4 | **auto-save 每 5 秒调 `saveAll()` 写 JSON** | `persistence.ts:246-254` | 在 DB 模式下，JSON 文件每 5 秒被完全重写一次，浪费 I/O |
| M5 | **SettingsPanel 通用设置 tab 的三个控件是 disabled 占位** | `SettingsPanel.svelte:157-168` | 用户能看到但无法操作，无明确的"即将支持"视觉区分 |

---

## 五、架构重写建议

### 5.1 短期修复（让面板/设置能打开）

1. **panel/+page.svelte 和 settings/+page.svelte 的 onMount 加 try-catch**：

```typescript
onMount(async () => {
    try {
        await initStoreSync();
    } catch (e) {
        console.error('Store sync 初始化失败:', e);
    }
    try {
        await loadAllFromDB();
    } catch (e) {
        console.error('数据加载失败:', e);
    }
    ready = true;  // 无论如何都要渲染界面
});
```

2. **sync.ts 的 `getCurrentWindow()` 延迟到函数调用时获取**，不要在模块顶层执行：

```typescript
function getWindowLabel(): string {
    try {
        return getCurrentWindow().label;
    } catch {
        return 'unknown';
    }
}
```

3. **`loadAllFromDB` 整体加 try-catch**，确保即使 DB 全挂也能 fallback 到空数据。

### 5.2 中期重构（消除多窗口状态不一致）

1. **将 `isDbAvailable` 改为从 Rust 端查询**，而非前端模块变量：

```typescript
async function isDbAvailable(): Promise<boolean> {
    const status = await invoke<DbStatusInfo>('db_status');
    return status.available;
}
```

2. **消除 `watchAndSyncStores`**，改为在 persistence 层的每个写操作中显式 `broadcastStoreChange`（已有），不在 pet 窗口做 subscribe 广播。

3. **`broadcastStoreChange` 加确认机制**，至少加 log，不要 `catch {}`。

### 5.3 长期重写（根本性架构改进）

1. **Rust 侧维护单一数据源**：所有 CRUD 只走 Rust，前端通过 `invoke` 读写，Rust 通过 `emit` 通知变更。
2. **前端 store 改为 "view model"**：只缓存当前窗口需要的数据，收到 Rust 通知时更新。
3. **消除 JSON file mode**：要么用 DB，要么用 Rust 侧的文件读写，不要前端直接操作 JSON。

---

## 六、总结

这个项目的核心问题不是某个具体的 Bug，而是**对 Tauri 多窗口运行模型的根本性误解**导致的系统性缺陷。

实习生把三个 Tauri 窗口当成"同一个网页的三个 div"来写，但实际上它们是**三个独立进程中的三个独立 JS 运行时**。所有基于"Svelte store 天然共享"的假设都是错误的。

在这个错误假设之上，用 `emit`/`listen` 事件拼凑跨窗口同步，用模块级变量管理 DB 状态，用无 try-catch 的 async 链路做初始化——这些都是"看起来对但运行时全错"的代码。

**一句话总结**：编译通过是因为 TypeScript 和 Rust 编译器只检查语法和类型；运行时崩溃是因为多窗口状态管理、错误处理、数据一致性这三个层面都存在根本性设计缺陷，而这些缺陷是编译器无法检测的。
