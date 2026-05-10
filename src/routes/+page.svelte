<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import PetAnimation from '$lib/components/PetAnimation.svelte';
  import SpeechBubble from '$lib/components/SpeechBubble.svelte';
  import ActivityChart from '$lib/components/ActivityChart.svelte';
  import QuickChat from '$lib/components/QuickChat.svelte';
  import {
    isPanelOpen, isSettingsOpen,
    tasks, monitorRules, activeWindow, aiConfig, activityRecords
  } from '$lib/stores';
  import type { ActiveWindow, Task, MonitorRule, PetState, ActivityRecord } from '$lib/types';
  import { loadAllFromDB, saveAll, setupAutoSave, toggleTask as persistToggleTask, createTask as persistCreateTask, saveActivityRecords, calibrateActivityRecord } from '$lib/services/persistence';
  import { chatWithAI, classifyActivity, getCompletionHint } from '$lib/services/ai';
  import { initStoreSync } from '$lib/services/sync';

  let showBubble = $state(false);
  let currentMessage = $state('');
  let currentPetState = $state<PetState>('idle');
  let showContextMenu = $state(false);
  let contextMenuPos = $state({ x: 0, y: 0 });
  let lastAlertTime = 0;
  let pendingConfirmTaskId = $state<string | null>(null);
  let showActivityChart = $state(false);
  let showExitMenu = $state(false);
  let speechTimer: ReturnType<typeof setTimeout> | null = null;

  const appWindow = getCurrentWindow();
  const MONITOR_INTERVAL_MS = 45000;
  const ALERT_COOLDOWN_MS = 30000;
  const SPEECH_DURATION_MS = 5000;

  async function startDrag() {
    await appWindow.startDragging();
  }

  function showSpeech(msg: string, state: PetState = 'worried') {
    if (speechTimer) clearTimeout(speechTimer);
    currentMessage = msg;
    currentPetState = state;
    showBubble = true;
    speechTimer = setTimeout(() => {
      showBubble = false;
      currentPetState = 'idle';
      speechTimer = null;
    }, SPEECH_DURATION_MS);
  }

  // FIX: P0-B — 窗口关闭后无法再打开。getByLabel 返回 null 时重建窗口
  async function openPanel() {
    isPanelOpen.set(true);
    try {
      let panelWin = await WebviewWindow.getByLabel('panel');
      if (panelWin) {
        await panelWin.show();
        await panelWin.setFocus();
      } else {
        // 窗口已被销毁，重新创建
        panelWin = new WebviewWindow('panel', {
          url: '/panel',
          title: '桌喵 - 任务面板',
          width: 420,
          height: 640,
          x: 400,
          y: 200,
          resizable: true,
        });
        await panelWin.once('tauri://created', () => {
          console.log('[pet] panel 窗口已重建');
        });
        await panelWin.once('tauri://error', (e) => {
          console.error('[pet] panel 窗口重建失败:', e);
        });
      }
    } catch (e) {
      console.error('[pet] 打开面板失败:', e);
    }
  }

  async function openSettings() {
    isSettingsOpen.set(true);
    try {
      let settingsWin = await WebviewWindow.getByLabel('settings');
      if (settingsWin) {
        await settingsWin.show();
        await settingsWin.setFocus();
      } else {
        // 窗口已被销毁，重新创建
        settingsWin = new WebviewWindow('settings', {
          url: '/settings',
          title: '桌喵 - 设置',
          width: 480,
          height: 600,
          x: 500,
          y: 150,
          resizable: false,
        });
        await settingsWin.once('tauri://created', () => {
          console.log('[pet] settings 窗口已重建');
        });
        await settingsWin.once('tauri://error', (e) => {
          console.error('[pet] settings 窗口重建失败:', e);
        });
      }
    } catch (e) {
      console.error('[pet] 打开设置失败:', e);
    }
  }

  async function quitApp() {
    await saveAll();
    await appWindow.destroy();
  }

  async function minimizeToTray() {
    showExitMenu = false;
    await appWindow.hide();
  }

  async function checkActivity() {
    try {
      const win: ActiveWindow = await invoke('get_active_window');
      activeWindow.set(win);

      const currentTasks: Task[] = $tasks;
      const rules: MonitorRule[] = $monitorRules;
      const config = $aiConfig;
      const incomplete = currentTasks.filter(t => !t.completed);
      if (incomplete.length === 0) return;

      const now = Date.now();
      if (now - lastAlertTime < ALERT_COOLDOWN_MS) return;

      const target = `${win.title} ${win.processName}`.toLowerCase();
      let matched = false;
      let matchedMessage = '';

      for (const rule of rules) {
        if (rule.isBlacklist) {
          const patterns: string[] = rule.pattern.split(',').map((s: string) => s.trim());
          for (const pattern of patterns) {
            if (target.includes(pattern.toLowerCase())) {
              matched = true;
              matchedMessage = rule.message;
              break;
            }
          }
        }
        if (matched) break;
      }

      const completed = currentTasks.filter(t => t.completed && t.completionMethod);
      let completionContext = '';
      if (completed.length > 0) {
        const manualCompleted = completed.filter(t => t.completionMethod === 'manual').map(t => t.title);
        const aiDetected = completed.filter(t => t.completionMethod === 'ai_detected').map(t => t.title);
        completionContext = '\n已完成的任务：\n';
        if (manualCompleted.length > 0) completionContext += `- 用户手动完成：${manualCompleted.join('、')}\n`;
        if (aiDetected.length > 0) completionContext += `- AI检测完成（用户确认）：${aiDetected.join('、')}\n`;
      }

      if (matched) {
        if (config.apiKey) {
          try {
            const classification = await classifyActivity(
              config, win.title, win.processName, incomplete.map(t => t.title)
            );
            const taskList = incomplete.map(t => `- "${t.title}"（完成判断：${t.completionHint || t.title}）`).join('\n');
            const aiResult = await chatWithAI(
              config,
              `我检测到用户正在访问：${win.title}（进程：${win.processName}）。

用户的未完成任务：
${taskList}
${completionContext}
请判断用户是在摸鱼还是在做正事。考虑：
- 如果在B站看网课/教程，这是在做事，回复"OK"
- 如果在B站刷视频/娱乐，这是摸鱼
- 根据任务内容判断当前行为是否相关
- 如果用户似乎完成了某个任务，回复"COMPLETED:任务标题"

如果是摸鱼：用可爱猫咪语气简短责备提醒（30字以内）
如果在做正事：回复"OK"
如果可能完成了任务：回复"COMPLETED:任务标题"`
            );
            if (aiResult && aiResult.startsWith('COMPLETED:')) {
              const completedTitle = aiResult.replace('COMPLETED:', '').trim();
              const matchedTask = incomplete.find(t => t.title.includes(completedTitle));
              if (matchedTask) {
                pendingConfirmTaskId = matchedTask.id;
                showSpeech(`"${matchedTask.title}" 完成了吗？`, 'happy');
              }
              recordActivity(win, 'productive', 'ai', classification.activityType, aiResult);
            } else if (aiResult && aiResult !== 'OK' && aiResult.length < 50) {
              showSpeech(aiResult, 'angry');
              lastAlertTime = now;
              recordActivity(win, 'slacking', 'ai', classification.activityType, aiResult);
            } else if (aiResult === 'OK') {
              const encourageTarget = incomplete[0]?.title || '任务';
              showSpeech(`在努力做${encourageTarget}吗？加油！`, 'happy');
              recordActivity(win, 'productive', 'ai', classification.activityType);
            }
          } catch (e) {
            console.error('AI监控请求失败，降级为规则匹配:', e);
            showSpeech(matchedMessage, 'angry');
            lastAlertTime = now;
            recordActivity(win, 'slacking', 'rule_based');
          }
        } else {
          showSpeech(matchedMessage, 'angry');
          lastAlertTime = now;
          recordActivity(win, 'slacking', 'rule_based');
        }
      } else if (config.apiKey && incomplete.length > 0) {
        try {
          const classification = await classifyActivity(
            config, win.title, win.processName, incomplete.map(t => t.title)
          );
          const taskContext = incomplete.map(t =>
            `- "${t.title}"（完成判断：${t.completionHint || t.title}）`
          ).join('\n');

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
            recordActivity(win, 'productive', 'ai', classification.activityType, aiResult);
          } else if (aiResult && aiResult !== 'OK' && aiResult.length < 30) {
            showSpeech(aiResult, 'happy');
            lastAlertTime = now;
            recordActivity(win, classification.classification, 'ai', classification.activityType, aiResult);
          } else {
            recordActivity(win, classification.classification, 'ai', classification.activityType);
          }
        } catch (e) {
          console.error('AI监控请求失败（非黑名单分支）:', e);
          recordActivity(win, 'productive', 'rule_based');
        }
      }
    } catch (e) {
      console.error('Monitor error:', e);
    }
  }

  async function recordActivity(win: ActiveWindow, classification: 'productive' | 'slacking', source: 'ai' | 'rule_based' | 'manual', activityType?: string, aiComment?: string) {
    const record: ActivityRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      windowTitle: win.title,
      processName: win.processName,
      classification,
      classificationSource: source,
      activityType,
      aiComment,
    };

    const current = $activityRecords;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = current.filter(r => new Date(r.timestamp).getTime() > thirtyDaysAgo);
    filtered.push(record);

    await saveActivityRecords(filtered, record);
  }

  async function confirmTaskCompletion() {
    if (!pendingConfirmTaskId) return;
    const id = pendingConfirmTaskId;
    pendingConfirmTaskId = null;
    try {
      await persistToggleTask(id, 'ai_detected');
      showSpeech('太棒了！又完成一个！', 'happy');
    } catch (e) {
      console.error('完成任务持久化失败:', e);
      showSpeech('保存失败，请重试', 'worried');
    }
  }

  function denyTaskCompletion() {
    pendingConfirmTaskId = null;
    showSpeech('继续加油！', 'happy');
  }

  async function calibrateActivity(record: ActivityRecord, newClassification: 'productive' | 'slacking') {
    const current = $activityRecords;
    const updated = current.map(r =>
      r.id === record.id
        ? { ...r, classification: newClassification, classificationSource: 'manual' as const }
        : r
    );
    activityRecords.set(updated);
    await calibrateActivityRecord(record.id, newClassification);
  }

  onMount(() => {
    let monitorTimer: ReturnType<typeof setInterval> | null = null;
    let autoSaveTimer: ReturnType<typeof setInterval> | null = null;
    let unlistenSync: (() => void) | null = null;

    // FIX: P0 — 每个 async 步骤用 try-catch 包裹，初始化链路不会因单步失败而中断
    // FIX: P2 — 删除 watchAndSyncStores，只保留 persistence 层显式广播
    // FIX: P3 — 保存 initStoreSync 返回的 unlisten 函数
    loadAllFromDB().then(async () => {
      if ($monitorRules.length === 0) {
        const defaultRules: MonitorRule[] = [
          {
            id: '1',
            pattern: 'xiaohongshu,douyin,bilibili/video',
            ruleType: 'url',
            isBlacklist: true,
            message: '不是应该在学习吗？怎么在刷这个？！',
          },
          {
            id: '2',
            pattern: 'wechat',
            ruleType: 'process',
            isBlacklist: true,
            message: '又在聊天？任务还没做完呢！',
          },
        ];
        monitorRules.set(defaultRules);
      }

      monitorTimer = setInterval(checkActivity, MONITOR_INTERVAL_MS);
      autoSaveTimer = setupAutoSave(5000);

      try {
        unlistenSync = await initStoreSync();
      } catch (e) {
        console.error('[pet] initStoreSync 失败:', e);
      }
    }).catch((e) => {
      console.error('[pet] loadAllFromDB 失败:', e);
    });

    return () => {
      if (monitorTimer) clearInterval(monitorTimer);
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      if (speechTimer) clearTimeout(speechTimer);
      if (unlistenSync) unlistenSync();
    };
  });

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    showContextMenu = true;
    contextMenuPos = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    showContextMenu = false;
  }

  let showQuickTaskInput = $state(false);
  let quickTaskTitle = $state('');
  let enableChat = $state(false);
  let showChatPanel = $state(false);
  let chatTaskContext = $state<{ tasks: Task[]; currentTaskId?: string } | null>(null);

  async function addQuickTask() {
    closeContextMenu();
    showQuickTaskInput = true;
    quickTaskTitle = '';
    enableChat = false;
  }

  async function submitQuickTask() {
    if (!quickTaskTitle.trim()) {
      showQuickTaskInput = false;
      return;
    }
    const task: Task = {
      id: crypto.randomUUID(),
      title: quickTaskTitle.trim(),
      category: '学习',
      priority: 'medium',
      dueDate: new Date().toISOString().split('T')[0],
      completed: false,
      createdAt: new Date().toISOString(),
    };

    const hint = await getCompletionHint(quickTaskTitle.trim());
    task.completionHint = hint;

    try {
      await persistCreateTask(task);
    } catch (e) {
      console.error('快速添加任务失败:', e);
    }

    showQuickTaskInput = false;
    const taskTitle = quickTaskTitle.trim();
    quickTaskTitle = '';

    if (enableChat) {
      chatTaskContext = { tasks: $tasks, currentTaskId: task.id };
      showChatPanel = true;
    } else if (hint) {
      showSpeech(`收到！完成提示：${hint}`, 'happy');
    } else {
      showSpeech('收到！我帮你记下了～加油哦！', 'happy');
    }
  }

  function cancelQuickTask() {
    showQuickTaskInput = false;
    quickTaskTitle = '';
  }
