# 桌喵 Bug修复与功能增强 — 实现方案（design.md）

---

# **1. 实现模型**

## **1.1 上下文视图**

本次修改涉及 Tauri v2 桌面应用的三层架构协同变更，核心数据流与组件交互关系如下：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Tauri v2 Runtime                                    │
│  ┌───────────────────────┐    ┌──────────────────────────────────────────┐  │
│  │  Capabilities 配置      │    │           Rust 后端 (lib.rs)             │  │
│  │  default.json           │    │  ┌────────────────────────────────────┐ │  │
│  │  ┌─────────────────┐   │    │  │ IPC Commands:                      │ │  │
│  │  │ ★ 新增权限:       │   │    │  │  get_active_window                │ │  │
│  │  │  allow-save-app  │   │    │  │  save_app_data ★                  │ │  │
│  │  │  -data           │   │    │  │  load_app_data ★                  │ │  │
│  │  │  allow-load-app  │   │    │  │  get_data_dir                     │ │  │
│  │  │  -data           │   │    │  │  set_data_dir                     │ │  │
│  │  │  allow-get-data  │   │    │  │  start_monitor_cycle              │ │  │
│  │  │  -dir            │   │    │  │  check_fish_detection             │ │  │
│  │  │  allow-set-data  │   │    │  └────────────────────────────────────┘ │  │
│  │  │  -dir            │   │    └──────────────────────────────────────────┘  │
│  │  │  allow-get-active│   │                                                   │
│  │  │  -window         │   │                                                   │
│  │  └─────────────────┘   │                                                   │
│  └───────────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↕ IPC (invoke / emit)
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Svelte 5 前端 (runes 语法)                           │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │  SettingsPanel    │  │   TaskPanel      │  │    +page.svelte          │   │
│  │ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌────────────────────┐  │   │
│  │ │saveAiConfig  │ │  │ │handleDelete  │ │  │ │ checkActivity()    │  │   │
│  │ │ ★ 回滚逻辑   │ │  │ │ ★ ask()确认  │ │  │ │ ★ prompt含hint    │  │   │
│  │ │ ★ isSaving   │ │  │ │ ★ 回滚恢复   │ │  │ │ ★ AI完成检测      │  │   │
│  │ │ ★ 双态反馈   │ │  │ │onToggle      │ │  │ │ ★ 用户确认流程    │  │   │
│  │ │ ★ 脱敏函数   │ │  │ │ ★ completion │ │  │ │ ★ 降级处理        │  │   │
│  │ └──────────────┘ │  │ │   Method     │ │  │ │ ★ completionMethod │  │   │
│  └──────────────────┘  │ │ ★ addStatus  │ │  │ │   上下文           │  │   │
│                          │ └──────────────┘ │  │ │ ★ recordActivity  │  │   │
│  ┌──────────────────┐  └──────────────────┘  │ └────────────────────┘  │   │
│  │  TaskItem         │                         │                          │   │
│  │ ┌──────────────┐ │  ┌──────────────────┐  │ ┌────────────────────┐  │   │
│  │ │ 删除按钮      │ │  │   stores         │  │ │  persistence.ts    │  │   │
│  │ │ ★ 醒目样式   │ │  │ ┌──────────────┐ │  │ │ ┌──────────────┐  │  │   │
│  │ │ ★ 24px区域   │ │  │ │tasks.toggle  │ │  │ │ │ saveAll()    │  │  │   │
│  │ │completionHint│ │  │ │ ★ method参数 │ │  │ │ │ (验证异常    │  │  │   │
│  │ │ ★ 提示标签   │ │  │ └──────────────┘ │  │ │ │  传播正确)   │  │  │   │
│  │ └──────────────┘ │  └──────────────────┘  │ └──────────────┘  │  │   │
│  └──────────────────┘                          └──────────────────────────┘   │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                                 │
│  │  types/index.ts   │  │   ai.ts          │                                 │
│  │ ┌──────────────┐ │  │ ┌──────────────┐ │                                 │
│  │ │Task ★        │ │  │ │chatWithAI    │ │                                 │
│  │ │completion    │ │  │ │ (无接口变更) │ │                                 │
│  │ │Method        │ │  │ └──────────────┘ │                                 │
│  │ └──────────────┘ │  └──────────────────┘                                 │
│  └──────────────────┘                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**组件间交互关系图**：

```
用户操作            前端组件             Store/Service         Rust 后端
  │                    │                     │                    │
  │──保存AI配置────→ SettingsPanel ──→ aiConfig.set() ──→ saveAll() ──→ invoke('save_app_data')
  │                    │                     │                    │
  │                    │ ←── 失败回滚 ──── ←│ ←── Err ───────── ←│
  │ ←─ 双态反馈 ───── │                     │                    │
  │                    │                     │                    │
  │──删除任务──────→ TaskPanel ───→ ask()确认 ──→ tasks.remove() ──→ saveAll()
  │                    │                     │                    │
  │──手动完成──────→ TaskPanel ───→ tasks.toggle(id,'manual') ──→ saveAll()
  │                    │                     │                    │
  │                    │ ←─ 45s定时 ─────── │                    │
  │                    │ +page.svelte ──→ invoke('get_active_window') ──→ Rust
  │                    │    │                │                    │
  │                    │    └─→ chatWithAI(prompt含completionHint+completionMethod上下文)
  │                    │         │                               │
  │ ←─ 气泡反馈 ───── │ ←── AI结果 │                              │
  │                    │    │                                      │
  │──确认完成──────→ confirmTaskCompletion() ──→ tasks.toggle(id,'ai_detected')
```

