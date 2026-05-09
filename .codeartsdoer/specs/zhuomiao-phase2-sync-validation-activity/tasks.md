# 桌喵 第二阶段 — 编码任务列表（tasks.md）

---

## 1. 竞态修复 — 移除面板独立 loadAll 轮询（P0 最高优先级）

> 对应需求：REQ-SYNC-002
> 目标：从根源消除竞态条件，移除 panel/+page.svelte 中独立的 3 秒 loadAll 定时轮询

- [ ] **T1.1** 移除 `src/routes/panel/+page.svelte` 中的 `setInterval(async () => { await loadAll(); }, 3000)` 轮询代码及其清理逻辑（`clearInterval`）
  - 涉及文件：`src/routes/panel/+page.svelte`
  - 优先级：P0
  - 依赖：无
  - 说明：仅保留 `onMount` 中的 `loadAll().then(() => { ready = true; })` 初始化加载，删除 setInterval 和对应的 interval 变量及 onDestroy 清理

- [ ] **T1.2** 验证移除轮询后面板 UI 仍能通过 Svelte store 响应式机制自动更新
  - 涉及文件：`src/routes/panel/+page.svelte`
  - 优先级：P0
  - 依赖：T1.1
  - 说明：在主页面修改 tasks 后，面板页面应自动显示更新后的任务列表，无需手动轮询

---

## 2. 竞态修复 — persistence.ts 保存锁机制（P0）

> 对应需求：REQ-SYNC-001
> 目标：当 saveAll 正在执行时，loadAll 必须跳过本次轮询，避免用磁盘数据覆盖 store

- [ ] **T2.1** 在 `src/lib/services/persistence.ts` 中新增模块级变量 `isSaving` 和导出函数 `getIsSaving()`
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P0
  - 依赖：无
  - 说明：`let isSaving = false;`，`export function getIsSaving(): boolean { return isSaving; }`

- [ ] **T2.2** 改造 `saveAll()` 函数：在函数开头设置 `isSaving = true`，在 `finally` 块中设置 `isSaving = false`
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P0
  - 依赖：T2.1
  - 说明：使用 try-finally 保证即使保存失败也能释放保存锁

- [ ] **T2.3** 改造 `loadAll()` 函数：在函数开头增加保存锁检查，若 `isSaving === true` 则跳过本次加载并输出日志
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P0
  - 依赖：T2.1
  - 说明：`if (isSaving) { console.log('[persistence] loadAll 跳过：saveAll 正在执行中'); return; }`

---

## 3. 竞态修复 — persistence.ts 版本戳机制（P1）

> 对应需求：REQ-SYNC-003
> 目标：loadAll 从磁盘读取数据后，若磁盘版本低于内存版本则拒绝覆盖 store

- [ ] **T3.1** 在 `src/lib/services/persistence.ts` 中新增模块级变量 `currentDataVersion = 0` 和导出函数 `getDataVersion()`
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P1
  - 依赖：无

- [ ] **T3.2** 在 `src/lib/stores/index.ts` 中新增 `dataVersion` writable store 并导出
  - 涉及文件：`src/lib/stores/index.ts`
  - 优先级：P1
  - 依赖：无
  - 说明：`export const dataVersion = writable<number>(0);`

- [ ] **T3.3** 改造 `saveAll()`：保存完成后递增 `currentDataVersion`，将版本号通过 `invoke('save_app_data', { key: 'data-version', data: { version, lastModifiedAt } })` 持久化到磁盘，并同步更新 `dataVersion` store
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P1
  - 依赖：T3.1, T3.2, T2.2
  - 说明：版本号在 saveAll 的 try 块中递增并保存，确保与数据保存原子性

- [ ] **T3.4** 改造 `loadAll()`：在保存锁检查通过后，先从磁盘加载 `data-version`，若 `diskVersion < currentDataVersion` 则跳过加载并输出日志；正常加载完成后同步 `currentDataVersion = diskVersion` 并更新 store
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P1
  - 依赖：T3.1, T3.2, T2.3
  - 说明：版本文件不存在时视为版本 0（兼容旧数据），catch 静默处理

---

## 4. API 验证 — ai.ts 新增 validateAiConfig 函数（P0）

> 对应需求：REQ-VALIDATE-001, REQ-VALIDATE-002
> 目标：在保存 AI 配置前，使用当前配置向 LLM 端点发送最小化测试请求验证有效性

- [ ] **T4.1** 在 `src/lib/services/ai.ts` 中新增 `ValidationResult` 接口定义
  - 涉及文件：`src/lib/services/ai.ts`
  - 优先级：P0
  - 依赖：无
  - 说明：`{ success: boolean; error?: string; errorType?: 'auth' | 'timeout' | 'network' | 'format' | 'unknown'; }`

