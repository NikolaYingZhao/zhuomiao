# **1. 实现模型**

## **1.1 上下文视图**

### 系统上下文

```plantuml
@startuml
left to right direction

actor "用户" as User
rectangle "桌喵应用 (Tauri v2)" as App {
  rectangle "Svelte 5 前端" as Frontend {
    rectangle "主宠物窗口" as Pet
    rectangle "任务面板窗口" as Panel
    rectangle "设置窗口" as Settings
  }
  rectangle "Rust 后端" as Backend {
    rectangle "Tauri命令层" as Cmd
    rectangle "MySQL持久化层" as DBLayer
    rectangle "窗口监控模块" as Monitor
  }
}
database "MySQL" as MySQL
actor "LLM API" as LLM

User --> Frontend : 交互操作
Frontend --> Cmd : invoke()调用
Cmd --> DBLayer : 读写数据
DBLayer --> MySQL : SQL操作
Monitor --> Frontend : emit事件
Frontend --> LLM : HTTP请求
@enduml
```

### 现有架构痛点

| 痛点 | 现状 | 影响 |
|------|------|------|
| JSON文件存储 | `save_app_data`/`load_app_data` 将所有数据序列化为JSON文件写入磁盘 | 数据复活、无事务保障、无并发控制 |
| 全量序列化保存 | `saveAll()` 每次将整个tasks数组写入JSON | 性能差、操作非原子性 |
| 版本号冲突检测 | `currentDataVersion` 简单比较磁盘版本号 | 无法解决并发写入问题 |
| 无即时持久化 | 依赖5秒自动保存兜底 | 操作丢失风险 |
| 活动图表截断 | `.chart-panel` 固定 `max-height: 500px`，内部无滚动 | 内容超出时被截断不可见 |
| 面板高度不足 | 窗口默认高度560px，"清除已完成"按钮可能被遮挡 | 底部操作不可达 |

## **1.2 服务/组件总体架构**

### 分层架构

```plantuml
@startuml
@startuml
top to bottom direction

package "前端层 (Svelte 5 + TypeScript)" {
  [主宠物窗口 (+page.svelte)] as PetPage
  [任务面板窗口 (TaskPanel.svelte)] as TaskPanel
  [活动图表 (ActivityChart.svelte)] as ActivityChart
  [快速添加+聊天组件] as QuickChat
  [任务完成确认组件] as ConfirmDialog
}

package "前端服务层" {
  [持久化服务 (persistence.ts)] as PersistSvc
  [AI服务 (ai.ts)] as AISvc
  [聊天服务 (chat.ts)] as ChatSvc
}

package "前端状态层 (Svelte Stores)" {
  [tasks store] as TaskStore
  [activityRecords store] as ActivityStore
  [chatMessages store] as ChatStore
  [dbStatus store] as DbStatusStore
}

package "Rust后端 (Tauri v2)" {
  [Tauri命令层 (lib.rs)] as CmdLayer
  [MySQL连接池管理] as ConnPool
  [任务CRUD模块] as TaskCRUD
  [活动记录CRUD模块] as ActivityCRUD
  [监控规则CRUD模块] as RuleCRUD
  [数据迁移模块] as Migration
  [窗口监控模块] as WinMonitor
}

database "MySQL数据库" {
  [tasks表] as TaskTbl
  [activity_records表] as ActTbl
  [monitor_rules表] as RuleTbl
  [ai_config表] as AITbl
}

PetPage --> PersistSvc
PetPage --> AISvc
PetPage --> ChatSvc
TaskPanel --> PersistSvc
QuickChat --> ChatSvc
QuickChat --> PersistSvc

PersistSvc --> CmdLayer : invoke()
AISvc --> [LLM API] : fetch()
ChatSvc --> AISvc

CmdLayer --> ConnPool
CmdLayer --> TaskCRUD
CmdLayer --> ActivityCRUD
CmdLayer --> RuleCRUD
CmdLayer --> Migration

TaskCRUD --> TaskTbl
ActivityCRUD --> ActTbl
RuleCRUD --> RuleTbl
RuleCRUD --> AITbl
@enduml
@enduml
```

### 数据流改造对比

**现有数据流（JSON文件）：**
```
前端操作 → tasks store更新 → saveAll() → invoke('save_app_data') → 写入tasks.json
```

**新数据流（MySQL即时持久化）：**
```
前端操作 → invoke('db_task_create/remove/update') → MySQL INSERT/DELETE/UPDATE → 返回结果 → 成功则更新store / 失败则回滚
```

## **1.3 实现设计文档**

### 1.3.1 需求5.1：任务数据持久化重构（MySQL）

#### Rust后端MySQL集成

**技术选型：**

| 组件 | 选型 | 版本 | 理由 |
|------|------|------|------|
| MySQL驱动 | `sqlx` | 0.8 | 纯Rust实现、异步、编译期SQL检查、连接池内置 |
| 连接池 | `sqlx::MySqlPool` | - | sqlx内置，无需额外依赖 |
| 特性 | `runtime-tokio-rustls` | - | Tauri v2使用tokio运行时，rustls避免OpenSSL依赖 |
| 迁移 | `sqlx::migrate` | - | 内置迁移框架，版本化管理schema |