## **1.2 服务/组件总体架构**

### 修改范围与分层职责

| 层级 | 组件 | 变更性质 | 职责 |
|------|------|----------|------|
| **基础设施层** | `src-tauri/capabilities/default.json` | 修改 | 添加 IPC 命令权限，解决 settings 窗口调用后端命令的权限缺失 |
| **类型层** | `src/lib/types/index.ts` | 修改 | Task 接口新增 `completionMethod` 可选字段 |
| **状态层** | `src/lib/stores/index.ts` | 修改 | `tasks.toggle()` 支持 `completionMethod` 参数 |
| **持久化层** | `src/lib/services/persistence.ts` | 验证 | 确认 `saveAll()` 异常正确传播（当前已满足，无需修改） |
| **UI 层** | `src/lib/components/SettingsPanel.svelte` | 修改 | 保存回滚、加载状态、双态反馈、提示时长、脱敏函数 |
| **UI 层** | `src/lib/components/TaskItem.svelte` | 修改 | 删除按钮醒目化（24px区域+红色）、completionHint 展示标签 |
| **UI 层** | `src/lib/components/TaskPanel.svelte` | 修改 | 删除确认对话框、onToggle 设置 completionMethod、addStatus 展示增强 |
| **业务逻辑层** | `src/routes/+page.svelte` | 修改 | checkActivity 全面增强：prompt含completionHint、AI完成检测、用户确认、降级、completionMethod上下文 |

### 架构决策

| 决策项 | 方案 | 理由 |
|--------|------|------|
| **IPC 权限方案** | 在 `default.json` 的 `permissions` 数组中添加自定义命令权限标识符 | Tauri v2 capabilities 模型要求每个 webview 窗口显式授权 IPC 命令，当前仅授权了插件权限，未授权自定义命令 |
| **保存回滚方案** | `saveAiConfig()` 中深拷贝当前 `aiConfig` store 值作为旧值快照，执行 `aiConfig.set(localAiConfig)` 后再 `await saveAll()`，失败则回滚 | 避免保存失败后内存状态与磁盘不一致 |
| **删除确认方案** | 使用 Tauri 对话框插件 `@tauri-apps/plugin-dialog` 的 `ask()` 方法 | 保持桌面应用的原生对话框体验一致性，`window.confirm()` 在 Tauri webview 中行为不一致 |
| **AI 完成检测方案** | `checkActivity()` 中构建含 completionHint 的 prompt 让 AI 判断任务是否完成，AI 返回 `COMPLETED:任务标题` 时显示确认气泡 | 避免误判直接标记完成，用户确认后才标记，completionMethod 记录为 `ai_detected` |
| **降级方案** | AI 不可用时（apiKey 为空或请求失败）降级为纯规则匹配模式 | 保证监控功能在 AI 不可用时仍可用，行为与无 AI 配置时一致 |
| **错误脱敏方案** | `sanitizeError()` 函数用正则遮蔽 API Key（如 `sk-***`） | 保存失败错误提示不得泄露完整 API Key，满足安全性约束 |

## **1.3 实现设计文档**

### 1.3.1 REQ-SAVE-001：settings 窗口 IPC 命令权限完备

**根因分析**：

当前 `default.json` 的 `permissions` 数组中只包含了插件权限（`store:default`、`dialog:default` 等），但**缺少自定义 Tauri 命令的权限声明**。在 Tauri v2 中，自定义 `#[tauri::command]` 函数需要通过 `allow-<snake_case_command_name>` 格式显式授权，否则 `invoke()` 调用会因权限不足而失败。

**实现方案**：

在 `src-tauri/capabilities/default.json` 的 `permissions` 数组中追加以下自定义命令权限：

```json
"allow-get-active-window",
"allow-check-fish-detection",
"allow-start-monitor-cycle",
"allow-get-data-dir",
"allow-set-data-dir",
"allow-save-app-data",
"allow-load-app-data"
```

> **重要**：Tauri v2 自动为每个 `#[tauri::command]` 生成权限标识符，格式为 `allow-<snake_case_command_name>`。实际实现时需检查 `src-tauri/gen/schemas/` 目录下自动生成的权限 schema 文件来确认准确的标识符名称。

**备选方案**：如果自动生成的权限标识符名称不确定，可采用更宽松的通配符权限（仅用于开发阶段）：

```json
"core:path:default"
```

---

### 1.3.2 REQ-SAVE-002：保存失败错误不可吞没 + 回滚

