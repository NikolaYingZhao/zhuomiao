# 桌喵 Bug修复与功能增强 — 编码任务列表（tasks.md）

---

## 任务概览

| 任务组 | 任务数 | 优先级 | 对应需求 |
|--------|--------|--------|----------|
| 1. IPC 权限配置 | 2 | P0 | REQ-SAVE-001 |
| 2. 设置保存可靠性 | 3 | P0-P1 | REQ-SAVE-002/003/004 |
| 3. API 连接测试按钮 | 3 | P0 | P0-1 新需求 |
| 4. Task 类型与 Store 扩展 | 2 | P1 | REQ-TASK-003 / P0-3 |
| 5. 任务管理交互优化 | 4 | P0-P2 | REQ-TASK-001/002/004 |
| 6. 活动图表显示截断修复 | 2 | P0 | P0-2 新需求 |
| 7. 活动分类细化（工作类型+手动校准） | 4 | P0 | P0-3 新需求 |
| 8. 开机自启动按钮位置调整 | 2 | P1 | P1-1 新需求 |
| 9. AI 监控闭环增强 | 6 | P0-P2 | REQ-AI-001~006 |
| 10. 验证与回归测试 | 5 | — | 全部 |

---

## 1. IPC 权限配置（Bug 1 前置条件）

> **优先级**：P0（最高） | **对应需求**：REQ-SAVE-001 | **依赖**：无
> **目标**：解决 settings 窗口调用后端 IPC 命令时权限缺失导致静默失败的核心问题

### Task 1.1 — 确认 Tauri v2 自动生成的权限标识符名称

- [ ] 检查 `src-tauri/gen/schemas/` 目录下自动生成的 ACL schema 文件，确认每个自定义 `#[tauri::command]` 对应的权限标识符实际名称
- [ ] 如 schema 文件不存在，运行 `cargo tauri dev` 触发一次构建生成 schema，再行确认
- [ ] 记录以下命令对应的权限标识符：`get_active_window`、`check_fish_detection`、`start_monitor_cycle`、`get_data_dir`、`set_data_dir`、`save_app_data`、`load_app_data`

**涉及文件**：`src-tauri/gen/schemas/acl/`（只读检查）
**预估耗时**：30 分钟

---

### Task 1.2 — 在 capabilities 配置中添加自定义 IPC 命令权限

- [ ] 在 `src-tauri/capabilities/default.json` 的 `permissions` 数组中追加所有自定义 IPC 命令的权限标识符
- [ ] 确保添加的权限标识符名称与 Task 1.1 确认的实际名称一致
- [ ] 预期添加的权限项（待 Task 1.1 确认后替换为实际名称）：
  ```json
  "allow-get-active-window",
  "allow-check-fish-detection",
  "allow-start-monitor-cycle",
  "allow-get-data-dir",
  "allow-set-data-dir",
  "allow-save-app-data",
  "allow-load-app-data"
  ```
- [ ] 保存后重新运行 `cargo tauri dev`，确认应用启动无权限错误

**涉及文件**：`src-tauri/capabilities/default.json`
**依赖**：Task 1.1
**预估耗时**：30 分钟

---

## 2. 设置保存可靠性（Bug 1 核心修复）

> **优先级**：P0-P1 | **对应需求**：REQ-SAVE-002/003/004 | **依赖**：Task 1.2
> **目标**：实现保存失败错误传播、store 回滚、双态反馈、防重复点击
> **现状**：SettingsPanel.svelte 中已实现回滚逻辑、脱敏函数、双态反馈、isSaving 防重复点击，需逐项确认完整性

### Task 2.1 — 验证 persistence.ts 中 saveAll() 异常正确传播

- [ ] 阅读 `src/lib/services/persistence.ts` 中 `saveAll()` 函数的实现
- [ ] 确认三个顺序 `await invoke()` 调用中任一失败时异常会自然向上抛出（无 try-catch 吞没）
- [ ] 如发现异常被吞没的情况，修改为正确 throw
- [ ] 在控制台日志中确认 IPC 调用失败时输出包含命令名和错误详情的日志

**涉及文件**：`src/lib/services/persistence.ts`
**依赖**：Task 1.2
**预估耗时**：30 分钟

---

### Task 2.2 — 确认 SettingsPanel 保存可靠性完整实现

