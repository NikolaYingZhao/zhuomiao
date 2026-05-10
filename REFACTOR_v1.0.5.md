# 桌喵 (Zhuomiao) v1.0.5 重构技术文档

> 版本: 1.0.3 → 1.0.5  
> 日期: 2026-05-09  
> 目标: 修复所有运行时致命 Bug，使应用从"编译能过但完全用不了"达到可上线质量

---

## 1. 问题总览

原 v1.0.3 编译通过但存在 **15 个运行时致命 Bug**，涵盖数据一致性、跨窗口状态、持久化、内存泄漏、安全策略等核心问题。经两轮审计后追加 7 项返工修复。

---

## 2. Bug 清单与修复方案

### BUG-1: 任务重复添加

| 项目 | 内容 |
|------|------|
| **现象** | 创建任务时，`persistence.ts` 的 `createTask` 已调用 `tasks.add(task)`，但 `+page.svelte` 和 `TaskPanel.svelte` 又重复调用，导致任务出现两份 |
| **根因** | 持久化层和 UI 层职责划分不清，两处都执行 store 更新 |
| **修复** | 删除 `+page.svelte` 和 `TaskPanel.svelte` 中多余的 `tasks.add(task)`，只保留 `persistence.ts` 中的唯一入口 |
| **文件** | `src/routes/+page.svelte`, `src/lib/components/TaskPanel.svelte` |

### BUG-2: 跨窗口状态不共享

| 项目 | 内容 |
|------|------|
| **现象** | 每个 Tauri WebviewWindow 有独立 JS 运行时，Svelte store 不跨窗口共享。pet 窗口添加任务，panel 窗口看不到 |
| **根因** | 无跨窗口同步机制，各窗口 store 实例独立 |
| **修复** | 新建 `src/lib/services/sync.ts`，基于 Tauri event system 实现桥接层。`broadcastStoreChange()` 在变更时 emit 事件，`initStoreSync()` 在 panel/settings 窗口监听并同步 store。所有持久化操作调用 `broadcastStoreChange` |
| **文件** | `src/lib/services/sync.ts`（新增）, `src/routes/panel/+page.svelte`, `src/routes/settings/+page.svelte`, `src/lib/services/persistence.ts` |

### BUG-3: Activity Records 只走 JSON 永远不写 DB

| 项目 | 内容 |
|------|------|
| **现象** | `saveAll()` 只写 JSON 文件，activity records 从不写入 MySQL |
| **根因** | `saveAll` 走 `invoke('save_app_data')` 只写 JSON，无 DB 持久化路径 |
| **修复** | 新增 `saveActivityRecords()`，DB 优先写入（`db_activity_create`），失败 fallback 到 JSON。`loadAllFromDB()` 也加载 activity records。校准场景用 `calibrateActivityRecord()` |
| **文件** | `src/lib/services/persistence.ts`, `src/routes/+page.svelte` |

### BUG-4: Settings 窗口数据加载不一致

| 项目 | 内容 |
|------|------|
| **现象** | Settings 窗口用 `loadAll()`（JSON 模式）而非 `loadAllFromDB()`（DB 优先），DB 模式下显示过期数据 |
| **根因** | 初始开发时各窗口独立加载，未统一用 DB 优先逻辑 |
| **修复** | `settings/+page.svelte` 改用 `loadAllFromDB()` + `initStoreSync()` |
| **文件** | `src/routes/settings/+page.svelte` |

### BUG-5: `db_connect` 运行时重连完全无效

| 项目 | 内容 |
|------|------|
| **现象** | `db_connect` 命令新建连接后 `let _ =` 丢弃，运行时重连无效 |
| **根因** | `DbState.pool` 无内部可变性（`Option<MySqlPool>` 无 `Arc<RwLock<>>`），且结果被丢弃 |
| **修复** | `DbState` 改为 `Arc<RwLock<Option<MySqlPool>>>` + `AtomicBool is_file_mode`。新增 `replace_pool()` 方法。`db_connect` 调用 `replace_pool` 替换连接池并运行迁移 |
| **文件** | `src-tauri/src/db/mod.rs`, `src-tauri/src/commands/config.rs` |

### BUG-6: 双重监控周期