- [ ] **T4.2** 在 `src/lib/services/ai.ts` 中新增 `validateAiConfig(config: AIConfig): Promise<ValidationResult>` 函数实现
  - 涉及文件：`src/lib/services/ai.ts`
  - 优先级：P0
  - 依赖：T4.1
  - 说明：
    - apiKey 为空时直接返回 `{ success: true }`（合法配置）
    - 使用 `AbortController` 实现 10 秒超时
    - 发送最小化聊天请求：`{ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 }`
    - 响应 200 且 `data.choices?.[0]?.message?.content` 存在时验证成功
    - 响应 401/403 返回 auth 错误
    - AbortError 返回 timeout 错误
    - 其他网络错误返回 network 错误
    - 响应格式异常返回 format 错误
    - **API Key 不得在控制台日志中明文输出**

---

## 5. API 验证 — SettingsPanel saveAiConfig 流程改造（P0）

> 对应需求：REQ-VALIDATE-001, REQ-VALIDATE-002, REQ-VALIDATE-003, REQ-VALIDATE-004
> 目标：保存配置前先验证，验证失败不保存，验证期间按钮禁用，saveAll 失败时回滚

- [ ] **T5.1** 在 `src/lib/components/SettingsPanel.svelte` 中引入 `validateAiConfig` 函数
  - 涉及文件：`src/lib/components/SettingsPanel.svelte`
  - 优先级：P0
  - 依赖：T4.2
  - 说明：`import { validateAiConfig } from '$lib/services/ai';`

- [ ] **T5.2** 改造 `saveAiConfig()` 函数：在 `isSaving = true` 后，先调用 `validateAiConfig(localAiConfig)` 验证
  - 涉及文件：`src/lib/components/SettingsPanel.svelte`
  - 优先级：P0
  - 依赖：T5.1
  - 说明：验证使用 `localAiConfig`（用户编辑中的临时值），store 尚未修改

- [ ] **T5.3** 实现验证失败分支：验证不通过时，设置 `saveStatus` 为红色错误提示（8秒后清除），不执行 `aiConfig.set()` 和 `saveAll()`，输出控制台错误日志
  - 涉及文件：`src/lib/components/SettingsPanel.svelte`
  - 优先级：P0
  - 依赖：T5.2
  - 说明：
    - auth 错误 → "API 配置有误，请检查 API-Key 和对应的响应地址"
    - timeout 错误 → "API 连接超时，请检查端点地址是否正确"
    - network 错误 → "API 连接失败，请检查端点地址是否正确"
    - format 错误 → "API 响应格式异常，请检查端点地址"

- [ ] **T5.4** 实现验证成功分支：执行 `aiConfig.set(localAiConfig)` + `saveAll()`，成功时显示绿色提示"API 配置成功！"（5秒后清除）
  - 涉及文件：`src/lib/components/SettingsPanel.svelte`
  - 优先级：P0
  - 依赖：T5.2
  - 说明：在 set 之前保存 `oldConfig = { ...$aiConfig }` 用于可能的回滚

- [ ] **T5.5** 实现 saveAll 失败回滚：验证通过但 saveAll 抛出异常时，回滚 `aiConfig.set(oldConfig)` 和 `localAiConfig = { ...oldConfig }`，显示红色提示
  - 涉及文件：`src/lib/components/SettingsPanel.svelte`
  - 优先级：P2
  - 依赖：T5.4
  - 说明：提示内容："API 验证通过，但保存失败: {错误原因}"

- [ ] **T5.6** 修改保存按钮：文案根据 `isSaving` 状态切换为"验证中..."或"保存配置"，`disabled` 绑定 `isSaving`
  - 涉及文件：`src/lib/components/SettingsPanel.svelte`
  - 优先级：P1
  - 依赖：T5.2
  - 说明：`<button disabled={isSaving}>{isSaving ? '验证中...' : '保存配置'}</button>`

---

## 6. 活动追踪 — 类型与 Store 新增（P0 基础）

> 对应需求：REQ-ACTIVITY-001
> 目标：为活动记录功能新增数据类型定义和 store

- [ ] **T6.1** 在 `src/lib/types/index.ts` 中新增 `ActivityClassification`、`ClassificationSource` 类型和 `ActivityRecord` 接口
  - 涉及文件：`src/lib/types/index.ts`
  - 优先级：P0
  - 依赖：无
  - 说明：
    - `ActivityClassification = 'productive' | 'slacking'`
    - `ClassificationSource = 'ai' | 'rule_based'`
    - `ActivityRecord { id, timestamp, windowTitle, processName, classification, classificationSource, taskId? }`