- [ ] 确认 `saveAiConfig()` 中回滚逻辑完整：旧值深拷贝 → set新值 → saveAll → 失败回滚
- [ ] 确认 `sanitizeError()` 脱敏函数正确遮蔽 API Key（正则 `sk-[a-zA-Z0-9]{10,}` → `sk-***`）
- [ ] 确认 `saveStatus` 双态反馈：`success:` 前缀绿色 ≥5秒，`error:` 前缀红色 ≥8秒
- [ ] 确认 `isSaving` 加载状态正确：按钮 disabled、文字切换"验证中..."、"保存配置"
- [ ] 确认 `validateAiConfig()` 调用在保存前执行，验证失败时中止保存
- [ ] 如发现任何缺失，补全实现

**涉及文件**：`src/lib/components/SettingsPanel.svelte`
**依赖**：Task 2.1
**预估耗时**：30 分钟

---

### Task 2.3 — 验证设置保存可靠性完整流程

- [ ] 手动测试：在 settings 窗口修改 AI 配置并保存 → 显示绿色成功提示 ≥5 秒
- [ ] 手动测试：设置只读数据目录后保存 → 显示红色失败提示 ≥8 秒，界面值回滚到保存前
- [ ] 手动测试：保存过程中快速连续点击 → 按钮显示"验证中..."且 disabled，无重复调用
- [ ] 手动测试：故意输入含 `sk-` 前缀的 API Key 触发失败 → 错误提示中 API Key 被脱敏
- [ ] 检查浏览器控制台：失败时输出包含命令名的错误日志

**涉及文件**：无（手动测试）
**依赖**：Task 2.2
**预估耗时**：30 分钟

---

## 3. API 连接测试按钮（P0-1 新需求）

> **优先级**：P0 | **对应需求**：P0-1 | **依赖**：Task 2.2
> **目标**：在 AI 配置页添加独立的"测试连接"按钮，点击后调用 validateAiConfig 并显示结果，无需执行完整保存流程
> **现状**：`validateAiConfig()` 已在 ai.ts 中实现，当前仅在 saveAiConfig 中隐式调用；需要将其暴露为用户可主动触发的独立操作

### Task 3.1 — 在 AI 配置页添加测试连接按钮 UI

- [ ] 在 `SettingsPanel.svelte` 的 AI 配置 tab 中，在"保存配置"按钮旁（或上方）添加"测试连接"按钮
- [ ] 新增 `isTesting` 状态变量：`let isTesting = $state(false);`
- [ ] 新增 `testResult` 状态变量：`let testResult = $state<ValidationResult | null>(null);`（复用 ai.ts 中的 ValidationResult 类型）
- [ ] 按钮样式与"保存配置"按钮一致，但使用不同底色（如蓝色 `#2196f3`）区分功能
- [ ] 按钮在 `isTesting` 时 disabled，文字切换为"测试中..."

**涉及文件**：`src/lib/components/SettingsPanel.svelte`
**依赖**：无
**预估耗时**：30 分钟

---

### Task 3.2 — 实现测试连接逻辑和结果展示

- [ ] 实现 `testConnection()` 异步函数：
  ```typescript
  async function testConnection() {
    isTesting = true;
    testResult = null;
    try {
      const result = await validateAiConfig(localAiConfig);
      testResult = result;
    } catch (e: any) {
      testResult = { success: false, error: `测试出错: ${sanitizeError(e)}`, errorType: 'unknown' };
    } finally {
      isTesting = false;
    }
  }
  ```
- [ ] 在按钮下方添加结果展示区域：
  - 成功：绿色文字"✅ 连接成功！API 配置有效"
  - 失败：红色文字 + 具体错误类型提示（auth → "API Key 或地址有误"，timeout → "连接超时"，network → "网络错误"，format → "响应格式异常"）
- [ ] 结果展示 5 秒后自动消失，或下次测试时清除

**涉及文件**：`src/lib/components/SettingsPanel.svelte`
**依赖**：Task 3.1
**预估耗时**：45 分钟

---

### Task 3.3 — 优化保存逻辑：复用测试结果避免重复验证

- [ ] 当用户已执行过测试连接且配置未修改时，`saveAiConfig()` 可跳过 `validateAiConfig()` 调用直接保存
- [ ] 添加 `configModifiedSinceTest` 标志位：localAiConfig 任一字段变化时设为 true
- [ ] 在 `saveAiConfig()` 中：若 `testResult?.success && !configModifiedSinceTest`，跳过验证直接保存
- [ ] 此为优化项，如实现复杂可暂缓，先确保基础功能正确

