<script>
  export let showDatabaseDetails;
  export let browserDatabases;
  export let viewingDatabase;
  export let databaseContents;
  export let storageUsage;
  export let formatBytes;
  export let onRefreshDatabases;
  export let onToggleShow;
  export let onViewDatabaseContents;
  export let onDeleteSingleDatabase;
  export let onDeleteAllDatabases;
  export let onDeleteAllInactiveDatabases;
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
  
  <!-- Storage Usage Summary -->
  {#if storageUsage && showDatabaseDetails}
    <div class="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
      <h3 class="text-lg font-semibold text-blue-900 mb-3">💾 Storage Usage Summary</h3>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Overall Storage -->
        <div class="bg-white p-3 rounded-lg border">
          <h4 class="font-medium text-gray-800 mb-2">Overall Browser Storage</h4>
          <div class="text-sm space-y-1">
            <div class="flex justify-between">
              <span class="text-gray-600">Used:</span>
              <span class="font-mono">{formatBytes ? formatBytes(storageUsage.used) : '0 Bytes'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Quota:</span>
              <span class="font-mono">{formatBytes ? formatBytes(storageUsage.quota) : 'Unknown'}</span>
            </div>
            {#if storageUsage.quota > 0}
              <div class="mt-2">
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    class="bg-blue-500 h-2 rounded-full" 
                    style="width: {Math.min(100, (storageUsage.used / storageUsage.quota) * 100)}%"
                  ></div>
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  {((storageUsage.used / storageUsage.quota) * 100).toFixed(1)}% used
                </div>
              </div>
            {/if}
          </div>
        </div>
        
        <!-- P2P Database Storage -->
        <div class="bg-white p-3 rounded-lg border">
          <h4 class="font-medium text-gray-800 mb-2">P2P Database Storage</h4>
          <div class="text-sm space-y-1">
            <div class="flex justify-between">
              <span class="text-gray-600">Total Size:</span>
              <span class="font-mono font-semibold">{formatBytes ? formatBytes(storageUsage.p2pDatabases.totalSize) : '0 Bytes'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Active DBs:</span>
              <span class="font-mono text-green-600">{formatBytes ? formatBytes(storageUsage.p2pDatabases.activeDatabasesSize) : '0 Bytes'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Inactive DBs:</span>
              <span class="font-mono text-orange-600">{formatBytes ? formatBytes(storageUsage.p2pDatabases.inactiveDatabasesSize) : '0 Bytes'}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Database Type Breakdown -->
      <div class="mt-4 bg-white p-3 rounded-lg border">
        <h4 class="font-medium text-gray-800 mb-2">📊 Storage by Database Type</h4>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div class="text-center p-2 bg-green-50 rounded border">
            <div class="text-green-700 font-semibold">OrbitDB</div>
            <div class="text-xs text-green-600">{storageUsage.p2pDatabases.byType.orbitdb.count} database{storageUsage.p2pDatabases.byType.orbitdb.count !== 1 ? 's' : ''}</div>
            <div class="font-mono text-green-800">{formatBytes ? formatBytes(storageUsage.p2pDatabases.byType.orbitdb.size) : '0 Bytes'}</div>
          </div>
          <div class="text-center p-2 bg-blue-50 rounded border">
            <div class="text-blue-700 font-semibold">Helia/IPFS</div>
            <div class="text-xs text-blue-600">{storageUsage.p2pDatabases.byType.helia.count} database{storageUsage.p2pDatabases.byType.helia.count !== 1 ? 's' : ''}</div>
            <div class="font-mono text-blue-800">{formatBytes ? formatBytes(storageUsage.p2pDatabases.byType.helia.size) : '0 Bytes'}</div>
          </div>
          <div class="text-center p-2 bg-purple-50 rounded border">
            <div class="text-purple-700 font-semibold">Libp2p</div>
            <div class="text-xs text-purple-600">{storageUsage.p2pDatabases.byType.libp2p.count} database{storageUsage.p2pDatabases.byType.libp2p.count !== 1 ? 's' : ''}</div>
            <div class="font-mono text-purple-800">{formatBytes ? formatBytes(storageUsage.p2pDatabases.byType.libp2p.size) : '0 Bytes'}</div>
          </div>
          <div class="text-center p-2 bg-gray-50 rounded border">
            <div class="text-gray-700 font-semibold">Other</div>
            <div class="text-xs text-gray-600">{storageUsage.p2pDatabases.byType.other.count} database{storageUsage.p2pDatabases.byType.other.count !== 1 ? 's' : ''}</div>
            <div class="font-mono text-gray-800">{formatBytes ? formatBytes(storageUsage.p2pDatabases.byType.other.size) : '0 Bytes'}</div>
          </div>
        </div>
      </div>
    </div>
  {/if}
  
  {#if showDatabaseDetails}
    {#if browserDatabases.length > 0}
      <!-- Database Summary and Bulk Actions -->
      <div class="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div class="flex items-center justify-between">
          <div class="text-sm text-gray-600">
            <span class="font-semibold text-gray-800">Found {browserDatabases.length} database(s)</span>
            <div class="text-xs text-gray-500 mt-1">
              {browserDatabases.filter(db => db.isActive).length} active • 
              {browserDatabases.filter(db => !db.isActive).length} inactive
              {#if storageUsage && formatBytes}
                • Total: {formatBytes(storageUsage.p2pDatabases.totalSize)}
              {/if}
            </div>
          </div>
          <div class="flex space-x-2">
            {#if browserDatabases.filter(db => !db.isActive).length > 0}
              <button 
                on:click={onDeleteAllInactiveDatabases}
                class="text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-md transition-colors"
              >
                Delete All Inactive ({browserDatabases.filter(db => !db.isActive).length})
              </button>
            {/if}
            <button 
              on:click={onDeleteAllDatabases}
              class="text-sm bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md transition-colors"
            >
              Delete All Databases
            </button>
          </div>
        </div>
      </div>
      
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
                        {#if db.estimatedSize !== undefined && formatBytes}
                          <span class="font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            📦 {formatBytes(db.estimatedSize)}
                          </span>
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
