# 桌喵 - 编码任务列表

> 基于需求规格文档(spec.md)和技术设计文档(design.md)生成
> 项目：zhuomiao-p0-bugfix-p1-chat
> 技术栈：Tauri v2 (Rust) + Svelte 5 + TypeScript + MySQL

---

## 1. Rust后端 - MySQL基础设施搭建

- [ ] **1.1 添加Cargo依赖**：在 `src-tauri/Cargo.toml` 中新增 `sqlx`（features: mysql, runtime-tokio-rustls, derive）和 `dotenvy` 依赖，为MySQL连接和.env配置读取提供支持
- [ ] **1.2 创建数据库连接配置文件**：新增 `src-tauri/.env` 文件，配置 `DATABASE_URL`、`DB_POOL_MIN`、`DB_POOL_MAX` 环境变量，并确保 `.env` 被添加到 `.gitignore` 避免泄露敏感信息
- [ ] **1.3 实现MySQL连接池管理模块**：新增 `src-tauri/src/db/mod.rs`，实现 `DbState` 结构体，包含 `connect()`（建立连接池）、`memory_mode()`（降级为内存模式）、`pool()`（获取连接池引用）、`is_available()`（检查可用性）方法，使用 `Option<MySqlPool>` 区分正常/降级模式
- [ ] **1.4 创建SQL迁移脚本**：新增 `src-tauri/src/db/migrations/` 目录，编写建表DDL迁移脚本，包含 `tasks`、`activity_records`、`monitor_rules`、`ai_config` 四张表的定义，含索引和外键约束
- [ ] **1.5 定义Rust侧数据模型**：新增 `src-tauri/src/models.rs`，定义 `Task`、`TaskInput`、`TaskPatch`、`ActivityRecord`、`ActivityInput`、`MonitorRule`、`AIConfig`、`DbStatusInfo`、`MigrationReport` 等结构体，添加 `serde` 序列化/反序列化支持
- [ ] **1.6 验证DB模块编译通过**：运行 `cargo check` 确认所有新增Rust代码无编译错误

## 2. Rust后端 - 任务CRUD命令实现

- [ ] **2.1 创建命令模块结构**：新增 `src-tauri/src/commands/mod.rs`，声明 `task`、`activity`、`rule`、`config`、`migration` 子模块
- [ ] **2.2 实现任务CRUD Tauri命令**：新增 `src-tauri/src/commands/task.rs`，实现以下 `#[tauri::command]` 异步命令：
  - `db_task_create`：INSERT单条任务，返回完整Task对象
  - `db_task_remove`：DELETE单条任务（按id）
  - `db_task_update`：部分UPDATE任务字段（支持TaskPatch），返回更新后的Task
  - `db_task_list`：SELECT全部任务，按created_at降序
  - `db_task_clear_completed`：DELETE所有completed=true的任务，返回删除行数
  - `db_task_toggle`：UPDATE任务的completed和completion_method字段
- [ ] **2.3 实现活动记录CRUD命令**：新增 `src-tauri/src/commands/activity.rs`，实现 `db_activity_create`、`db_activity_list`、`db_activity_calibrate` 三个Tauri命令
- [ ] **2.4 实现监控规则CRUD命令**：新增 `src-tauri/src/commands/rule.rs`，实现 `db_rule_list`、`db_rule_save` 两个Tauri命令
- [ ] **2.5 实现AI配置CRUD命令**：新增 `src-tauri/src/commands/config.rs`，实现 `db_config_get`、`db_config_save` 两个Tauri命令
- [ ] **2.6 实现数据库管理命令**：在 `src-tauri/src/commands/config.rs` 中添加 `db_status`（查询连接池状态）和 `db_connect`（重新连接数据库）两个命令
- [ ] **2.7 实现数据迁移命令**：新增 `src-tauri/src/commands/migration.rs`，实现 `migrate_from_json` 命令：读取旧JSON文件 → 验证数据完整性 → 批量INSERT到MySQL（ON DUPLICATE KEY SKIP）→ 返回 MigrationReport（成功数/跳过数/错误数）
- [ ] **2.8 注册所有新命令到lib.rs**：修改 `src-tauri/src/lib.rs`，在 `tauri::Builder` 的 `invoke_handler` 中注册所有新增的 `db_*` 和 `migrate_from_json` 命令，将旧 `save_app_data`/`load_app_data` 保留但标记为 `#[deprecated]`
- [ ] **2.9 改造Tauri setup初始化**：修改 `src-tauri/src/lib.rs` 的 `setup` 闭包，在应用启动时：读取 `.env` 配置 → 尝试建立MySQL连接 → 连接成功则运行schema迁移 → 连接失败则降级为内存模式并记录错误日志 → 将 `DbState` 通过 `app.manage()` 注入Tauri状态
- [ ] **2.10 验证所有Rust命令编译通过**：运行 `cargo check` 确认所有CRUD命令无编译错误，命令签名与前端invoke调用匹配