**涉及文件**：`src/lib/components/SettingsPanel.svelte`
**依赖**：Task 3.2
**预估耗时**：30 分钟

---

## 4. Task 类型与 Store 扩展（Bug 2/AI 前置条件 + 活动分类细化）

> **优先级**：P1-P0 | **对应需求**：REQ-TASK-003 / P0-3 | **依赖**：无
> **目标**：为 Task 接口新增 completionMethod 字段（已实现），为 ActivityRecord 新增 activityType 字段（活动分类细化），扩展 toggle 方法签名

### Task 4.1 — 确认 Task 接口 completionMethod 字段（已实现）

- [ ] 确认 `src/lib/types/index.ts` 的 `Task` 接口中已有 `completionMethod?: 'manual' | 'ai_detected' | null;`
- [ ] 确认该字段为可选字段（`?`），保证已有 `tasks.json` 数据可正常加载
- [ ] 确认 TypeScript 编译无类型错误

**涉及文件**：`src/lib/types/index.ts`
**依赖**：无
**预估耗时**：10 分钟

---

### Task 4.2 — ActivityRecord 新增 activityType 字段 + ClassificationSource 扩展

- [ ] 在 `src/lib/types/index.ts` 中扩展 `ClassificationSource` 类型，新增 `'manual'` 值：
  ```typescript
  export type ClassificationSource = 'ai' | 'rule_based' | 'manual';
  ```
- [ ] 在 `ActivityRecord` 接口中新增可选字段 `activityType`：
  ```typescript
  export interface ActivityRecord {
    id: string;
    timestamp: string;
    windowTitle: string;
    processName: string;
    classification: ActivityClassification;
    classificationSource: ClassificationSource;
    activityType?: string;  // ★ 新增：细化工作类型，如"coding"、"reading"、"meeting"、"design"等
    taskId?: string;
  }
  ```
- [ ] 确认新增字段均为可选，不影响已有 `activity-records` 数据加载

**涉及文件**：`src/lib/types/index.ts`
**依赖**：无
**预估耗时**：15 分钟

---

## 5. 任务管理交互优化（Bug 2 核心修复）

> **优先级**：P0-P2 | **对应需求**：REQ-TASK-001/002/004 | **依赖**：Task 4.1
> **目标**：删除按钮醒目化、删除前确认、completionHint 展示、完成方式记录
> **现状**：TaskItem 和 TaskPanel 中大部分已实现，需逐项确认完整性

### Task 5.1 — 确认删除按钮视觉醒目化 + 24px 可点击区域（已实现）

- [ ] 确认 `TaskItem.svelte` 中删除按钮颜色为 `#e57373`（浅红色）
- [ ] 确认 `min-width: 24px; min-height: 24px` 保证可点击区域
- [ ] 确认 hover 效果：`color: #f44336; background: rgba(244, 67, 54, 0.08)`
- [ ] 确认按钮内容为 `✕`，有 `title="删除任务"` 属性
- [ ] 如发现任何缺失，补全实现

**涉及文件**：`src/lib/components/TaskItem.svelte`
**依赖**：无
**预估耗时**：15 分钟

---

### Task 5.2 — 确认删除前弹出原生确认对话框（已实现）

- [ ] 确认 `TaskPanel.svelte` 中已导入 `ask` from `@tauri-apps/plugin-dialog`
- [ ] 确认 `handleDelete()` 包含确认对话框 + 持久化失败回滚逻辑
- [ ] 确认 `TaskItem` 的 `onDelete` prop 类型为 `(id: string) => Promise<void>`
- [ ] 确认 `default.json` 中已包含 `dialog:default` 权限

**涉及文件**：`src/lib/components/TaskPanel.svelte`, `src/lib/components/TaskItem.svelte`
**依赖**：Task 5.1
**预估耗时**：15 分钟

---

### Task 5.3 — 确认手动完成任务记录 completionMethod 并持久化（已实现）

- [ ] 确认 `TaskPanel.svelte` 中 `handleToggle()` 调用 `tasks.toggle(id, 'manual')` 并持久化
- [ ] 确认持久化失败时回滚逻辑正确
- [ ] 确认 `stores/index.ts` 中 `toggle` 方法签名和实现正确

**涉及文件**：`src/lib/components/TaskPanel.svelte`, `src/lib/stores/index.ts`
**依赖**：Task 4.1
**预估耗时**：15 分钟

---

