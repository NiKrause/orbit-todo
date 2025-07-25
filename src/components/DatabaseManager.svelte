<script>
  export let showDatabaseDetails;
  export let browserDatabases;
  export let viewingDatabase;
  export let databaseContents;
  export let onRefreshDatabases;
  export let onToggleShow;
  export let onViewDatabaseContents;
  export let onDeleteSingleDatabase;
  export let onDeleteAllDatabases;
</script>

<div class="bg-white rounded-lg shadow-md p-6 mt-6">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center space-x-2">
      <h2 class="text-xl font-semibold">Database Manager</h2>
      {#if browserDatabases.length > 0}
        <span class="bg-blue-100 text-blue-800 text-sm px-2 py-1 rounded-full">
          {browserDatabases.length} database{browserDatabases.length !== 1 ? 's' : ''}
        </span>
      {/if}
    </div>
    <div class="flex space-x-2">
      <button 
        on:click={onRefreshDatabases}
        class="text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded-md transition-colors"
      >
        Refresh
      </button>
      <button 
        on:click={onToggleShow}
        class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
      >
        {showDatabaseDetails ? 'Hide Databases' : 'Show Databases'}
      </button>
    </div>
  </div>
  
  {#if showDatabaseDetails}
    {#if browserDatabases.length > 0}
      <div class="space-y-4">
        <!-- Database List -->
        <div class="space-y-3">
          {#each browserDatabases as db}
            <div class="border rounded-lg p-4 {db.isActive ? 
              (db.activeType === 'orbitdb' ? 'border-green-300 bg-green-50' : 
               db.activeType === 'helia' ? 'border-blue-300 bg-blue-50' : 
               'border-purple-300 bg-purple-50') : 'border-gray-200'}">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center space-x-3">
                  <div class="w-3 h-3 rounded-full {db.isActive ? 
                    (db.activeType === 'orbitdb' ? 'bg-green-500' : 
                     db.activeType === 'helia' ? 'bg-blue-500' : 
                     'bg-purple-500') : 'bg-gray-400'}"></div>
                  <div>
                    <div class="flex items-center space-x-2">
                      <h3 class="font-medium text-lg">{db.name}</h3>
                      {#if db.isActive}
                        <span class="text-xs px-2 py-1 rounded-full font-medium {db.activeType === 'orbitdb' ? 'bg-green-200 text-green-800' : 
                          db.activeType === 'helia' ? 'bg-blue-200 text-blue-800' : 
                          'bg-purple-200 text-purple-800'}">
                          ✨ ACTIVE {db.activeType.toUpperCase()}
                        </span>
                      {/if}
                    </div>
                    <div class="text-sm text-gray-500 space-y-1">
                      <div class="flex items-center space-x-4">
                        <span>Version: {db.version}</span>
                        {#if db.totalRecords !== undefined}
                          <span>Records: {db.totalRecords.toLocaleString()}</span>
                        {/if}
                        {#if db.storeNames && db.storeNames.length > 0}
                          <span>Stores: {db.storeNames.length}</span>
                        {/if}
                        {#if db.isKeystore}
                          <span class="text-yellow-600 font-medium">🔑 KEYSTORE</span>
                        {/if}
                      </div>
                      {#if db.lastAccessed}
                        <div class="text-xs text-gray-400">
                          Last accessed: {new Date(db.lastAccessed).toLocaleString()}
                        </div>
                      {:else}
                        <div class="text-xs text-gray-400">
                          Last accessed: Unknown
                        </div>
                      {/if}
                      
                      {#if db.isKeystore && db.keystoreKeys && db.keystoreKeys.length > 0}
                        <div class="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                          <div class="font-medium text-yellow-800 mb-1">Keystore Contents:</div>
                          {#each db.keystoreKeys as keystore}
                            <div class="mb-2">
                              <div class="font-medium text-yellow-700">Store: {keystore.storeName}</div>
                              <div class="text-yellow-600">Keys: {keystore.keyCount}</div>
                              
                              {#if keystore.keys && keystore.keys.length > 0}
                                <div class="mt-1">
                                  <div class="text-yellow-700 font-medium">Key IDs:</div>
                                  <div class="text-yellow-600 break-all">
                                    {keystore.keys.slice(0, 3).join(', ')}
                                    {#if keystore.keys.length > 3}
                                      ... and {keystore.keys.length - 3} more
                                    {/if}
                                  </div>
                                </div>
                              {/if}
                              
                              {#if keystore.sampleRecords && keystore.sampleRecords.length > 0}
                                <div class="mt-1">
                                  <div class="text-yellow-700 font-medium">Sample Records:</div>
                                  {#each keystore.sampleRecords.slice(0, 2) as record}
                                    <div class="text-yellow-600 text-xs bg-yellow-100 p-1 rounded mt-1">
                                      {#if record.id}
                                        <strong>ID:</strong> {record.id}<br>
                                      {/if}
                                      {#if record.name}
                                        <strong>Name:</strong> {record.name}<br>
                                      {/if}
                                      {#if record.keyType}
                                        <strong>Type:</strong> {record.keyType}<br>
                                      {/if}
                                      {#if record.algorithm}
                                        <strong>Algorithm:</strong> {record.algorithm}<br>
                                      {/if}
                                      {#if record.hasPublicKey}
                                        <strong>Has Public Key:</strong> Yes<br>
                                      {/if}
                                      {#if record.hasPrivateKey}
                                        <strong>Has Private Key:</strong> Yes<br>
                                      {/if}
                                      {#if record.usages}
                                        <strong>Usages:</strong> {JSON.stringify(record.usages)}<br>
                                      {/if}
                                      {#if record.dataLength}
                                        <strong>Data Length:</strong> {record.dataLength} bytes<br>
                                      {/if}
                                      {#if record.value}
                                        <strong>Value:</strong> {record.value}<br>
                                      {/if}
                                    </div>
                                  {/each}
                                  {#if keystore.sampleRecords.length > 2}
                                    <div class="text-yellow-600 text-xs mt-1">
                                      ... and {keystore.sampleRecords.length - 2} more records
                                    </div>
                                  {/if}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {:else if db.isKeystore}
                        <div class="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-600">
                          🔑 This is a keystore database, but no key data could be extracted.
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>
                <div class="flex space-x-2">
                  <button 
                    on:click={() => onViewDatabaseContents(db.name)}
                    class="text-sm bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1 rounded-md transition-colors"
                  >
                    View Contents
                  </button>
                  <button 
                    on:click={() => onDeleteSingleDatabase(db.name)}
                    class="text-sm bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded-md transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              <!-- Database Contents (if viewing) -->
              {#if viewingDatabase === db.name && databaseContents[db.name]}
                <div class="mt-3 p-3 bg-gray-50 rounded-md">
                  <h4 class="font-medium text-sm mb-2">Object Stores:</h4>
                  {#each databaseContents[db.name] as store}
                    <div class="mb-3 p-2 bg-white rounded">
                      <div class="flex items-center justify-between mb-1">
                        <span class="font-medium text-sm">{store.name}</span>
                        <span class="text-xs text-gray-500">{store.count} records</span>
                      </div>
                      {#if store.records && store.records.length > 0}
                        <div class="text-xs bg-gray-100 p-2 rounded max-h-32 overflow-y-auto">
                          <pre class="whitespace-pre-wrap">{JSON.stringify(store.records.slice(0, 5), null, 2)}</pre>
                          {#if store.records.length > 5}
                            <p class="text-gray-500 mt-1">... and {store.records.length - 5} more records</p>
                          {/if}
                        </div>
                      {:else}
                        <p class="text-xs text-gray-500">No records found</p>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        
        <!-- Bulk Actions -->
        <div class="border-t pt-4">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-600">Found {browserDatabases.length} database(s)</span>
            <button 
              on:click={onDeleteAllDatabases}
              class="text-sm bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md transition-colors"
            >
              Delete All Databases
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="text-center py-8">
        <p class="text-gray-500">No Libp2p/IPFS/OrbitDB databases found</p>
        <p class="text-xs text-gray-400 mt-2">Databases appear here when you use the P2P features</p>
      </div>
    {/if}
  {:else}
    <p class="text-sm text-gray-500">Manage IndexedDB databases created by Libp2p, Helia, and OrbitDB. Click "Show Databases" to view and manage them.</p>
  {/if}
</div>
