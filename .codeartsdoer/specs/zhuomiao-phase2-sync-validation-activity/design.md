# 桌喵 第二阶段 — 数据同步竞态修复、API验证与活动追踪 实现方案（design.md）

---

# **1. 实现模型**

## **1.1 上下文视图**

本次修改涉及三层架构的协同变更，核心数据流如下：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Tauri v2 Runtime                                │
│  ┌───────────────────┐    ┌──────────────────────────────────────────┐ │
│  │  Capabilities 配置 │    │          Rust 后端 (lib.rs)             │ │
│  │  default.json      │    │  ┌──────────────────────────────────┐  │ │
│  │  ┌───────────────┐ │    │  │ IPC Commands:                   │  │ │
│  │  │ 新增权限:      │ │    │  │  get_active_window              │  │ │
│  │  │  自定义命令    │ │    │  │  save_app_data                  │  │ │
│  │  │  显式授权      │ │    │  │  load_app_data                  │  │ │
│  │  └───────────────┘ │    │  │  get_data_dir / set_data_dir   │  │ │
│  └───────────────────┘    │  │  start_monitor_cycle             │  │ │
│                            │  │  check_fish_detection            │  │ │
│                            │  └──────────────────────────────────┘  │ │
│                            └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                              ↕ IPC (invoke / emit)
┌─────────────────────────────────────────────────────────────────────────┐
│                       Svelte 5 前端                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ SettingsPanel │  │  Panel       │  │    +page.svelte (主页面)     │ │
│  │ ┌────────────┐│  │ ┌────────────┐│  │ ┌────────────────────────┐ │ │
│  │ │saveAiConfig││  │ │ ★ 移除3秒  ││  │ │ checkActivity()       │ │ │
│  │ │ ★ 验证请求 ││  │ │   loadAll  ││  │ │ ★ 活动记录采集       │ │ │
│  │ │ ★ 验证失败 ││  │ │   轮询    ││  │ │ ★ AI分类活动         │ │ │
│  │ │   不保存   ││  │ │ ★ 仅onMount││  │ │ ★ 规则匹配降级分类   │ │ │
│  │ │ ★ 回滚逻辑 ││  │ │   一次加载 ││  │ │ ★ 活动记录持久化     │ │ │
│  │ └────────────┘│  │ └────────────┘│  │ │ ★ 右键菜单新增图表   │ │ │
│  └──────────────┘  └──────────────┘  │ └────────────────────────┘ │ │
│                                        │                              │ │
│  ┌──────────────┐  ┌──────────────┐   ┌──────────────────────────────┐│
│  │ persistence   │  │   stores     │   │    ai.ts                    ││
│  │ ┌────────────┐│  │ ┌────────────┐│  │ ┌────────────────────────┐ ││
│  │ │ ★ isSaving ││  │ │ ★ dataVer  ││  │ │ ★ validateAiConfig() │ ││
│  │ │   保存锁   ││  │ │   sion     ││  │ │   API验证请求         │ ││
│  │ │ ★ dataVer  ││  │ │ ★ activity ││  │ │ ★ classifyActivity() │ ││
│  │ │   sion版本 ││  │ │   Records  ││  │ │   活动分类函数       │ ││
│  │ │   戳机制   ││  │ │   store    ││  │ └────────────────────────┘ ││
│  │ │ ★ activity ││  │ └────────────┘│  └──────────────────────────────┘│
│  │ │   records  ││  │                                              ││
│  │ │   持久化   ││  │  ┌──────────────────────────────────────────┐ ││
│  │ │ ★ 30天清理 ││  │  │    ActivityChart.svelte (★新增)         │ ││
│  │ └────────────┘│  │  │ ┌────────────────────────────────────┐  │ ││
│  └──────────────┘  │  │ │ ★ 每小时时段分布条                │  │ ││
│                     │  │ │ ★ 工作(绿)/摸鱼(红)比例           │  │ ││
│  ┌──────────────┐  │  │ │ ★ 日期选择器                      │  │ ││
│  │ types/index   │  │  │ │ ★ 空状态提示                      │  │ ││
│  │ ┌────────────┐│  │  │ └────────────────────────────────────┘  │ ││
│  │ │ ★ Activity ││  │  └──────────────────────────────────────────┘ ││
│  │ │   Record   ││  │                                              ││
│  │ │   类型定义 ││  └──────────────────────────────────────────────┘│
│  │ └────────────┘│                                                    │
│  └──────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## **1.2 服务/组件总体架构**

### 修改范围与分层职责

| 层级 | 组件 | 变更性质 | 职责 |
|------|------|----------|------|
| **基础设施层** | `default.json` | 修改 | 添加自定义 IPC 命令权限（上一阶段已验证需补充） |
| **类型层** | `types/index.ts` | 修改 | 新增 `ActivityRecord` 类型定义 |
| **状态层** | `stores/index.ts` | 修改 | 1) 新增 `activityRecords` store 2) store 操作中递增 `dataVersion` 3) 新增 `dataVersion` writable |
| **持久化层** | `persistence.ts` | 修改 | 1) 新增 `isSaving` 保存锁标志 2) `loadAll` 增加保存锁+版本戳检查 3) 新增 `dataVersion` 版本戳机制 4) `saveAll`/`loadAll` 扩展支持 `activity-records` 5) 加载时清理30天过期记录 |
| **AI服务层** | `ai.ts` | 修改 | 1) 新增 `validateAiConfig()` 函数 2) 新增 `classifyActivity()` 函数 |
| **UI层** | `SettingsPanel.svelte` | 修改 | `saveAiConfig()` 增加验证请求步骤，验证失败不保存 |
| **UI层** | `panel/+page.svelte` | 修改 | 移除 `setInterval(loadAll, 3000)` 轮询，仅保留初始化加载 |
| **UI层** | `+page.svelte` | 修改 | 1) `checkActivity()` 增加活动记录采集+AI分类+降级 2) 右键菜单新增"📊 活动图表"选项 3) 活动记录持久化触发 |
| **UI层** | `ActivityChart.svelte` | **新增** | 活动图表组件（含日期选择器、24小时时段分布条） |
| **路由层** | `routes/activity/+page.svelte` | **新增** | 活动图表页面 |

### 架构决策

1. **竞态根治方案——移除面板独立轮询**：当前 `panel/+page.svelte` 有独立的 `setInterval(loadAll, 3000)` 轮询，这是竞态条件的根本原因。面板与主页面共享同一 Svelte store，store 变更通过响应式机制自动传播到面板 UI，无需轮询。**移除轮询是最直接、最彻底的修复**。作为补充保护，在 `persistence.ts` 中增加 `isSaving` 保存锁和 `dataVersion` 版本戳。

