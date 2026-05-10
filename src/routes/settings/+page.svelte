<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import { loadAllFromDB } from '$lib/services/persistence';
  import { initStoreSync } from '$lib/services/sync';

  let ready = $state(false);

  // FIX: P0 — 每个 await 用独立 try-catch 包裹，无论如何最后都 ready = true
  // FIX: P3 — 保存 unlisten 函数，组件销毁时清理
  onMount(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        unlisten = await initStoreSync();
      } catch (e) {
        console.error('[settings] initStoreSync 失败:', e);
      }

      try {
        await loadAllFromDB();
      } catch (e) {
        console.error('[settings] loadAllFromDB 失败:', e);
      }

      ready = true;
    })();

    return () => {
      if (unlisten) unlisten();
    };
  });
</script>

{#if ready}
  <div class="window-root">
    <SettingsPanel />
  </div>
{:else}
  <div class="loading">加载中...</div>
{/if}

<style>
  :global(html), :global(body) {
    margin: 0;
    background: #fff;
  }
  .window-root {
    width: 100%;
    height: 100vh;
    background: #fff;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: #999;
    font-size: 14px;
  }
</style>