## 3. 前端 - 数据类型和Store扩展

- [ ] **3.1 扩展TypeScript类型定义**：修改 `src/lib/types/index.ts`，新增以下类型：
  - `ChatMessage`：`{ role: 'user' | 'assistant'; content: string; timestamp: string }`
  - `ChatResponse`：`{ message: string; action?: TaskAction }`
  - `TaskAction`：联合类型 `{ type: 'complete'; taskId: string } | { type: 'updateHint'; taskId: string; newHint: string }`
  - `DbStatusInfo`：`{ available: boolean; mode: 'mysql' | 'memory'; poolSize: number; idleConnections: number }`
  - `MigrationReport`：`{ successCount: number; skipCount: number; errorCount: number; errors: string[] }`
- [ ] **3.2 扩展Svelte Stores**：修改 `src/lib/stores/index.ts`，新增：
  - `dbStatus` store：类型 `DbStatusInfo`，默认值 `{ available: true, mode: 'mysql', poolSize: 0, idleConnections: 0 }`
  - `chatMessages` store：类型 `ChatMessage[]`，默认空数组
  - 确保 `tasks` store 的现有接口（add/remove/toggle/updateTask/clearCompleted）保持不变

## 4. 前端 - 持久化服务重构

- [ ] **4.1 新增即时单任务持久化API**：修改 `src/lib/services/persistence.ts`，新增以下异步函数：
  - `createTask(task: Task)`：调用 `invoke('db_task_create')` 创建任务，成功后更新store，失败则抛出异常
  - `removeTask(id: string)`：乐观更新（先从store移除），调用 `invoke('db_task_remove')`，失败则回滚（重新添加到store）
  - `updateTask(id: string, patch: Partial<Task>)`：乐观更新store，调用 `invoke('db_task_update')`，失败则回滚到旧值
  - `toggleTask(id: string, completionMethod?: 'manual' | 'ai_detected')`：乐观切换完成状态，调用 `invoke('db_task_update')` 更新completed和completion_method，失败则回滚
  - `clearCompleted()`：调用 `invoke('db_task_clear_completed')`，成功后从store移除已完成任务
- [ ] **4.2 实现从数据库加载全量数据**：在 `persistence.ts` 中新增 `loadAllFromDB()` 函数：并行调用 `db_task_list`、`db_rule_list`、`db_config_get`，以数据库为权威源覆盖内存store数据
- [ ] **4.3 实现降级模式处理**：在 `persistence.ts` 中新增降级逻辑：
  - 当invoke调用失败且错误包含"数据库连接不可用"时，设置 `dbStatus` store 为 `{ available: false, mode: 'memory' }`
  - 降级模式下回退到旧的 `save_app_data`/`load_app_data` JSON文件方式
  - 添加定时重试连接数据库逻辑，恢复后自动切换回MySQL模式并通知用户
- [ ] **4.4 保留自动保存兜底**：保留现有 `saveAll()` 和 `setupAutoSave()` 函数，作为数据库写入的兜底策略，确保快速连续操作无遗漏
- [ ] **4.5 替换面板窗口数据加载入口**：修改面板窗口打开时的数据加载逻辑，从调用 `load_app_data`（JSON）改为调用 `loadAllFromDB()`（MySQL），确保面板重开后数据与数据库一致

## 5. 前端 - 活动图表窗口内容完整展示

