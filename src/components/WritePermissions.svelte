<script>
  import { formatPeerId } from '../lib/p2p.js';
  
  export let showWritePermissions;
  export let canWriteToCurrentDB;
  export let dbAddress;
  export let selectedPeerId;
  export let writePermissionRequests;
  export let outgoingWritePermissionRequests;
  export let onToggleShow;
  export let onRequestWritePermission;
  export let onGrantWritePermission;
  export let onDenyWritePermission;
</script>

<div class="bg-white rounded-lg shadow-md p-6 mt-6">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-xl font-semibold">Write Permissions</h2>
    <button 
      on:click={onToggleShow}
      class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
    >
      {showWritePermissions ? 'Hide Permissions' : 'Show Permissions'}
    </button>
  </div>
  
  {#if showWritePermissions}
    <div class="space-y-6">
      <!-- Write Permission Status -->
      <div class="bg-gray-50 p-4 rounded-md">
        <div class="flex items-center space-x-2 mb-2">
          <div class="w-3 h-3 rounded-full {canWriteToCurrentDB ? 'bg-green-500' : 'bg-red-500'}"></div>
          <span class="font-medium">
            {canWriteToCurrentDB ? 'You can write to this database' : 'You cannot write to this database'}
          </span>
        </div>
        <p class="text-sm text-gray-600">
          Current database: <code class="bg-white px-1 rounded">{dbAddress || 'Loading...'}</code>
        </p>
        {#if selectedPeerId && !canWriteToCurrentDB}
          <button 
            on:click={() => onRequestWritePermission(selectedPeerId)}
            class="mt-2 text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md transition-colors"
          >
            Request Write Permission from {formatPeerId(selectedPeerId)}
          </button>
        {/if}
      </div>

      <!-- Incoming Permission Requests -->
      <div>
        <h3 class="text-lg font-medium mb-3">Incoming Requests ({writePermissionRequests.length})</h3>
        {#if writePermissionRequests.length > 0}
          <div class="space-y-3">
            {#each writePermissionRequests as request}
              <div class="border border-gray-200 p-3 rounded-md">
                <div class="flex items-center justify-between">
                  <div class="flex-1">
                    <div class="flex items-center space-x-2 mb-1">
                      <span class="font-medium text-sm">From: {formatPeerId(request.requesterPeerId)}</span>
                      <span class="text-xs px-2 py-1 rounded-full {request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : request.status === 'granted' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        {request.status}
                      </span>
                    </div>
                    <p class="text-sm text-gray-600 mb-1">{request.reason}</p>
                    <p class="text-xs text-gray-500">
                      Requested: {new Date(request.requestedAt).toLocaleString()}
                    </p>
                  </div>
                  {#if request.status === 'pending'}
                    <div class="flex space-x-2">
                      <button 
                        on:click={() => onGrantWritePermission(request.id)}
                        class="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-md transition-colors"
                      >
                        Grant
                      </button>
                      <button 
                        on:click={() => onDenyWritePermission(request.id, 'Declined by user')}
                        class="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md transition-colors"
                      >
                        Deny
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-gray-500 text-sm">No incoming permission requests</p>
        {/if}
      </div>

      <!-- Outgoing Permission Requests -->
      <div>
        <h3 class="text-lg font-medium mb-3">My Requests ({outgoingWritePermissionRequests.length})</h3>
        {#if outgoingWritePermissionRequests.length > 0}
          <div class="space-y-3">
            {#each outgoingWritePermissionRequests as request}
              <div class="border border-gray-200 p-3 rounded-md">
                <div class="flex items-center justify-between">
                  <div class="flex-1">
                    <div class="flex items-center space-x-2 mb-1">
                      <span class="font-medium text-sm">To: {formatPeerId(request.targetPeerID)}</span>
                      <span class="text-xs px-2 py-1 rounded-full {request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : request.status === 'granted' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        {request.status}
                      </span>
                    </div>
                    <p class="text-sm text-gray-600 mb-1">{request.reason}</p>
                    <p class="text-xs text-gray-500">
                      Requested: {new Date(request.requestedAt).toLocaleString()}
                      {#if request.status === 'granted' && request.grantedAt}
                        | Granted: {new Date(request.grantedAt).toLocaleString()}
                      {:else if request.status === 'denied' && request.deniedAt}
                        | Denied: {new Date(request.deniedAt).toLocaleString()}
                      {/if}
                    </p>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-gray-500 text-sm">No outgoing permission requests</p>
        {/if}
      </div>
    </div>
  {:else}
    <p class="text-sm text-gray-500">Manage write permissions for peer databases. Click "Show Permissions" to view requests.</p>
  {/if}
</div>