2. **API 验证先于保存**：在 `saveAiConfig()` 中，先使用 `localAiConfig`（用户编辑中的临时值）发送验证请求，验证成功后才执行 `aiConfig.set(localAiConfig)` + `saveAll()`。验证失败时 store 不变（因为 set 在验证之后），无需回滚。

3. **活动分类与监控解耦**：活动分类（productive/slacking）与现有的摸鱼提醒逻辑并行执行——每次 `checkActivity()` 调用同时完成两件事：(a) 摸鱼提醒（已有逻辑）(b) 活动记录+分类（新增逻辑）。两者共享 AI 请求结果，避免重复调用 API。

4. **活动图表纯 CSS 渲染**：不引入第三方图表库，使用 CSS flexbox + 色彩条实现 24 小时时段分布图，保持轻量。

5. **版本戳方案**：使用内存中的 `dataVersion` 单调递增计数器，每次 `saveAll` 完成后递增。`loadAll` 从磁盘读取数据后，比较磁盘数据携带的版本号与内存版本号，仅当磁盘版本 ≥ 内存版本时才覆盖 store。

## **1.3 实现设计文档**

### 1.3.1 REQ-SYNC-001：保存期间禁止 loadAll 覆盖 store

**根因分析**：

当前 `persistence.ts` 的 `saveAll()` 和 `loadAll()` 是完全独立的异步函数，没有任何协调机制。当 `saveAll` 正在执行时（3 个顺序 `await invoke` 调用），`loadAll` 可能在任意时刻介入，从磁盘读取到保存过程中的中间状态或旧数据，覆盖 store 中的最新值。

**实现方案**：

在 `persistence.ts` 中新增模块级变量 `isSaving` 作为保存锁：

```typescript
// persistence.ts — 新增保存锁
let isSaving = false;

export function getIsSaving(): boolean {
  return isSaving;
}

export async function saveAll(): Promise<void> {
  isSaving = true;  // ★ 获取保存锁
  try {
    await invoke('save_app_data', { key: 'tasks', data: get(tasks) });
    await invoke('save_app_data', { key: 'monitor-rules', data: get(monitorRules) });
    await invoke('save_app_data', { key: 'ai-config', data: get(aiConfig) });
    await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) });  // ★ 扩展
    dataVersion++;  // ★ 递增版本戳
  } finally {
    isSaving = false;  // ★ 释放保存锁
  }
}

export async function loadAll(): Promise<void> {
  // ★ 保存锁检查：正在保存时跳过本次加载
  if (isSaving) {
    console.log('[persistence] loadAll 跳过：saveAll 正在执行中');
    return;
  }

  // 加载各项数据（含版本戳比较）...
}
```

---

### 1.3.2 REQ-SYNC-002：面板页面移除独立 loadAll 轮询

**根因分析**：

当前 `panel/+page.svelte` 的 `onMount` 中有：

```typescript
const interval = setInterval(async () => {
  await loadAll();
}, 3000);
```

这是竞态条件的直接诱因。面板窗口与主窗口共享同一个 Svelte store（`tasks`, `monitorRules`, `aiConfig`），当主页面执行 `saveAll` 将 store 数据写入磁盘时，面板的 `loadAll` 轮询可能从磁盘读取到旧数据覆盖 store。

**实现方案**：

移除 `setInterval`，仅保留初始化加载：

```typescript
// panel/+page.svelte — 改造后
onMount(() => {
  loadAll().then(() => { ready = true; });
  // ★ 不再有 setInterval(loadAll, 3000)
  // 面板通过 Svelte store 的响应式机制自动更新 UI
});
```

**数据同步机制**：面板窗口与主窗口在 Tauri v2 中属于同一应用的多个 webview，共享同一个 JS 上下文中的 Svelte store。当主页面修改 store 后，面板页面的 `$tasks` 等响应式绑定会自动更新 UI。

> **注意**：如果 Tauri v2 的多 webview 架构导致 store 不共享（每个 webview 有独立 JS 上下文），则需要通过 Tauri 事件机制（`emit`/`listen`）进行跨窗口数据同步。当前实现中面板窗口在 `onMount` 时调用 `loadAll()` 初始化数据，后续依赖主页面通过事件通知面板刷新。但鉴于当前架构下 `loadAll` 轮询已证明 store 确实会被覆盖（说明存在共享），移除轮询后面板 UI 将通过 store 响应式更新。

---

### 1.3.3 REQ-SYNC-003：版本戳机制防止数据覆盖

**实现方案**：

在 `persistence.ts` 中新增模块级变量 `dataVersion`，并在 `loadAll` 中加入版本比较：

```typescript
// persistence.ts — 版本戳
let dataVersion = 0;

export function getDataVersion(): number {
  return dataVersion;
}

export async function saveAll(): Promise<void> {
  isSaving = true;
  try {
    const currentVersion = dataVersion;
    await invoke('save_app_data', { key: 'tasks', data: get(tasks) });
    await invoke('save_app_data', { key: 'monitor-rules', data: get(monitorRules) });
    await invoke('save_app_data', { key: 'ai-config', data: get(aiConfig) });
    await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) });
    // ★ 保存版本号到磁盘（与 tasks 一起存储或单独文件）
    await invoke('save_app_data', { key: 'data-version', data: { version: currentVersion + 1, lastModifiedAt: new Date().toISOString() } });
    dataVersion = currentVersion + 1;
  } finally {
    isSaving = false;
  }
}

export async function loadAll(): Promise<void> {
  if (isSaving) return;

  // ★ 先加载版本号
  let diskVersion = 0;
  try {
    const versionData = await invoke<{ version: number } | null>('load_app_data', { key: 'data-version' });
    diskVersion = versionData?.version ?? 0;
  } catch { /* 版本文件不存在，视为版本 0 */ }

  // ★ 版本比较：磁盘数据更旧时拒绝覆盖
  if (diskVersion < dataVersion) {
    console.log(`[persistence] loadAll 跳过：磁盘版本(${diskVersion}) < 内存版本(${dataVersion})`);
    return;
  }

  // 正常加载数据...
  try {
    const tasksData = await invoke<Task[] | null>('load_app_data', { key: 'tasks' });
    if (tasksData) tasks.set(tasksData);
  } catch { }

  try {
    const rulesData = await invoke<MonitorRule[] | null>('load_app_data', { key: 'monitor-rules' });
    if (rulesData) monitorRules.set(rulesData);
  } catch { }

  try {
    const aiData = await invoke<AIConfig | null>('load_app_data', { key: 'ai-config' });
    if (aiData) aiConfig.set(aiData);
  } catch { }

  try {
    const activityData = await invoke<ActivityRecord[] | null>('load_app_data', { key: 'activity-records' });
    if (activityData) {
      // ★ 30天清理
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const filtered = activityData.filter(r => new Date(r.timestamp).getTime() > cutoff);
      activityRecords.set(filtered);
    }
  } catch { }

  dataVersion = diskVersion;  // ★ 同步内存版本号
}
```