**当前代码分析**：

`persistence.ts` 中的 `saveAll()` 使用三个顺序 `await invoke()` 调用，任一失败会自然抛出异常（因为未用 try-catch 包裹）。`SettingsPanel.svelte` 中的 `saveAiConfig()` 有 catch 块但**没有回滚逻辑**。

**实现方案**：

修改 `SettingsPanel.svelte` 的 `saveAiConfig()` 函数：

```typescript
// saveAiConfig() 完整改造
async function saveAiConfig() {
  // 1. 记录旧值快照（深拷贝）
  const oldConfig = { ...$aiConfig };

  // 2. 先更新 store
  aiConfig.set(localAiConfig);

  // 3. 设置加载状态
  isSaving = true;
  saveStatus = null;

  try {
    // 4. 持久化
    await saveAll();
    // 5. 成功反馈：绿色提示，持续 5 秒
    saveStatus = 'success:AI 配置已保存！';
    setTimeout(() => { saveStatus = null; }, 5000);
  } catch (e: unknown) {
    // 6. 回滚 store
    aiConfig.set(oldConfig);
    localAiConfig = { ...oldConfig };
    // 7. 失败反馈：红色提示，持续 8 秒
    saveStatus = `error:保存失败: ${sanitizeError(e)}`;
    setTimeout(() => { saveStatus = null; }, 8000);
    // 8. 控制台日志
    console.error('保存AI配置失败:', e);
  } finally {
    isSaving = false;
  }
}

// 错误信息脱敏：不泄露完整 API Key
function sanitizeError(e: unknown): string {
  const msg = String(e instanceof Error ? e.message : e);
  return msg.replace(/sk-[a-zA-Z0-9]{10,}/g, 'sk-***');
}
```

**saveStatus 双态渲染**：

```svelte
{#if saveStatus}
  {@const isSuccess = saveStatus.startsWith('success:')}
  {@const msg = saveStatus.replace(/^(success|error):/, '')}
  <p class="status-msg" class:success={isSuccess} class:error={!isSuccess}>
    {msg}
  </p>
{/if}
```

```css
.status-msg { margin-top: 8px; font-size: 13px; }
.status-msg.success { color: #4caf50; }
.status-msg.error { color: #f44336; font-weight: 600; }
```

---

### 1.3.3 REQ-SAVE-003：保存成功提示 ≥5 秒

**实现方案**：

在 `saveAiConfig()` 成功分支中，`setTimeout` 时长设为 `5000`（当前代码为 3000，需修改）。同时将失败分支的 `setTimeout` 设为 `8000`。

此逻辑已包含在 1.3.2 的 `saveAiConfig()` 改造方案中。

---

### 1.3.4 REQ-SAVE-004：保存按钮加载/防重复点击

**实现方案**：

在 `SettingsPanel.svelte` 中新增 `isSaving` 状态变量：

```typescript
let isSaving = $state(false);
```

修改保存按钮：

```svelte
<button class="save-btn" onclick={saveAiConfig} disabled={isSaving}>
  {isSaving ? '保存中...' : '保存配置'}
</button>
```

```css
.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

---

### 1.3.5 REQ-TASK-001：删除按钮视觉醒目 + 24px 可点击区域

**当前代码分析**：

`TaskItem.svelte` 中删除按钮当前样式为：
- `color: #ccc`（浅灰色，不够醒目）
- `font-size: 18px`
- `padding: 0 4px`

**实现方案**：

```css
.delete-btn {
  background: none;
  border: none;
  color: #e57373;           /* 浅红色，默认即可辨识 */
  cursor: pointer;
  font-size: 16px;
  padding: 4px;              /* 增大 padding */
  min-width: 24px;           /* 保证 24px 可点击区域 */
  min-height: 24px;
  line-height: 1;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.delete-btn:hover {
  color: #f44336;            /* hover 加深 */
  background: rgba(244, 67, 54, 0.08);
}
```

将删除按钮内容从 `×` 改为红色 `✕` 图标：

```svelte
<button class="delete-btn" onclick={() => onDelete(task.id)} title="删除任务">✕</button>
```

---

### 1.3.6 REQ-TASK-002：删除前确认对话框

**实现方案**：

使用 Tauri 对话框插件的 `ask()` 方法：

```typescript
import { ask } from '@tauri-apps/plugin-dialog';
```

在 `TaskPanel.svelte` 中新增 `handleDelete()` 回调：

```typescript
async function handleDelete(id: string) {
  const confirmed = await ask('确定删除该任务？', {
    title: '删除确认',
    kind: 'warning',
    okLabel: '确定',
    cancelLabel: '取消',
  });
  if (!confirmed) return;

  const task = $tasks.find(t => t.id === id);
  tasks.remove(id);
  try {
    await saveAll();
  } catch (e) {
    // 持久化失败：回滚，将任务重新添加回 store
    if (task) tasks.add(task);
    console.error('删除任务持久化失败:', e);
  }
}
```

