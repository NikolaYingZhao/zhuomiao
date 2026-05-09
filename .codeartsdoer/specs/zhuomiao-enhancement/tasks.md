# 桌喵功能增强 — 编码任务规划

> 需求来源：spec.md / design.md  
> 技术栈：Tauri v2 + SvelteKit v2 + Svelte 5 (runes) + TypeScript + Rust  
> 优先级：P0-1 > P0-2 > P0-3 > P1-1

---

## 1. 基础类型与数据模型准备（无依赖）

- [ ] 在 `src/lib/types/index.ts` 中为 `ActivityRecord` 接口新增可选字段 `aiComment?: string`，确保向后兼容（旧数据无此字段时返回 `undefined`）
- [ ] 确认 `ActivityRecord` 的 `aiComment` 字段在 `persistence.ts` 的 `saveAll()` / `loadAll()` 流程中能正确序列化/反序列化（TypeScript 可选字段天然兼容，无需特殊处理）

---

## 2. P0-1：快速添加任务界面修复（依赖：无）

### 2.1 创建 QuickTaskInput 组件

- [ ] 新建 `src/lib/components/QuickTaskInput.svelte`，实现内联快速添加任务输入组件：
  - Props 接口：`visible: boolean`、`onConfirm: (title: string) => void`、`onCancel: () => void`
  - 组件内部状态：`inputValue = $state('')`、`errorMessage = $state<string | null>(null)`、`inputRef = $state(undefined)`
  - 当 `visible` 变为 `true` 时，通过 `$effect()` 自动聚焦 `inputRef`
  - `handleConfirm()`：检查 `inputValue.trim()` 非空则调用 `onConfirm(trimmed)`，空则设置 `errorMessage = '请输入任务内容哦～'`
  - `handleCancel()`：清空 `inputValue` 和 `errorMessage`，调用 `onCancel()`
  - 键盘事件：Enter → `handleConfirm()`，Escape → `handleCancel()`
  - `input` 元素设置 `maxlength={200}`
  - 使用 `{#if visible}` 条件渲染

### 2.2 QuickTaskInput 样式适配透明窗口

- [ ] 为 `QuickTaskInput.svelte` 编写样式：
  - `.quick-input-overlay`：绝对定位覆盖宠物区域（top:0, left:0, right:0, bottom:40px 不遮挡 action-bar），z-index:50，flex 居中
  - `.quick-input-box`：不透明背景 `rgba(255,255,255,0.95)`，圆角 12px，阴影，max-width:240px
  - `.quick-input-field`：宽度 100%，padding 8px，focus 时边框色 `#ff9f43`
  - `.quick-input-error`：红色 `#f44336`，字号 11px
  - `.quick-input-actions`：flex 布局，gap 8px，右对齐
  - `.quick-input-cancel`：白底灰边框，字号 12px
  - `.quick-input-confirm`：主题色 `#ff9f43` 背景，白字，字号 12px

### 2.3 集成 QuickTaskInput 到宠物主界面

- [ ] 修改 `src/routes/+page.svelte`：
  - 新增导入：`import QuickTaskInput from '$lib/components/QuickTaskInput.svelte'`
  - 新增状态：`let showQuickInput = $state(false)`
  - 替换 `addQuickTask()` 函数：移除 `prompt()` 调用，改为 `showQuickInput = true`（同时调用 `closeContextMenu()`）
  - 新增 `handleQuickTaskConfirm(title: string)` 函数：设置 `showQuickInput = false`，创建 `Task` 对象（id 用 `crypto.randomUUID()`，category:'学习'，priority:'medium'），调用 `getCompletionHint(title)` 获取提示，`tasks.add(task)`，`await saveAll()`，`showSpeech()` 反馈
  - 新增 `handleQuickTaskCancel()` 函数：设置 `showQuickInput = false`
  - 在模板中 `{#if showQuickInput}` 块内渲染 `<QuickTaskInput visible={showQuickInput} onConfirm={handleQuickTaskConfirm} onCancel={handleQuickTaskCancel} />`

---

## 3. P0-2：退出选项与系统托盘（依赖：无）

### 3.1 Rust 端 — 托盘模块与依赖

