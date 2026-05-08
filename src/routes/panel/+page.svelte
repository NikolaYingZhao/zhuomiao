<script lang="ts">
  import TaskPanel from '$lib/components/TaskPanel.svelte';
</script>

<div class="window-root">
  <TaskPanel />
</div>

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
</style>