将 `TaskItem` 的 `onDelete` prop 类型改为 `(id: string) => Promise<void>`，并在 `TaskPanel` 传递 `handleDelete`。

**依赖**：需确认 `default.json` 中已包含 `dialog:default` 权限（当前已有）。

---

### 1.3.7 REQ-TASK-003：手动完成记录 completionMethod

**实现方案**：

**Step 1**：在 `src/lib/types/index.ts` 中扩展 Task 接口：

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
  completionMethod?: 'manual' | 'ai_detected' | null;  // ★ 新增
}
```

**Step 2**：在 `src/lib/stores/index.ts` 中修改 `toggle` 方法签名和实现：

```typescript
toggle(id: string, completionMethod?: 'manual' | 'ai_detected') {
  update(tasks => tasks.map(t =>
    t.id === id
      ? {
          ...t,
          completed: !t.completed,
          completionMethod: !t.completed  // 仅在标记为完成时记录
            ? (completionMethod ?? 'manual')
            : null,  // 取消完成时清除
        }
      : t
  ));
}
```

**Step 3**：在 `TaskPanel.svelte` 中修改 `onToggle` 回调，添加持久化和回滚：

```typescript
onToggle={async (id) => {
  const task = $tasks.find(t => t.id === id);
  tasks.toggle(id, 'manual');
  try {
    await saveAll();
  } catch (e) {
    // 回滚：重新 toggle 恢复原状态
    tasks.toggle(id);
    console.error('完成标记持久化失败:', e);
  }
}}
```

---

### 1.3.8 REQ-TASK-004：completionHint 在任务项中展示

**实现方案**：

在 `TaskItem.svelte` 的任务内容区域添加 completionHint 标签：

```svelte
<div class="task-content">
  <span class="task-title">{task.title}</span>
  <div class="task-meta">
    <span class="priority" style="color: {priorityColors[task.priority]}">
      {priorityLabels[task.priority]}
    </span>
    <span class="category">{task.category}</span>
    {#if task.dueDate}
      <span class="due">{task.dueDate}</span>
    {/if}
    {#if task.completionHint}
      <span class="hint-badge" title="完成检测提示">💡 {task.completionHint}</span>
    {/if}
  </div>
</div>
```

```css
.hint-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: #e8f5e9;
  color: #2e7d32;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

### 1.3.9 REQ-AI-001：监控 prompt 包含 completionHint

**当前代码分析**：

`+page.svelte` 的 `checkActivity()` 中：
- **黑名单匹配分支**：已有 completionHint 使用（第 141 行 `t.completionHint || t.title`）
- **非黑名单匹配分支**（第 187-224 行）：已有 completionHint 使用（第 190 行）

两个分支均已在当前代码中实现 completionHint 的传递，此需求已满足。

---

### 1.3.10 REQ-AI-002：AI 检测完成需用户确认

**当前代码分析**：

当前代码（第 159-165 行、第 206-212 行）已实现：
- AI 返回 `COMPLETED:任务标题` 格式时的解析
- 设置 `pendingConfirmTaskId` 并显示确认气泡
- **不直接标记完成**，需用户确认

**实现方案**：

在 `+page.svelte` 中新增待确认状态和确认/否认处理函数（当前代码第 24-25 行、268-285 行已实现）：

```typescript
let pendingConfirmTaskId = $state<string | null>(null);

async function confirmTaskCompletion() {
  if (!pendingConfirmTaskId) return;
  const id = pendingConfirmTaskId;
  tasks.toggle(id, 'ai_detected');
  pendingConfirmTaskId = null;
  try {
    await saveAll();
    showSpeech('太棒了！又完成一个！', 'happy');
  } catch (e) {
    tasks.toggle(id);  // 回滚
    console.error('完成任务持久化失败:', e);
  }
}

function denyTaskCompletion() {
  pendingConfirmTaskId = null;
  showSpeech('继续加油！', 'happy');
}
```

在气泡 UI 中添加确认/否认按钮（当 `pendingConfirmTaskId` 非空时显示）：

```svelte
{#if pendingConfirmTaskId}
  <div class="confirm-actions">
    <button class="confirm-yes" onclick={confirmTaskCompletion}>✅ 完成了</button>
    <button class="confirm-no" onclick={denyTaskCompletion}>还没呢</button>
  </div>
{/if}
```

```css
.confirm-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.confirm-yes, .confirm-no {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.confirm-yes { background: #e8f5e9; color: #2e7d32; }
.confirm-no { background: #f5f5f5; color: #666; }
```

---

### 1.3.11 REQ-AI-003：做正事时显示鼓励气泡

**当前代码分析**：

黑名单匹配分支中 AI 判断做正事时（第 171-174 行），已有个性化鼓励逻辑：

```typescript
if (aiResult === 'OK') {
  const encourageTarget = incomplete[0]?.title || '任务';
  showSpeech(`在努力做${encourageTarget}吗？加油！`, 'happy');
}
```

鼓励内容已与任务标题相关，此需求已满足。

---

### 1.3.12 REQ-AI-004：AI 不可用时降级为纯规则匹配

**当前代码分析**：

当前 `checkActivity()` 的降级逻辑已较完善：
- `apiKey` 为空时直接显示规则消息（第 182-186 行）
- AI 请求失败时 catch 块显示规则消息 + 控制台日志（第 176-181 行）

**实现方案**：

确认当前代码已满足需求。仅需验证：
1. 黑名单匹配 + apiKey 为空 → 显示 `matchedMessage`
2. 黑名单匹配 + AI 失败 → 降级显示 `matchedMessage` + `console.error`
3. 非黑名单匹配 + AI 失败 → 静默降级 + `console.error`

---

### 1.3.13 REQ-AI-005：任务创建后醒目展示 completionHint

**实现方案**：

在 `TaskPanel.svelte` 中增强 `addStatus` 的展示样式，使其更醒目：

```svelte
{#if addStatus}
  <div class="hint-notification">
    <span class="hint-icon">💡</span>
    <span class="hint-text">{addStatus}</span>
  </div>
{/if}
```

```css
.hint-notification {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #e8f5e9;
  border: 1px solid #c8e6c9;
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: #2e7d32;
}
.hint-icon { font-size: 16px; }
```

---

### 1.3.14 REQ-AI-006：AI prompt 包含已完成任务 completionMethod 上下文

**当前代码分析**：

当前代码（第 127-136 行）已实现 `completionContext` 的构建：

```typescript
const completed = currentTasks.filter(t => t.completed && t.completionMethod);
let completionContext = '';
if (completed.length > 0) {
  const manualCompleted = completed.filter(t => t.completionMethod === 'manual').map(t => t.title);
  const aiDetected = completed.filter(t => t.completionMethod === 'ai_detected').map(t => t.title);
  completionContext = '\n已完成的任务：\n';
  if (manualCompleted.length > 0) completionContext += `- 用户手动完成：${manualCompleted.join('、')}\n`;
  if (aiDetected.length > 0) completionContext += `- AI检测完成（用户确认）：${aiDetected.join('、')}\n`;
}
```

`completionContext` 已在黑名单分支（第 148 行）和非黑名单分支（第 199 行）的 AI prompt 中引用。此需求已满足。

---

# **2. 接口设计**

## **2.1 总体设计**

本次修改不新增 IPC 命令，仅涉及以下层面的接口变更：

1. **Task 类型接口扩展**：新增 `completionMethod` 可选字段（向后兼容）
2. **Task Store 接口扩展**：`toggle()` 方法新增可选参数
3. **TaskPanel → TaskItem 接口变更**：`onDelete` 回调类型从同步改为异步
4. **checkActivity() 内部逻辑增强**：不改变对外接口，仅修改 prompt 构建和结果处理
5. **Capabilities 接口变更**：`default.json` 新增自定义 IPC 命令权限标识符

## **2.2 接口清单**

### 2.2.1 类型接口变更

```typescript
// src/lib/types/index.ts — Task 接口
export interface Task {
  id: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  completionHint?: string;                              // 已有
  completionMethod?: 'manual' | 'ai_detected' | null;   // ★ 新增
}
```

**变更说明**：
- 新增 `completionMethod` 为可选字段，类型为联合类型 `'manual' | 'ai_detected' | null`
- `undefined`（旧数据不存在该字段）等同于 `null`，逻辑一致
- 不影响已有 `tasks.json` 数据加载（向后兼容）

### 2.2.2 Store 接口变更

```typescript
// src/lib/stores/index.ts — createTaskStore.toggle 签名变更
// 旧签名: toggle(id: string): void
// 新签名: toggle(id: string, completionMethod?: 'manual' | 'ai_detected'): void
```

**变更说明**：
- 新增可选参数 `completionMethod`，不传时默认为 `'manual'`
- 仅在 `!t.completed`（标记为完成）时设置 `completionMethod`，取消完成时清除为 `null`

### 2.2.3 组件接口变更

```typescript
// TaskItem.svelte — props 变更
// 旧: onDelete: (id: string) => void
// 新: onDelete: (id: string) => Promise<void>
```

**变更说明**：
- `onDelete` 从同步回调改为异步回调，因为删除操作现在包含 `ask()` 确认对话框和 `saveAll()` 持久化

### 2.2.4 Capabilities 接口变更

```json
// src-tauri/capabilities/default.json — permissions 新增
[
  // ... 已有权限 (store:default, dialog:default, etc.) ...
  "allow-get-active-window",
  "allow-check-fish-detection",
  "allow-start-monitor-cycle",
  "allow-get-data-dir",
  "allow-set-data-dir",
  "allow-save-app-data",
  "allow-load-app-data"
]
```

> **重要**：上述权限标识符需要根据 Tauri v2 自动生成的 ACL schema 确认实际名称。可通过检查 `src-tauri/gen/schemas/acl/` 目录或运行 `npx tauri info` 确认。

---

# **4. 数据模型**

## **4.1 设计目标**

1. **向后兼容**：新增字段均为可选字段，不影响已有 `tasks.json` 数据加载
2. **类型安全**：所有新增字段使用 TypeScript 联合类型严格约束，不使用 `any`
3. **序列化兼容**：Rust 后端使用 `serde_json::Value` 透传数据，无需修改 Rust 侧的 Task 结构体
4. **原子性**：数据变更与持久化操作应保证原子性，失败时回滚内存状态

## **4.2 模型实现**

### 4.2.1 Task 模型变更

```typescript
// 变更前
export interface Task {
  id: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  completionHint?: string;
}

// 变更后
export interface Task {
  id: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  completionHint?: string;
  completionMethod?: 'manual' | 'ai_detected' | null;  // ★ 新增
}
```

**向后兼容性分析**：

| 场景 | 行为 |
|------|------|
| 旧数据无 `completionMethod` 字段 | TypeScript 中为 `undefined`，运行时正常，逻辑等同于 `null` |
| 新数据含 `completionMethod: null` | 等价于无字段，AI prompt 中不包含此任务完成方式 |
| 新数据含 `completionMethod: 'manual'` | AI 监控 prompt 中包含"用户手动完成：xxx"信息 |
| 新数据含 `completionMethod: 'ai_detected'` | AI 监控 prompt 中包含"AI检测完成（用户确认）：xxx"信息 |

### 4.2.2 AIConfig 模型（无变更）

```typescript
export interface AIConfig {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}
```

### 4.2.3 MonitorRule 模型（无变更）

```typescript
export interface MonitorRule {
  id: string;
  pattern: string;
  ruleType: 'url' | 'process';
  isBlacklist: boolean;
  message: string;
}
```

### 4.2.4 ActivityRecord 模型（无变更）

```typescript
export type ActivityClassification = 'productive' | 'slacking';
export type ClassificationSource = 'ai' | 'rule_based';

export interface ActivityRecord {
  id: string;
  timestamp: string;
  windowTitle: string;
  processName: string;
  classification: ActivityClassification;
  classificationSource: ClassificationSource;
  taskId?: string;
}
```

---

# **5. 修改文件清单**

| 文件路径 | 变更类型 | 涉及需求 | 具体修改内容 |
|----------|----------|----------|-------------|
| `src-tauri/capabilities/default.json` | 修改 | REQ-SAVE-001 | 在 `permissions` 数组中追加自定义 IPC 命令权限标识符 |
| `src/lib/types/index.ts` | 修改 | REQ-TASK-003 | Task 接口新增 `completionMethod?: 'manual' \| 'ai_detected' \| null` 字段 |
| `src/lib/stores/index.ts` | 修改 | REQ-TASK-003 | `toggle(id, completionMethod?)` 方法签名扩展，设置 completionMethod 逻辑 |
| `src/lib/services/persistence.ts` | 验证 | REQ-SAVE-002 | 确认 `saveAll()` 异常传播正确（当前已满足，无需修改） |
| `src/lib/components/SettingsPanel.svelte` | 修改 | REQ-SAVE-002/003/004 | 1) `saveAiConfig()` 添加回滚逻辑和深拷贝旧值 2) `isSaving` 加载状态 3) `saveStatus` 双态反馈（success/error 前缀 + 绿/红样式） 4) 提示时长调整 5) `sanitizeError()` 脱敏函数 6) 保存按钮 disabled 绑定 |
| `src/lib/components/TaskItem.svelte` | 修改 | REQ-TASK-001/002/004 | 1) 删除按钮样式：`color: #e57373`、`min-width/height: 24px`、图标改为 ✕ 2) completionHint 展示标签（💡 badge） |
| `src/lib/components/TaskPanel.svelte` | 修改 | REQ-TASK-002/003, REQ-AI-005 | 1) 新增 `handleDelete()` 含 `ask()` 确认对话框 2) `onToggle` 传递 `'manual'` 3) `onDelete` 类型改为 async 4) `addStatus` 展示增强为醒目 hint-notification 样式 |
| `src/routes/+page.svelte` | 修改 | REQ-AI-001/002/003/004/006 | 1) 非黑名单分支 prompt 含 completionHint + COMPLETED 格式 2) AI 返回 COMPLETED 解析 + 确认气泡 3) `pendingConfirmTaskId` 状态 + `confirmTaskCompletion()` / `denyTaskCompletion()` 4) 做正事鼓励个性化 5) 降级日志增强 6) completionMethod 上下文追加 7) 确认/否认按钮 UI |