- [ ] 修改 `src-tauri/Cargo.toml`：在 tauri 依赖的 features 列表中添加 `"tray-icon"`（即 `tauri = { version = "2", features = ["tray-icon"] }`）
- [ ] 新建 `src-tauri/src/tray.rs`，实现 Rust 托盘管理模块：
  - 定义 `TrayState` 结构体：`pub struct TrayState { pub available: std::sync::Mutex<bool> }`
  - 实现 `pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), tauri::Error>`：
    - 使用 `MenuItem::with_id` 创建 "show"（"显示桌喵"）和 "quit"（"退出"）菜单项
    - 使用 `Menu::with_items` 创建右键菜单
    - 使用 `TrayIconBuilder` 创建托盘图标：设置 `default_window_icon()`、tooltip("桌喵")、menu、on_menu_event（"show" → 显示宠物窗口，"quit" → app.exit(0)）、on_tray_icon_event（Click → 显示宠物窗口）
  - 实现 `#[tauri::command] pub fn hide_all_windows(app: tauri::AppHandle) -> Result<(), String>`：遍历 ["pet", "panel", "settings"] 窗口调用 `hide()`
  - 实现 `#[tauri::command] pub fn show_pet_window(app: tauri::AppHandle) -> Result<(), String>`：获取 "pet" 窗口调用 `show()` + `set_focus()`
  - 实现 `#[tauri::command] pub fn quit_app(app: tauri::AppHandle) -> Result<(), String>`：调用 `app.exit(0)`
  - 实现 `#[tauri::command] pub fn is_tray_available(state: tauri::State<TrayState>) -> bool`：返回 `*state.available.lock().unwrap_or_else(|e| e.into_inner())`

### 3.2 Rust 端 — 注册托盘模块到主入口

- [ ] 修改 `src-tauri/src/lib.rs`：
  - 新增 `mod tray;`
  - 在 `tauri::Builder` 的 `.setup()` 回调中调用 `tray::create_tray(&app.handle())`，成功则设置 `TrayState.available = true`，失败则记录错误日志并设置 `available = false`
  - 在 `.manage()` 中注册 `tray::TrayState { available: Mutex::new(false) }`
  - 在 `.invoke_handler()` 中注册新增的 4 个命令：`hide_all_windows`、`show_pet_window`、`quit_app`、`is_tray_available`

### 3.3 Tauri 配置

- [ ] 检查并确认 `src-tauri/tauri.conf.json`：Tauri v2 内建 tray 通过 Cargo.toml feature flag 启用，一般无需额外 plugins 配置；若有权限相关配置（如 `tray:allow-*`），需在 `capabilities` 中补充

### 3.4 前端 — 托盘服务

- [ ] 新建 `src/lib/services/tray.ts`，封装托盘 IPC 调用：
  - `minimizeToTray(): Promise<void>` — 调用 `invoke('hide_all_windows')`
  - `restoreFromTray(): Promise<void>` — 调用 `invoke('show_pet_window')`
  - `quitApp(): Promise<void>` — 调用 `invoke('quit_app')`
  - `checkTrayAvailable(): Promise<boolean>` — 调用 `invoke<boolean>('is_tray_available')`，catch 降级返回 `false` 并记录日志

### 3.5 前端 — ExitMenu 组件

- [ ] 新建 `src/lib/components/ExitMenu.svelte`，实现退出选项菜单组件：
  - Props 接口：`visible: boolean`、`isTrayAvailable: boolean`、`onMinimizeToTray: () => void`、`onQuit: () => void`、`onClose: () => void`
  - 使用 `{#if visible}` 条件渲染
  - 外层 `.exit-menu-overlay`：fixed 定位覆盖全屏，z-index:200，点击触发 `onClose()`
  - 内层 `.exit-menu`：白色背景，圆角，阴影，`onclick|stopPropagation` 阻止冒泡
  - "🌙 最小化到托盘" 按钮：`disabled={!isTrayAvailable}`，点击触发 `onMinimizeToTray()`
  - "✕ 彻底退出" 按钮：红色文字 `#f44336`，点击触发 `onQuit()`
  - disabled 按钮样式：灰色文字 `#ccc`，cursor: not-allowed

### 3.6 前端 — 集成退出选项到宠物主界面