| 项目 | 内容 |
|------|------|
| **现象** | Rust 无限循环线程（`start_monitor_cycle`）+ JS `setInterval` 完全重复，且 Rust 线程无法停止 |
| **根因** | 早期设计在 Rust 端做监控循环，后来又在前端加了一层 |
| **修复** | 删除 `start_monitor_cycle` 命令和线程，删除 `check_fish_detection` 死命令。前端 JS `setInterval` 为唯一监控入口 |
| **文件** | `src-tauri/src/lib.rs`, `src-tauri/permissions/`, `src/routes/+page.svelte` |

### BUG-7: `showSpeech` 定时器叠加

| 项目 | 内容 |
|------|------|
| **现象** | 快速连续触发时，多个 setTimeout 叠加，气泡状态被提前清除 |
| **根因** | 每次触发都新建 setTimeout，未清除前一个 |
| **修复** | 增加 `speechTimer` 变量追踪，新触发时先 `clearTimeout(speechTimer)` |
| **文件** | `src/routes/+page.svelte` |

### BUG-8: 定时器永不清理

| 项目 | 内容 |
|------|------|
| **现象** | `setInterval`/`setTimeout` 返回值未保存，组件销毁时无法清理 |
| **根因** | 缺少 `onMount` 返回清理函数 |
| **修复** | 保存 `monitorIntervalId`，`onMount` 返回 `() => clearInterval(monitorIntervalId)` |
| **文件** | `src/routes/+page.svelte` |

### BUG-9: 通用设置面板假 UI

| 项目 | 内容 |
|------|------|
| **现象** | 通用设置 tab 的3个控件（开机自启、监控间隔、气泡时长）无 bind、无事件，点击无效 |
| **根因** | 占位 UI 未实现功能 |
| **修复** | 添加 `disabled` 属性 + "即将支持"提示，明确标识为未实现 |
| **文件** | `src/lib/components/SettingsPanel.svelte` |

### BUG-10: `DbState.pool` 无内部可变性

| 项目 | 内容 |
|------|------|
| **现象** | 多个 async command 同时调用 `pool()` 会 panic 或返回 stale 值 |
| **根因** | `Option<MySqlPool>` 无线程安全包装 |
| **修复** | 改为 `Arc<RwLock<Option<MySqlPool>>>`，所有 command 中 `pool` 引用改为 `&pool` |
| **文件** | `src-tauri/src/db/mod.rs`, `src-tauri/src/commands/*.rs` |

### BUG-11: `parseChatResponse` 中 HINT 覆盖 COMPLETE

| 项目 | 内容 |
|------|------|
| **现象** | AI 回复同时包含 `[COMPLETE:id]` 和 `[HINT:id:text]` 时，后者覆盖前者 |
| **根因** | `ChatResponse.action` 是单一 `TaskAction`，后赋值覆盖前赋值 |
| **修复** | `ChatResponse.action` → `actions: TaskAction[]`，解析时 push 到数组。`QuickChat.svelte` 遍历执行 |
| **文件** | `src/lib/types/index.ts`, `src/lib/services/chat.ts`, `src/lib/components/QuickChat.svelte` |

### BUG-12: `ActivityChart` 的 `$derived` 返回函数

| 项目 | 内容 |
|------|------|
| **现象** | `$derived(() => {...})` 在 Svelte 5 中返回函数引用而非计算值 |
| **根因** | Svelte 5 语法差异，`$derived` 自动追踪表达式，`$derived.by` 用于函数体 |
| **修复** | 改为 `$derived.by(() => {...})` |
| **文件** | `src/lib/components/ActivityChart.svelte` |

### BUG-13: `petState`/`petMessage` stores 是死代码

| 项目 | 内容 |
|------|------|
| **现象** | 定义但从未消费，增加 bundle 体积 |
| **修复** | 从 `stores/index.ts` 中删除 |
| **文件** | `src/lib/stores/index.ts` |

### BUG-14: `getCompletionHint` 重复定义

| 项目 | 内容 |
|------|------|
| **现象** | `+page.svelte` 和 `TaskPanel.svelte` 中完全相同的函数定义 |
| **修复** | 提取到 `ai.ts` 作为 export，两处改为 import |
| **文件** | `src/lib/services/ai.ts`, `src/routes/+page.svelte`, `src/lib/components/TaskPanel.svelte` |