---

### 1.3.4 REQ-VALIDATE-001/002：API 保存前验证 + 验证失败拒绝保存

**当前代码分析**：

`SettingsPanel.svelte` 的 `saveAiConfig()` 当前流程：`aiConfig.set(localAiConfig)` → `saveAll()` → 成功/失败反馈。**无验证步骤**。

**实现方案**：

在 `ai.ts` 中新增 `validateAiConfig()` 函数：

```typescript
// ai.ts — 新增验证函数
export interface ValidationResult {
  success: boolean;
  error?: string;   // 具体错误信息
  errorType?: 'auth' | 'timeout' | 'network' | 'format' | 'unknown';
}

export async function validateAiConfig(config: AIConfig): Promise<ValidationResult> {
  if (!config.apiKey) {
    // apiKey 为空视为合法（用户可能想清除配置）
    return { success: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);  // ★ 10秒超时

  try {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'user', content: 'Hi' }  // 最小化测试请求
        ],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      // 验证响应体格式
      const data = await response.json();
      if (data.choices?.[0]?.message?.content !== undefined) {
        return { success: true };
      }
      return { success: false, error: 'API 响应格式异常，请检查端点地址', errorType: 'format' };
    }

    // HTTP 错误状态码分类
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'API 配置有误，请检查 API-Key 和对应的响应地址', errorType: 'auth' };
    }
    return { success: false, error: 'API 配置有误，请检查 API-Key 和对应的响应地址', errorType: 'unknown' };

  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { success: false, error: 'API 连接超时，请检查端点地址是否正确', errorType: 'timeout' };
    }
    return { success: false, error: 'API 连接失败，请检查端点地址是否正确', errorType: 'network' };
  }
}
```

修改 `SettingsPanel.svelte` 的 `saveAiConfig()`：

```typescript
// SettingsPanel.svelte — saveAiConfig 改造
import { validateAiConfig } from '$lib/services/ai';

async function saveAiConfig() {
  isSaving = true;
  saveStatus = null;

  try {
    // ★ Step 1: 先验证（使用 localAiConfig，store 尚未修改）
    const validation = await validateAiConfig(localAiConfig);

    if (!validation.success) {
      // ★ Step 2a: 验证失败——不修改 store，不保存
      saveStatus = `error:${validation.error}`;
      setTimeout(() => { saveStatus = null; }, 8000);
      console.error('API 验证失败:', validation.errorType, validation.error);
      return;
    }

    // ★ Step 2b: 验证成功——更新 store 并持久化
    const oldConfig = { ...$aiConfig };
    aiConfig.set(localAiConfig);

    try {
      await saveAll();
      saveStatus = 'success:API 配置成功！';
      setTimeout(() => { saveStatus = null; }, 5000);
    } catch (e: any) {
      // ★ Step 3: 验证通过但 saveAll 失败——回滚 store
      aiConfig.set(oldConfig);
      localAiConfig = { ...oldConfig };
      saveStatus = `error:API 验证通过，但保存失败: ${sanitizeError(e)}`;
      setTimeout(() => { saveStatus = null; }, 8000);
      console.error('保存AI配置失败:', e);
    }
  } catch (e: any) {
    // 验证过程本身的意外错误
    saveStatus = `error:验证过程出错: ${sanitizeError(e)}`;
    setTimeout(() => { saveStatus = null; }, 8000);
  } finally {
    isSaving = false;
  }
}
```

**关键设计点**：
- 验证在 `aiConfig.set()` 之前执行，验证失败时 store 不变，无需回滚
- 验证使用 `localAiConfig`（用户编辑中的值），而非 `$aiConfig`（store 中的旧值）
- 验证成功后才执行 `set` + `saveAll`，saveAll 失败时需回滚（因为 set 已执行）

---

### 1.3.5 REQ-VALIDATE-003：验证期间按钮禁用

**实现方案**：

复用已有的 `isSaving` 状态变量，扩展其语义覆盖验证阶段。按钮文案根据阶段变化：

```svelte
<button class="save-btn" onclick={saveAiConfig} disabled={isSaving}>
  {isSaving ? '验证中...' : '保存配置'}
</button>
```

> 注意：由于 `isSaving` 在验证开始时设为 `true`，在 `finally` 中设为 `false`，按钮在整个验证+保存流程中都处于禁用状态。

---

### 1.3.6 REQ-VALIDATE-004：验证通过但 saveAll 失败回滚

已在 1.3.4 的 `saveAiConfig()` 内部 catch 块中实现：回滚 `aiConfig` store 和 `localAiConfig` 本地副本。

---

### 1.3.7 REQ-ACTIVITY-001：活动记录采集

**实现方案**：

**Step 1**：在 `types/index.ts` 中新增 `ActivityRecord` 类型：

```typescript
// types/index.ts — 新增
export type ActivityClassification = 'productive' | 'slacking';
export type ClassificationSource = 'ai' | 'rule_based';

export interface ActivityRecord {
  id: string;                        // UUID v4
  timestamp: string;                 // ISO 8601，精确到秒
  windowTitle: string;               // 前台窗口标题，最大 500
  processName: string;               // 前台窗口进程名，最大 200
  classification: ActivityClassification;  // 'productive' | 'slacking'
  classificationSource: ClassificationSource;  // 'ai' | 'rule_based'
  taskId?: string | null;            // 关联的任务 ID，可选
}
```

**Step 2**：在 `stores/index.ts` 中新增 `activityRecords` store：

```typescript
// stores/index.ts — 新增
import type { ..., ActivityRecord } from '$lib/types';

export const activityRecords = writable<ActivityRecord[]>([]);
```

**Step 3**：在 `checkActivity()` 中增加活动记录采集逻辑（详见 1.3.8）。

---

### 1.3.8 REQ-ACTIVITY-002/003：AI 判断活动分类 + 无 API 降级

**实现方案**：

**Step 1**：在 `ai.ts` 中新增 `classifyActivity()` 函数：

```typescript
// ai.ts — 新增活动分类函数
export type ActivityClassification = 'productive' | 'slacking';

export async function classifyActivity(
  config: AIConfig,
  windowTitle: string,
  processName: string,
  incompleteTasks: string[]   // 未完成任务标题列表
): Promise<{ classification: ActivityClassification; source: 'ai' | 'rule_based' }> {
  if (!config.apiKey) {
    return { classification: 'productive', source: 'rule_based' };
  }

  try {
    const result = await chatWithAI(
      config,
      `用户正在使用：${windowTitle}（${processName}）