**Cargo.toml新增依赖：**
```toml
[dependencies]
sqlx = { version = "0.8", features = ["mysql", "runtime-tokio-rustls", "derive"] }
dotenvy = "0.15"  # 读取.env数据库连接配置
```

**数据库连接配置（.env文件）：**
```env
DATABASE_URL=mysql://zhuomiao:zhuomiao_pwd@localhost:3306/zhuomiao
DB_POOL_MIN=2
DB_POOL_MAX=5
```

**连接池管理模块（src-tauri/src/db/mod.rs）：**

```rust
// 核心设计：全局连接池，Tauri State管理
use sqlx::MySqlPool;
use std::sync::Mutex;

pub struct DbState {
    pool: Option<MySqlPool>,  // None表示降级为内存模式
}

impl DbState {
    pub async fn connect(url: &str, min: u32, max: u32) -> Result<Self, sqlx::Error> {
        let pool = MySqlPool::connect_with(
            sqlx::mysql::MySqlConnectOptions::from_str(url)?
                .min_connections(min)
                .max_connections(max)
        ).await?;
        Ok(Self { pool: Some(pool) })
    }

    pub fn memory_mode() -> Self {
        Self { pool: None }
    }

    pub fn pool(&self) -> Option<&MySqlPool> {
        self.pool.as_ref()
    }

    pub fn is_available(&self) -> bool {
        self.pool.is_some()
    }
}
```

**Tauri命令层改造（src-tauri/src/commands/task.rs）：**

```rust
// 即时持久化的CRUD命令，替代save_app_data/load_app_data
#[tauri::command]
async fn db_task_create(app: tauri::AppHandle, task: TaskInput) -> Result<Task, String> {
    let state = app.state::<DbState>();
    // 1. 写入MySQL
    // 2. 返回完整Task（含服务端生成的字段）
    // 3. 失败返回Err，前端据此回滚
}

#[tauri::command]
async fn db_task_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // DELETE FROM tasks WHERE id = ?
}

#[tauri::command]
async fn db_task_update(app: tauri::AppHandle, id: String, patch: TaskPatch) -> Result<Task, String> {
    // UPDATE tasks SET ... WHERE id = ?
    // 支持部分更新：completed、completionMethod、completionHint等
}

#[tauri::command]
async fn db_task_list(app: tauri::AppHandle) -> Result<Vec<Task>, String> {
    // SELECT * FROM tasks ORDER BY created_at DESC
}

#[tauri::command]
async fn db_task_clear_completed(app: tauri::AppHandle) -> Result<u64, String> {
    // DELETE FROM tasks WHERE completed = true
    // 返回删除行数
}
```

**Tauri setup初始化改造：**

```rust
// 在tauri::Builder::setup中初始化DB连接
.setup(|app| {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let db_state = rt.block_on(async {
        match DbState::connect(&db_url, min_conn, max_conn).await {
            Ok(state) => {
                // 运行schema迁移
                state.run_migrations().await.ok();
                state
            }
            Err(e) => {
                log::error!("数据库连接失败，降级为内存模式: {}", e);
                DbState::memory_mode()
            }
        }
    });
    app.manage(db_state);
    // ... 其余setup逻辑
})
```

**前端持久化服务重构（persistence.ts）：**

```typescript
// 新增：即时单任务持久化API
export async function createTask(task: Task): Promise<void> {
  try {
    const result = await invoke<Task>('db_task_create', { task });
    tasks.add(result);
  } catch (e) {
    console.error('创建任务持久化失败:', e);
    throw e; // 让调用方决定回滚策略
  }
}

export async function removeTask(id: string): Promise<void> {
  const backup = $tasks.find(t => t.id === id);
  tasks.remove(id); // 乐观更新
  try {
    await invoke('db_task_remove', { id });
  } catch (e) {
    if (backup) tasks.add(backup); // 回滚
    throw e;
  }
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  const old = $tasks.find(t => t.id === id);
  tasks.updateTask(id, patch); // 乐观更新
  try {
    await invoke('db_task_update', { id, patch });
  } catch (e) {
    if (old) tasks.updateTask(id, old); // 回滚
    throw e;
  }
}

export async function toggleTask(id: string, completionMethod?: 'manual' | 'ai_detected'): Promise<void> {
  const task = $tasks.find(t => t.id === id);
  if (!task) return;
  const newCompleted = !task.completed;
  const patch = {
    completed: newCompleted,
    completionMethod: newCompleted ? (completionMethod ?? 'manual') : null,
  };
  tasks.toggle(id, completionMethod); // 乐观更新
  try {
    await invoke('db_task_update', { id, patch });
  } catch (e) {
    tasks.toggle(id); // 回滚
    throw e;
  }
}

export async function loadAllFromDB(): Promise<void> {
  // 从MySQL加载全量数据作为权威源
  const [taskList, ruleList, configData] = await Promise.all([
    invoke<Task[]>('db_task_list'),
    invoke<MonitorRule[]>('db_rule_list'),
    invoke<AIConfig | null>('db_config_get'),
  ]);
  tasks.set(taskList);
  monitorRules.set(ruleList);
  if (configData) aiConfig.set(configData);
}
```

**数据迁移模块（src-tauri/src/commands/migration.rs）：**

