<script>
  import { formatPeerId } from '../lib/p2p.js';
  
  export let peers;
  export let myPeerId;
</script>

<div class="grid md:grid-cols-2 gap-6">
  <!-- Connected Peers -->
  <div class="bg-white rounded-lg shadow-md p-6">
    <h2 class="text-xl font-semibold mb-4">Connected Peers ({peers.length})</h2>
    {#if peers.length > 0}
      <div class="space-y-2">
        {#each peers as { peerId, transports }}
          <div class="flex items-center space-x-2">
            <div class="w-2 h-2 bg-green-500 rounded-full"></div>
            <code class="text-sm bg-gray-100 px-2 py-1 rounded">{formatPeerId(peerId)}</code>
            {#each transports as type}
              {#if type === 'webrtc'}
                <span class="badge bg-green-200 text-green-800">WebRTC</span>
              {:else if type === 'circuit-relay'}
                <span class="badge bg-blue-200 text-blue-800">Relay</span>
              {:else if type === 'websocket'}
                <span class="badge bg-purple-200 text-purple-800">WS</span>
              {:else}
                <span class="badge bg-gray-200 text-gray-800">{type}</span>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-gray-500">No peers connected yet.</p>
    {/if}
  </div>

  <!-- My Identity -->
  <div class="bg-white rounded-lg shadow-md p-6">
    <h2 class="text-xl font-semibold mb-4">My Peer ID</h2>
    {#if myPeerId}
      <div class="bg-blue-50 p-3 rounded-md">
        <code class="text-sm font-mono break-all">{formatPeerId(myPeerId)}</code>
      </div>
      <p class="text-sm text-gray-600 mt-2">Share this ID with others to assign TODOs to you.</p>
    {:else}
      <p class="text-gray-500">Loading...</p>
    {/if}
  </div>
</div>

<style>
  .badge {
    @apply text-xs px-2 py-1 rounded-full font-medium;
  }
</style>
