<script>
  import { formatPeerId } from '../lib/p2p.js';
  
  export let selectedPeerId;
  export let peers;
  export let peerOrbitDbAddresses;
  export let onDatabaseSwitch;
  export let onSelectedPeerIdChange;
  
  function handleChange(event) {
    const newPeerId = event.target.value;
    if (onSelectedPeerIdChange) {
      onSelectedPeerIdChange(newPeerId);
    }
    onDatabaseSwitch(newPeerId);
  }
</script>

<div class="mb-6 flex items-center gap-4">
  <label for="peer-db-select" class="font-medium">View TODOs from:</label>
  <select
    id="peer-db-select"
    value={selectedPeerId}
    on:change={handleChange}
    class="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  >
    <option value="">My DB (default)</option>
    {#each peers as { peerId }}
      {#if peerOrbitDbAddresses.get(peerId)}
        <option value={peerId}>
          {formatPeerId(peerId)}... (…{peerOrbitDbAddresses.get(peerId).slice(-5)})
        </option>
      {/if}
    {/each}
  </select>
  {#if selectedPeerId && peerOrbitDbAddresses.get(selectedPeerId)}
    <span class="text-xs text-gray-500">OrbitDB: <code class="bg-gray-100 px-1 rounded">…{peerOrbitDbAddresses.get(selectedPeerId).slice(-5)}</code></span>
  {/if}
</div>