- [ ] **T6.2** 在 `src/lib/stores/index.ts` 中新增 `activityRecords` writable store 并导出
  - 涉及文件：`src/lib/stores/index.ts`
  - 优先级：P0
  - 依赖：T6.1
  - 说明：`export const activityRecords = writable<ActivityRecord[]>([]);`，同时更新 import

---

## 7. 活动追踪 — ai.ts 新增 classifyActivity 函数（P0）

> 对应需求：REQ-ACTIVITY-002, REQ-ACTIVITY-003
> 目标：实现 AI 判断活动分类功能，API 不可用时降级为规则匹配

- [ ] **T7.1** 在 `src/lib/services/ai.ts` 中新增 `classifyActivity(config, windowTitle, processName, incompleteTasks): Promise<{ classification, source }>` 函数
  - 涉及文件：`src/lib/services/ai.ts`
  - 优先级：P0
  - 依赖：T6.1
  - 说明：
    - apiKey 为空时返回 `{ classification: 'productive', source: 'rule_based' }`
    - 调用 `chatWithAI` 发送精简 prompt：包含窗口信息、进程名、未完成任务列表，要求 AI 仅回复 "productive" 或 "slacking"
    - AI 返回值匹配时返回 `{ classification, source: 'ai' }`
    - AI 返回不匹配或调用失败时降级返回 `{ classification: 'productive', source: 'rule_based' }`

---

## 8. 活动追踪 — checkActivity 中活动记录采集与分类（P0/P1）

> 对应需求：REQ-ACTIVITY-001, REQ-ACTIVITY-002, REQ-ACTIVITY-003
> 目标：在每次监控检测时采集活动记录，由 AI 或规则匹配分类

- [ ] **T8.1** 在 `src/routes/+page.svelte` 中引入 `classifyActivity` 函数和 `ActivityRecord` 类型
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P0
  - 依赖：T7.1, T6.1
  - 说明：新增 import 语句

- [ ] **T8.2** 在 `checkActivity()` 函数中，获取 `activeWindow` 后增加活动记录采集逻辑：提取黑名单匹配结果
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P0
  - 依赖：T8.1
  - 说明：遍历 `$monitorRules` 中的黑名单规则，判断当前窗口是否匹配

- [ ] **T8.3** 在 `checkActivity()` 中实现活动分类逻辑：有 API 时调用 `classifyActivity`，无 API 或 AI 失败时降级为规则匹配
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P0
  - 依赖：T8.2
  - 说明：
    - API 可用 → 调用 `classifyActivity`，catch 中降级为规则匹配
    - API 不可用 → 黑名单匹配 → slacking，否则 productive

- [ ] **T8.4** 在 `checkActivity()` 中创建 `ActivityRecord` 对象并添加到 `activityRecords` store
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P0
  - 依赖：T8.3, T6.2
  - 说明：`{ id: crypto.randomUUID(), timestamp: new Date().toISOString(), windowTitle, processName, classification, classificationSource }`

- [ ] **T8.5** 在活动记录添加后，异步持久化到磁盘（不阻塞 UI）
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P1
  - 依赖：T8.4
  - 说明：`invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) }).catch(e => console.error(...))`

---

## 9. 活动追踪 — persistence.ts 扩展支持 activity-records（P1）

> 对应需求：REQ-ACTIVITY-004, REQ-ACTIVITY-005
> 目标：saveAll/loadAll 扩展支持活动记录的持久化，加载时清理 30 天过期记录

- [ ] **T9.1** 在 `saveAll()` 中新增 `activity-records` 的保存：`await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) })`
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P1
  - 依赖：T6.2, T2.2
  - 说明：在 tasks/monitor-rules/ai-config 保存之后添加，更新 import

- [ ] **T9.2** 在 `loadAll()` 中新增 `activity-records` 的加载逻辑
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P1
  - 依赖：T6.2, T2.3
  - 说明：`invoke<ActivityRecord[] | null>('load_app_data', { key: 'activity-records' })`，成功时 `activityRecords.set(data)`

- [ ] **T9.3** 在 `loadAll()` 的 activity-records 加载逻辑中增加 30 天自动清理：过滤掉 `timestamp` 距当前超过 30 天的记录，若清理了数据则重新持久化
  - 涉及文件：`src/lib/services/persistence.ts`
  - 优先级：P2
  - 依赖：T9.2
  - 说明：`const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000`，过滤后若 `filtered.length < data.length` 则异步重新保存并输出清理日志