- [ ] **5.1 调整图表容器CSS**：修改 `src/routes/+page.svelte` 中 `.chart-panel` 的样式，将 `max-height` 从 500px 增大到 600px，保留 `overflow-y: auto`
- [ ] **5.2 ActivityChart内部容器滚动优化**：修改 `src/lib/components/ActivityChart.svelte`：
  - 为 `.chart-container` 添加 `display: flex; flex-direction: column; max-height: calc(100% - 40px); overflow-y: auto`
  - 为活动明细列表区域 `.record-list` 添加 `max-height: 200px; overflow-y: auto` 实现独立滚动
  - 使用 `position: sticky` 保持日期导航和汇总区域固定在顶部
- [ ] **5.3 验证空状态展示**：确认 `ActivityChart.svelte` 中已有空状态提示 `<p class="empty">当天暂无活动记录</p>`，无需额外修改

## 6. 前端 - 任务完成检测视觉反馈改造

- [ ] **6.1 改造confirmTaskCompletion函数**：修改 `src/routes/+page.svelte` 中的 `confirmTaskCompletion()`：
  - 将 `saveAll()` 替换为即时持久化调用 `toggleTask(id, 'ai_detected')`（利用乐观更新+自动回滚机制）
  - 成功后显示 `showSpeech('太棒了！又完成一个！', 'happy')`
  - 失败时显示 `showSpeech('保存失败，请重试', 'worried')` 并记录错误日志
- [ ] **6.2 改造denyTaskCompletion函数**：确认 `denyTaskCompletion()` 逻辑正确：取消确认状态、保持任务未完成、显示 `showSpeech('继续加油！', 'encourage')`
- [ ] **6.3 验证确认对话框UI**：确认现有的 `pendingConfirmTaskId` 状态管理、`confirm-actions` div 的气泡样式在宠物窗口上方正确显示，确保AI检测到任务完成时不自动标记，必须弹出确认对话框

## 7. 前端 - 任务面板窗口尺寸适配

- [ ] **7.1 调整面板窗口默认高度**：
  - 修改 `src-tauri/tauri.conf.json` 中 panel 窗口的 `height` 从 560 改为 640
  - 修改 `src/routes/+page.svelte` 中 `openPanel()` 函数的 `height: 560` 改为 `height: 640`
- [ ] **7.2 改造TaskPanel布局结构**：修改 `src/lib/components/TaskPanel.svelte`：
  - 外层 `.panel` 改为 `display: flex; flex-direction: column; height: 100vh; padding: 16px; box-sizing: border-box`
  - 任务列表区域 `.task-list` 改为 `flex: 1; overflow-y: auto; min-height: 0`（可滚动区域）
  - 底部 `.panel-footer` 改为 `flex-shrink: 0; margin-top: 8px`（始终可见，不被滚动遮挡）
  - 确保 `resizable: true` 保持不变
- [ ] **7.3 替换TaskPanel中的持久化调用**：修改 `TaskPanel.svelte` 中的任务操作（toggle、delete、clearCompleted），从直接修改store+saveAll改为调用 `persistence.ts` 的即时持久化API（toggleTask、removeTask、clearCompleted）

## 8. 前端 - 与桌喵聊天功能实现

- [ ] **8.1 创建聊天服务模块**：新增 `src/lib/services/chat.ts`，实现：
  - `TaskChatContext` 接口：`{ tasks: Task[]; currentTaskId?: string }`
  - `buildTaskContextPrompt()`：构建带任务列表上下文的系统提示词，包含任务列表和 `[COMPLETE:id]`、`[HINT:id:hint]` 操作指令说明
  - `parseChatResponse()`：解析AI回复中的 `[COMPLETE:id]` 和 `[HINT:id:hint]` 标记，提取 `TaskAction` 和清理后的回复文本
  - `chatWithTaskContext()`：整合上下文提示词构建、LLM调用、响应解析，返回 `ChatResponse`
- [ ] **8.2 创建QuickChat聊天组件**：新增 `src/lib/components/QuickChat.svelte`，实现：
  - Props：`visible`（是否可见）、`taskContext`（关联的任务上下文）、`onClose`（关闭回调）
  - 状态：`chatInput`（输入框内容）、`chatMessages`（对话历史）、`isChatLoading`（加载状态）
  - `handleChatSubmit()`：发送用户消息 → 调用 `chatWithTaskContext` → 添加AI回复到消息列表 → 若识别到 `TaskAction` 则调用 `executeTaskAction()` 执行
  - `executeTaskAction()`：根据action类型调用 `toggleTask()`（标记完成）或 `updateTask()`（修改检测规则），使用即时持久化
  - 超时自动关闭：30秒无输入自动退出聊天模式
  - 支持Escape键关闭
  - AI不可用时使用fallback回复
  - 聊天内容不持久化到数据库，仅在会话内有效