### Task 5.4 — 确认任务项中 completionHint 提示标签展示（已实现）

- [ ] 确认 `TaskItem.svelte` 中有条件渲染 `completionHint` badge
- [ ] 确认 `.hint-badge` CSS 样式正确（绿色背景、截断省略号）
- [ ] 确认 `TaskPanel.svelte` 中 `addStatus` 使用 `.hint-notification` 样式展示
- [ ] 验证无 `completionHint` 时不显示 badge

**涉及文件**：`src/lib/components/TaskItem.svelte`, `src/lib/components/TaskPanel.svelte`
**依赖**：Task 4.1
**预估耗时**：15 分钟

---

## 6. 活动图表显示截断修复（P0-2 新需求）

> **优先级**：P0 | **对应需求**：P0-2 | **依赖**：Task 4.2
> **目标**：修复每日活动图表在宠物主界面 chart-panel 容器中显示截断的问题，确保图表完整可见
> **现状**：chart-panel 宽度 320px，ActivityChart 中 24 小时柱状图可能因空间不足导致截断

### Task 6.1 — 分析并修复 ActivityChart 图表容器尺寸截断问题

- [ ] 在 `+page.svelte` 中分析 `.chart-panel` 的尺寸设置：当前 `width: 320px`，可能不足以完整显示 24 小时柱状图
- [ ] 将 `.chart-panel` 宽度从 `320px` 调整为 `360px`（或使用 `min-width: 340px` + `max-width: 400px`），确保 24 个小时列都有足够空间
- [ ] 检查 `.chart-panel` 的 `position: absolute; bottom: 40px` 定位，确保不会超出视口边界被截断
- [ ] 添加 `overflow: hidden` 到 `.chart-panel` 防止内容溢出，同时确保图表内容完全在容器内

**涉及文件**：`src/routes/+page.svelte`
**依赖**：无
**预估耗时**：30 分钟

---

### Task 6.2 — 优化 ActivityChart 内部布局适配容器尺寸

- [ ] 在 `ActivityChart.svelte` 中检查 `.chart` 的高度设置（当前 `height: 120px`），确认在小容器中不溢出
- [ ] 优化小时列标签：当容器宽度有限时，仅显示偶数小时标签（0, 2, 4...）或使用更小的字体
- [ ] 添加 `.chart-container` 的 `overflow: hidden` 确保无水平溢出
- [ ] 确保图表在小尺寸容器中仍可读：柱状图最小宽度 2px、标签字号适配
- [ ] 在宠物窗口（约 200px 宽）中测试图表展开后的显示效果

**涉及文件**：`src/lib/components/ActivityChart.svelte`
**依赖**：Task 6.1
**预估耗时**：1 小时

---

## 7. 活动分类细化：工作类型识别 + 手动校准（P0-3 新需求）

> **优先级**：P0 | **对应需求**：P0-3 | **依赖**：Task 4.2
> **目标**：让 AI 分类活动时不仅判断 productive/slacking，还识别具体工作类型（coding/reading/meeting 等）；用户可手动校准错误分类

### Task 7.1 — 扩展 classifyActivity 返回 activityType

- [ ] 修改 `src/lib/services/ai.ts` 中 `classifyActivity()` 函数签名，返回值新增 `activityType` 字段：
  ```typescript
  export async function classifyActivity(
    config: AIConfig,
    windowTitle: string,
    processName: string,
    incompleteTaskTitles: string[]
  ): Promise<{
    classification: ActivityClassification;
    source: ClassificationSource;
    activityType?: string;  // ★ 新增
  }>
  ```
- [ ] 修改 AI prompt，让 AI 同时判断工作类型：
  ```
  请判断用户当前行为：
  1. 首先判断是在工作(productive)还是摸鱼(slacking)
  2. 如果在工作，进一步识别工作类型：coding/reading/writing/meeting/design/learning/communication/other
  回复格式：classification|activityType（如 "productive|coding" 或 "slacking"）
  ```
- [ ] 解析 AI 返回值，提取 classification 和 activityType
- [ ] 无 API Key 时降级返回 `{ classification: 'productive', source: 'rule_based' }`，不包含 activityType

**涉及文件**：`src/lib/services/ai.ts`
**依赖**：Task 4.2
**预估耗时**：1 小时

---

### Task 7.2 — 更新 recordActivity 支持记录 activityType