未完成任务：${incompleteTasks.length > 0 ? incompleteTasks.join('、') : '无'}
请仅回复一个词：productive（工作/正事）或 slacking（摸鱼/娱乐）`
    );

    const trimmed = result.trim().toLowerCase();
    if (trimmed === 'productive' || trimmed === 'slacking') {
      return { classification: trimmed, source: 'ai' };
    }
    // AI 返回格式不符，降级
    return { classification: 'productive', source: 'rule_based' };
  } catch {
    return { classification: 'productive', source: 'rule_based' };
  }
}
```

**Step 2**：在 `+page.svelte` 的 `checkActivity()` 中集成活动记录采集：

```typescript
// +page.svelte — checkActivity() 中增加活动记录采集
async function checkActivity() {
  try {
    const win: ActiveWindow = await invoke('get_active_window');
    activeWindow.set(win);

    const currentTasks: Task[] = $tasks;
    const rules: MonitorRule[] = $monitorRules;
    const config = $aiConfig;
    const incomplete = currentTasks.filter(t => !t.completed);

    // ── ★ 活动记录采集 + 分类 ──
    const target = `${win.title} ${win.processName}`.toLowerCase();
    let isBlacklistMatch = false;

    for (const rule of rules) {
      if (rule.isBlacklist) {
        const patterns = rule.pattern.split(',').map((s: string) => s.trim());
        for (const pattern of patterns) {
          if (target.includes(pattern.toLowerCase())) {
            isBlacklistMatch = true;
            break;
          }
        }
      }
      if (isBlacklistMatch) break;
    }

    // 分类活动（AI 或规则匹配降级）
    let classification: 'productive' | 'slacking';
    let classificationSource: 'ai' | 'rule_based';

    if (config.apiKey) {
      try {
        const result = await classifyActivity(
          config, win.title, win.processName,
          incomplete.map(t => t.title)
        );
        classification = result.classification;
        classificationSource = result.source;
      } catch {
        // AI 分类失败，降级为规则匹配
        classification = isBlacklistMatch ? 'slacking' : 'productive';
        classificationSource = 'rule_based';
      }
    } else {
      // 无 API，纯规则匹配
      classification = isBlacklistMatch ? 'slacking' : 'productive';
      classificationSource = 'rule_based';
    }

    // 创建活动记录
    const record: ActivityRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      windowTitle: win.title,
      processName: win.processName,
      classification,
      classificationSource,
    };
    activityRecords.update(records => [...records, record]);

    // ★ 异步持久化活动记录（不阻塞 UI）
    invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) }).catch(e => {
      console.error('活动记录持久化失败:', e);
    });

    // ── 以下为原有摸鱼提醒逻辑（保持不变）──
    if (incomplete.length === 0) return;
    const now = Date.now();
    if (now - lastAlertTime < 30000) return;

    // ... 原有黑名单匹配 + AI 提醒逻辑 ...
  } catch (e) {
    console.error('Monitor error:', e);
  }
}
```

**关键设计点**：
- 活动记录采集与摸鱼提醒逻辑**并行**执行，互不阻塞
- AI 分类与 AI 提醒**共享同一次 `checkActivity` 调用**，但分类使用独立的 `classifyActivity` 函数（prompt 更精简，仅返回 productive/slacking）
- 活动记录持久化通过 `invoke` 异步执行（无 await），失败仅打日志

---

### 1.3.9 REQ-ACTIVITY-004/005：活动记录持久化 + 30天清理

**实现方案**：

**Step 1**：在 `persistence.ts` 的 `saveAll()` 中增加 `activity-records` 的保存：

```typescript
// saveAll 中新增
await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) });
```

**Step 2**：在 `loadAll()` 中增加 `activity-records` 的加载和 30 天清理：

```typescript
// loadAll 中新增
try {
  const activityData = await invoke<ActivityRecord[] | null>('load_app_data', { key: 'activity-records' });
  if (activityData) {
    // ★ 30天自动清理
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = activityData.filter(r => new Date(r.timestamp).getTime() > cutoff);
    activityRecords.set(filtered);

    // 如果清理了数据，重新持久化
    if (filtered.length < activityData.length) {
      invoke('save_app_data', { key: 'activity-records', data: filtered }).catch(() => {});
      console.log(`[persistence] 清理了 ${activityData.length - filtered.length} 条过期活动记录`);
    }
  }
} catch { }
```

---

### 1.3.10 REQ-ACTIVITY-006/007：每日活动图表 + 日期切换

**实现方案**：

**新增组件** `ActivityChart.svelte`：

```svelte
<script lang="ts">
  import { activityRecords } from '$lib/stores';
  import type { ActivityRecord } from '$lib/types';

  let selectedDate = $state(new Date().toISOString().split('T')[0]);  // 默认今天

  // 按日期过滤活动记录
  let dayRecords = $derived(
    $activityRecords.filter(r => r.timestamp.startsWith(selectedDate))
  );

  // 按小时聚合
  let hourlyData = $derived(() => {
    const hours: Array<{
      hour: number;
      productive: number;
      slacking: number;
      total: number;
    }> = [];

    for (let h = 0; h < 24; h++) {
      const hourRecords = dayRecords.filter(r => new Date(r.timestamp).getHours() === h);
      const productive = hourRecords.filter(r => r.classification === 'productive').length;
      const slacking = hourRecords.filter(r => r.classification === 'slacking').length;
      hours.push({ hour: h, productive, slacking, total: productive + slacking });
    }
    return hours;
  });

  // 日期导航
  function prevDay() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    selectedDate = d.toISOString().split('T')[0];
  }

  function nextDay() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    selectedDate = d.toISOString().split('T')[0];
  }

  let maxTotal = $derived(Math.max(1, ...hourlyData().map(h => h.total)));

  // 统计汇总
  let dayStats = $derived(() => {
    const data = hourlyData();
    const productive = data.reduce((sum, h) => sum + h.productive, 0);
    const slacking = data.reduce((sum, h) => sum + h.slacking, 0);
    return { productive, slacking, total: productive + slacking };
  });
</script>

<div class="chart-container">
  <div class="chart-header">
    <button onclick={prevDay}>◀</button>
    <input type="date" bind:value={selectedDate} />
    <button onclick={nextDay}>▶</button>
  </div>

  {#if dayRecords.length === 0}
    <div class="empty">当天没有活动记录</div>
  {:else}
    <div class="stats-summary">
      <span class="stat-productive">🟢 工作: {dayStats().productive}次</span>
      <span class="stat-slacking">🔴 摸鱼: {dayStats().slacking}次</span>
    </div>

    <div class="hourly-chart">
      {#each hourlyData() as hourData (hourData.hour)}
        <div class="hour-row">
          <span class="hour-label">{hourData.hour.toString().padStart(2, '0')}:00</span>
          <div class="bar-container">
            {#if hourData.total > 0}
              <div class="bar productive-bar"
                   style="width: {(hourData.productive / maxTotal) * 100}%"></div>
              <div class="bar slacking-bar"
                   style="width: {(hourData.slacking / maxTotal) * 100}%"></div>
            {:else}
              <div class="bar empty-bar"></div>
            {/if}
          </div>
          <span class="count">{hourData.total}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* 图表样式 — 纯 CSS 实现 */
  .chart-container { padding: 16px; height: 100%; overflow-y: auto; }
  .chart-header { display: flex; gap: 8px; align-items: center; justify-content: center; margin-bottom: 16px; }
  .chart-header button { border: none; background: #f0f0f0; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
  .chart-header input { border: 1px solid #ddd; border-radius: 6px; padding: 4px 8px; }
  .stats-summary { display: flex; gap: 16px; justify-content: center; margin-bottom: 12px; font-size: 13px; }
  .stat-productive { color: #4caf50; }
  .stat-slacking { color: #f44336; }
  .hourly-chart { display: flex; flex-direction: column; gap: 4px; }
  .hour-row { display: flex; align-items: center; gap: 8px; }
  .hour-label { width: 40px; font-size: 11px; color: #888; text-align: right; }
  .bar-container { flex: 1; height: 16px; display: flex; border-radius: 4px; overflow: hidden; background: #f5f5f5; }
  .bar { height: 100%; }
  .productive-bar { background: #4caf50; }
  .slacking-bar { background: #f44336; }
  .empty-bar { width: 100%; background: #e0e0e0; }
  .count { width: 24px; font-size: 10px; color: #888; text-align: center; }
  .empty { text-align: center; color: #aaa; padding: 40px 0; font-size: 14px; }
</style>
```