```rust
#[tauri::command]
async fn migrate_from_json(app: tauri::AppHandle) -> Result<MigrationReport, String> {
    // 1. 读取旧的tasks.json、monitor-rules.json、ai-config.json
    // 2. 验证每条记录的数据完整性
    // 3. 批量INSERT到MySQL（ON DUPLICATE KEY SKIP）
    // 4. 返回MigrationReport { success_count, skip_count, error_count, errors }
}

pub struct MigrationReport {
    pub success_count: u32,
    pub skip_count: u32,
    pub error_count: u32,
    pub errors: Vec<String>,
}
```

**降级模式处理：**

当前端调用数据库命令失败且错误类型为连接不可用时：
1. 设置 `dbStatus` store 为 `{ available: false, mode: 'memory' }`
2. 切换到内存模式，回退到旧的 `save_app_data`/`load_app_data` JSON文件方式
3. 桌喵气泡提示"数据存储服务暂不可用，数据仅在内存中保存"
4. 定时重试连接数据库，恢复后自动切换回MySQL模式

---

### 1.3.2 需求5.2：活动图表窗口内容完整展示

**问题分析：**

当前 `ActivityChart.svelte` 组件本身无高度限制，但其在 `+page.svelte` 中的容器 `.chart-panel` 设置了 `max-height: 500px` 和 `overflow-y: auto`。问题是图表内容（24小时柱状图 + 活动类型汇总 + 图例 + 活动明细列表 + 校准按钮）总高度经常超过500px，且滚动可能不流畅。

**实现方案：**

1. **保留 `.chart-panel` 的 `max-height` 和 `overflow-y: auto`**：确保弹窗不会无限撑高
2. **增大 `max-height` 为 600px**：适配更多内容
3. **在 `.chart-container`（ActivityChart内部容器）添加 `overflow-y: auto` 和 `max-height` 计算**：确保内部可滚动
4. **活动明细列表区域独立滚动**：`.record-list` 添加 `max-height: 200px; overflow-y: auto`
5. **图表头部固定、明细区域滚动**：使用CSS `position: sticky` 保持日期导航和汇总区域固定

**CSS变更清单：**

```css
/* +page.svelte - chart-panel */
.chart-panel {
  max-height: 600px; /* 从500px增大 */
  overflow-y: auto;
}

/* ActivityChart.svelte - chart-container */
.chart-container {
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 40px); /* 减去header高度 */
  overflow-y: auto;
}

/* ActivityChart.svelte - record-list 独立滚动 */
.record-list {
  max-height: 200px;
  overflow-y: auto;
}
```

**空状态处理：**

活动记录为空时，已有 `<p class="empty">当天暂无活动记录</p>` 的处理，无需额外修改。

---

### 1.3.3 需求5.3：任务完成检测视觉反馈

**现有实现分析：**

当前 `+page.svelte` 已有基本的完成确认流程：
- `pendingConfirmTaskId` 状态管理
- `confirmTaskCompletion()` / `denyTaskCompletion()` 处理函数
- 气泡确认UI（`confirm-actions` div）

**需改造点：**

1. **持久化保障**：`confirmTaskCompletion()` 中的 `saveAll()` 替换为即时持久化 `toggleTask(id, 'ai_detected')`
2. **回滚增强**：持久化失败时回滚更精确（当前回滚 `tasks.toggle(id)` 可能状态不一致）
3. **视觉反馈优化**：确认按钮的气泡样式增强，确保在宠物窗口上方显示

**改造后的 confirmTaskCompletion：**

```typescript
async function confirmTaskCompletion() {
  if (!pendingConfirmTaskId) return;
  const id = pendingConfirmTaskId;
  pendingConfirmTaskId = null;
  try {
    await toggleTask(id, 'ai_detected'); // 即时持久化+乐观更新+自动回滚
    showSpeech('太棒了！又完成一个！', 'happy');
  } catch (e) {
    showSpeech('保存失败，请重试', 'worried');
    console.error('完成任务持久化失败:', e);
  }
}
```

---

### 1.3.4 需求5.4：任务面板窗口尺寸适配

**问题分析：**

当前面板窗口配置：`width: 420, height: 560`。在560px高度下，当任务列表较多时，"清除已完成"按钮可能被滚动区域遮挡。

**实现方案：**

1. **增大默认窗口高度**：从560px调整为640px，确保在典型任务数量下底部按钮可见
2. **面板布局改造**：采用 `display: flex; flex-direction: column; height: 100vh` 布局，任务列表区域 `flex: 1; overflow-y: auto`，底部按钮 `flex-shrink: 0` 始终可见
3. **同步修改 tauri.conf.json 和 +page.svelte 中的窗口创建参数**

**文件变更：**

- `tauri.conf.json`：panel窗口 `height` 从560改为640
- `+page.svelte`：`openPanel()` 中 `height: 560` 改为 `height: 640`
- `TaskPanel.svelte`：布局结构改造

**TaskPanel.svelte 布局改造：**