### BUG-15: CSP 完全禁用

| 项目 | 内容 |
|------|------|
| **现象** | `"csp": null` 允许所有内容源，存在 XSS 风险 |
| **修复** | 改为限制性 CSP 策略：`default-src 'self'; connect-src https://* http://localhost:1420; style-src 'self' 'unsafe-inline'; img-src 'self' data:` |
| **文件** | `src-tauri/tauri.conf.json` |

---

## 3. 返工审计修复

### R-1: sync.ts 中 emit 用了不必要的动态 import

- **修复**: `await import('@tauri-apps/api/core')` → 静态 `import { emit } from '@tauri-apps/api/core'`

### R-2: ai.ts 中 `getCompletionHint` 用了动态 import

- **修复**: `await import()` → 静态 import

### R-3: `saveActivityRecords` 只将最新一条记录写 DB

- **修复**: 区分 `newRecord` 参数（新增记录走 `db_activity_create`）和校准场景（走 `db_activity_calibrate`）

### R-4: rules 和 aiConfig 变更只写 JSON 不写 DB

- **修复**: 新增 `saveMonitorRules()`（DB: `db_rule_save` + JSON fallback）和 `saveAiConfig()`（DB: `db_config_save` + JSON fallback）

### R-5: `SettingsPanel.svelte` 中 `saveAiConfig` 直接调 `saveAll()`

- **修复**: 改用 `persistAiConfig()`（persistence 层的 `saveAiConfig`），rules 变改用 `persistMonitorRules()`

### R-6: stale permissions 文件

- **修复**: 删除 `check_fish_detection.toml`、`start_monitor_cycle.toml`，从 `default.toml` 移除对应条目

### R-7: 版本号未 bump

- **修复**: `tauri.conf.json`、`Cargo.toml`、`package.json` 版本号 1.0.3 → 1.0.5

---

## 4. 架构变更总览

### Rust 后端

| 变更 | 详情 |
|------|------|
| `DbState` 线程安全重构 | `Option<MySqlPool>` → `Arc<RwLock<Option<MySqlPool>>>` + `AtomicBool` |
| 新增 `replace_pool()` | 运行时替换连接池，更新 `is_file_mode` 标志 |
| `db_connect` 真正生效 | 调用 `replace_pool()` + `run_migrations()` |
| 删除死代码 | `check_fish_detection` 命令、`start_monitor_cycle` 命令/线程、`set_file_mode` 方法、重复结构体 |
| pool 引用统一 | 所有 command 中 `pool` 改为 `&pool` |
| 临时 runtime 替换 | 用 `tauri::async_runtime::block_on` 替代手动创建的 tokio runtime |

### 前端

| 变更 | 详情 |
|------|------|
| 新增跨窗口同步 | `sync.ts`（Tauri event 桥接层），panel/settings 窗口加入 `initStoreSync()` |
| 统一持久化 | `saveActivityRecords`、`saveMonitorRules`、`saveAiConfig`、`calibrateActivityRecord` |
| 重复添加修复 | 删除 UI 层多余的 `tasks.add()` |
| 定时器管理 | `speechTimer` 防叠加 + `onMount` 清理函数 |
| 窗口创建修复 | `openPanel`/`openSettings` 只用 `getByLabel`，删除冗余 `WebviewWindow` 构造 |
| Chat actions | `ChatResponse.action` → `actions: TaskAction[]` |
| ActivityChart | `$derived` → `$derived.by` |
| SettingsPanel | 假 UI 加 `disabled`，改用 persistence 层持久化 |
| CSP 安全 | `null` → 限制性策略 |
| 版本号 | 1.0.3 → 1.0.5 |

---

## 5. 修改文件清单

