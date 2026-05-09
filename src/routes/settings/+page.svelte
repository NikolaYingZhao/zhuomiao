<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import { loadAll } from '$lib/services/persistence';

  let ready = $state(false);

  onMount(async () => {
    await loadAll();
    ready = true;
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
