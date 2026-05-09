<script lang="ts">
  import { onMount } from 'svelte';
  import TaskPanel from '$lib/components/TaskPanel.svelte';
  import { tasks, monitorRules } from '$lib/stores';
  import type { Task, MonitorRule } from '$lib/types';
  import { loadAll, saveAll } from '$lib/services/persistence';

  let ready = $state(false);

  onMount(() => {
    loadAll().then(() => { ready = true; });
  });

  async function onDataChange() {
    await saveAll();
  }
</script>

{#if ready}
  <div class="window-root">
    <TaskPanel />
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