---

# **6. 关键代码片段**

## 6.1 SettingsPanel.svelte — saveAiConfig 完整改造

```typescript
let isSaving = $state(false);
let saveStatus = $state<string | null>(null);

function sanitizeError(e: unknown): string {
  const msg = String(e instanceof Error ? e.message : e);
  // 脱敏：遮蔽 API Key（匹配 sk- 开头的长字符串）
  return msg.replace(/sk-[a-zA-Z0-9]{10,}/g, 'sk-***');
}

async function saveAiConfig() {
  const oldConfig = { ...$aiConfig };
  aiConfig.set(localAiConfig);
  isSaving = true;
  saveStatus = null;

  try {
    await saveAll();
    saveStatus = 'success:AI 配置已保存！';
    setTimeout(() => { saveStatus = null; }, 5000);
  } catch (e: unknown) {
    aiConfig.set(oldConfig);
    localAiConfig = { ...oldConfig };
    saveStatus = `error:保存失败: ${sanitizeError(e)}`;
    setTimeout(() => { saveStatus = null; }, 8000);
    console.error('保存AI配置失败:', e);
  } finally {
    isSaving = false;
  }
}
```

## 6.2 TaskPanel.svelte — handleDelete

```typescript
import { ask } from '@tauri-apps/plugin-dialog';

async function handleDelete(id: string) {
  const confirmed = await ask('确定删除该任务？', {
    title: '删除确认',
    kind: 'warning',
    okLabel: '确定',
    cancelLabel: '取消',
  });
  if (!confirmed) return;

  const task = $tasks.find(t => t.id === id);
  tasks.remove(id);
  try {
    await saveAll();
  } catch (e) {
    if (task) tasks.add(task);
    console.error('删除任务持久化失败:', e);
  }
}
```