</script>

<svelte:document onclick={closeContextMenu} />

<div class="pet-window" oncontextmenu={handleContextMenu}>
  <div class="pet-area" onmousedown={startDrag}>
    <SpeechBubble message={currentMessage} visible={showBubble} />
    <PetAnimation state={currentPetState} />
  </div>

  {#if pendingConfirmTaskId}
    <div class="confirm-actions">
      <button class="confirm-btn" onclick={confirmTaskCompletion}>✅ 完成了</button>
      <button class="deny-btn" onclick={denyTaskCompletion}>还没呢</button>
    </div>
  {/if}

  {#if showQuickTaskInput}
    <div class="quick-task-input">
      <input
        type="text"
        placeholder="告诉桌喵你要做什么..."
        bind:value={quickTaskTitle}
        onkeydown={(e) => { if (e.key === 'Enter') submitQuickTask(); if (e.key === 'Escape') cancelQuickTask(); }}
      />
      <button class="quick-task-ok" onclick={submitQuickTask}>✓</button>
      <button class="quick-task-cancel" onclick={cancelQuickTask}>✕</button>
    </div>
    <label class="chat-toggle">
      <input type="checkbox" bind:checked={enableChat} />
      <span>与桌喵聊天</span>
    </label>
  {/if}

  <div class="action-bar">
    <button class="action-btn" onclick={addQuickTask} title="快速添加任务">📝</button>
    <button class="action-btn" onclick={openPanel} title="任务面板">📋</button>
    <button class="action-btn" onclick={() => showActivityChart = !showActivityChart} title="活动图表">📊</button>
    <button class="action-btn" onclick={openSettings} title="设置">⚙️</button>
    <button class="action-btn action-btn-exit" onclick={() => showExitMenu = !showExitMenu} title="退出">✕</button>
  </div>

  {#if showExitMenu}
    <div class="exit-menu">
      <button class="exit-option" onclick={minimizeToTray}>🔽 最小化到托盘</button>
      <button class="exit-option exit-quit" onclick={quitApp}>❌ 彻底退出</button>
    </div>
  {/if}

  {#if showActivityChart}
    <div class="chart-panel">
      <div class="chart-panel-header">
        <span>每日活动图表</span>
        <button class="close-chart" onclick={() => showActivityChart = false}>✕</button>
      </div>
      <ActivityChart records={$activityRecords} onCalibrate={calibrateActivity} />
    </div>
  {/if}

  {#if showChatPanel && chatTaskContext}
    <QuickChat
      visible={true}
      taskContext={chatTaskContext}
      onClose={() => { showChatPanel = false; chatTaskContext = null; }}
    />
  {/if}
</div>

{#if showContextMenu}
  <div class="context-menu" style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px">
    <button onclick={addQuickTask}>📝 添加任务</button>
    <button onclick={openPanel}>📋 任务面板</button>
    <button onclick={openSettings}>⚙️ 设置</button>
    <hr />
    <button onclick={() => { currentPetState = 'sleeping'; showSpeech('晚安～我睡一会儿', 'sleeping'); }}>😴 休息</button>
    <hr />
    <button onclick={minimizeToTray}>🔽 最小化到托盘</button>
    <button class="exit-btn" onclick={quitApp}>❌ 退出桌喵</button>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: transparent !important;
    overflow: hidden;
    user-select: none;
  }
  :global(html) {
    background: transparent !important;
  }

  .pet-window {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    width: 100vw;
    height: 100vh;
    padding-bottom: 8px;
    background: transparent;
  }

  .pet-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: grab;
  }

  .pet-area:active {
    cursor: grabbing;
  }

  .action-bar {
    display: flex;
    gap: 4px;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 12px;
    padding: 4px 8px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.1);
    margin-top: 4px;
  }

  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    padding: 2px 4px;
    border-radius: 6px;
    transition: background 0.2s;
  }

  .action-btn:hover {
    background: rgba(255, 159, 67, 0.15);
  }

  .action-btn-exit {
    font-size: 14px;
    color: #999;
    font-weight: bold;
  }
  .action-btn-exit:hover {
    background: rgba(244, 67, 54, 0.15);
    color: #f44336;
  }

  .confirm-actions {
    display: flex;
    gap: 6px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 10px;
    padding: 4px 8px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.1);
    margin-bottom: 2px;
  }

  .quick-task-input {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 10px;
    padding: 4px 8px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.1);
    margin-bottom: 2px;
    width: 240px;
  }
  .quick-task-input input {
    flex: 1;
    border: none;
    background: transparent;
    font-size: 12px;
    outline: none;
    min-width: 0;
  }
  .quick-task-ok, .quick-task-cancel {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .quick-task-ok {
    color: #4caf50;
  }
  .quick-task-ok:hover {
    background: rgba(76, 175, 80, 0.1);
  }
  .quick-task-cancel {
    color: #999;
  }
  .quick-task-cancel:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #f44336;
  }
  .chat-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #ff9f43;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 8px;
    padding: 2px 8px;
    margin-bottom: 2px;
  }
  .chat-toggle input {
    margin: 0;
  }
  .confirm-btn, .deny-btn {
    border: none;
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .confirm-btn {
    background: #4caf50;
    color: white;
  }
  .confirm-btn:hover {
    background: #388e3c;
  }
  .deny-btn {
    background: #f5f5f5;
    color: #666;
  }
  .deny-btn:hover {
    background: #e0e0e0;
  }

  .chart-panel {
    position: absolute;
    bottom: 40px;
    left: 8px;
    right: 8px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    max-height: 280px;
    overflow-y: auto;
    z-index: 100;
  }
  .chart-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .close-chart {
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }
  .close-chart:hover {
    color: #333;
  }

  .context-menu {
    position: fixed;
    background: white;
    border-radius: 8px;
    padding: 4px 0;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 140px;
  }

  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 16px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    color: #333;
  }

  .context-menu button:hover {
    background: #fff3e0;
  }

  .exit-btn {
    color: #f44336 !important;
  }

  .exit-menu {
    position: absolute;
    bottom: 36px;
    right: 4px;
    background: white;
    border-radius: 8px;
    padding: 4px 0;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    min-width: 140px;
  }
  .exit-option {
    display: block;
    width: 100%;
    padding: 6px 16px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    color: #333;
  }
  .exit-option:hover {
    background: #fff3e0;
  }
  .exit-quit {
    color: #f44336 !important;
  }

  .context-menu hr {
    border: none;
    border-top: 1px solid #eee;
    margin: 2px 0;
  }
</style>