- [ ] 修改 `+page.svelte` 中 `recordActivity()` 函数签名，新增可选参数 `activityType`：
  ```typescript
  async function recordActivity(
    win: ActiveWindow,
    classification: 'productive' | 'slacking',
    source: 'ai' | 'rule_based' | 'manual',
    activityType?: string
  )
  ```
- [ ] 在创建 `ActivityRecord` 时将 `activityType` 写入记录
- [ ] 在 `checkActivity()` 中调用 `classifyActivity()` 后，将其返回的 `activityType` 传递给 `recordActivity()`
- [ ] 确保黑名单分支和非黑名单分支的 `recordActivity()` 调用都正确传递 `activityType`

**涉及文件**：`src/routes/+page.svelte`
**依赖**：Task 7.1, Task 4.2
**预估耗时**：45 分钟

---

### Task 7.3 — 活动图表展示细化分类信息

- [ ] 修改 `ActivityChart.svelte`，在图表中展示 activityType 信息
- [ ] 在 summary 区域显示工作类型分布（如"编码: 5次 / 阅读: 3次 / 会议: 2次"）
- [ ] 在柱状图的 tooltip（title 属性）中显示该小时的 activityType 分布
- [ ] 为不同工作类型使用不同颜色区分（coding→蓝、reading→青、meeting→橙、design→紫、其他→绿）

**涉及文件**：`src/lib/components/ActivityChart.svelte`
**依赖**：Task 7.2, Task 6.2
**预估耗时**：1.5 小时

---

### Task 7.4 — 实现手动校准活动分类交互

- [ ] 在 `ActivityChart.svelte` 中，为每条活动记录添加"校准"按钮（点击后弹出选项修改分类）
- [ ] 实现校准选项：
  - 修改 classification：productive ↔ slacking
  - 修改 activityType：从预设列表中选择（coding/reading/writing/meeting/design/learning/communication/other）
- [ ] 校准后更新 `activityRecords` store 中对应记录：
  - `classificationSource` 改为 `'manual'`
  - `classification` 和 `activityType` 按用户选择更新
- [ ] 校准后调用 `saveAll()` 持久化
- [ ] 考虑简化交互：在图表的每日记录列表中显示最近活动，每条可点击校准

**涉及文件**：`src/lib/components/ActivityChart.svelte`, `src/routes/+page.svelte`, `src/lib/stores/index.ts`
**依赖**：Task 7.2
**预估耗时**：2 小时

---

## 8. 开机自启动按钮位置调整（P1-1 新需求）

> **优先级**：P1 | **对应需求**：P1-1 | **依赖**：无
> **目标**：将开机自启动开关从通用设置页移到更显眼的位置，或调整其样式使其更容易被发现和操作
> **现状**：SettingsPanel 通用设置 tab 中有 `<input type="checkbox" />` 开机自启动，但样式朴素且位置不够醒目

### Task 8.1 — 调整开机自启动开关的布局和样式

- [ ] 将开机自启动从普通 `<input type="checkbox" />` 改为更醒目的 toggle switch 组件样式
- [ ] 添加自定义 toggle switch CSS：
  ```css
  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: #ddd;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.3s;
  }
  .toggle-switch.active {
    background: #4caf50;
  }
  .toggle-switch::after {
    content: '';
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    top: 2px;
    left: 2px;
    transition: transform 0.3s;
  }
  .toggle-switch.active::after {
    transform: translateX(20px);
  }
  ```
- [ ] 将开机自启动项放在通用设置页的顶部第一个位置（当前已是，确认顺序）
- [ ] 添加说明文字"开启后电脑启动时桌喵会自动运行"

**涉及文件**：`src/lib/components/SettingsPanel.svelte`
**依赖**：无
**预估耗时**：45 分钟

---

### Task 8.2 — 实现开机自启动的 Tauri API 调用

- [ ] 确认 Tauri v2 中开机自启动的 API：使用 `@tauri-apps/plugin-autostart` 或 `tauri-plugin-autostart`
- [ ] 在 `src-tauri/Cargo.toml` 中添加 `tauri-plugin-autostart` 依赖（如尚未添加）
- [ ] 在 `src-tauri/capabilities/default.json` 中添加 autostart 插件权限
- [ ] 在 SettingsPanel 中绑定 toggle 状态到 Tauri autostart API：
  - 读取当前自启动状态：`await invoke('plugin:autostart|is_enabled')`
  - 设置自启动：`await invoke('plugin:autostart|enable')` / `await invoke('plugin:autostart|disable')`