- [ ] 修改 `src/routes/+page.svelte`：
  - 新增导入：`import ExitMenu from '$lib/components/ExitMenu.svelte'`、`import * as tray from '$lib/services/tray'`
  - 新增状态：`let showExitMenu = $state(false)`、`let isTrayAvailable = $state(true)`
  - 替换 `quitApp()` 函数：调用 `closeContextMenu()`，若 `isTrayAvailable` 则设置 `showExitMenu = true`，否则直接调用 `tray.quitApp()`
  - 新增 `handleMinimizeToTray()` 函数：设置 `showExitMenu = false`，调用 `await tray.minimizeToTray()`
  - 新增 `handleQuit()` 函数：设置 `showExitMenu = false`，调用 `await tray.quitApp()`
  - 新增 `handleExitMenuClose()` 函数：设置 `showExitMenu = false`
  - 在 `onMount` 的 `loadAll().then()` 中初始化：`isTrayAvailable = await tray.checkTrayAvailable()`
  - 在模板中 `{#if showExitMenu}` 块内渲染 `<ExitMenu visible={showExitMenu} isTrayAvailable={isTrayAvailable} onMinimizeToTray={handleMinimizeToTray} onQuit={handleQuit} onClose={handleExitMenuClose} />`

---

## 4. P0-3：任务删除持久化修复（依赖：无）

### 4.1 持久化服务竞态保护

- [ ] 修改 `src/lib/services/persistence.ts` 中的 `setupAutoSave()` 函数：
  - 在 `setInterval` 回调函数体开头新增 `isSaving` 检查：若 `isSaving` 为 `true`，打印 `'[persistence] 自动保存跳过：saveAll 正在执行中'` 并 `return`
  - 确保自动保存与手动 `saveAll()`（删除操作触发）不会因并发导致数据覆盖

### 4.2 TaskPanel 清除已完成持久化

- [ ] 修改 `src/lib/components/TaskPanel.svelte`：
  - 找到 `clearCompleted()` 相关的处理逻辑（按钮点击处理函数）
  - 确保在调用 `tasks.clearCompleted()`（或等效的批量移除操作）后，调用 `await saveAll()` 持久化到磁盘
  - 若当前缺失 `saveAll()` 调用，则补充 `await saveAll()`，并添加 try/catch 错误处理

### 4.3 +page.svelte 持久化一致性检查

- [ ] 检查 `src/routes/+page.svelte` 中所有修改 tasks store 的操作点：
  - `tasks.remove()` 后是否均调用了 `await saveAll()`
  - `tasks.toggle()` 后是否均调用了 `await saveAll()`
  - `tasks.add()` 后是否均调用了 `await saveAll()`
  - 确认 `recordActivity` 中 `activity-records` 的独立持久化（直接 `invoke`）不受 `saveAll` 的 `isSaving` 互斥锁影响

---

## 5. P1-1：活动图表显示 AI 评语（依赖：任务 1 — ActivityRecord 类型扩展）

### 5.1 recordActivity 增加 aiComment 参数

- [ ] 修改 `src/routes/+page.svelte` 中的 `recordActivity()` 函数签名：
  - 新增可选参数 `aiComment?: string`
  - 在创建 `ActivityRecord` 对象时赋值 `aiComment` 字段
  - 持久化逻辑不变（`activity-records` 独立持久化）

### 5.2 checkActivity 各分支传入 aiComment

- [ ] 修改 `src/routes/+page.svelte` 中的 `checkActivity()` 函数各分支：
  - **摸鱼分支**（AI 返回非 OK 且长度 < 50）：`recordActivity(win, 'slacking', 'ai', guessActivityType(...), aiResult)` — 传入 `aiResult` 作为 `aiComment`
  - **鼓励分支**（AI 返回 OK）：`recordActivity(win, 'productive', 'ai', guessActivityType(...), '在努力做${encourageTarget}吗？加油！')` — 传入鼓励消息作为 `aiComment`
  - **规则匹配分支**：`recordActivity(win, 'slacking', 'rule_based', guessActivityType(...), matchedMessage)` — 传入 `matchedMessage` 作为 `aiComment`
  - **非黑名单 + AI 返回短消息分支**：`recordActivity(win, 'productive', 'ai', guessActivityType(...), aiResult)` — 传入 `aiResult` 作为 `aiComment`

### 5.3 ActivityChart 显示 AI 评语

- [ ] 修改 `src/lib/components/ActivityChart.svelte`：
  - 在活动明细的 `record-item` 行中，在 `record-type` 后新增条件渲染块：
    ```svelte
    {#if record.aiComment}
      <span class="record-comment" title={record.aiComment.length > 30 ? record.aiComment : ''}>
        🐱 {record.aiComment.length > 30 ? record.aiComment.slice(0, 30) + '...' : record.aiComment}
      </span>
    {/if}
    ```
  - 新增 `.record-comment` 样式：`font-size: 10px`、`color: #ff9f43`、`font-style: italic`、`max-width: 100px`、`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`、`flex-shrink: 0`

