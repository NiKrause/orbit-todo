<script>
  export let loading;
  export let error;
</script>

{#if loading}
  <div class="text-center py-8">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
    <p class="mt-4 text-gray-600">Initializing P2P connection...</p>
    <p class="mt-2 text-xs text-gray-400">v{__APP_VERSION__}</p>
  </div>
{:else if error}
  <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
    Error: {error}
  </div>
{/if}
