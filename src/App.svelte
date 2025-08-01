<script>
  import { onMount } from 'svelte'
  import { 
    initializeP2P, 
    addTodo, 
    getAllTodos, 
    updateTodo, 
    deleteTodo, 
    getConnectedPeers, 
    getMyPeerId, 
    onDatabaseUpdate,
    getRelayDiscoveryStatus,
    formatPeerId,
    getTodoDbAddress,
    getTodoDbName,
getPeerOrbitDbAddresses,
    openTodoDatabaseForPeer,
    getCurrentDatabaseInfo
  } from './lib/p2p.js'

  let todos = []
  let inputText = ''
  let assigneeText = ''
  let peers = []
  let myPeerId = null
  let loading = true
  let error = null
  let relayStatus = null
  let showRelayDetails = false
  let toastMessage = '';
  let toastTimeout;
  let dbAddress = null
  let dbName = null
  let selectedPeerId = '';
  let peerOrbitDbAddresses = new Map();
  let cleanupDatabaseListener = null;

  function showToast(message) {
    toastMessage = message;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastMessage = '';
    }, 1500); // Toast visible for 1.5 seconds
  }

  onMount(async () => {
    function updatePeerTransports(peerId, newTransport) {
      const peer = peers.find(p => p.peerId === peerId);
      if (peer) {
        // If the transport does not exist, add it
        if (!peer.transports.includes(newTransport)) {
          peer.transports.push(newTransport);
        }
        // Remove 'circuit-relay' if we have 'webrtc'
        if (newTransport === 'webrtc') {
          peer.transports = peer.transports.filter(type => type !== 'circuit-relay');
        }
        peers = [...peers]; // Trigger reactivity
      }
    }

    // Set up periodic peer transport updates to catch WebRTC upgrades
    let peerUpdateInterval;
    function startPeerTransportMonitoring() {
      peerUpdateInterval = setInterval(async () => {
        const updatedPeers = await getConnectedPeers();
        let hasChanges = false;
        
        // Check if any peer's transports have changed
        for (const updatedPeer of updatedPeers) {
          const existingPeer = peers.find(p => p.peerId === updatedPeer.peerId);
          if (existingPeer) {
            // Compare transport arrays
            const existingTransports = existingPeer.transports.sort().join(',');
            const newTransports = updatedPeer.transports.sort().join(',');
            
            if (existingTransports !== newTransports) {
              console.log(`🔄 Transport change detected for ${formatPeerId(updatedPeer.peerId)}:`, {
                before: existingPeer.transports,
                after: updatedPeer.transports
              });
              hasChanges = true;
            }
          }
        }
        
        if (hasChanges || updatedPeers.length !== peers.length) {
          console.log('🔄 Updating peer list due to transport or connection changes');
          peers = updatedPeers;
        }
      }, 2000); // Check every 2 seconds for transport upgrades
    }
    try {
      await initializeP2P()
      todos = await getAllTodos()
      peers = await getConnectedPeers()
      myPeerId = getMyPeerId()
      dbAddress = getTodoDbAddress()
      dbName = getTodoDbName()
      
      // Subscribe to database updates
      onDatabaseUpdate(async (eventType, eventData) => {
        console.log("eventType",eventType)
        console.log("eventData",eventData)
        // Only refresh for certain event types (optional, but matches +page.svelte)
        if (eventType === 'update'  || !eventType) {
          todos = await getAllTodos()
          peers = await getConnectedPeers()
          dbAddress = getTodoDbAddress()
          dbName = getTodoDbName()
          if (eventType === 'update') {
            if (eventData?.type === 'PUT') {
              showToast('Todo added or updated!');
            } else if (eventData?.type === 'DEL') {
              showToast('Todo deleted!');
            } else {
              showToast('Todo updated!');
            }
          }
        }
      })

      // Listen for peer connect/disconnect events
      function updatePeers() {
        getConnectedPeers().then(p => peers = p)
      }

function handlePeerConnected(e) {
        const peerId = e.detail?.peerId || 'unknown';
        const newTransport = e.detail?.transport || '';
        updatePeerTransports(peerId, newTransport);
        updatePeers();
        console.log("handlePeerConnected",e.detail);
        showToast(`Peer connected: ${formatPeerId(peerId)}`);
      }

      function handlePeerDisconnected(e) {
        updatePeers();
        const peerId = e.detail?.peerId || 'unknown';
        showToast(`Peer disconnected: ${formatPeerId(peerId)}`);
      }

      window.addEventListener('p2p-peer-connected', handlePeerConnected);
      window.addEventListener('p2p-peer-disconnected', handlePeerDisconnected);

      // Listen for OrbitDB address updates
      function handleOrbitDbAddressUpdate(e) {
        console.log('📝 [UI DEBUG] OrbitDB address update event:', e.detail);
        const oldMap = new Map(peerOrbitDbAddresses);
        peerOrbitDbAddresses = getPeerOrbitDbAddresses();
        console.log('📝 [UI DEBUG] Peer OrbitDB map update:', {
          before: Array.from(oldMap.entries()),
          after: Array.from(peerOrbitDbAddresses.entries()),
          size: peerOrbitDbAddresses.size
        });
        const { peerId, topic: dbAddress } = e.detail || {};
        // Only show toast if it's not our own peerId
        if (peerId && peerId !== myPeerId) {
          showToast(`Received OrbitDB address from peer: ${formatPeerId(peerId)}`);
        }
      }
      window.addEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
      // Initial fetch
      peerOrbitDbAddresses = getPeerOrbitDbAddresses();

      // Start periodic peer transport monitoring
      startPeerTransportMonitoring();
      
      loading = false
    } catch (err) {
      error = err.message
      loading = false
    }

    // Clean up on destroy
    return () => {
      if (peerUpdateInterval) {
        clearInterval(peerUpdateInterval);
        console.log('🧹 Cleared peer transport monitoring interval');
      }
      window.removeEventListener('p2p-peer-connected', handlePeerConnected);
      window.removeEventListener('p2p-peer-disconnected', handlePeerDisconnected);
      window.removeEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
    }
  })

  async function handleAddTodo() {
    if (inputText.trim() !== '') {
      try {
        await addTodo(inputText, assigneeText || null)
        inputText = ''
        assigneeText = ''
      } catch (err) {
        error = err.message
      }
    }
  }

  async function handleToggleComplete(id) {
    const todo = todos.find(t => t.id === id)
    if (todo) {
      try {
        await updateTodo(id, { completed: !todo.completed })
      } catch (err) {
        error = err.message
      }
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTodo(id)
    } catch (err) {
      error = err.message
    }
  }

  async function handleAssign(id, peerId) {
    try {
      await updateTodo(id, { assignee: peerId })
    } catch (err) {
      error = err.message
    }
  }

  async function handlePeerDbSwitch() {
    try {
      console.log('🔄 Starting database switch to:', selectedPeerId || 'default');
      
      // Show loading state during switch
      const wasLoading = loading;
      loading = true;
      
      try {
        // Step 1: Switch to the new database
        console.log('📍 Opening database for peer:', selectedPeerId);
        await openTodoDatabaseForPeer(selectedPeerId);
        
        // Step 2: Wait a moment for database to initialize
        console.log('⏳ Waiting for database to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 3: Update database info
        dbAddress = getTodoDbAddress();
        dbName = getTodoDbName();
        console.log('📊 Database info updated:', { address: dbAddress, name: dbName });
        
        // Step 4: Fetch todos from the new database
        console.log('📋 Fetching todos from new database...');
        const newTodos = await getAllTodos();
        todos = newTodos;
        console.log('✅ Loaded', newTodos.length, 'todos from new database');
        
        // Step 5: Update other state
        peers = await getConnectedPeers();
        peerOrbitDbAddresses = getPeerOrbitDbAddresses();
        
        // Step 6: Re-setup database event listeners for reactive updates
        console.log('🔄 Re-setting up database event listeners...');
        if (cleanupDatabaseListener) {
          cleanupDatabaseListener();
        }
        cleanupDatabaseListener = onDatabaseUpdate((eventType, eventData) => {
          console.log('📝 Database update received:', eventType, eventData);
          // Refresh todos when database updates
          getAllTodos().then(refreshedTodos => {
            todos = refreshedTodos;
            console.log('🔄 Todos refreshed after database update:', refreshedTodos.length);
          }).catch(err => {
            console.error('Error refreshing todos after database update:', err);
          });
        });
        
        showToast(selectedPeerId ? 
          `Switched to ${formatPeerId(selectedPeerId)}'s DB (${newTodos.length} todos)` : 
          `Switched to default DB (${newTodos.length} todos)`);
        
        console.log('✅ Database switch completed successfully');
        
      } finally {
        // Always restore loading state
        loading = wasLoading;
      }
      
    } catch (err) {
      console.error('❌ Database switch failed:', err);
      error = err.message;
      loading = false;
    }
  }
</script>

{#if toastMessage}
  <div class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300">
    {toastMessage}
  </div>
{/if}

<svelte:head>
  <title>P2P TODO List {__APP_VERSION__}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="A peer-to-peer TODO list application using OrbitDB and IPFS">
</svelte:head>

<main class="container mx-auto p-6 max-w-4xl">
  <h1 class="text-3xl font-bold mb-6 text-center">P2P TODO List</h1>

  <!-- Peer OrbitDB Selection Dropdown -->
  <div class="mb-6 flex items-center gap-4">
    <label for="peer-db-select" class="font-medium">View TODOs from:</label>
    <select
      id="peer-db-select"
      bind:value={selectedPeerId}
      on:change={handlePeerDbSwitch}
      class="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    >
      <option value="">My DB (default)</option>
      {#each peers as { peerId }}
        <!-- Debug logging in template -->
        {console.log('📝 [DROPDOWN DEBUG] Checking peer:', peerId, 'Has OrbitDB address:', !!peerOrbitDbAddresses.get(peerId), 'Address:', peerOrbitDbAddresses.get(peerId))}
        {#if peerOrbitDbAddresses.get(peerId)}
          <option value={peerId}>
            {formatPeerId(peerId)}... (…{peerOrbitDbAddresses.get(peerId).slice(-5)})
          </option>
        {:else}
          <!-- Show debug option for peers without OrbitDB address -->
          <!-- <option value={peerId} disabled>{formatPeerId(peerId)}... (no OrbitDB address)</option> -->
        {/if}
      {/each}
    </select>
    {#if selectedPeerId && peerOrbitDbAddresses.get(selectedPeerId)}
      <span class="text-xs text-gray-500">OrbitDB: <code class="bg-gray-100 px-1 rounded">…{peerOrbitDbAddresses.get(selectedPeerId).slice(-5)}</code></span>
    {/if}
  </div>

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
  {:else}
    <!-- Add TODO Form -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">Add New TODO</h2>
      <div class="space-y-4">
        <input
          type="text"
          bind:value={inputText}
          placeholder="What needs to be done?"
          class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          on:keydown={(e) => e.key === 'Enter' && handleAddTodo()}
        />
        <div class="flex gap-2">
          <select
            bind:value={assigneeText}
            class="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Assign to...</option>
            {#each peers as { peerId }}
              <option value={peerId}>{formatPeerId(peerId)}...</option>
            {/each}
          </select>
          <button 
            on:click={handleAddTodo} 
            class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-md font-medium transition-colors"
          >
            Add TODO
          </button>
        </div>
      </div>
    </div>

    <!-- TODO List -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">TODO Items ({todos.length})</h2>
      {#if todos.length > 0}
        <div class="space-y-3">
          {#each todos as { id, text, completed, assignee, createdBy }}
            <div class="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
              <div class="flex items-center space-x-3 flex-1">
                <input 
                  type="checkbox" 
                  checked={completed} 
                  on:change={() => handleToggleComplete(id)} 
                  class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <div class="flex-1">
                  <span class={completed ? 'line-through text-gray-500' : 'text-gray-800'}>
                    {text}
                  </span>
                  <div class="text-sm text-gray-500 mt-1">
                    {#if assignee}
                      Assigned to: <code class="bg-gray-100 px-1 rounded">{formatPeerId(assignee)}</code>
                    {:else}
                      <span class="text-orange-600">Unassigned</span>
                    {/if}
                    • Created by: <code class="bg-gray-100 px-1 rounded">{formatPeerId(createdBy)}</code>
                  </div>
                </div>
              </div>
              <div class="flex space-x-2">
                <!-- Assign to connected peers -->
                {#if peers.length > 0}
                  <select 
                    on:change={(e) => handleAssign(id, e.target.value)}
                    class="text-sm border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="">Assign to...</option>
                    {#each peers as { peerId }}
                      <option value={peerId}>{formatPeerId(peerId)}...</option>
                    {/each}
                  </select>
                {/if}
                <button 
                  on:click={() => handleDelete(id)} 
                  class="text-red-500 hover:text-red-700 px-3 py-1 rounded-md transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-gray-500 text-center py-8">No TODOs yet. Add one above!</p>
      {/if}
    </div>

    <!-- P2P Status -->
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

    <!-- Relay Discovery Status (Debug Section) -->
    <div class="bg-white rounded-lg shadow-md p-6 mt-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Relay Discovery Status</h2>
        <button 
          on:click={async () => {
            relayStatus = await getRelayDiscoveryStatus()
            showRelayDetails = !showRelayDetails
          }}
          class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
        >
          {showRelayDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>
      
      {#if showRelayDetails}
        {#if relayStatus}
          <div class="space-y-3">
            <div class="flex items-center space-x-2">
              <div class="w-3 h-3 rounded-full {relayStatus.healthy ? 'bg-green-500' : 'bg-red-500'}"></div>
              <span class="font-medium">Relay Server: {relayStatus.healthy ? 'Healthy' : 'Unhealthy'}</span>
            </div>
            
            <div class="text-sm text-gray-600">
              <p><strong>Cache Status:</strong> 
                {#if relayStatus.cacheValid}
                  <span class="text-green-600">Valid (age: {Math.round(relayStatus.cacheAge / 1000)}s)</span>
                {:else}
                  <span class="text-orange-600">Expired or missing</span>
                {/if}
              </p>
              
              {#if relayStatus.addresses}
                <p class="mt-2"><strong>Available WebRTC Addresses:</strong></p>
                <div class="mt-1 space-y-1">
                  {#if relayStatus.addresses.direct}
                    <div class="bg-green-50 p-2 rounded border-l-4 border-green-400">
                      <code class="text-xs">{relayStatus.addresses.direct}</code>
                      <span class="text-green-600 text-xs ml-2">(Direct WebRTC)</span>
                    </div>
                  {/if}
                  {#if relayStatus.addresses.circuitRelay}
                    <div class="bg-blue-50 p-2 rounded border-l-4 border-blue-400">
                      <code class="text-xs">{relayStatus.addresses.circuitRelay}</code>
                      <span class="text-blue-600 text-xs ml-2">(Circuit Relay)</span>
                    </div>
                  {/if}
                  {#if relayStatus.addresses.websocket}
                    <div class="bg-purple-50 p-2 rounded border-l-4 border-purple-400">
                      <code class="text-xs">{relayStatus.addresses.websocket}</code>
                      <span class="text-purple-600 text-xs ml-2">(WebSocket)</span>
                    </div>
                  {/if}
                </div>
              {:else}
                <p class="text-red-600">No cached addresses available</p>
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
    {/if}
  </main>

<footer class="mt-10 text-center text-xs text-gray-500 space-y-1">
  <div class="font-medium text-gray-600">
    P2P TODO List v{__APP_VERSION__}
  </div>
  {#if dbAddress}
    <div>
      <strong>OrbitDB Address:</strong>
      <code class="bg-gray-100 px-1 rounded">{dbAddress}</code>
    </div>
  {/if}
  {#if dbName}
    <div>
      <strong>DB Name:</strong>
      <code class="bg-gray-100 px-1 rounded">{dbName}</code>
    </div>
  {/if}
</footer>