---

## 10. 活动图表 — ActivityChart 组件开发（P1）

> 对应需求：REQ-ACTIVITY-006, REQ-ACTIVITY-007
> 目标：新增活动图表组件，按 24 小时展示每日活动分布，支持日期切换

- [ ] **T10.1** 新增 `src/lib/components/ActivityChart.svelte` 组件：script 部分
  - 涉及文件：`src/lib/components/ActivityChart.svelte`（新增）
  - 优先级：P1
  - 依赖：T6.2
  - 说明：
    - `selectedDate` 状态，默认今天
    - `dayRecords` 派生：按日期过滤 `$activityRecords`
    - `hourlyData` 派生：24 小时聚合，每小时统计 productive/slacking/total
    - `dayStats` 派生：全天汇总统计
    - `maxTotal` 派生：最大时段记录数（用于归一化条宽）
    - `prevDay()`/`nextDay()` 日期导航函数

- [ ] **T10.2** 新增 `ActivityChart.svelte` 组件：template 部分
  - 涉及文件：`src/lib/components/ActivityChart.svelte`
  - 优先级：P1
  - 依赖：T10.1
  - 说明：
    - 日期选择器（◀ / input[date] / ▶）
    - 空状态提示："当天没有活动记录"
    - 汇总统计：🟢 工作次数 / 🔴 摸鱼次数
    - 24 小时时段分布条：每行 = 时间标签 + 工作(绿)/摸鱼(红)比例条 + 记录数