```svelte
<div class="panel">
  <!-- 头部固定 -->
  <div class="panel-header">...</div>
  <div class="toolbar">...</div>

  <!-- 添加表单（条件渲染） -->
  {#if showAddForm}
    <div class="add-form">...</div>
  {/if}

  <!-- 任务列表区域：可滚动 -->
  <div class="task-list">
    {#each filteredTasks as task (task.id)}
      <TaskItem {task} onToggle={handleToggle} onDelete={handleDelete} />
    {/each}
  </div>

  <!-- 底部按钮固定 -->
  {#if $completedTasks.length > 0}
    <div class="panel-footer">
      <button class="clear-btn" onclick={handleClearCompleted}>
        清除已完成 ({$completedTasks.length})
      </button>
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 16px;
    box-sizing: border-box;
  }
  .task-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .panel-footer {
    flex-shrink: 0;
    margin-top: 8px;
  }
</style>
```

---

### 1.3.5 需求5.5：快速添加任务时"与桌喵聊天"功能

**新增组件：QuickChat.svelte**

这是本次新增的核心组件，在快速添加任务流程中嵌入聊天功能。

**组件结构：**

```svelte
<script lang="ts">
  // Props
  let { visible, taskContext, onClose } = $props<{
    visible: boolean;
    taskContext: Task | null;
    onClose: () => void;
  }>();

  // 状态
  let chatInput = $state('');
  let chatMessages = $state<ChatMessage[]>([]);
  let isChatLoading = $state(false);

  // 聊天消息类型
  interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }
</script>
```

**快速添加流程改造（+page.svelte）：**

```
现有流程：
  点击📝 → 显示输入框 → 输入标题 → Enter → 创建任务 → 显示气泡提示

新流程：
  点击📝 → 显示输入框 + "与桌喵聊天"复选框 → 输入标题 → Enter
    → 创建任务
    → 如果勾选了"与桌喵聊天"：显示QuickChat组件
    → 如果未勾选：显示气泡提示（现有行为）
```

**AI聊天服务增强（chat.ts）：**

```typescript
// 新增：任务上下文感知的聊天服务
export interface TaskChatContext {
  tasks: Task[];
  currentTaskId?: string;
}

export async function chatWithTaskContext(
  config: AIConfig,
  userMessage: string,
  context: TaskChatContext,
  history: ChatMessage[] = []
): Promise<ChatResponse> {
  // 1. 构建带任务上下文的系统提示
  const systemPrompt = buildTaskContextPrompt(config.systemPrompt, context);
  // 2. 调用LLM
  const aiResponse = await chatWithAI(config, userMessage, history);
  // 3. 解析AI响应，识别任务操作指令
  return parseChatResponse(aiResponse, context);
}

export interface ChatResponse {
  message: string;           // 桌喵的回复文本
  action?: TaskAction;       // 识别到的任务操作
}

export type TaskAction =
  | { type: 'complete'; taskId: string }
  | { type: 'updateHint'; taskId: string; newHint: string };

function buildTaskContextPrompt(basePrompt: string, context: TaskChatContext): string {
  const taskList = context.tasks
    .map(t => `- "${t.title}" (id: ${t.id}, 完成: ${t.completed}, 检测规则: ${t.completionHint || '无'})`)
    .join('\n');
  return `${basePrompt}\n\n当前用户的任务列表：\n${taskList}\n\n你可以通过以下格式执行任务操作：\n- 标记任务完成：[COMPLETE:任务ID]\n- 修改检测规则：[HINT:任务ID:新规则]\n请在自然语言回复中嵌入这些指令。`;
}

function parseChatResponse(aiResponse: string, context: TaskChatContext): ChatResponse {
  // 解析AI回复中的 [COMPLETE:id] 和 [HINT:id:hint] 指令
  let action: TaskAction | undefined;
  let message = aiResponse;

  const completeMatch = aiResponse.match(/\[COMPLETE:([^\]]+)\]/);
  if (completeMatch) {
    const taskId = completeMatch[1];
    const task = context.tasks.find(t => t.id === taskId);
    if (task) {
      action = { type: 'complete', taskId };
      message = aiResponse.replace(completeMatch[0], '').trim();
    }
  }

  const hintMatch = aiResponse.match(/\[HINT:([^:]+):([^\]]+)\]/);
  if (hintMatch) {
    const taskId = hintMatch[1];
    const newHint = hintMatch[2];
    action = { type: 'updateHint', taskId, newHint };
    message = aiResponse.replace(hintMatch[0], '').trim();
  }

  return { message: message || aiResponse, action };
}
```

**聊天交互处理逻辑：**

```typescript
async function handleChatSubmit() {
  if (!chatInput.trim()) return;

  const userMsg: ChatMessage = {
    role: 'user',
    content: chatInput.trim(),
    timestamp: new Date().toISOString(),
  };
  chatMessages = [...chatMessages, userMsg];
  chatInput = '';
  isChatLoading = true;

  try {
    const context: TaskChatContext = {
      tasks: $tasks,
      currentTaskId: taskContext?.id,
    };
    const response = await chatWithTaskContext(
      $aiConfig,
      userMsg.content,
      context,
      chatMessages.filter(m => m.role !== 'system')
    );

    chatMessages = [...chatMessages, {
      role: 'assistant',
      content: response.message,
      timestamp: new Date().toISOString(),
    }];

    // 执行识别到的任务操作
    if (response.action) {
      await executeTaskAction(response.action);
    }
  } catch {
    chatMessages = [...chatMessages, {
      role: 'assistant',
      content: 'AI服务暂不可用，部分功能受限',
      timestamp: new Date().toISOString(),
    }];
  } finally {
    isChatLoading = false;
  }
}

async function executeTaskAction(action: TaskAction) {
  switch (action.type) {
    case 'complete':
      await toggleTask(action.taskId, 'manual');
      break;
    case 'updateHint':
      await updateTask(action.taskId, { completionHint: action.newHint });
      break;
  }
}
```