**新增页面** `routes/activity/+page.svelte`：

```svelte
<script lang="ts">
  import ActivityChart from '$lib/components/ActivityChart.svelte';
</script>

<div class="activity-page">
  <h2>📊 每日活动图表</h2>
  <ActivityChart />
</div>

<style>
  .activity-page { padding: 16px; height: 100vh; background: #fff; }
  h2 { margin: 0 0 16px 0; color: #333; }
</style>
```

---

### 1.3.11 REQ-ACTIVITY-008：右键菜单新增"📊 活动图表"选项

**实现方案**：

在 `+page.svelte` 中新增打开活动图表窗口的函数，并在右键菜单中添加选项：

```typescript
// +page.svelte — 新增
async function openActivityChart() {
  closeContextMenu();
  try {
    let chartWin = await WebviewWindow.getByLabel('activity');
    if (!chartWin) {
      chartWin = new WebviewWindow('activity', {
        url: '/activity',
        title: '桌喵 - 活动图表',
        width: 500,
        height: 600,
        decorations: true,
        resizable: true,
        x: 450,
        y: 150,
      });
    }
    if (chartWin) {
      await chartWin.show();
      await chartWin.setFocus();
    }
  } catch (e) {
    console.error('打开活动图表失败:', e);
  }
}
```

在右键菜单模板中增加选项：

```svelte
<!-- 右键菜单中新增 -->
<button onclick={openActivityChart}>📊 活动图表</button>
```

同时在 `default.json` 的 `windows` 数组中添加 `"activity"` 窗口标识。

---

# **2. 接口设计**

## **2.1 总体设计**

本次新增/变更的接口：

1. **ActivityRecord 类型**：新增活动记录数据结构
2. **persistence 模块接口**：新增 `isSaving`/`dataVersion` 导出
3. **ai.ts 新增函数**：`validateAiConfig()`、`classifyActivity()`
4. **SettingsPanel saveAiConfig 流程**：增加验证步骤
5. **capabilities 配置**：新增窗口和权限

## **2.2 接口清单**

### 2.2.1 类型接口新增

```typescript
// src/lib/types/index.ts — ActivityRecord 新增
export type ActivityClassification = 'productive' | 'slacking';
export type ClassificationSource = 'ai' | 'rule_based';

export interface ActivityRecord {
  id: string;
  timestamp: string;
  windowTitle: string;
  processName: string;
  classification: ActivityClassification;
  classificationSource: ClassificationSource;
  taskId?: string | null;
}
```

### 2.2.2 persistence 模块接口新增

```typescript
// src/lib/services/persistence.ts — 新增导出
export function getIsSaving(): boolean;
export function getDataVersion(): number;
// saveAll/loadAll 签名不变，内部行为变更
```

### 2.2.3 ai.ts 新增接口

```typescript
// src/lib/services/ai.ts — 新增
export interface ValidationResult {
  success: boolean;
  error?: string;
  errorType?: 'auth' | 'timeout' | 'network' | 'format' | 'unknown';
}

export async function validateAiConfig(config: AIConfig): Promise<ValidationResult>;

export async function classifyActivity(
  config: AIConfig,
  windowTitle: string,
  processName: string,
  incompleteTasks: string[]
): Promise<{ classification: 'productive' | 'slacking'; source: 'ai' | 'rule_based' }>;
```

### 2.2.4 Store 接口新增

```typescript
// src/lib/stores/index.ts — 新增
export const activityRecords: Writable<ActivityRecord[]>;
export const dataVersion: Writable<number>;
```

### 2.2.5 Capabilities 接口变更

```json
// src-tauri/capabilities/default.json
{
  "windows": ["pet", "panel", "settings", "activity"],  // ★ 新增 "activity"
  "permissions": [
    // ... 已有权限 ...
    "default"  // 自定义命令通配符（已包含）
  ]
}
```

---

# **4. 数据模型**

## **4.1 设计目标**

1. **向后兼容**：新增字段均为可选字段，不影响已有数据文件加载
2. **类型安全**：所有新增字段使用 TypeScript 联合类型严格约束
3. **序列化兼容**：Rust 后端使用 `serde_json::Value` 透传数据，无需修改 Rust 侧结构体
4. **数据隔离**：`activity-records.json` 为新增文件，不与已有 `tasks.json` 等文件耦合

## **4.2 模型实现**

### 4.2.1 ActivityRecord 模型（新增）

```typescript
export interface ActivityRecord {
  id: string;                               // UUID v4，全局唯一
  timestamp: string;                        // ISO 8601，精确到秒
  windowTitle: string;                      // 前台窗口标题，最大 500
  processName: string;                      // 前台窗口进程名，最大 200
  classification: 'productive' | 'slacking'; // 活动分类
  classificationSource: 'ai' | 'rule_based'; // 分类来源
  taskId?: string | null;                   // 关联任务 ID，可选
}
```