## 6.3 +page.svelte — checkActivity 非黑名单分支增强

```typescript
} else if (config.apiKey && incomplete.length > 0) {
  try {
    // 构建任务上下文（含 completionHint）
    const taskContext = incomplete.map(t =>
      `- "${t.title}"（完成判断：${t.completionHint || t.title}）`
    ).join('\n');

    // 构建已完成任务上下文（含 completionMethod）
    const completed = currentTasks.filter(t => t.completed && t.completionMethod);
    let completionContext = '';
    if (completed.length > 0) {
      const manual = completed.filter(t => t.completionMethod === 'manual').map(t => t.title);
      const aiDet = completed.filter(t => t.completionMethod === 'ai_detected').map(t => t.title);
      completionContext = '\n已完成的任务：\n';
      if (manual.length > 0) completionContext += `- 用户手动完成：${manual.join('、')}\n`;
      if (aiDet.length > 0) completionContext += `- AI检测完成：${aiDet.join('、')}\n`;
    }

    const aiResult = await chatWithAI(
      config,
      `用户正在用：${win.title}（${win.processName}）。

用户的未完成任务：
${taskContext}
${completionContext}
请判断：
1. 用户是否可能在完成某个任务？如果是，回复"COMPLETED:任务标题"
2. 用户在做正事吗？如果是，回复"OK"
3. 否则用一句话鼓励或提醒（15字以内）`
    );

    if (aiResult && aiResult.startsWith('COMPLETED:')) {
      const completedTitle = aiResult.replace('COMPLETED:', '').trim();
      const matchedTask = incomplete.find(t => t.title.includes(completedTitle));
      if (matchedTask) {
        pendingConfirmTaskId = matchedTask.id;
        showSpeech(`"${matchedTask.title}" 完成了吗？`, 'happy');
      }
      recordActivity(win, 'productive', 'ai');
    } else if (aiResult && aiResult !== 'OK' && aiResult.length < 30) {
      showSpeech(aiResult, 'happy');
      lastAlertTime = now;
      recordActivity(win, 'productive', 'ai');
    } else {
      recordActivity(win, 'productive', 'ai');
    }
  } catch (e) {
    console.error('AI监控请求失败（非黑名单分支）:', e);
    recordActivity(win, 'productive', 'rule_based');
  }
}
```