- [ ] 确保应用重启后自启动状态正确恢复

**涉及文件**：`src/lib/components/SettingsPanel.svelte`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`
**依赖**：Task 8.1
**预估耗时**：1 小时

---

## 9. AI 监控闭环增强（Bug 3 / 需求增强）

> **优先级**：P0-P2 | **对应需求**：REQ-AI-001~006 | **依赖**：Task 4.1
> **目标**：completionHint 驱动监控、AI 主动检测任务完成、用户确认流程、鼓励个性化、降级增强、completionMethod 上下文
> **现状**：+page.svelte 中已实现完整的 AI 监控闭环逻辑，需逐项确认完整性

### Task 9.1 — 确认监控 prompt 包含 completionHint（已实现）

- [ ] 确认 `checkActivity()` 黑名单分支中 taskList 包含 completionHint：`- "${t.title}"（完成判断：${t.completionHint || t.title}）`
- [ ] 确认非黑名单分支中 taskContext 同样包含 completionHint
- [ ] 确认任务无 completionHint 时使用标题代替（`|| t.title` 降级）
- [ ] 如发现任何缺失，补全实现

**涉及文件**：`src/routes/+page.svelte`
**依赖**：Task 4.1
**预估耗时**：15 分钟

---

### Task 9.2 — 确认 AI 检测完成需用户确认（已实现）

- [ ] 确认 `pendingConfirmTaskId` 状态变量存在
- [ ] 确认黑名单和非黑名单分支中 `COMPLETED:` 前缀解析逻辑正确
- [ ] 确认 `confirmTaskCompletion()` 中标记 completionMethod 为 `'ai_detected'`，持久化失败回滚
- [ ] 确认 `denyTaskCompletion()` 显示鼓励气泡并清除状态
- [ ] 确认 UI 中有确认/否认按钮（`.confirm-actions` 区域）

**涉及文件**：`src/routes/+page.svelte`
**依赖**：Task 9.1
**预估耗时**：15 分钟

---

### Task 9.3 — 确认做正事时显示个性化鼓励气泡（已实现）

- [ ] 确认黑名单分支中 AI 返回 `'OK'` 时显示个性化鼓励：`在努力做${encourageTarget}吗？加油！`
- [ ] 确认 `encourageTarget` 取自 `incomplete[0]?.title || '任务'`
- [ ] 如发现使用固定文案，修改为个性化鼓励

**涉及文件**：`src/routes/+page.svelte`
**依赖**：Task 9.1
**预估耗时**：10 分钟

---

### Task 9.4 — 确认 AI 不可用时降级为纯规则匹配（已实现）

- [ ] 确认黑名单分支：apiKey 为空时直接显示 `matchedMessage`
- [ ] 确认黑名单分支：AI 失败时 catch 块降级显示 `matchedMessage` + `console.error`
- [ ] 确认非黑名单分支：AI 失败时 catch 块 `recordActivity(win, 'productive', 'rule_based')` + `console.error`
- [ ] 如发现降级逻辑不完整，补全实现

**涉及文件**：`src/routes/+page.svelte`
**依赖**：Task 9.1
**预估耗时**：10 分钟

---

### Task 9.5 — 确认任务创建后醒目展示 completionHint（已实现）

- [ ] 确认 `TaskPanel.svelte` 中 `addStatus` 使用 `.hint-notification` 样式展示
- [ ] 确认 `+page.svelte` 中 `addQuickTask()` 的气泡展示逻辑正确
- [ ] 如发现展示不够醒目，增强样式

**涉及文件**：`src/lib/components/TaskPanel.svelte`, `src/routes/+page.svelte`
**依赖**：Task 5.4
**预估耗时**：10 分钟

---

### Task 9.6 — 确认 AI prompt 包含已完成任务 completionMethod 上下文（已实现）

- [ ] 确认 `checkActivity()` 中 `completionContext` 构建逻辑正确
- [ ] 确认黑名单和非黑名单分支的 AI prompt 中都引用了 `completionContext`
- [ ] 确认无已完成任务时不影响原有 prompt 结构（`completionContext` 为空字符串）
- [ ] 如发现任何缺失，补全实现

**涉及文件**：`src/routes/+page.svelte`
**依赖**：Task 9.1
**预估耗时**：10 分钟

---

## 10. 验证与回归测试

> **优先级**：必须 | **依赖**：所有前序任务完成
> **目标**：全量验证 Bug 修复效果和功能增强，确保无回归

### Task 10.1 — Bug 1 设置保存可靠性验证

- [ ] TC-SAVE-001：在 settings 窗口修改 AI 配置并点击保存 → 保存成功，显示绿色提示 ≥5 秒
- [ ] TC-SAVE-002：修改 API Key 为空后保存 → 保存成功，显示绿色提示
- [ ] TC-SAVE-003：保存过程中快速连续点击保存按钮 → 第二次点击无效，按钮显示"验证中..."且 disabled
- [ ] TC-SAVE-004：模拟 saveAll() 失败（设置只读数据目录） → 显示红色失败提示 ≥8 秒，aiConfig store 回滚
- [ ] TC-SAVE-005：检查 default.json 包含所有自定义命令权限 → 各窗口均可成功调用 invoke()

**依赖**：Task 2.3
**预估耗时**：30 分钟

---

### Task 10.2 — 任务管理交互验证

- [ ] TC-TASK-001：查看任务列表 → 删除按钮颜色为 #e57373，可点击区域 ≥24×24px
- [ ] TC-TASK-002：点击删除按钮 → 弹出原生确认对话框"确定删除该任务？"
- [ ] TC-TASK-003：确认删除 → 任务从列表移除并持久化
- [ ] TC-TASK-004：取消删除 → 任务保留不变
- [ ] TC-TASK-005：手动勾选完成 → task.completionMethod 为 "manual"，持久化到 tasks.json
- [ ] TC-TASK-006：含 completionHint 的任务 → 显示 💡 badge 标签
- [ ] TC-TASK-007：无 completionHint 的任务 → 不显示 💡 badge

**依赖**：Task 5.1~5.4
**预估耗时**：30 分钟

---

### Task 10.3 — 新需求功能验证

- [ ] TC-TEST-001：AI 配置页点击"测试连接"按钮 → 显示测试结果（成功/失败+原因）
- [ ] TC-TEST-002：测试连接过程中按钮 disabled，文字变为"测试中..."
- [ ] TC-CHART-001：宠物窗口展开活动图表 → 图表完整显示，无截断
- [ ] TC-CHART-002：图表中 24 小时柱状图各列可见，标签可读
- [ ] TC-CHART-003：图表中显示工作类型分布（activityType）
- [ ] TC-CLASSIFY-001：AI 监控触发时 activityType 被正确识别和记录
- [ ] TC-CLASSIFY-002：活动记录可手动校准分类和 activityType
- [ ] TC-CLASSIFY-003：手动校准后 classificationSource 为 'manual'，持久化正确
- [ ] TC-AUTOSTART-001：通用设置中开机自启动 toggle 开关样式醒目
- [ ] TC-AUTOSTART-002：切换自启动开关后系统注册表/启动项状态正确

**依赖**：Task 3.2, Task 6.2, Task 7.4, Task 8.2
**预估耗时**：1 小时

---

### Task 10.4 — AI 监控闭环验证

- [ ] TC-AI-001：配置 AI 后访问黑名单网站 → AI prompt 中包含未完成任务的 completionHint
- [ ] TC-AI-002：AI 返回 COMPLETED:xxx → 显示确认气泡，不直接标记完成
- [ ] TC-AI-003：确认气泡点击"✅ 完成了" → 任务标记完成，completionMethod 为 'ai_detected'
- [ ] TC-AI-004：确认气泡点击"还没呢" → 显示"继续加油！"，任务状态不变
- [ ] TC-AI-005：AI 判断做正事（返回 OK） → 显示个性化鼓励气泡，宠物状态为 happy
- [ ] TC-AI-006：清除 apiKey 后访问黑名单 → 降级为纯规则匹配
- [ ] TC-AI-007：AI 请求超时/失败 → 降级为纯规则匹配，控制台输出错误日志
- [ ] TC-AI-008：有已完成任务（含 completionMethod）时触发监控 → AI prompt 包含完成方式上下文
- [ ] TC-AI-009：任务无 completionHint → AI prompt 使用任务标题代替，监控不中断

**依赖**：Task 9.1~9.6
**预估耗时**：1 小时

---

### Task 10.5 — 回归测试 + TypeScript 编译检查 + 最终构建验证

- [ ] TC-REG-001：已有 tasks.json 数据（无 completionMethod 字段）可正常加载，不报错
- [ ] TC-REG-002：已有 activity-records 数据（无 activityType 字段）可正常加载，不报错
- [ ] TC-REG-003：任务面板的添加、过滤、清除已完成等功能正常
- [ ] TC-REG-004：监控规则的添加、删除、保存正常
- [ ] TC-REG-005：宠物动画状态切换正常（idle/happy/angry/worried）
- [ ] TC-REG-006：数据目录更改功能正常
- [ ] TC-REG-007：自动保存（5 秒间隔）正常工作
- [ ] 运行 `npx svelte-check` 确认无 TypeScript 类型错误
- [ ] 运行 `cargo tauri dev` 确认 Rust 后端编译无错误
- [ ] 确认所有新增/修改文件的代码风格与项目现有代码一致
- [ ] 确认无 console.log 调试代码残留（保留 console.error 用于错误日志）

**依赖**：所有任务
**预估耗时**：1 小时

---

## 任务依赖关系图

```
Phase 1 — Bug 1：设置保存可靠性
  Task 1.1 (确认权限标识符)
    └─→ Task 1.2 (添加 IPC 权限)
          └─→ Task 2.1 (验证 saveAll 异常传播)
                └─→ Task 2.2 (确认保存可靠性实现)
                      └─→ Task 2.3 (保存可靠性验证)