**磁盘存储格式**：`activity-records.json`

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-05-08T14:30:00.000Z",
    "windowTitle": "Visual Studio Code",
    "processName": "Code.exe",
    "classification": "productive",
    "classificationSource": "ai",
    "taskId": null
  }
]
```

### 4.2.2 DataVersion 模型（新增）

```typescript
// 磁盘存储格式：data-version.json
{
  "version": 5,
  "lastModifiedAt": "2026-05-08T14:30:00.000Z"
}
```

### 4.2.3 Task 模型（不变，继承上一阶段）

```typescript
export interface Task {
  id: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  completionHint?: string;
  completionMethod?: 'manual' | 'ai_detected' | null;
}
```

### 4.2.4 AIConfig 模型（不变）

### 4.2.5 MonitorRule 模型（不变）

---

# **5. 修改文件清单**

| 文件路径 | 变更类型 | 涉及需求 | 具体修改内容 |
|----------|----------|----------|-------------|
| `src-tauri/capabilities/default.json` | 修改 | REQ-ACTIVITY-008 | `windows` 数组新增 `"activity"` |
| `src/lib/types/index.ts` | 修改 | REQ-ACTIVITY-001 | 新增 `ActivityRecord`、`ActivityClassification`、`ClassificationSource` 类型 |
| `src/lib/stores/index.ts` | 修改 | REQ-SYNC-003, REQ-ACTIVITY-001 | 1) 新增 `activityRecords` writable store 2) 新增 `dataVersion` writable 3) `createTaskStore` 操作中递增 dataVersion |
| `src/lib/services/persistence.ts` | 修改 | REQ-SYNC-001/003, REQ-ACTIVITY-004/005 | 1) 新增 `isSaving` 保存锁 2) 新增 `dataVersion` 版本戳 3) `loadAll` 增加保存锁+版本戳检查 4) `saveAll`/`loadAll` 扩展 activity-records 5) 加载时 30 天清理 6) 导出 `getIsSaving()`、`getDataVersion()` |
| `src/lib/services/ai.ts` | 修改 | REQ-VALIDATE-001, REQ-ACTIVITY-002 | 1) 新增 `validateAiConfig()` 函数 2) 新增 `classifyActivity()` 函数 3) 新增 `ValidationResult` 接口 |
| `src/lib/components/SettingsPanel.svelte` | 修改 | REQ-VALIDATE-001/002/003/004 | 1) `saveAiConfig()` 增加验证请求步骤 2) 验证失败不同错误分支和提示 3) 按钮文案改为"验证中..." 4) 验证失败不保存、store 不变 5) 验证通过但 saveAll 失败回滚 |
| `src/routes/panel/+page.svelte` | 修改 | REQ-SYNC-002 | 移除 `setInterval(loadAll, 3000)` 轮询，仅保留 onMount 初始化 loadAll |
| `src/routes/+page.svelte` | 修改 | REQ-ACTIVITY-001/002/003/008 | 1) `checkActivity()` 增加活动记录采集+AI分类+降级 2) 右键菜单新增"📊 活动图表"选项 3) 新增 `openActivityChart()` 函数 4) 活动记录异步持久化 |
| `src/lib/components/ActivityChart.svelte` | **新增** | REQ-ACTIVITY-006/007 | 活动图表组件（24小时时段分布条、日期选择器、汇总统计、空状态） |
| `src/routes/activity/+page.svelte` | **新增** | REQ-ACTIVITY-006 | 活动图表页面 |

---

# **6. 关键代码片段**

## 6.1 persistence.ts — 完整改造

```typescript
import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { tasks, monitorRules, aiConfig, activityRecords, dataVersion } from '$lib/stores';
import type { Task, MonitorRule, AIConfig, ActivityRecord } from '$lib/types';

export interface AppDataDir {
  path: string;
  isDefault: boolean;
}

// ★ 保存锁
let isSaving = false;
export function getIsSaving(): boolean { return isSaving; }

// ★ 版本戳
let currentDataVersion = 0;

export async function getDataDir(): Promise<AppDataDir> {
  return invoke<AppDataDir>('get_data_dir');
}

export async function setDataDir(dir: string): Promise<void> {
  await invoke('set_data_dir', { dir });
  await saveAll();
}

export async function saveAll(): Promise<void> {
  isSaving = true;
  try {
    await invoke('save_app_data', { key: 'tasks', data: get(tasks) });
    await invoke('save_app_data', { key: 'monitor-rules', data: get(monitorRules) });
    await invoke('save_app_data', { key: 'ai-config', data: get(aiConfig) });
    await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) });
    // ★ 保存版本号
    currentDataVersion++;
    await invoke('save_app_data', {
      key: 'data-version',
      data: { version: currentDataVersion, lastModifiedAt: new Date().toISOString() }
    });
    dataVersion.set(currentDataVersion);
  } finally {
    isSaving = false;
  }
}

export async function loadAll(): Promise<void> {
  // ★ 保存锁检查
  if (isSaving) {
    console.log('[persistence] loadAll 跳过：saveAll 正在执行中');
    return;
  }

  // ★ 版本戳检查
  let diskVersion = 0;
  try {
    const versionData = await invoke<{ version: number } | null>('load_app_data', { key: 'data-version' });
    diskVersion = versionData?.version ?? 0;
  } catch { /* 版本文件不存在 */ }

  if (diskVersion < currentDataVersion) {
    console.log(`[persistence] loadAll 跳过：磁盘版本(${diskVersion}) < 内存版本(${currentDataVersion})`);
    return;
  }

  // 正常加载数据
  try {
    const tasksData = await invoke<Task[] | null>('load_app_data', { key: 'tasks' });
    if (tasksData) tasks.set(tasksData);
  } catch { }

  try {
    const rulesData = await invoke<MonitorRule[] | null>('load_app_data', { key: 'monitor-rules' });
    if (rulesData) monitorRules.set(rulesData);
  } catch { }

  try {
    const aiData = await invoke<AIConfig | null>('load_app_data', { key: 'ai-config' });
    if (aiData) aiConfig.set(aiData);
  } catch { }

  try {
    const activityData = await invoke<ActivityRecord[] | null>('load_app_data', { key: 'activity-records' });
    if (activityData) {
      // ★ 30天清理
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const filtered = activityData.filter(r => new Date(r.timestamp).getTime() > cutoff);
      activityRecords.set(filtered);
      if (filtered.length < activityData.length) {
        invoke('save_app_data', { key: 'activity-records', data: filtered }).catch(() => {});
      }
    }
  } catch { }

  currentDataVersion = diskVersion;
  dataVersion.set(currentDataVersion);
}