## 6.4 +page.svelte — 任务完成确认交互

```typescript
let pendingConfirmTaskId = $state<string | null>(null);

async function confirmTaskCompletion() {
  if (!pendingConfirmTaskId) return;
  const id = pendingConfirmTaskId;
  tasks.toggle(id, 'ai_detected');
  pendingConfirmTaskId = null;
  try {
    await saveAll();
    showSpeech('太棒了！又完成一个！', 'happy');
  } catch (e) {
    tasks.toggle(id);  // 回滚
    console.error('完成任务持久化失败:', e);
  }
}

function denyTaskCompletion() {
  pendingConfirmTaskId = null;
  showSpeech('继续加油！', 'happy');
}
```

---

# **7. 测试验证方案**

## 7.1 Bug 1 — 设置保存可靠性测试

| 测试用例 | 操作步骤 | 预期结果 |
|----------|----------|----------|
| TC-SAVE-001 | 在 settings 窗口修改 AI 配置并点击保存 | 保存成功，显示绿色提示 ≥5 秒 |
| TC-SAVE-002 | 修改 API Key 为空后保存 | 保存成功（apiKey 为空是合法值），显示绿色提示 |
| TC-SAVE-003 | 在保存过程中快速连续点击保存按钮 | 第二次点击无效，按钮显示"保存中..."且 disabled |
| TC-SAVE-004 | 模拟 saveAll() 失败（如设置只读数据目录） | 显示红色失败提示 ≥8 秒，aiConfig store 回滚到旧值 |
| TC-SAVE-005 | 检查 default.json 中包含所有自定义命令权限 | settings/panel/pet 窗口均可成功调用 invoke() |
| TC-SAVE-006 | 保存失败时错误提示中包含 API Key | 错误提示中 API Key 被脱敏为 sk-*** |