Phase 1.5 — P0-1 新需求：API 连接测试按钮
  Task 3.1 (测试按钮 UI)
    └─→ Task 3.2 (测试连接逻辑)
          └─→ Task 3.3 (复用测试结果优化)

Phase 2 — 类型扩展
  Task 4.1 (Task 类型确认) ← 已实现
  Task 4.2 (ActivityRecord + ClassificationSource 扩展)

Phase 2.5 — Bug 2：任务管理交互优化（已实现，确认完整性）
  Task 5.1 (删除按钮确认) ← 已实现
    └─→ Task 5.2 (删除确认确认) ← 已实现
  Task 5.3 (手动完成确认) ← 已实现
  Task 5.4 (completionHint 展示确认) ← 已实现

Phase 3 — P0-2 新需求：活动图表截断修复
  Task 6.1 (chart-panel 尺寸修复)
    └─→ Task 6.2 (ActivityChart 内部布局优化)

Phase 4 — P0-3 新需求：活动分类细化
  Task 4.2 (类型扩展)
    └─→ Task 7.1 (classifyActivity 返回 activityType)
          └─→ Task 7.2 (recordActivity 支持 activityType)
                ├─→ Task 7.3 (图表展示细化分类) ─── 依赖 Task 6.2
                └─→ Task 7.4 (手动校准交互)

