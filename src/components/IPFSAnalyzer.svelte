<script>
  import { CID } from 'multiformats/cid';
  export let showIPFSDetails;
  export let ipfsAnalysis;
  export let formatBytes;
  export let formatPeerId;
  export let onRefreshIPFSAnalysis;
  export let onToggleShow;
  
  // Pin content inspection state
  let selectedPin = null;
  let showPinModal = false;
  let pinContent = null;
  let loadingPinContent = false;
  let pinContentError = null;
  
  // Function to inspect pin content
  async function inspectPinContent(pin) {
    selectedPin = pin;
    showPinModal = true;
    loadingPinContent = true;
    pinContent = null;
    pinContentError = null;
    
    try {
      console.log(`🔍 Inspecting content for pin:`, pin);
      
      // Get Helia instance
      const { getHelia } = await import('../lib/p2p/network.js');
      const helia = getHelia();
      
      if (!helia) {
        throw new Error('Helia instance not available');
      }
      
      // Log basic pin info for debugging
      console.log(`🔗 Processing pin CID:`, typeof pin.cid === 'string' ? pin.cid : pin.cid?.toString?.());
      
      // Try to get a proper CID object
      let cidToUse;
      
      // If it's already a string, parse it
      if (typeof pin.cid === 'string') {
        cidToUse = CID.parse(pin.cid);
        console.log(`✅ Parsed CID from string:`, cidToUse);
      } else if (pin.cid && typeof pin.cid.toString === 'function') {
        // If it's an object with toString, convert and parse
        const cidString = pin.cid.toString();
        cidToUse = CID.parse(cidString);
        console.log(`✅ Converted to string and parsed:`, cidToUse);
      } else {
        // Use the CID object directly if it's already a proper CID
        cidToUse = pin.cid;
        console.log(`⚠️ Using CID object directly:`, cidToUse);
      }
      
      console.log(`📦 Getting block for CID:`, cidToUse);
      
      // Get the block content with error handling
      let block;
      try {
        block = await helia.blockstore.get(cidToUse);
        console.log(`📦 Block retrieved:`, {
          block,
          type: typeof block,
          constructor: block?.constructor?.name,
          hasBytes: 'bytes' in (block || {}),
          keys: block ? Object.keys(block) : 'null',
          blockType: block instanceof Uint8Array ? 'Uint8Array' : 'other'
        });
      } catch (blockErr) {
        console.error(`❌ Blockstore.get failed:`, blockErr);
        
        // Try alternative approaches
        if (typeof cidToUse.toString === 'function') {
          const cidString = cidToUse.toString();
          console.log(`🔄 Retrying with CID string: ${cidString}`);
          
          try {
            const freshCid = CID.parse(cidString);
            block = await helia.blockstore.get(freshCid);
            console.log(`✅ Retry with fresh CID succeeded`);
          } catch (retryErr) {
            console.error(`❌ Retry also failed:`, retryErr);
            throw new Error(`Could not retrieve block for CID ${cidString}: ${retryErr.message}`);
          }
        } else {
          throw new Error(`Could not retrieve block: ${blockErr.message}`);
        }
      }
      
      // Handle different block formats
      let rawBytes;
      if (block instanceof Uint8Array) {
        // Block is directly a Uint8Array
        rawBytes = block;
        console.log(`📦 Block is Uint8Array: ${rawBytes.length} bytes`);
      } else if (block && block.bytes) {
        // Block has a bytes property
        rawBytes = block.bytes;
        console.log(`📦 Block has bytes property: ${rawBytes.length} bytes`);
      } else {
        console.error(`❌ Unexpected block format:`, block);
        throw new Error('Block retrieval failed - unexpected format returned');
      }
      
      // Try to decode the content in various formats
      const contentInfo = {
        cid: pin.cid,
        size: rawBytes.length,
        type: pin.type,
        formats: []
      };
      
      // 1. Try as UTF-8 text
      try {
        const textDecoder = new TextDecoder('utf-8', { fatal: true });
        const textContent = textDecoder.decode(rawBytes);
        
        // Check if it looks like valid text (printable characters)
        const isPrintableText = /^[\x20-\x7E\s\n\r\t]*$/.test(textContent.substring(0, 1000));
        
        if (isPrintableText && textContent.length > 0) {
          contentInfo.formats.push({
            name: 'Text (UTF-8)',
            content: textContent,
            preview: textContent.length > 500 ? textContent.substring(0, 500) + '...' : textContent,
            fullContent: textContent
          });
        }
      } catch (e) {
        // Not valid UTF-8 text
      }
      
      // 2. Try as JSON
      try {
        const textDecoder = new TextDecoder('utf-8');
        const textContent = textDecoder.decode(rawBytes);
        const jsonData = JSON.parse(textContent);
        
        contentInfo.formats.push({
          name: 'JSON',
          content: jsonData,
          preview: JSON.stringify(jsonData, null, 2).substring(0, 500) + (JSON.stringify(jsonData).length > 500 ? '...' : ''),
          fullContent: JSON.stringify(jsonData, null, 2)
        });
      } catch (e) {
        // Not valid JSON
      }
      
      // 3. Try as OrbitDB CBOR (manifests and log entries)
      try {
        // Import dependencies exactly like OrbitDB does
        const Block = await import('multiformats/block');
        const dagCbor = await import('@ipld/dag-cbor');
        const { sha256 } = await import('multiformats/hashes/sha2');
        
        // Use the exact same pattern as OrbitDB: Block.decode (not Block.default.decode)
        const { value: decodedValue } = await Block.decode({ 
          bytes: rawBytes, 
          codec: dagCbor, 
          hasher: sha256 
        });
        
        console.log('🔍 Decoded CBOR value:', decodedValue);
        
        // Check if it's an OrbitDB manifest
        if (decodedValue && typeof decodedValue === 'object' && 
            decodedValue.name && decodedValue.type && decodedValue.accessController) {
          contentInfo.formats.push({
            name: 'OrbitDB Manifest',
            content: decodedValue,
            preview: `OrbitDB Database: ${decodedValue.name} (${decodedValue.type})`,
            fullContent: `OrbitDB Manifest:\n\nName: ${decodedValue.name}\nType: ${decodedValue.type}\nAccess Controller: ${JSON.stringify(decodedValue.accessController, null, 2)}\n\n${decodedValue.meta ? 'Metadata: ' + JSON.stringify(decodedValue.meta, null, 2) : 'No metadata'}`
          });
        }
        // Check if it's an OrbitDB log entry
        else if (decodedValue && typeof decodedValue === 'object' && 
                 decodedValue.id && decodedValue.payload !== undefined && 
                 decodedValue.clock && decodedValue.v !== undefined) {
          contentInfo.formats.push({
            name: 'OrbitDB Log Entry',
            content: decodedValue,
            preview: `Log Entry ID: ${decodedValue.id}, Clock: ${decodedValue.clock?.time || 'N/A'}`,
            fullContent: `OrbitDB Log Entry:\n\nID: ${decodedValue.id}\nPayload: ${JSON.stringify(decodedValue.payload, null, 2)}\nClock: ${JSON.stringify(decodedValue.clock, null, 2)}\nVersion: ${decodedValue.v}\nNext: ${JSON.stringify(decodedValue.next || [])}\nRefs: ${JSON.stringify(decodedValue.refs || [])}\n\n${decodedValue.key ? 'Public Key: ' + decodedValue.key : ''}\n${decodedValue.identity ? 'Identity: ' + decodedValue.identity : ''}\n${decodedValue.sig ? 'Signature: ' + decodedValue.sig : ''}`
          });
        }
        // Generic CBOR data
        else {
          contentInfo.formats.push({
            name: 'CBOR Data',
            content: decodedValue,
            preview: `CBOR object with ${Object.keys(decodedValue || {}).length} properties`,
            fullContent: JSON.stringify(decodedValue, null, 2)
          });
        }
      } catch (e) {
        console.log('⚠️ Not valid CBOR or failed to decode:', e.message);
        // Try simple CBOR detection fallback
        if (rawBytes[0] >= 0x80 && rawBytes[0] <= 0xbf) {
          contentInfo.formats.push({
            name: 'CBOR (Binary)',
            content: 'Binary CBOR data - could not decode',
            preview: `CBOR data (${rawBytes.length} bytes) - decoding failed`,
            fullContent: `Error decoding CBOR: ${e.message}\n\nRaw hex data:\n${Array.from(rawBytes.slice(0, 100)).map(byte => byte.toString(16).padStart(2, '0')).join(' ')}${rawBytes.length > 100 ? '...' : ''}`
          });
        }
      }
      
      // 4. Always provide hex dump
      const hexDump = Array.from(rawBytes.slice(0, 256))
        .map((byte, index) => {
          if (index % 16 === 0) {
            return '\n' + index.toString(16).padStart(4, '0') + ': ' + byte.toString(16).padStart(2, '0');
          }
          return byte.toString(16).padStart(2, '0');
        })
        .join(' ') + (rawBytes.length > 256 ? '\n... (truncated)' : '');
      
      contentInfo.formats.push({
        name: 'Hex Dump',
        content: hexDump,
        preview: `Hex dump (first ${Math.min(256, rawBytes.length)} bytes)`,
        fullContent: hexDump
      });
      
      // 5. Try to detect if it's a DAG node (for recursive pins)
      if (pin.type === 'recursive') {
        try {
          // Try to interpret as UnixFS or DAG-PB
          contentInfo.formats.push({
            name: 'DAG Structure',
            content: `Recursive pin - may contain linked blocks`,
            preview: `This is a recursive pin that may reference other blocks in a DAG structure.`,
            fullContent: `Pin Type: Recursive\nCID: ${pin.cid}\nSize: ${rawBytes.length} bytes\n\nThis content may be part of a larger Directed Acyclic Graph (DAG) structure.\nUse IPFS tools to explore the full DAG.`
          });
        } catch (e) {
          // Failed to interpret as DAG
        }
      }
      
      // If no readable formats found, just show raw binary info
      if (contentInfo.formats.length === 1) { // Only hex dump
        contentInfo.formats.unshift({
          name: 'Binary Data',
          content: `Binary data (${rawBytes.length} bytes)`,
          preview: `This appears to be binary data. ${rawBytes.length} bytes total.`,
          fullContent: `Binary content: ${rawBytes.length} bytes\n\nFirst few bytes:\n${Array.from(rawBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`
        });
      }
      
      pinContent = contentInfo;
      console.log(`✅ Content inspection complete:`, contentInfo);
      
    } catch (error) {
      console.error(`❌ Error inspecting pin content:`, error);
      pinContentError = error.message;
    } finally {
      loadingPinContent = false;
    }
  }
  
  function closePinModal() {
    showPinModal = false;
    selectedPin = null;
    pinContent = null;
    pinContentError = null;
  }
  
  // Handle modal backdrop click
  function handleModalBackdrop(event) {
    if (event.target === event.currentTarget) {
      closePinModal();
    }
  }