## 7.2 Bug 2 — 任务管理交互测试

| 测试用例 | 操作步骤 | 预期结果 |
|----------|----------|----------|
| TC-TASK-001 | 查看任务列表中任意任务项 | 删除按钮颜色为浅红色（#e57373），可点击区域 ≥24×24px |
| TC-TASK-002 | 点击任务删除按钮 | 弹出原生确认对话框"确定删除该任务？" |
| TC-TASK-003 | 确认对话框中点击"确定" | 任务从列表移除并持久化 |
| TC-TASK-004 | 确认对话框中点击"取消" | 任务保留不变 |
| TC-TASK-005 | 手动勾选任务完成 | task.completionMethod 为 "manual"，持久化到 tasks.json |
| TC-TASK-006 | 含 completionHint 的任务项展示 | 显示 💡 badge 标签，文字为 completionHint 内容 |
| TC-TASK-007 | 无 completionHint 的任务项展示 | 不显示 💡 badge |
| TC-TASK-008 | 删除任务后持久化失败 | 任务重新出现在列表中（回滚） |

## 7.3 Bug 3 / 需求增强 — AI 监控闭环测试

| 测试用例 | 操作步骤 | 预期结果 |
|----------|----------|----------|
| TC-AI-001 | 配置 AI 后，访问黑名单网站 | AI prompt 中包含未完成任务的 completionHint |
| TC-AI-002 | AI 判断用户在完成某任务（返回 COMPLETED:xxx） | 显示确认气泡"xxx 完成了吗？"，不直接标记完成 |
| TC-AI-003 | 在确认气泡中点击"✅ 完成了" | 任务标记完成，completionMethod 为 'ai_detected'，显示庆祝气泡 |
| TC-AI-004 | 在确认气泡中点击"还没呢" | 显示鼓励气泡"继续加油！"，任务状态不变 |
| TC-AI-005 | AI 判断用户在做正事（返回 OK） | 显示个性化鼓励气泡，宠物状态为 happy |
| TC-AI-006 | 清除 apiKey 后访问黑名单网站 | 降级为纯规则匹配，显示规则 message |
| TC-AI-007 | AI 请求超时/失败 | 降级为纯规则匹配，控制台输出错误日志 |
| TC-AI-008 | 有已完成任务（含 completionMethod）时触发监控 | AI prompt 包含已完成任务的完成方式上下文 |
| TC-AI-009 | 任务无 completionHint 时触发监控 | AI prompt 使用任务标题代替，监控不中断 |

## 7.4 回归测试

| 测试用例 | 验证内容 |
|----------|----------|
| TC-REG-001 | 已有 tasks.json 数据（无 completionMethod 字段）可正常加载，不报错 |
| TC-REG-002 | 任务面板的添加、过滤、清除已完成等功能正常 |
| TC-REG-003 | 监控规则的添加、删除、保存正常 |
| TC-REG-004 | 宠物动画状态切换正常（idle/happy/angry/worried） |
| TC-REG-005 | 数据目录更改功能正常 |
| TC-REG-006 | 自动保存（5 秒间隔）正常工作 |

---

# **8. 实现优先级与依赖关系**

```
REQ-SAVE-001 (IPC 权限) ─── 前置条件，必须首先完成
    │
    ├── REQ-SAVE-002 (回滚) ─── 依赖权限正确
    ├── REQ-SAVE-003 (提示时长) ─── 独立
    └── REQ-SAVE-004 (加载状态) ─── 独立

REQ-TASK-003 (completionMethod 类型) ─── 前置条件
    │
    ├── REQ-TASK-001 (删除按钮样式) ─── 独立
    ├── REQ-TASK-002 (删除确认) ─── 独立
    └── REQ-TASK-004 (completionHint 展示) ─── 独立

REQ-AI-001 (prompt 含 completionHint) ─── 依赖 REQ-TASK-003
    │
    ├── REQ-AI-002 (AI 完成检测) ─── 依赖 REQ-AI-001
    ├── REQ-AI-003 (鼓励气泡) ─── 独立
    ├── REQ-AI-004 (降级处理) ─── 独立
    ├── REQ-AI-005 (completionHint 展示增强) ─── 依赖 REQ-TASK-004
    └── REQ-AI-006 (completionMethod 上下文) ─── 依赖 REQ-TASK-003
```

**建议实施顺序**：
1. **Phase 1**：REQ-SAVE-001 → REQ-SAVE-002 → REQ-SAVE-003 → REQ-SAVE-004
2. **Phase 2**：REQ-TASK-003 (类型) → REQ-TASK-001 → REQ-TASK-002 → REQ-TASK-004
3. **Phase 3**：REQ-AI-001 → REQ-AI-002 → REQ-AI-003 → REQ-AI-004 → REQ-AI-005 → REQ-AI-006