export function setupAutoSave(intervalMs: number = 5000): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      await saveAll();
    } catch (e) {
      console.error('自动保存失败:', e);
    }
  }, intervalMs);
}
```

## 6.2 ai.ts — 新增函数

```typescript
// ★ API 验证函数
export interface ValidationResult {
  success: boolean;
  error?: string;
  errorType?: 'auth' | 'timeout' | 'network' | 'format' | 'unknown';
}

export async function validateAiConfig(config: AIConfig): Promise<ValidationResult> {
  if (!config.apiKey) {
    return { success: true };  // apiKey 为空合法
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.choices?.[0]?.message?.content !== undefined) {
        return { success: true };
      }
      return { success: false, error: 'API 响应格式异常，请检查端点地址', errorType: 'format' };
    }

    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'API 配置有误，请检查 API-Key 和对应的响应地址', errorType: 'auth' };
    }
    return { success: false, error: 'API 配置有误，请检查 API-Key 和对应的响应地址', errorType: 'unknown' };
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { success: false, error: 'API 连接超时，请检查端点地址是否正确', errorType: 'timeout' };
    }
    return { success: false, error: 'API 连接失败，请检查端点地址是否正确', errorType: 'network' };
  }
}

// ★ 活动分类函数
export async function classifyActivity(
  config: AIConfig,
  windowTitle: string,
  processName: string,
  incompleteTasks: string[]
): Promise<{ classification: 'productive' | 'slacking'; source: 'ai' | 'rule_based' }> {
  if (!config.apiKey) {
    return { classification: 'productive', source: 'rule_based' };
  }

  try {
    const result = await chatWithAI(
      config,
      `用户正在使用：${windowTitle}（${processName}）
未完成任务：${incompleteTasks.length > 0 ? incompleteTasks.join('、') : '无'}
请仅回复一个词：productive 或 slacking`
    );

    const trimmed = result.trim().toLowerCase();
    if (trimmed === 'productive' || trimmed === 'slacking') {
      return { classification: trimmed, source: 'ai' };
    }
    return { classification: 'productive', source: 'rule_based' };
  } catch {
    return { classification: 'productive', source: 'rule_based' };
  }
}
```

## 6.3 SettingsPanel.svelte — saveAiConfig 完整改造

```typescript
import { validateAiConfig } from '$lib/services/ai';

async function saveAiConfig() {
  isSaving = true;
  saveStatus = null;

  try {
    // Step 1: 验证 API 配置（使用 localAiConfig，store 尚未修改）
    const validation = await validateAiConfig(localAiConfig);

    if (!validation.success) {
      // 验证失败——不修改 store，不保存
      saveStatus = `error:${validation.error}`;
      setTimeout(() => { saveStatus = null; }, 8000);
      console.error('API 验证失败:', validation.errorType, validation.error);
      return;
    }

    // Step 2: 验证成功——更新 store 并持久化
    const oldConfig = { ...$aiConfig };
    aiConfig.set(localAiConfig);

    try {
      await saveAll();
      saveStatus = 'success:API 配置成功！';
      setTimeout(() => { saveStatus = null; }, 5000);
    } catch (e: any) {
      // 验证通过但 saveAll 失败——回滚
      aiConfig.set(oldConfig);
      localAiConfig = { ...oldConfig };
      saveStatus = `error:API 验证通过，但保存失败: ${sanitizeError(e)}`;
      setTimeout(() => { saveStatus = null; }, 8000);
      console.error('保存AI配置失败:', e);
    }
  } catch (e: any) {
    saveStatus = `error:验证过程出错: ${sanitizeError(e)}`;
    setTimeout(() => { saveStatus = null; }, 8000);
  } finally {
    isSaving = false;
  }
}
```

## 6.4 panel/+page.svelte — 移除轮询

```typescript
// 改造前
onMount(() => {
  loadAll().then(() => { ready = true; });
  const interval = setInterval(async () => {
    await loadAll();
  }, 3000);
  return () => clearInterval(interval);
});

