<script>
  export let message = '';
</script>

{#if message}
  <div class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300">
    {message}
  </div>
{/if}