### Rust 后端
- `src-tauri/src/db/mod.rs` — DbState 线程安全重构，删除 `set_file_mode`
- `src-tauri/src/lib.rs` — 删除死命令/线程，用 `tauri::async_runtime::block_on`
- `src-tauri/src/commands/config.rs` — 修复 `db_connect`，pool 引用 `&pool`
- `src-tauri/src/commands/task.rs` — pool 引用 `&pool`
- `src-tauri/src/commands/activity.rs` — pool 引用 `&pool`
- `src-tauri/src/commands/rule.rs` — pool 引用 `&pool`
- `src-tauri/src/commands/migration.rs` — pool 引用 `&pool`
- `src-tauri/tauri.conf.json` — CSP 安全策略，版本号 1.0.5
- `src-tauri/Cargo.toml` — 版本号 1.0.5
- `src-tauri/permissions/default.toml` — 删除 stale 条目

### 删除的文件
- `src-tauri/permissions/commands/check_fish_detection.toml`
- `src-tauri/permissions/commands/start_monitor_cycle.toml`

### 前端
- `src/routes/+page.svelte` — 核心重构：重复添加、定时器、showSpeech、窗口创建、死代码、统一持久化
- `src/routes/panel/+page.svelte` — `initStoreSync` + `loadAllFromDB`
- `src/routes/settings/+page.svelte` — `loadAllFromDB` + `initStoreSync`
- `src/lib/services/sync.ts` — **新增** 跨窗口状态同步桥接
- `src/lib/services/persistence.ts` — 新增统一持久化函数
- `src/lib/services/ai.ts` — export `getCompletionHint`（静态 import）
- `src/lib/services/chat.ts` — `parseChatResponse` 支持 `actions` 数组
- `src/lib/stores/index.ts` — 删除死代码 `petState`/`petMessage`
- `src/lib/types/index.ts` — `ChatResponse.action` → `actions: TaskAction[]`
- `src/lib/components/TaskPanel.svelte` — 删除重复函数 + 重复 `tasks.add`
- `src/lib/components/QuickChat.svelte` — 支持 `response.actions` 数组
- `src/lib/components/ActivityChart.svelte` — `$derived.by` 修复
- `src/lib/components/SettingsPanel.svelte` — 假 UI `disabled`，改用 persistence 层持久化
- `package.json` — 版本号 1.0.5

---

## 6. 验证结果

| 检查项 | 结果 |
|--------|------|
| `cargo check` | 0 errors, 0 warnings |
| `svelte-check` | 0 errors, 9 warnings (a11y only) |
| 版本号一致 | `tauri.conf.json` = `Cargo.toml` = `package.json` = 1.0.5 |

---

## 7. 数据流（修复后）

```
Win32 API → Rust get_active_window → Frontend checkActivity() (every 45s)
  → Rule matching (blacklist on title/process, skips if no incomplete tasks)
  → AI judgment (if configured; classifyActivity + chatWithAI)
  → AI may detect task completion → "completed?" confirmation → toggleTask with 'ai_detected'
  → Speech bubble + pet state change
  → ActivityRecord persisted (DB优先, JSON fallback)
  → broadcastStoreChange → 跨窗口同步
```

### 持久化策略（修复后）

| 数据 | DB 模式 | File 模式 |
|------|---------|-----------|
| Tasks | `db_task_create/remove/update/toggle/clear_completed` | `saveAll()` → JSON |
| Activity Records | `db_activity_create` / `db_activity_calibrate` | `save_app_data` → JSON |
| Monitor Rules | `db_rule_save` | `saveAll()` → JSON |
| AI Config | `db_config_save` | `saveAll()` → JSON |

### 跨窗口同步（新增）

```
pet 窗口 → broadcastStoreChange('tasks', data) → Tauri emit event
panel 窗口 ← initStoreSync() ← Tauri listen event → tasks.set(data)
settings 窗口 ← initStoreSync() ← Tauri listen event → aiConfig/monitorRules.set(data)
```

---

## 8. 已知局限

1. **a11y 警告**: SettingsPanel 中多个 `<label>` 未通过 `for` 属性关联控件（Svelte warning，不影响功能）
2. **通用设置 tab**: 开机自启、监控间隔、气泡时长仍为占位 UI（`disabled`）
3. **CSP `unsafe-inline`**: style-src 需要 `unsafe-inline` 以支持 Svelte CSS scoping
4. **`node` 类型定义缺失**: tsconfig 引用了 `@types/node` 但未安装（仅影响类型检查，不影响运行时）
