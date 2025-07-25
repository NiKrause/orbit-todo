<script>
  import { formatPeerId } from '../lib/p2p.js';
  
  export let showRelayDetails;
  export let relayStatus;
  export let onToggleShow;
  export let onRefreshCache;
</script>

<div class="bg-white rounded-lg shadow-md p-6 mt-6">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-xl font-semibold">Relay Discovery Status</h2>
    <div class="flex space-x-2">
      <button 
        on:click={onToggleShow}
        class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
      >
        {showRelayDetails ? 'Hide Details' : 'Show Details'}
      </button>
      
      {#if showRelayDetails}
        <button 
          on:click={onRefreshCache}
          class="text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded-md transition-colors"
        >
          Refresh Cache
        </button>
      {/if}
    </div>
  </div>
  
  {#if showRelayDetails}
    {#if relayStatus}
      <div class="space-y-3">
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full {relayStatus.healthy ? 'bg-green-500' : 'bg-red-500'}"></div>
          <span class="font-medium">Relay Server: {relayStatus.healthy ? 'Healthy' : 'Unhealthy'}</span>
          <span class="text-xs px-2 py-1 rounded-full {relayStatus.bootstrapConfig?.isDevelopment ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">
            {relayStatus.bootstrapConfig?.isDevelopment ? 'Development (localhost)' : 'Production (public)'}
          </span>
        </div>
        
        <div class="text-sm text-gray-600">
          <p><strong>WebRTC Address Cache:</strong> 
            {#if relayStatus.cacheValid}
              <span class="text-green-600">Valid (cached {Math.round(relayStatus.cacheAge / 1000)}s ago)</span>
            {:else}
              <span class="text-orange-600">Expired or missing - will fetch from relay on next connection</span>
            {/if}
          </p>
          <p class="text-xs text-gray-500 mt-1">Caches WebRTC multiaddresses from the relay to avoid repeated HTTP requests</p>
          
          <!-- Bootstrap Configuration -->
          {#if relayStatus.bootstrapConfig}
            <p class="mt-2"><strong>Bootstrap Relay:</strong> <code class="bg-white px-1 rounded text-xs">{relayStatus.bootstrapConfig.currentBootstrapAddr}</code></p>
            <p class="text-xs text-gray-500 mt-1">This is the LibP2P relay server used for peer discovery and circuit relay</p>
          {/if}
          
          <!-- Relay Server Information -->
          <p class="mt-2"><strong>Relay HTTP Server:</strong> <code class="bg-white px-1 rounded text-xs">{relayStatus.relayHttpUrl || 'Unknown'}</code></p>
          <p class="text-xs text-gray-500 mt-1">This is the HTTP server for health checks and multiaddr discovery (different from the LibP2P relay above)</p>
          
          {#if relayStatus.discoveryResult}
            <p class="mt-2"><strong>Relay Peer ID:</strong> <code class="bg-white px-1 rounded text-xs">{formatPeerId(relayStatus.discoveryResult.peerId)}</code></p>
          {/if}
          
          {#if relayStatus.addresses || relayStatus.discoveryResult}
            <p class="mt-2"><strong>Available Multiaddresses:</strong></p>
            <div class="mt-1 space-y-1">
              {#if relayStatus.addresses?.direct || relayStatus.discoveryResult?.direct}
                <div class="bg-green-50 p-2 rounded border-l-4 border-green-400">
                  <code class="text-xs">{relayStatus.addresses?.direct || relayStatus.discoveryResult?.direct}</code>
                  <span class="text-green-600 text-xs ml-2">(Direct WebRTC)</span>
                </div>
              {/if}
              {#if relayStatus.addresses?.circuitRelay || relayStatus.discoveryResult?.circuitRelay}
                <div class="bg-blue-50 p-2 rounded border-l-4 border-blue-400">
                  <code class="text-xs">{relayStatus.addresses?.circuitRelay || relayStatus.discoveryResult?.circuitRelay}</code>
                  <span class="text-blue-600 text-xs ml-2">(Circuit Relay)</span>
                </div>
              {/if}
              {#if relayStatus.addresses?.websocket || relayStatus.discoveryResult?.websocket}
                <div class="bg-purple-50 p-2 rounded border-l-4 border-purple-400">
                  <code class="text-xs">{relayStatus.addresses?.websocket || relayStatus.discoveryResult?.websocket}</code>
                  <span class="text-purple-600 text-xs ml-2">(WebSocket)</span>
                </div>
              {/if}
              
              <!-- Show all WebRTC addresses if available -->
              {#if relayStatus.discoveryResult?.webrtc && relayStatus.discoveryResult.webrtc.length > 0}
                <div class="mt-2">
                  <p class="text-sm font-medium text-gray-700">All WebRTC Addresses:</p>
                  {#each relayStatus.discoveryResult.webrtc as addr}
                    <div class="bg-gray-50 p-1 rounded mt-1">
                      <code class="text-xs">{addr}</code>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <p class="text-red-600">No multiaddresses available</p>
          {/if}
          
          {#if relayStatus.error}
            <p class="text-red-600 mt-2"><strong>Error:</strong> {relayStatus.error}</p>
          {/if}
        </div>
      </div>
    {:else}
      <p class="text-gray-500">Click "Show Details" to check relay discovery status</p>
    {/if}
  {:else}
    <p class="text-sm text-gray-500">Relay discovery provides WebRTC addresses with smart caching to avoid unnecessary requests on page reload.</p>
  {/if}
</div>