**UI交互设计：**

快速添加输入框区域改造：

```svelte
{#if showQuickTaskInput}
  <div class="quick-task-input">
    <input type="text" placeholder="告诉桌喵你要做什么..." bind:value={quickTaskTitle}
      onkeydown={(e) => { if (e.key === 'Enter') submitQuickTask(); if (e.key === 'Escape') cancelQuickTask(); }}
    />
    <label class="chat-toggle">
      <input type="checkbox" bind:checked={enableChat} />
      <span>与桌喵聊天</span>
    </label>
    <button class="quick-task-ok" onclick={submitQuickTask}>✓</button>
    <button class="quick-task-cancel" onclick={cancelQuickTask}>✕</button>
  </div>
{/if}

{#if showChatPanel && chatTaskContext}
  <QuickChat
    visible={true}
    taskContext={chatTaskContext}
    onClose={() => { showChatPanel = false; chatTaskContext = null; }}
  />
{/if}
```

**聊天模式退出：**
- 点击QuickChat组件的关闭按钮
- 按Escape键
- 聊天输入框超时无输入（30秒无操作自动关闭，配置化）

---

# **2. 接口设计**

## **2.1 总体设计**

### 接口分层

```plantuml
@startuml
top to bottom direction

package "前端 → Rust (Tauri invoke)" {
  rectangle "任务CRUD命令" as TaskCmd #LightGreen
  rectangle "活动记录CRUD命令" as ActCmd #LightBlue
  rectangle "监控规则CRUD命令" as RuleCmd #LightYellow
  rectangle "配置CRUD命令" as ConfCmd #LightCoral
  rectangle "数据库管理命令" as DbCmd #Lavender
  rectangle "数据迁移命令" as MigCmd #Thistle
}

package "前端内部服务接口" {
  rectangle "persistence.ts" as Persist #LightGreen
  rectangle "ai.ts" as AI #LightBlue
  rectangle "chat.ts" as Chat #LightYellow
}

TaskCmd --> [MySQL] : sqlx
ActCmd --> [MySQL] : sqlx
RuleCmd --> [MySQL] : sqlx
ConfCmd --> [MySQL] : sqlx
DbCmd --> [MySQL] : sqlx
MigCmd --> [MySQL] : sqlx

Persist --> TaskCmd
Persist --> ActCmd
Persist --> RuleCmd
Persist --> ConfCmd
Chat --> AI
@enduml
```

### 错误处理规范

所有Tauri命令统一返回 `Result<T, String>`，错误消息格式：

```rust
// 业务错误
Err(format!("任务不存在: {}", id))
Err("数据库连接不可用".into())

// 持久化错误
Err(format!("任务创建失败: {}", sql_error))
```

前端侧统一错误处理：

```typescript
try {
  await invoke('db_task_create', { task });
} catch (e) {
  if (String(e).includes('数据库连接不可用')) {
    // 切换降级模式
    dbStatus.set({ available: false, mode: 'memory' });
  }
  throw e; // 向上传播，让调用方处理回滚
}
```

## **2.2 接口清单**

### 2.2.1 任务CRUD接口（Rust Tauri Commands）

| 命令名 | 输入参数 | 返回类型 | 说明 |
|--------|----------|----------|------|
| `db_task_create` | `task: TaskInput` | `Result<Task, String>` | 创建单个任务，立即持久化 |
| `db_task_remove` | `id: String` | `Result<(), String>` | 删除单个任务，立即持久化 |
| `db_task_update` | `id: String, patch: TaskPatch` | `Result<Task, String>` | 部分更新任务字段 |
| `db_task_list` | 无 | `Result<Vec<Task>, String>` | 查询全部任务 |
| `db_task_clear_completed` | 无 | `Result<u64, String>` | 删除所有已完成任务，返回删除数 |
| `db_task_toggle` | `id: String, completed: bool, completion_method: Option<String>` | `Result<Task, String>` | 切换完成状态 |

**TaskInput结构（创建时输入）：**

```rust
pub struct TaskInput {
    pub title: String,          // 必填，max 100字符
    pub category: String,       // 必填，枚举
    pub priority: String,       // 必填，枚举
    pub due_date: Option<String>, // 选填
    pub completion_hint: Option<String>, // 选填，max 50字符
}
```

**TaskPatch结构（部分更新）：**

```rust
pub struct TaskPatch {
    pub title: Option<String>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<Option<String>>, // Some(None)表示清空
    pub completed: Option<bool>,
    pub completion_method: Option<Option<String>>,
    pub completion_hint: Option<String>,
}
```

### 2.2.2 活动记录CRUD接口

| 命令名 | 输入参数 | 返回类型 | 说明 |
|--------|----------|----------|------|
| `db_activity_create` | `record: ActivityInput` | `Result<ActivityRecord, String>` | 记录一条活动 |
| `db_activity_list` | `since: Option<String>` | `Result<Vec<ActivityRecord>, String>` | 查询活动记录，since为ISO时间戳 |
| `db_activity_calibrate` | `id: String, classification: String` | `Result<ActivityRecord, String>` | 校准活动分类 |