- [ ] **T10.3** 新增 `ActivityChart.svelte` 组件：style 部分（纯 CSS 渲染）
  - 涉及文件：`src/lib/components/ActivityChart.svelte`
  - 优先级：P1
  - 依赖：T10.2
  - 说明：flexbox 布局，productive 绿色(#4caf50)、slacking 红色(#f44336)、空时段灰色(#e0e0e0)

---

## 11. 活动图表 — 页面与入口（P1/P2）

> 对应需求：REQ-ACTIVITY-006, REQ-ACTIVITY-008
> 目标：新增活动图表页面路由，主页面右键菜单新增入口

- [ ] **T11.1** 新增 `src/routes/activity/+page.svelte` 页面，引用 ActivityChart 组件
  - 涉及文件：`src/routes/activity/+page.svelte`（新增）
  - 优先级：P1
  - 依赖：T10.3
  - 说明：页面标题"📊 每日活动图表"，包含 `<ActivityChart />`

- [ ] **T11.2** 在 `src-tauri/capabilities/default.json` 的 `windows` 数组中新增 `"activity"` 窗口标识
  - 涉及文件：`src-tauri/capabilities/default.json`
  - 优先级：P1
  - 依赖：T11.1
  - 说明：允许 Tauri 创建 label 为 "activity" 的 webview 窗口

- [ ] **T11.3** 在 `src/routes/+page.svelte` 中新增 `openActivityChart()` 函数：创建或聚焦 label 为 "activity" 的 WebviewWindow
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P2
  - 依赖：T11.2
  - 说明：窗口配置 `{ url: '/activity', title: '桌喵 - 活动图表', width: 500, height: 600, decorations: true, resizable: true }`，已存在时 `show()` + `setFocus()`

- [ ] **T11.4** 在 `src/routes/+page.svelte` 右键上下文菜单中新增"📊 活动图表"按钮，绑定 `openActivityChart`
  - 涉及文件：`src/routes/+page.svelte`
  - 优先级：P2
  - 依赖：T11.3
  - 说明：在已有菜单选项后添加，点击后关闭菜单并打开活动图表窗口

---

## 12. 验证与测试

> 目标：验证所有需求正确实现，回归测试确保已有功能不受影响

- [ ] **T12.1** 竞态修复验证：在面板页面删除任务后观察不再回弹，检查源码确认无 setInterval 轮询，检查控制台确认保存锁跳过日志正常
  - 优先级：P0
  - 依赖：T1.1, T2.3, T3.4
  - 验收标准：TC-SYNC-001 ~ TC-SYNC-007

- [ ] **T12.2** API 验证功能验证：分别测试正确配置、错误 Key、不存在的端点、超时端点、清除 apiKey、验证期间重复点击等场景
  - 优先级：P0
  - 依赖：T5.3, T5.4, T5.5, T5.6
  - 验收标准：TC-VAL-001 ~ TC-VAL-007

- [ ] **T12.3** 活动记录采集与分类验证：配置 AI 后等待监控周期，检查活动记录字段完整性和分类准确性；无 AI 时验证规则匹配降级
  - 优先级：P1
  - 依赖：T8.5, T9.2
  - 验收标准：TC-ACT-001 ~ TC-ACT-006

- [ ] **T12.4** 活动记录持久化与清理验证：重启应用后活动记录恢复；检查 30 天过期记录自动清理
  - 优先级：P1
  - 依赖：T9.3
  - 验收标准：TC-ACT-007, TC-ACT-008, TC-ACT-114

- [ ] **T12.5** 活动图表功能验证：右键菜单入口、24 小时时段分布展示、日期切换、空状态提示
  - 优先级：P1
  - 依赖：T11.4, T10.3
  - 验收标准：TC-ACT-009 ~ TC-ACT-113

- [ ] **T12.6** 回归测试：验证已有功能不受影响，包括任务增删改查、AI 监控、自动保存、数据目录、宠物动画等
  - 优先级：P1
  - 依赖：所有编码任务
  - 验收标准：TC-REG-001 ~ TC-REG-008

---

## 13. 最终编译与构建验证

- [ ] **T13.1** 执行 `cargo build` 验证 Rust 后端编译通过
  - 涉及文件：`src-tauri/`
  - 优先级：P0
  - 依赖：所有编码任务
  - 说明：确保 Rust 侧无编译错误

- [ ] **T13.2** 执行前端类型检查（`svelte-check` 或 `tsc --noEmit`）验证 TypeScript 类型正确
  - 涉及文件：`src/`
  - 优先级：P0
  - 依赖：所有编码任务
  - 说明：确保新增类型定义和接口变更无类型错误

- [ ] **T13.3** 执行 `tauri build` 或 `tauri dev` 验证完整应用可正常启动和运行
  - 涉及文件：项目根目录
  - 优先级：P0
  - 依赖：T13.1, T13.2
  - 说明：验证所有窗口（pet、panel、settings、activity）可正常打开

---

## 任务依赖关系图

```
T1.1 (移除轮询) ─── ★ 最高优先级
  └── T1.2 (验证响应式更新)

T2.1 (isSaving 变量) ─── T2.2 (saveAll 保存锁) ─── T2.3 (loadAll 保存锁检查)

T3.1 (dataVersion 变量) ─── T3.3 (saveAll 版本戳) ─── 依赖 T2.2
T3.2 (dataVersion store) ─┘                   T3.4 (loadAll 版本检查) ─── 依赖 T2.3

T4.1 (ValidationResult 接口) ─── T4.2 (validateAiConfig 函数)
  └── T5.1 (import) ─── T5.2 (saveAiConfig 验证步骤)
        ├── T5.3 (验证失败分支)
        ├── T5.4 (验证成功分支) ─── T5.5 (saveAll 失败回滚)
        └── T5.6 (按钮禁用+文案)

T6.1 (ActivityRecord 类型) ─── T6.2 (activityRecords store)
  ├── T7.1 (classifyActivity 函数)
  │     └── T8.1 (import) ─── T8.2 (黑名单匹配) ─── T8.3 (活动分类) ─── T8.4 (创建记录) ─── T8.5 (异步持久化)
  ├── T9.1 (saveAll 扩展) ─── 依赖 T2.2
  └── T9.2 (loadAll 扩展) ─── T9.3 (30天清理) ─── 依赖 T2.3

T10.1 (Chart script) ─── T10.2 (Chart template) ─── T10.3 (Chart style)
  └── T11.1 (activity 页面) ─── T11.2 (capabilities) ─── T11.3 (openActivityChart) ─── T11.4 (右键菜单)

T12.1~T12.6 (验证测试) ─── 依赖对应编码任务
T13.1~T13.3 (编译验证) ─── 依赖所有编码任务
```

## 实施顺序建议

1. **Phase 1 — 竞态修复**（P0）：T1.1 → T1.2 → T2.1 → T2.2 → T2.3 → T3.1 → T3.2 → T3.3 → T3.4
2. **Phase 2 — API 验证**（P0）：T4.1 → T4.2 → T5.1 → T5.2 → T5.3 → T5.4 → T5.5 → T5.6
3. **Phase 3 — 活动追踪基础**（P0/P1）：T6.1 → T6.2 → T7.1 → T8.1 → T8.2 → T8.3 → T8.4 → T8.5 → T9.1 → T9.2 → T9.3
4. **Phase 4 — 活动图表**（P1/P2）：T10.1 → T10.2 → T10.3 → T11.1 → T11.2 → T11.3 → T11.4
5. **Phase 5 — 验证测试**：T12.1 → T12.2 → T12.3 → T12.4 → T12.5 → T12.6
6. **Phase 6 — 编译验证**：T13.1 → T13.2 → T13.3
