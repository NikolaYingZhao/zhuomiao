<script lang="ts">
  import type { Task, TaskChatContext, ChatMessage } from '$lib/types';
  import { chatWithTaskContext } from '$lib/services/chat';
  import { toggleTask, updateTask } from '$lib/services/persistence';
  import { tasks, aiConfig } from '$lib/stores';

  let {
    visible,
    taskContext,
    onClose,
  }: {
    visible: boolean;
    taskContext: TaskChatContext;
    onClose: () => void;
  } = $props();

  let chatInput = $state('');
  let chatMessages = $state<ChatMessage[]>([]);
  let isChatLoading = $state(false);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function resetTimeout() {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      onClose();
    }, 30000);
  }

  async function handleChatSubmit() {
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };
    chatMessages = [...chatMessages, userMsg];
    chatInput = '';
    isChatLoading = true;
    resetTimeout();

    try {
      const config = $aiConfig;
      const history = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await chatWithTaskContext(config, userMsg.content, taskContext, history);

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString(),
      };
      chatMessages = [...chatMessages, assistantMsg];

      if (response.action) {
        await executeTaskAction(response.action);
      }
    } catch {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: 'AI服务暂不可用，部分功能受限',
        timestamp: new Date().toISOString(),
      };
      chatMessages = [...chatMessages, errorMsg];
    } finally {
      isChatLoading = false;
    }
  }

  async function executeTaskAction(action: { type: string; taskId: string; newHint?: string }) {
    if (action.type === 'complete') {
      try {
        await toggleTask(action.taskId, 'manual');
      } catch (e) {
        console.error('聊天中标记任务完成失败:', e);
      }
    } else if (action.type === 'updateHint' && action.newHint) {
      try {
        await updateTask(action.taskId, { completionHint: action.newHint });
      } catch (e) {
        console.error('聊天中修改检测规则失败:', e);
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleChatSubmit();
    if (e.key === 'Escape') onClose();
  }
</script>

{#if visible}
  <div class="quick-chat">
    <div class="chat-header">
      <span>与桌喵聊天</span>
      <button class="chat-close" onclick={onClose}>✕</button>
    </div>
    <div class="chat-messages">
      {#each chatMessages as msg}
        <div class="chat-msg" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
          {msg.content}
        </div>
      {/each}
      {#if isChatLoading}
        <div class="chat-msg assistant">思考中...</div>
      {/if}
    </div>
    <div class="chat-input-row">
      <input
        type="text"
        placeholder="跟桌喵说..."
        bind:value={chatInput}
        onkeydown={handleKeydown}
        onfocus={resetTimeout}
      />
      <button class="chat-send" onclick={handleChatSubmit} disabled={isChatLoading}>发送</button>
    </div>
  </div>
{/if}

<style>
  .quick-chat {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    width: 260px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    z-index: 101;
    display: flex;
    flex-direction: column;
    max-height: 320px;
  }
  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid #eee;
    font-size: 12px;
    font-weight: 600;
  }
  .chat-close {
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
  }
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    max-height: 200px;
  }
  .chat-msg {
    font-size: 11px;
    padding: 4px 8px;
    margin-bottom: 4px;
    border-radius: 8px;
    max-width: 85%;
    word-wrap: break-word;
  }
  .chat-msg.user {
    background: #ff9f43;
    color: white;
    margin-left: auto;
    border-bottom-right-radius: 2px;
  }
  .chat-msg.assistant {
    background: #f5f5f5;
    color: #333;
    margin-right: auto;
    border-bottom-left-radius: 2px;
  }
  .chat-input-row {
    display: flex;
    gap: 4px;
    padding: 6px;
    border-top: 1px solid #eee;
  }
  .chat-input-row input {
    flex: 1;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    outline: none;
  }
  .chat-send {
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    background: #ff9f43;
    color: white;
    font-size: 11px;
    cursor: pointer;
  }
  .chat-send:disabled {
    opacity: 0.5;
  }
</style>