### 2.2.3 监控规则CRUD接口

| 命令名 | 输入参数 | 返回类型 | 说明 |
|--------|----------|----------|------|
| `db_rule_list` | 无 | `Result<Vec<MonitorRule>, String>` | 查询所有规则 |
| `db_rule_save` | `rules: Vec<MonitorRule>` | `Result<(), String>` | 批量保存规则 |

### 2.2.4 AI配置CRUD接口

| 命令名 | 输入参数 | 返回类型 | 说明 |
|--------|----------|----------|------|
| `db_config_get` | 无 | `Result<Option<AIConfig>, String>` | 获取AI配置 |
| `db_config_save` | `config: AIConfig` | `Result<(), String>` | 保存AI配置 |

### 2.2.5 数据库管理接口

| 命令名 | 输入参数 | 返回类型 | 说明 |
|--------|----------|----------|------|
| `db_status` | 无 | `Result<DbStatusInfo, String>` | 查询数据库连接状态 |
| `db_connect` | `url: String` | `Result<(), String>` | 重新连接数据库 |

**DbStatusInfo结构：**

```rust
pub struct DbStatusInfo {
    pub available: bool,
    pub mode: String,         // "mysql" | "memory"
    pub pool_size: u32,       // 当前连接数
    pub idle_connections: u32, // 空闲连接数
}
```

### 2.2.6 数据迁移接口

| 命令名 | 输入参数 | 返回类型 | 说明 |
|--------|----------|----------|------|
| `migrate_from_json` | 无 | `Result<MigrationReport, String>` | 从JSON文件迁移到MySQL |

### 2.2.7 前端服务层接口（TypeScript）

**persistence.ts 改造后接口：**

| 函数 | 签名 | 说明 |
|------|------|------|
| `createTask` | `(task: Task) => Promise<void>` | 创建任务（即时持久化） |
| `removeTask` | `(id: string) => Promise<void>` | 删除任务（乐观更新+回滚） |
| `updateTask` | `(id: string, patch: Partial<Task>) => Promise<void>` | 更新任务（乐观更新+回滚） |
| `toggleTask` | `(id: string, method?: 'manual'\|'ai_detected') => Promise<void>` | 切换完成状态 |
| `clearCompleted` | `() => Promise<void>` | 清除已完成任务 |
| `loadAllFromDB` | `() => Promise<void>` | 从MySQL加载全量数据 |
| `saveAll` | `() => Promise<void>` | 兼容保留，兜底自动保存 |
| `setupAutoSave` | `(intervalMs?: number) => Timer` | 保留自动保存兜底 |

**新增 chat.ts 接口：**

| 函数 | 签名 | 说明 |
|------|------|------|
| `chatWithTaskContext` | `(config, message, context, history?) => Promise<ChatResponse>` | 带任务上下文的聊天 |
| `buildTaskContextPrompt` | `(base, context) => string` | 构建上下文提示词 |
| `parseChatResponse` | `(response, context) => ChatResponse` | 解析AI回复中的任务操作 |

---

# **4. 数据模型**

## **4.1 设计目标**

1. **关系规范化**：任务、活动记录、监控规则、AI配置各自独立表，消除JSON全量序列化的冗余
2. **类型安全**：枚举字段使用ENUM类型或CHECK约束，确保数据完整性
3. **即时持久化**：每条操作对应单行INSERT/UPDATE/DELETE，无需全量覆盖
4. **查询效率**：为常用查询路径建立索引
5. **迁移兼容**：表结构兼容现有JSON数据模型的字段，迁移无损

## **4.2 模型实现**

### 4.2.1 tasks 表

```sql
CREATE TABLE tasks (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID主键',
  title VARCHAR(100) NOT NULL COMMENT '任务标题',
  category ENUM('学习', '工作', '生活', '运动', '阅读', '其他') NOT NULL DEFAULT '其他' COMMENT '分类',
  priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium' COMMENT '优先级',
  due_date DATE NULL COMMENT '截止日期',
  completed BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否完成',
  completion_method ENUM('manual', 'ai_detected') NULL COMMENT '完成方式，NULL表示未完成',
  completion_hint VARCHAR(50) NULL COMMENT 'AI完成检测提示',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  INDEX idx_tasks_completed (completed),
  INDEX idx_tasks_category (category),
  INDEX idx_tasks_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务表';
```

**与现有Task接口的字段映射：**

| TypeScript字段 | MySQL列 | 类型映射 |
|----------------|---------|----------|
| `id: string` | `id VARCHAR(36)` | 直接映射 |
| `title: string` | `title VARCHAR(100)` | 直接映射 |
| `category: string` | `category ENUM(...)` | 枚举约束 |
| `priority: 'low'\|'medium'\|'high'` | `priority ENUM(...)` | 枚举约束 |
| `dueDate: string \| null` | `due_date DATE NULL` | ISO字符串↔DATE |
| `completed: boolean` | `completed BOOLEAN` | 直接映射 |
| `createdAt: string` | `created_at DATETIME` | ISO字符串↔DATETIME |
| `completionHint?: string` | `completion_hint VARCHAR(50) NULL` | 可选↔NULL |
| `completionMethod?: 'manual'\|'ai_detected'\|null` | `completion_method ENUM(...) NULL` | 可选枚举↔NULL |