Phase 5 — P1-1 新需求：开机自启动
  Task 8.1 (toggle 开关样式)
    └─→ Task 8.2 (Tauri autostart API)

Phase 6 — Bug 3：AI 监控闭环（已实现，确认完整性）
  Task 9.1 (prompt 含 completionHint) ← 已实现
    └─→ Task 9.2 (AI 完成检测确认) ← 已实现
    └─→ Task 9.3 (个性化鼓励确认) ← 已实现
    └─→ Task 9.4 (降级处理确认) ← 已实现
    └─→ Task 9.5 (completionHint 展示确认) ← 已实现
    └─→ Task 9.6 (completionMethod 上下文确认) ← 已实现

Phase 7 — 验证与回归测试
  Task 10.1 (保存可靠性验证)
  Task 10.2 (任务管理验证)
  Task 10.3 (新需求功能验证)
  Task 10.4 (AI 监控验证)
  Task 10.5 (回归 + 编译 + 构建)
```

## 建议实施顺序

1. **Phase 1**：Task 1.1 → 1.2 → 2.1 → 2.2 → 2.3（IPC 权限 + 保存可靠性）
2. **Phase 1.5**：Task 3.1 → 3.2 → 3.3（API 测试连接按钮）
3. **Phase 2**：Task 4.1 → 4.2（类型扩展）
4. **Phase 2.5**：Task 5.1 → 5.2 → 5.3 → 5.4（任务交互确认）
5. **Phase 3**：Task 6.1 → 6.2（图表截断修复）
6. **Phase 4**：Task 7.1 → 7.2 → 7.3 → 7.4（活动分类细化）
7. **Phase 5**：Task 8.1 → 8.2（开机自启动）
8. **Phase 6**：Task 9.1 → 9.2 → 9.3 → 9.4 → 9.5 → 9.6（AI 监控确认）
9. **Phase 7**：Task 10.1 → 10.2 → 10.3 → 10.4 → 10.5（全量验证）
