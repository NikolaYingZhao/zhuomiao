<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import PetAnimation from '$lib/components/PetAnimation.svelte';
  import SpeechBubble from '$lib/components/SpeechBubble.svelte';
  import {
    petState, petMessage, isPanelOpen, isSettingsOpen,
    tasks, monitorRules, activeWindow
  } from '$lib/stores';
  import type { ActiveWindow, Task, MonitorRule } from '$lib/types';
  import { loadAll, setupAutoSave } from '$lib/services/persistence';

  let showBubble = $state(false);
  let currentMessage = $state('');
  let currentPetState = $state('idle');
  let showContextMenu = $state(false);
  let contextMenuPos = $state({ x: 0, y: 0 });

  const appWindow = getCurrentWindow();

  async function startDrag() {
    await appWindow.startDragging();
  }

  function showSpeech(msg: string, state: string = 'worried') {
    currentMessage = msg;
    currentPetState = state;
    showBubble = true;
    setTimeout(() => { showBubble = false; currentPetState = 'idle'; }, 5000);
  }

  async function openPanel() {
    isPanelOpen.set(true);
    try {
      const panelWin = await WebviewWindow.getByLabel('panel');
      if (panelWin) {
        await panelWin.show();
        await panelWin.setFocus();
      }
    } catch (e) {
      console.error('打开面板失败:', e);
    }
  }

  async function openSettings() {
    isSettingsOpen.set(true);
    try {
      const settingsWin = await WebviewWindow.getByLabel('settings');
      if (settingsWin) {
        await settingsWin.show();
        await settingsWin.setFocus();
      }
    } catch (e) {
      console.error('打开设置失败:', e);
    }
  }

  async function quitApp() {
    await appWindow.destroy();
  }

  async function checkActivity() {
    try {
      const win: ActiveWindow = await invoke('get_active_window');
      activeWindow.set(win);

      const currentTasks: Task[] = $tasks;
      const rules: MonitorRule[] = $monitorRules;

      if (rules.length > 0) {
        const result: string | null = await invoke('check_fish_detection', {
          activeWindow: win,
          rules,
          currentTasks,
        });
        if (result) {
          showSpeech(result, 'angry');
        }
      }
    } catch (e) {
      console.error('Monitor error:', e);
    }
  }

  onMount(async () => {
    await loadAll();

    await invoke('start_monitor_cycle', { intervalSecs: 10 });

    setInterval(checkActivity, 10000);

    const unlisten = await listen<ActiveWindow>('active-window-changed', (event) => {
      activeWindow.set(event.payload);
    });

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

    setupAutoSave(5000);

    return unlisten;
  });

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    showContextMenu = true;
    contextMenuPos = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    showContextMenu = false;
  }

  async function addQuickTask() {
    closeContextMenu();
    const title = prompt('告诉桌喵你要做什么：');
    if (title?.trim()) {
      const task: Task = {
        id: crypto.randomUUID(),
        title: title.trim(),
        category: '学习',
        priority: 'medium',
        dueDate: new Date().toISOString().split('T')[0],
        completed: false,
        createdAt: new Date().toISOString(),
      };
      tasks.add(task);
      showSpeech('收到！我帮你记下了～加油哦！', 'happy');
    }
  }
</script>

<svelte:document onclick={closeContextMenu} />

<div class="pet-window" oncontextmenu={handleContextMenu}>
  <div class="pet-area" onmousedown={startDrag}>
    <SpeechBubble message={currentMessage} visible={showBubble} />
    <PetAnimation state={currentPetState} />
  </div>

  <div class="action-bar">
    <button class="action-btn" onclick={addQuickTask} title="快速添加任务">📝</button>
    <button class="action-btn" onclick={openPanel} title="任务面板">📋</button>
    <button class="action-btn" onclick={openSettings} title="设置">⚙️</button>
    <button class="action-btn action-btn-exit" onclick={quitApp} title="退出">✕</button>
  </div>
</div>

{#if showContextMenu}
  <div class="context-menu" style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px">
    <button onclick={addQuickTask}>📝 添加任务</button>
    <button onclick={openPanel}>📋 任务面板</button>
    <button onclick={openSettings}>⚙️ 设置</button>
    <hr />
    <button onclick={() => { currentPetState = 'sleeping'; showSpeech('晚安～我睡一会儿', 'sleeping'); }}>😴 休息</button>
    <hr />
    <button class="exit-btn" onclick={quitApp}>退出桌喵</button>
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

  .context-menu hr {
    border: none;
    border-top: 1px solid #eee;
    margin: 2px 0;
  }
</style>