// 改造后
onMount(() => {
  loadAll().then(() => { ready = true; });
  // ★ 不再有 setInterval 轮询
  // 面板通过 Svelte store 响应式机制自动更新
});
```

## 6.5 +page.svelte — checkActivity 中活动记录集成

```typescript
async function checkActivity() {
  try {
    const win: ActiveWindow = await invoke('get_active_window');
    activeWindow.set(win);

    const currentTasks: Task[] = $tasks;
    const rules: MonitorRule[] = $monitorRules;
    const config = $aiConfig;
    const incomplete = currentTasks.filter(t => !t.completed);

    // ── ★ 活动记录采集 ──
    const target = `${win.title} ${win.processName}`.toLowerCase();
    let isBlacklistMatch = false;
    for (const rule of rules) {
      if (rule.isBlacklist) {
        const patterns = rule.pattern.split(',').map((s: string) => s.trim());
        for (const pattern of patterns) {
          if (target.includes(pattern.toLowerCase())) {
            isBlacklistMatch = true;
            break;
          }
        }
      }
      if (isBlacklistMatch) break;
    }

    // 活动分类
    let classification: 'productive' | 'slacking';
    let classificationSource: 'ai' | 'rule_based';
    if (config.apiKey) {
      try {
        const result = await classifyActivity(config, win.title, win.processName, incomplete.map(t => t.title));
        classification = result.classification;
        classificationSource = result.source;
      } catch {
        classification = isBlacklistMatch ? 'slacking' : 'productive';
        classificationSource = 'rule_based';
      }
    } else {
      classification = isBlacklistMatch ? 'slacking' : 'productive';
      classificationSource = 'rule_based';
    }

    // 创建活动记录
    const record: ActivityRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      windowTitle: win.title,
      processName: win.processName,
      classification,
      classificationSource,
    };
    activityRecords.update(records => [...records, record]);

    // 异步持久化（不阻塞）
    invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) }).catch(e => {
      console.error('活动记录持久化失败:', e);
    });

    // ── 原有摸鱼提醒逻辑保持不变 ──
    if (incomplete.length === 0) return;
    const now = Date.now();
    if (now - lastAlertTime < 30000) return;

    // ... 原有黑名单匹配 + AI 提醒 + 完成检测逻辑 ...

  } catch (e) {
    console.error('Monitor error:', e);
  }
}
```

---

# **7. 测试验证方案**

## 7.1 REQ-SYNC — 数据同步竞态修复测试

| 测试用例 | 操作步骤 | 预期结果 |
|----------|----------|----------|
| TC-SYNC-001 | 在面板页面删除任务后立即观察 | 任务删除后不再回弹，store 保持删除后的状态 |
| TC-SYNC-002 | 在面板页面完成任务后等待 3 秒以上 | 任务完成状态保持，不被 loadAll 覆盖 |
| TC-SYNC-003 | 检查 panel/+page.svelte 源码 | 不存在 `setInterval(loadAll, 3000)` 代码 |
| TC-SYNC-004 | 在主页面快速连续添加+删除任务 | 操作结果正确，无数据丢失 |
| TC-SYNC-005 | 检查控制台日志 | 当 loadAll 因保存锁跳过时输出 `[persistence] loadAll 跳过` 日志 |
| TC-SYNC-006 | 模拟 saveAll 耗时 > 3 秒 | loadAll 连续跳过，直到 saveAll 完成 |
| TC-SYNC-007 | 检查磁盘 `data-version.json` | 版本号随每次 saveAll 递增 |

## 7.2 REQ-VALIDATE — API 配置验证测试

| 测试用例 | 操作步骤 | 预期结果 |
|----------|----------|----------|
| TC-VAL-001 | 填写正确的 AI 配置并点击"保存配置" | 按钮显示"验证中..."，验证通过后保存成功，绿色提示"API 配置成功！" |
| TC-VAL-002 | 填写错误的 API Key 并保存 | 显示红色"API 配置有误，请检查 API-Key..."提示，store 不变 |
| TC-VAL-003 | 填写不存在的端点地址并保存 | 显示红色"API 连接失败，请检查端点地址是否正确"提示 |
| TC-VAL-004 | 填写超时端点并保存（>10秒） | 显示红色"API 连接超时..."提示 |
| TC-VAL-005 | 验证期间重复点击保存按钮 | 按钮禁用，无法重复触发 |
| TC-VAL-006 | 清除 apiKey 后保存 | 视为合法配置，直接保存成功 |
| TC-VAL-007 | 验证通过但 saveAll 失败 | 回滚 store，显示"API 验证通过，但保存失败"红色提示 |

## 7.3 REQ-ACTIVITY — 活动追踪与图表测试

| 测试用例 | 操作步骤 | 预期结果 |
|----------|----------|----------|
| TC-ACT-001 | 配置有效 AI 后等待 45 秒监控周期 | 控制台输出活动记录，`activity-records.json` 文件更新 |
| TC-ACT-002 | 检查活动记录字段 | 包含 id、timestamp、windowTitle、processName、classification、classificationSource |
| TC-ACT-003 | AI 可用时访问黑名单网站 | classification = 'slacking'，classificationSource = 'ai' |
| TC-ACT-004 | AI 可用时使用 VS Code 编码 | classification = 'productive'，classificationSource = 'ai' |
| TC-ACT-005 | 无 AI 配置时访问黑名单网站 | classification = 'slacking'，classificationSource = 'rule_based' |
| TC-ACT-006 | 无 AI 配置时使用正常应用 | classification = 'productive'，classificationSource = 'rule_based' |
| TC-ACT-007 | 重启应用后 | 活动记录从磁盘恢复，图表可显示历史数据 |
| TC-ACT-008 | 活动记录超过 30 天 | 启动时自动清理过期记录 |
| TC-ACT-009 | 右键点击宠物 | 菜单包含"📊 活动图表"选项 |
| TC-ACT-010 | 点击"📊 活动图表" | 打开活动图表窗口 |
| TC-ACT-111 | 查看今天的活动图表 | 显示 24 小时时段分布，绿色=工作、红色=摸鱼 |
| TC-ACT-112 | 切换日期到昨天 | 图表更新为昨天的数据 |
| TC-ACT-113 | 选择无记录的日期 | 显示"当天没有活动记录"空状态 |
| TC-ACT-114 | 活动记录持久化失败 | 控制台输出错误日志，监控功能正常不中断 |

## 7.4 回归测试

| 测试用例 | 验证内容 |
|----------|----------|
| TC-REG-001 | 已有 tasks.json 数据可正常加载，含 completionMethod 字段的任务正常显示 |
| TC-REG-002 | 任务面板的添加、完成、删除、过滤、清除等功能正常 |
| TC-REG-003 | AI 监控的摸鱼提醒、完成检测、用户确认流程正常 |
| TC-REG-004 | 设置面板的监控规则增删正常 |
| TC-REG-005 | 自动保存（5秒间隔）正常工作，版本号递增 |
| TC-REG-006 | 数据目录更改功能正常 |
| TC-REG-007 | 宠物动画状态切换正常 |
| TC-REG-008 | 新增 `activity-records.json` 和 `data-version.json` 不影响已有数据文件 |

---

# **8. 实现优先级与依赖关系**

```
REQ-SYNC-002 (移除轮询) ─── ★ 最高优先级，直接消除竞态根因
    │
    ├── REQ-SYNC-001 (保存锁) ─── 补充保护
    └── REQ-SYNC-003 (版本戳) ─── 补充保护

REQ-VALIDATE-001 (验证请求) ─── 依赖 ai.ts 新增函数
    │
    ├── REQ-VALIDATE-002 (验证失败提示) ─── 依赖 VALIDATE-001
    ├── REQ-VALIDATE-003 (按钮禁用) ─── 依赖 VALIDATE-001
    └── REQ-VALIDATE-004 (saveAll 失败回滚) ─── 依赖 VALIDATE-001

REQ-ACTIVITY-001 (活动记录采集) ─── 依赖 types + stores 新增
    │
    ├── REQ-ACTIVITY-002 (AI 分类) ─── 依赖 ai.ts 新增函数
    ├── REQ-ACTIVITY-003 (降级分类) ─── 依赖 ACTIVITY-002
    ├── REQ-ACTIVITY-004 (持久化) ─── 依赖 persistence 扩展
    ├── REQ-ACTIVITY-005 (30天清理) ─── 依赖 ACTIVITY-004
    ├── REQ-ACTIVITY-006 (图表组件) ─── 依赖 ACTIVITY-001
    ├── REQ-ACTIVITY-007 (日期切换) ─── 依赖 ACTIVITY-006
    └── REQ-ACTIVITY-008 (图表入口) ─── 独立
```

**建议实施顺序**：

1. **Phase 1 — 竞态修复**（P0）：REQ-SYNC-002 → REQ-SYNC-001 → REQ-SYNC-003
2. **Phase 2 — API 验证**（P0）：ai.ts 新增 validateAiConfig → REQ-VALIDATE-001 → REQ-VALIDATE-002 → REQ-VALIDATE-003 → REQ-VALIDATE-004
3. **Phase 3 — 活动追踪**（P0/P1）：types + stores 新增 → ai.ts 新增 classifyActivity → REQ-ACTIVITY-001 → REQ-ACTIVITY-002 → REQ-ACTIVITY-003 → REQ-ACTIVITY-004 → REQ-ACTIVITY-005
4. **Phase 4 — 活动图表**（P1/P2）：REQ-ACTIVITY-006 → REQ-ACTIVITY-007 → REQ-ACTIVITY-008