- [ ] **8.3 改造快速添加任务流程**：修改 `src/routes/+page.svelte`：
  - 在快速任务输入框区域新增"与桌喵聊天"复选框（`<label class="chat-toggle"><input type="checkbox" bind:checked={enableChat} /><span>与桌喵聊天</span></label>`）
  - 新增 `enableChat` 状态变量（默认false）
  - 提交快速任务后：若 `enableChat` 为true，设置 `showChatPanel = true` 和 `chatTaskContext = 新创建的任务`，显示 QuickChat 组件；若false，保持现有气泡提示行为
  - 新增 `showChatPanel` 和 `chatTaskContext` 状态变量
  - 渲染 QuickChat 组件：`{#if showChatPanel && chatTaskContext}<QuickChat visible={true} taskContext={chatTaskContext} onClose={...} />{/if}`

## 9. 数据迁移与降级验证

- [ ] **9.1 实现JSON到MySQL数据迁移工具**：在 `src-tauri/src/commands/migration.rs` 中完善 `migrate_from_json` 命令：
  - 读取旧的 `tasks.json`、`monitor-rules.json`、`ai-config.json` 文件
  - 验证每条记录的数据完整性（必填字段存在、类型正确、枚举值合法）
  - 批量INSERT到MySQL（使用 ON DUPLICATE KEY SKIP 避免重复）
  - 返回 `MigrationReport` 包含成功数、跳过数、错误数和错误详情
- [ ] **9.2 添加迁移UI入口**：在设置窗口或首次启动流程中，添加"从JSON迁移数据到MySQL"的按钮，调用 `invoke('migrate_from_json')` 并展示迁移结果报告
- [ ] **9.3 验证降级模式端到端**：模拟MySQL服务不可用场景，验证：
  - 应用正常启动并降级为内存模式
  - 桌喵气泡提示"数据存储服务暂不可用，数据仅在内存中保存"
  - 任务操作正常执行（使用JSON文件兜底）
  - MySQL恢复后自动切回数据库模式

## 10. 集成测试与验证

- [ ] **10.1 验证任务数据持久化完整性**：测试完整流程：创建任务 → 关闭面板 → 重新打开面板 → 确认任务存在；删除任务 → 关闭面板 → 重新打开 → 确认任务不存在；确认无数据复活现象
- [ ] **10.2 验证即时持久化与回滚**：测试：正常操作应即时持久化到MySQL；模拟持久化失败（如断开MySQL连接）验证内存状态正确回滚并提示用户
- [ ] **10.3 验证活动图表展示**：测试：打开活动图表 → 所有内容（柱状图、汇总、明细列表、校准按钮）通过滚动完全可见；活动明细列表可独立滚动；空状态显示"当天暂无活动记录"
- [ ] **10.4 验证任务完成检测反馈**：测试：AI返回"COMPLETED:任务标题" → 弹出确认对话框 → 点击"✅完成了" → 任务标记完成并即时持久化 → 关闭重开面板仍为完成状态；点击"还没呢" → 任务保持未完成
- [ ] **10.5 验证面板窗口布局**：测试：打开任务面板 → "清除已完成"按钮在默认窗口尺寸下完全可见；任务列表超出可视区域时列表可滚动但底部按钮固定可见
- [ ] **10.6 验证与桌喵聊天功能**：测试：快速添加任务 → 勾选"与桌喵聊天" → 提交 → 聊天输入框出现 → 输入"修改PPT已经做完了" → 桌喵识别并标记任务完成 → 输入"检测规则改为..." → 桌喵更新completionHint → 按Escape或点关闭退出聊天 → 重新进入不显示历史对话
- [ ] **10.7 验证聊天操作持久化**：测试：聊天中标记任务完成 → 关闭面板 → 重新打开 → 任务仍为完成状态；聊天中修改检测规则 → 重新打开 → 检测规则已更新
- [ ] **10.8 验证API Key安全性**：确认AI API Key通过环境变量获取，不硬编码在代码中；数据库密码通过.env配置，.env在.gitignore中