</script>

<div class="bg-white rounded-lg shadow-md p-6 mt-6">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center space-x-2">
      <h2 class="text-xl font-semibold">IPFS & OrbitDB Analysis</h2>
      {#if ipfsAnalysis && ipfsAnalysis.summary}
        <span class="bg-purple-100 text-purple-800 text-sm px-2 py-1 rounded-full">
          {ipfsAnalysis.summary.totalPins} pins • {formatBytes ? formatBytes(ipfsAnalysis.summary.totalSize) : '0 Bytes'}
        </span>
      {/if}
    </div>
    <div class="flex space-x-2">
      <button 
        on:click={onRefreshIPFSAnalysis}
        class="text-sm bg-purple-100 hover:bg-purple-200 text-purple-800 px-3 py-1 rounded-md transition-colors"
      >
        Analyze
      </button>
      <button 
        on:click={onToggleShow}
        class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
      >
        {showIPFSDetails ? 'Hide Analysis' : 'Show Analysis'}
      </button>
    </div>
  </div>
  
  {#if showIPFSDetails}
    {#if ipfsAnalysis && ipfsAnalysis.summary}
      <!-- Summary Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <!-- Pinned Content Summary -->
        <div class="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg border border-purple-200">
          <h3 class="font-semibold text-purple-900 mb-2">📌 Pinned Content</h3>
          <div class="space-y-1 text-sm">
            <div class="flex justify-between">
              <span>Total Pins:</span>
              <span class="font-mono">{ipfsAnalysis.summary.totalPins}</span>
            </div>
            <div class="flex justify-between">
              <span>Total Size:</span>
              <span class="font-mono font-semibold">{formatBytes ? formatBytes(ipfsAnalysis.summary.totalSize) : ipfsAnalysis.summary.totalSize + ' Bytes'}</span>
            </div>
            <div class="flex justify-between">
              <span>Recursive Pins:</span>
              <span class="font-mono">{ipfsAnalysis.summary.recursivePins}</span>
            </div>
            <div class="flex justify-between">
              <span>Direct Pins:</span>
              <span class="font-mono">{ipfsAnalysis.summary.directPins}</span>
            </div>
          </div>
        </div>

        <!-- OrbitDB Info -->
        <div class="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
          <h3 class="font-semibold text-green-900 mb-2">🌍 OrbitDB Info</h3>
          <div class="space-y-1 text-sm">
            <div class="flex justify-between">
              <span>Active DBs:</span>
              <span class="font-mono">{ipfsAnalysis.summary.orbitDatabases}</span>
            </div>
            <div class="flex justify-between">
              <span>Own DBs:</span>
              <span class="font-mono text-green-600">{ipfsAnalysis.summary.ownDatabases}</span>
            </div>
            <div class="flex justify-between">
              <span>Peer DBs:</span>
              <span class="font-mono text-orange-600">{ipfsAnalysis.summary.peerDatabases}</span>
            </div>
            <div class="flex justify-between">
              <span>DB Size:</span>
              <span class="font-mono font-semibold">{formatBytes ? formatBytes(ipfsAnalysis.summary.orbitDbSize) : '0 Bytes'}</span>
            </div>
          </div>
        </div>

        <!-- Identity Info -->
        <div class="bg-gradient-to-r from-blue-50 to-cyan-50 p-4 rounded-lg border border-blue-200">
          <h3 class="font-semibold text-blue-900 mb-2">🔑 Identity Info</h3>
          <div class="space-y-1 text-sm">
            {#if ipfsAnalysis.identity}
              <div class="flex justify-between">
                <span>Peer ID:</span>
                <span class="font-mono text-blue-600">{formatPeerId ? formatPeerId(ipfsAnalysis.identity.peerId) : ipfsAnalysis.identity.peerId}</span>
              </div>
              <div class="flex justify-between">
                <span>Public Key:</span>
                <span class="font-mono text-xs">{ipfsAnalysis.identity.publicKey ? ipfsAnalysis.identity.publicKey.substring(0, 12) + '...' : 'N/A'}</span>
              </div>
              <div class="flex justify-between">
                <span>Key Type:</span>
                <span class="font-mono">{ipfsAnalysis.identity.keyType || 'Unknown'}</span>
              </div>
            {:else}
              <div class="text-gray-500 text-center">No identity info available</div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Pinned CIDs List -->
      {#if ipfsAnalysis.pins && ipfsAnalysis.pins.length > 0}
        <div class="mb-6">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">📎 Pinned Content Details</h3>
          <div class="space-y-2 max-h-64 overflow-y-auto">
            {#each ipfsAnalysis.pins.slice(0, 20) as pin}
              <div class="border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors" on:click={() => inspectPinContent(pin)}>
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center space-x-2">
                    <span class="text-xs px-2 py-1 rounded-full {pin.type === 'recursive' ? 'bg-purple-200 text-purple-800' : 'bg-blue-200 text-blue-800'}">
                      {pin.type}
                    </span>
                    <span class="font-mono text-sm text-gray-600">{typeof pin.cid === 'string' ? pin.cid.substring(0, 20) : pin.cid.toString().substring(0, 20)}...</span>
                    <span class="text-xs text-blue-500 opacity-75">👁️ Click to inspect</span>
                  </div>
                  <div class="text-sm font-semibold">
                    {formatBytes ? formatBytes(pin.size || 0) : '0 Bytes'}
                  </div>
                </div>
                {#if pin.metadata}
                  <div class="text-xs text-gray-500 space-y-1">
                    {#if pin.metadata.isOrbitDB}
                      <div class="text-green-600">🌍 OrbitDB Database</div>
                      {#if pin.metadata.dbType}
                        <div>Type: {pin.metadata.dbType}</div>
                      {/if}
                      {#if pin.metadata.dbName}
                        <div>Name: {pin.metadata.dbName}</div>
                      {/if}
                    {/if}
                    {#if pin.metadata.blocks}
                      <div>Blocks: {pin.metadata.blocks}</div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
            {#if ipfsAnalysis.pins.length > 20}
              <div class="text-center text-gray-500 text-sm">
                ... and {ipfsAnalysis.pins.length - 20} more pins
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- OrbitDB Details -->
      {#if ipfsAnalysis.orbitDatabases && ipfsAnalysis.orbitDatabases.length > 0}
        <div class="mb-6">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">🗄️ OrbitDB Database Details</h3>
          <div class="space-y-3">
            {#each ipfsAnalysis.orbitDatabases as db}
              <div class="border rounded-lg p-4 {db.isOwn ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'}">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center space-x-2">
                    <span class="text-xs px-2 py-1 rounded-full {db.isOwn ? 'bg-green-200 text-green-800' : 'bg-orange-200 text-orange-800'}">
                      {db.isOwn ? '👤 Own DB' : '🌐 Peer DB'}
                    </span>
                    <h4 class="font-medium">{db.name || 'Unnamed Database'}</h4>
                  </div>
                  <div class="text-sm font-semibold">
                    {formatBytes ? formatBytes(db.size || 0) : '0 Bytes'}
                  </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <div class="text-gray-600">Address:</div>
                    <div class="font-mono text-xs break-all">{db.address}</div>
                  </div>
                  <div>
                    <div class="text-gray-600">Type:</div>
                    <div class="font-mono">{db.type || 'Unknown'}</div>
                  </div>
                  {#if db.identity}
                    <div>
                      <div class="text-gray-600">Owner ID:</div>
                      <div class="font-mono text-xs">{formatPeerId ? formatPeerId(db.identity.id) : db.identity.id}</div>
                    </div>
                    <div>
                      <div class="text-gray-600">Public Key:</div>
                      <div class="font-mono text-xs">{db.identity.publicKey ? db.identity.publicKey.substring(0, 20) + '...' : 'N/A'}</div>
                    </div>
                  {/if}
                  {#if db.records !== undefined}
                    <div>
                      <div class="text-gray-600">Records:</div>
                      <div class="font-mono">{db.records.toLocaleString()}</div>
                    </div>
                  {/if}
                  {#if db.lastAccessed}
                    <div>
                      <div class="text-gray-600">Last Accessed:</div>
                      <div class="font-mono text-xs">{new Date(db.lastAccessed).toLocaleString()}</div>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

    {:else}
      <div class="text-center py-8">
        <p class="text-gray-500">No IPFS analysis data available</p>
        <p class="text-xs text-gray-400 mt-2">Click "Analyze" to scan your IPFS node and OrbitDB instances</p>
      </div>
    {/if}
  {:else}
    <p class="text-sm text-gray-500">Deep analysis of your IPFS node, pinned content, and OrbitDB databases. Click "Show Analysis" to view detailed information about storage, ownership, and peer relationships.</p>
  {/if}
</div>

<!-- Pin Content Inspection Modal -->
{#if showPinModal}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" on:click={handleModalBackdrop}>
    <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
      <!-- Modal Header -->
      <div class="flex items-center justify-between p-6 border-b border-gray-200">
        <div class="flex items-center space-x-3">
          <h3 class="text-lg font-semibold text-gray-900">📎 Pin Content Inspector</h3>
          {#if selectedPin}
            <span class="text-xs px-2 py-1 rounded-full {selectedPin.type === 'recursive' ? 'bg-purple-200 text-purple-800' : 'bg-blue-200 text-blue-800'}">
              {selectedPin.type}
            </span>
          {/if}
        </div>
        <button 
          on:click={closePinModal}
          class="text-gray-400 hover:text-gray-600 text-2xl font-bold"
          title="Close"
        >
          ×
        </button>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
        {#if loadingPinContent}
          <div class="flex items-center justify-center py-8">
            <div class="text-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-3"></div>
              <p class="text-gray-600">Inspecting pin content...</p>
            </div>
          </div>
        {:else if pinContentError}
          <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <div class="flex items-center mb-2">
              <span class="text-red-600 text-lg mr-2">❌</span>
              <h4 class="font-semibold text-red-800">Error Inspecting Content</h4>
            </div>
            <p class="text-red-700 text-sm">{pinContentError}</p>
          </div>
        {:else if pinContent}
          <!-- Pin Info -->
          <div class="bg-gray-50 rounded-lg p-4 mb-6">
            <h4 class="font-semibold text-gray-800 mb-3">Pin Information</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div class="text-gray-600">CID:</div>
                <div class="font-mono text-xs break-all">{pinContent.cid}</div>
              </div>
              <div>
                <div class="text-gray-600">Size:</div>
                <div class="font-mono">{formatBytes ? formatBytes(pinContent.size) : pinContent.size + ' bytes'}</div>
              </div>
              <div>
                <div class="text-gray-600">Type:</div>
                <div class="font-mono">{pinContent.type}</div>
              </div>
              <div>
                <div class="text-gray-600">Formats Detected:</div>
                <div class="font-mono">{pinContent.formats.length}</div>
              </div>
            </div>
          </div>
          
          <!-- Content Formats -->
          {#if pinContent.formats && pinContent.formats.length > 0}
            <div class="space-y-4">
              {#each pinContent.formats as format, index}
                <div class="border rounded-lg overflow-hidden">
                  <div class="bg-gray-100 px-4 py-2 border-b">
                    <h5 class="font-medium text-gray-800">{format.name}</h5>
                  </div>
                  <div class="p-4">
                    {#if format.name === 'JSON'}
                      <pre class="bg-gray-900 text-green-400 p-3 rounded text-xs overflow-x-auto max-h-64">{format.fullContent}</pre>
                    {:else if format.name === 'Text (UTF-8)'}
                      <div class="bg-gray-50 p-3 rounded text-sm max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">{format.fullContent}</div>
                    {:else if format.name === 'Hex Dump'}
                      <pre class="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto max-h-64 font-mono">{format.fullContent}</pre>
                    {:else if format.name === 'CBOR (Binary)'}
                      <div class="bg-yellow-50 p-3 rounded text-sm">
                        <p class="text-yellow-800 mb-2">{format.content}</p>
                        <pre class="bg-gray-900 text-yellow-400 p-2 rounded text-xs overflow-x-auto font-mono">{format.fullContent}</pre>
                      </div>
                    {:else if format.name === 'DAG Structure'}
                      <div class="bg-purple-50 p-3 rounded text-sm">
                        <pre class="text-purple-800 whitespace-pre-wrap">{format.fullContent}</pre>
                      </div>
                    {:else if format.name === 'OrbitDB Manifest'}
                      <div class="bg-green-50 p-3 rounded text-sm">
                        <pre class="text-green-800 whitespace-pre-wrap">{format.fullContent}</pre>
                      </div>
                    {:else if format.name === 'OrbitDB Log Entry'}
                      <div class="bg-blue-50 p-3 rounded text-sm">
                        <pre class="text-blue-800 whitespace-pre-wrap">{format.fullContent}</pre>
                      </div>
                    {:else if format.name === 'CBOR Data'}
                      <div class="bg-orange-50 p-3 rounded text-sm">
                        <pre class="text-orange-800 whitespace-pre-wrap">{format.fullContent}</pre>
                      </div>
                    {:else if format.name === 'Binary Data'}
                      <div class="bg-blue-50 p-3 rounded text-sm">
                        <pre class="text-blue-800 whitespace-pre-wrap">{format.fullContent}</pre>
                      </div>
                    {:else}
                      <div class="bg-gray-50 p-3 rounded text-sm">
                        <pre class="whitespace-pre-wrap">{format.fullContent}</pre>
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-center py-8 text-gray-500">
              <p>No readable content formats detected.</p>
            </div>
          {/if}
        {/if}
      </div>
      
      <!-- Modal Footer -->
      <div class="flex justify-end p-6 border-t border-gray-200">
        <button 
          on:click={closePinModal}
          class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
