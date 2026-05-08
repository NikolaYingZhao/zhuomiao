<script lang="ts">
  let { message = '', visible = false }: { message: string; visible: boolean } = $props();

  let show = $state(false);
  let currentMsg = $state('');

  $effect(() => {
    if (visible && message) {
      currentMsg = message;
      show = true;
      const timer = setTimeout(() => { show = false; }, 5000);
      return () => clearTimeout(timer);
    }
  });
</script>

{#if show}
  <div class="speech-bubble" class:hide={!show}>
    <div class="bubble-content">
      <span class="pet-emoji">🐱</span>
      <span class="text">{currentMsg}</span>
    </div>
    <div class="bubble-tail"></div>
  </div>
{/if}

<style>
  .speech-bubble {
    position: relative;
    background: white;
    border: 2px solid #ff9f43;
    border-radius: 16px;
    padding: 10px 14px;
    margin-bottom: 8px;
    max-width: 240px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    animation: fadeIn 0.3s ease;
  }

  .bubble-content {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .pet-emoji {
    font-size: 16px;
    flex-shrink: 0;
  }

  .text {
    font-size: 13px;
    color: #333;
    line-height: 1.4;
    word-break: break-word;
  }

  .bubble-tail {
    position: absolute;
    bottom: -8px;
    left: 30px;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid #ff9f43;
  }

  .hide {
    animation: fadeOut 0.3s ease forwards;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
</style>
