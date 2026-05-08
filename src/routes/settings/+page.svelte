<script lang="ts">
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
</script>

<div class="window-root">
  <SettingsPanel />
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