### 4.2.2 activity_records 表

```sql
CREATE TABLE activity_records (
  id VARCHAR(20) PRIMARY KEY COMMENT '记录ID',
  timestamp DATETIME NOT NULL COMMENT '记录时间',
  window_title VARCHAR(300) NOT NULL COMMENT '窗口标题',
  process_name VARCHAR(100) NOT NULL COMMENT '进程名称',
  classification ENUM('productive', 'slacking') NOT NULL COMMENT '活动分类',
  classification_source ENUM('ai', 'rule_based', 'manual') NOT NULL COMMENT '分类来源',
  activity_type VARCHAR(50) NULL COMMENT '活动类型',
  ai_comment VARCHAR(200) NULL COMMENT 'AI评论',
  task_id VARCHAR(36) NULL COMMENT '关联任务ID',

  INDEX idx_activity_timestamp (timestamp),
  INDEX idx_activity_classification (classification),
  INDEX idx_activity_task_id (task_id),

  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动记录表';
```

### 4.2.3 monitor_rules 表

```sql
CREATE TABLE monitor_rules (
  id VARCHAR(36) PRIMARY KEY COMMENT '规则ID',
  pattern VARCHAR(500) NOT NULL COMMENT '匹配模式',
  rule_type ENUM('url', 'process') NOT NULL COMMENT '规则类型',
  is_blacklist BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否黑名单',
  message VARCHAR(200) NOT NULL COMMENT '提醒消息'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='监控规则表';
```

### 4.2.4 ai_config 表

```sql
CREATE TABLE ai_config (
  config_key VARCHAR(50) PRIMARY KEY COMMENT '配置键',
  config_value TEXT NOT NULL COMMENT '配置值(JSON)',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI配置表';

-- 初始数据
INSERT INTO ai_config (config_key, config_value) VALUES
('provider', '"openai"'),
('endpoint', '"https://api.openai.com/v1"'),
('model', '"gpt-4o-mini"'),
('system_prompt', '"你是桌喵，一只住在用户桌面上的小猫咪..."');
```

**说明**：AI配置采用键值对存储，前端加载时组装为 `AIConfig` 对象。`api_key` 不存储在数据库中，通过环境变量 `AI_API_KEY` 获取，符合安全性要求。

### 4.2.5 schema_migrations 表（sqlx自动管理）

```sql
-- sqlx migrate 自动创建和管理此表
CREATE TABLE IF NOT EXISTS _sqlx_migrations (
  version BIGINT PRIMARY KEY,
  description TEXT NOT NULL,
  kind TEXT NOT NULL,
  checksum BLOB NOT NULL,
  execution_time BIGINT NOT NULL
);
```

### 4.2.6 数据模型ER图

```plantuml
@startuml
entity "tasks" as tasks {
  * id : VARCHAR(36) <<PK>>
  --
  * title : VARCHAR(100)
  * category : ENUM
  * priority : ENUM
  due_date : DATE
  * completed : BOOLEAN
  completion_method : ENUM
  completion_hint : VARCHAR(50)
  * created_at : DATETIME
}

entity "activity_records" as activity {
  * id : VARCHAR(20) <<PK>>
  --
  * timestamp : DATETIME
  * window_title : VARCHAR(300)
  * process_name : VARCHAR(100)
  * classification : ENUM
  * classification_source : ENUM
  activity_type : VARCHAR(50)
  ai_comment : VARCHAR(200)
  task_id : VARCHAR(36) <<FK>>
}

entity "monitor_rules" as rules {
  * id : VARCHAR(36) <<PK>>
  --
  * pattern : VARCHAR(500)
  * rule_type : ENUM
  * is_blacklist : BOOLEAN
  * message : VARCHAR(200)
}

entity "ai_config" as config {
  * config_key : VARCHAR(50) <<PK>>
  --
  * config_value : TEXT
  * updated_at : DATETIME
}

activity }o--|| tasks : "task_id FK"
@enduml
```

---

# **5. 关键代码变更清单**

## **5.1 Rust后端变更**

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `src-tauri/Cargo.toml` | 修改 | 新增 `sqlx`、`dotenvy` 依赖 |
| `src-tauri/.env` | 新增 | 数据库连接配置 |
| `src-tauri/src/db/mod.rs` | 新增 | MySQL连接池管理、DbState结构 |
| `src-tauri/src/db/migrations/` | 新增 | SQL迁移脚本（建表DDL） |
| `src-tauri/src/commands/task.rs` | 新增 | 任务CRUD Tauri命令 |
| `src-tauri/src/commands/activity.rs` | 新增 | 活动记录CRUD Tauri命令 |
| `src-tauri/src/commands/rule.rs` | 新增 | 监控规则CRUD Tauri命令 |
| `src-tauri/src/commands/config.rs` | 新增 | AI配置CRUD Tauri命令 |
| `src-tauri/src/commands/migration.rs` | 新增 | JSON→MySQL数据迁移命令 |
| `src-tauri/src/commands/mod.rs` | 新增 | 命令模块声明 |
| `src-tauri/src/lib.rs` | 修改 | 注册新命令、setup中初始化DB、管理DbState |
| `src-tauri/src/models.rs` | 新增 | Rust侧数据模型（Task、TaskInput、TaskPatch等） |