---

## 6. 编译与集成验证

- [ ] 运行 `cargo check` 验证 Rust 端编译通过（tray 模块、新命令注册）
- [ ] 运行 `npm run check`（或 `svelte-check`）验证 TypeScript/Svelte 端类型检查通过
- [ ] 运行 `npm run build` 验证前端构建通过
- [ ] 运行 `cargo build` 验证 Tauri 完整构建通过

---

## 7. 功能验收测试

### 7.1 P0-1 验收：快速添加任务界面

- [ ] 测试：点击📝按钮 → 不触发 `prompt()`，宠物窗口内出现内联输入框
- [ ] 测试：内联输入框显示后自动聚焦，可直接输入文字
- [ ] 测试：输入"写作业"后按 Enter → 任务创建成功，语音气泡显示
- [ ] 测试：输入"看书"后点击确认按钮 → 任务创建成功
- [ ] 测试：不输入内容按 Enter → 显示"请输入任务内容哦～"错误提示，不创建任务
- [ ] 测试：按 Escape → 输入框关闭，不创建任务
- [ ] 测试：在透明宠物窗口中输入框背景不透明，文字清晰可读

### 7.2 P0-2 验收：退出选项与系统托盘

- [ ] 测试：点击✕按钮 → 显示"最小化到托盘"和"彻底退出"两个选项的菜单
- [ ] 测试：选择"最小化到托盘" → 所有窗口隐藏，系统托盘出现桌喵图标
- [ ] 测试：最小化后左键点击托盘图标 → 宠物窗口恢复显示并获得焦点
- [ ] 测试：右键点击托盘图标 → 显示"显示桌喵"和"退出"选项
- [ ] 测试：托盘右键菜单点击"退出" → 应用彻底退出
- [ ] 测试：选择"彻底退出" → 应用完全退出，托盘图标消失
- [ ] 测试：点击退出菜单外区域 → 菜单关闭，不执行退出操作
- [ ] 测试：应用启动时系统托盘区域即出现桌喵图标

### 7.3 P0-3 验收：任务删除持久化

- [ ] 测试：删除任务 → 关闭应用 → 重新启动 → 被删除任务不再出现
- [ ] 测试：短时间内连续删除 3 个任务 → 重启后所有删除的任务均不出现
- [ ] 测试：完成 2 个任务 → 点击"清除已完成" → 重启 → 已完成任务不在列表中
- [ ] 测试：观察控制台日志，确认自动保存竞态保护日志（删除期间自动保存跳过）正常输出

### 7.4 P1-1 验收：活动图表 AI 评语

- [ ] 测试：等待 AI 检测摸鱼 → 打开活动图表 → 对应记录行显示 🐱 前缀的 AI 评语文本
- [ ] 测试：规则匹配但无 AI 评语的记录 → 记录行无评语区域，布局正常
- [ ] 测试：加载不含 `aiComment` 的旧 ActivityRecord → 图表正常显示，无报错
- [ ] 测试：AI 返回超过 30 字的评语 → 活动明细显示前 30 字 + "..."，悬停显示完整文本
- [ ] 测试：AI 生成评语 → 重启应用 → 查看活动明细 → `aiComment` 值保留

---

## 任务依赖关系

```
任务1 (类型/模型) ─────────────────────────────────┐
                                                    │
任务2 (P0-1 QuickTaskInput) ─── 无外部依赖          │
                                                    │
任务3 (P0-2 退出/托盘) ─────── 无外部依赖          │
  3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6               │
                                                    │
任务4 (P0-3 持久化修复) ────── 无外部依赖          │
                                                    │
任务5 (P1-1 AI评语) ────────── 依赖任务1 ──────────┘
  5.1 → 5.2 → 5.3

任务6 (编译验证) ──────────── 依赖任务 1~5 全部完成
任务7 (功能验收) ──────────── 依赖任务6 通过
```

**建议实施顺序**：任务1 → 任务4 → 任务2 → 任务3 → 任务5 → 任务6 → 任务7

> 理由：先完成数据模型(1)和持久化修复(4)最安全无副作用；QuickTaskInput(2)是独立UI组件可快速验证；托盘(3)涉及Rust编译链较重放中间；AI评语(5)依赖类型扩展放最后。