## **5.2 前端变更**

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `src/lib/services/persistence.ts` | 重构 | 新增即时持久化API（createTask/removeTask/updateTask/toggleTask/loadAllFromDB），保留saveAll兜底 |
| `src/lib/services/chat.ts` | 新增 | 任务上下文感知的聊天服务 |
| `src/lib/components/QuickChat.svelte` | 新增 | 聊天对话组件 |
| `src/lib/types/index.ts` | 修改 | 新增 ChatMessage、ChatResponse、TaskAction、DbStatusInfo 类型 |
| `src/lib/stores/index.ts` | 修改 | 新增 dbStatus、chatMessages store |
| `src/routes/+page.svelte` | 修改 | 快速添加流程增加"与桌喵聊天"选项、集成QuickChat、持久化调用替换为即时API、面板高度调整、图表容器高度调整 |
| `src/lib/components/TaskPanel.svelte` | 修改 | 布局改为flex column、底部按钮固定、持久化调用替换 |
| `src/lib/components/ActivityChart.svelte` | 修改 | 内部容器添加滚动、明细列表独立滚动区域 |
| `src-tauri/tauri.conf.json` | 修改 | panel窗口高度560→640 |

## **5.3 删除/废弃**

| 文件/代码 | 处理 | 说明 |
|-----------|------|------|
| `save_app_data` 命令 | 保留但标记废弃 | 降级模式仍需使用 |
| `load_app_data` 命令 | 保留但标记废弃 | 降级模式仍需使用 |
| `persistence.ts` 中的 `saveAll` | 保留 | 作为自动保存兜底策略 |
| JSON数据文件 (`tasks.json`等) | 保留 | 迁移后可作为备份，不自动删除 |

---

# **6. 风险评估和兼容性考量**

## **6.1 风险评估**

| 风险项 | 等级 | 影响 | 缓解措施 |
|--------|------|------|----------|
| MySQL服务未安装或未启动 | 高 | 应用无法持久化数据 | 降级为内存模式+JSON文件兜底，气泡提示用户 |
| 数据迁移数据损坏 | 中 | 部分数据丢失 | 迁移工具跳过损坏记录、生成迁移报告、保留原JSON文件 |
| sqlx编译期SQL检查依赖活跃DB连接 | 中 | CI/CD环境需MySQL | 使用 `sqlx::query` 而非 `sqlx::query!` 避免编译期检查；或CI中提供MySQL服务 |
| LLM API不可用导致聊天功能降级 | 低 | 聊天使用fallback回复 | 已有 `getFallbackResponse` 兜底机制 |
| 连接池耗尽 | 低 | 持久化操作等待 | max_connections=5、操作超时自动失败回滚 |
| 乐观更新与数据库不一致 | 低 | 短暂的UI闪烁 | 失败立即回滚，用户感知极短 |
| 多窗口并发写入 | 低 | 数据竞争 | MySQL行级锁+单连接池保证顺序 |

## **6.2 兼容性考量**

### 6.2.1 数据迁移兼容

- 现有JSON文件中的数据结构与MySQL表结构一一对应，迁移无损
- `dueDate` 格式：JSON中为ISO 8601字符串（`2025-01-15`），MySQL DATE类型兼容
- `createdAt` 格式：JSON中为ISO 8601完整时间戳，MySQL DATETIME兼容
- `id` 格式：JSON中使用 `crypto.randomUUID()` 生成标准UUID，VARCHAR(36)兼容
- `activity_records.id` 格式：JSON中使用 `Date.now().toString(36) + Math.random().toString(36).slice(2,6)`，VARCHAR(20)兼容

### 6.2.2 API兼容

- 旧的 `save_app_data`/`load_app_data` 命令保留，降级模式仍可使用
- 前端 `persistence.ts` 的 `saveAll()` 和 `setupAutoSave()` 保留，自动保存兜底
- 新的即时持久化API与旧API可共存，渐进式迁移

### 6.2.3 前端状态兼容

- `tasks` store 接口不变（`add`/`remove`/`toggle`/`updateTask`/`clearCompleted`），仅内部实现从"先更新store再saveAll"改为"乐观更新+即时持久化+失败回滚"
- 新增 `dbStatus` store，不影响现有store

### 6.2.4 窗口尺寸兼容

- 面板窗口高度从560px增至640px，用户已有的窗口位置记忆（若Tauri保存了窗口状态）可能需要适配
- `resizable: true` 保持不变，用户仍可手动调整

## **6.3 性能预期**

| 操作 | 现有耗时（JSON） | 预期耗时（MySQL） | 说明 |
|------|-----------------|-------------------|------|
| 创建任务 | ~50ms（全量序列化写入） | ~20ms（单行INSERT） | 显著提升 |
| 删除任务 | ~50ms | ~15ms（单行DELETE） | 显著提升 |
| 加载全部任务 | ~30ms（反序列化JSON） | ~25ms（SELECT *） | 持平 |
| 切换完成状态 | ~50ms | ~15ms（单行UPDATE） | 显著提升 |
| 自动保存兜底 | ~50ms × N次 | 不再需要频繁全量保存 | 大幅减少IO |
