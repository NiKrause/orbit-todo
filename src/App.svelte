<script>
  import { onMount } from 'svelte';
  import { formatPeerId } from './lib/p2p.js';

  // Import services
  import { ToastService } from './services/ToastService.js';
  import { EventManager } from './services/EventManager.js';
  import { DatabaseSwitcher } from './services/DatabaseSwitcher.js';
  import { DatabaseManager as DatabaseManagerService } from './services/DatabaseManager.js';
  import { IPFSAnalyzer as IPFSAnalyzerService } from './services/IPFSAnalyzer.js';
  import { WritePermissionManager } from './services/WritePermissionManager.js';
  import { PeerManager } from './services/PeerManager.js';
  import { P2PManager } from './services/P2PManager.js';
  import { AppStateManager } from './services/AppStateManager.js';

  // Import components
  import Toast from './components/Toast.svelte';
  import LoadingState from './components/LoadingState.svelte';
  import DatabaseSelector from './components/DatabaseSelector.svelte';
  import TodoForm from './components/TodoForm.svelte';
  import TodoList from './components/TodoList.svelte';
  import PeerStatus from './components/PeerStatus.svelte';
  import WritePermissions from './components/WritePermissions.svelte';
  import IPFSAnalyzer from './components/IPFSAnalyzer.svelte';
  import DatabaseManager from './components/DatabaseManager.svelte';
  import RelayStatus from './components/RelayStatus.svelte';

  // Application state
  let appState = {
    // Core data
    todos: [],
    peers: [],
    myPeerId: null,
    
    // Database info
    dbAddress: null,
    dbName: null,
    selectedPeerId: '',
    peerOrbitDbAddresses: new Map(),
    
    // UI state
    loading: true,
    error: null,
    inputText: '',
    assigneeText: '',
    
    // Write permissions
    writePermissionRequests: [],
    outgoingWritePermissionRequests: [],
    canWriteToCurrentDB: true,
    showWritePermissions: false,
    
    // Database manager
    showDatabaseDetails: false,
    browserDatabases: [],
    viewingDatabase: null,
    databaseContents: {},
    storageUsage: null,
    
    // IPFS analyzer
    showIPFSDetails: false,
    ipfsAnalysis: null,
    
    // Relay status
    showRelayDetails: false,
    relayStatus: null
  };

  let toastMessage = '';
  let appStateManager;

  onMount(async () => {
    // Initialize services
    const toastService = new ToastService((message) => {
      toastMessage = message;
    });

    // Initialize P2P functions
    const p2pFunctions = await import('./lib/p2p.js');
    const { getConnectedPeers } = p2pFunctions;
    
    // Create services
    const services = {
      toastService,
      p2pManager: new P2PManager(toastService, p2pFunctions),
      peerManager: new PeerManager(toastService, formatPeerId, getConnectedPeers),
      databaseSwitcher: new DatabaseSwitcher(toastService, formatPeerId),
      writePermissionManager: new WritePermissionManager(toastService),
      databaseManagerService: new DatabaseManagerService(toastService, formatBytes),
      ipfsAnalyzerService: new IPFSAnalyzerService(toastService, formatBytes, formatPeerId),
      eventManager: new EventManager(toastService, formatPeerId)
    };

    // Create main app state manager
    appStateManager = new AppStateManager(services);
    appStateManager.setFormatPeerIdFunction(formatPeerId);

    // Subscribe to state changes
    const unsubscribe = appStateManager.onStateChange((newState) => {
      appState = newState;
    });

    // Initialize the application
    await appStateManager.initialize();

    // Cleanup on destroy
    return () => {
      unsubscribe();
      appStateManager.cleanup();
    };
  });

  // Event handlers - these just delegate to the state manager
  const handleAddTodo = () => {
    // The input values are already updated via the change handlers
    appStateManager.addTodo();
  };
  const handleToggleComplete = (id) => appStateManager.toggleTodoComplete(id);
  const handleDelete = (id) => appStateManager.deleteTodo(id);
  const handleAssign = (id, peerId) => appStateManager.assignTodo(id, peerId);
  const handlePeerDbSwitch = (newPeerId) => {
    // The selectedPeerId is passed from the component
    if (newPeerId !== undefined) {
      appStateManager.updateState({ selectedPeerId: newPeerId });
    }
    appStateManager.switchDatabase();
  };

  // Write permission handlers
  const handleRequestWritePermission = async (targetPeerId) => {
    await appStateManager.writePermissionManager.requestPermission(
      targetPeerId,
      appState.peerOrbitDbAddresses,
      () => appStateManager.updateWritePermissionRequests()
    );
  };

  const handleGrantWritePermission = async (requestId) => {
    await appStateManager.writePermissionManager.grantPermission(
      requestId,
      () => appStateManager.updateWritePermissionRequests()
    );
  };

  const handleDenyWritePermission = async (requestId, reason = '') => {
    await appStateManager.writePermissionManager.denyPermission(
      requestId,
      reason,
      () => appStateManager.updateWritePermissionRequests()
    );
  };

  // Database manager handlers
  const refreshDatabases = async () => {
    const result = await appStateManager.databaseManagerService.refreshDatabases(
      () => appState.dbAddress,
      () => appState.dbName
    );
    appStateManager.updateState({
      browserDatabases: result.browserDatabases,
      storageUsage: result.storageUsage
    });
  };

  const viewDatabaseContents = async (dbName) => {
    const result = await appStateManager.databaseManagerService.viewDatabaseContents(
      dbName,
      appState.viewingDatabase
    );
    appStateManager.updateState({
      viewingDatabase: result.viewingDatabase,
      databaseContents: result.databaseContents
    });
  };

  const deleteSingleDatabase = async (dbName) => {
    const result = await appStateManager.databaseManagerService.deleteSingleDatabase(
      dbName,
      appState.browserDatabases,
      appState.storageUsage,
      appState.viewingDatabase,
      appState.databaseContents
    );
    if (result) {
      appStateManager.updateState(result);
    }
  };

  const deleteAllInactiveDatabases = async () => {
    const result = await appStateManager.databaseManagerService.deleteAllInactiveDatabases(
      appState.browserDatabases,
      appState.viewingDatabase,
      appState.databaseContents
    );
    if (result) {
      appStateManager.updateState(result);
    }
  };

  const deleteAllDatabases = async () => {
    const result = await appStateManager.databaseManagerService.deleteAllDatabases(
      appState.browserDatabases
    );
    if (result) {
      appStateManager.updateState(result);
    }
  };

  // IPFS analyzer handlers
  const analyzeIPFS = async () => {
    const analysis = await appStateManager.ipfsAnalyzerService.analyzeIPFS({
      getTodoDbAddress: () => appState.dbAddress,
      getTodoDbName: () => appState.dbName,
      getMyPeerId: () => appState.myPeerId,
      todos: appState.todos,
      peerOrbitDbAddresses: appState.peerOrbitDbAddresses,
      writePermissionRequests: appState.writePermissionRequests,
      storageUsage: appState.storageUsage
    });
    
    if (analysis) {
      appStateManager.updateState({ ipfsAnalysis: analysis });
    }
  };

  // Relay status handlers
  const handleToggleRelayDetails = async () => {
    const { getRelayDiscoveryStatus, discoverRelay } = await import('./utils/relay-discovery.js');
    
    let relayStatus = await getRelayDiscoveryStatus();
    
    // Also fetch discovery result to get full address info
    try {
      const discoveryResult = await discoverRelay();
      relayStatus.discoveryResult = discoveryResult;
    } catch (error) {
      console.warn('Failed to fetch discovery result:', error);
    }
    
    appStateManager.updateState({
      relayStatus,
      showRelayDetails: !appState.showRelayDetails
    });
  };

  const handleRefreshCache = async () => {
    console.log('🔘 Refresh Cache button clicked!');
    
    try {
      const { getRelayDiscoveryStatus, discoverRelay, getRelayDiscovery } = await import('./utils/relay-discovery.js');
      
      // First ensure relay discovery is properly configured
      console.log('📊 Getting relay discovery status to ensure proper configuration...');
      await getRelayDiscoveryStatus();
      
      // Clear cache and fetch fresh data
      const relayDiscoveryInstance = getRelayDiscovery();
      console.log('🔧 Using relay discovery instance with URL:', relayDiscoveryInstance.relayHttpUrl);
      
      relayDiscoveryInstance.clearCache();
      console.log('🧹 Cleared relay discovery cache');
      
      // Immediately fetch fresh data
      let relayStatus = await getRelayDiscoveryStatus();
      console.log('📊 Updated relay status:', relayStatus);
      
      const discoveryResult = await discoverRelay();
      relayStatus.discoveryResult = discoveryResult;
      console.log('🔄 Fetched fresh relay discovery data:', discoveryResult);
      
      appStateManager.updateState({ relayStatus });
      
    } catch (error) {
      console.error('❌ Error during refresh:', error);
    }
  };

  // Utility function
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
</script>

<Toast message={toastMessage} />

<svelte:head>
  <title>P2P TODO List {__APP_VERSION__}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="A peer-to-peer TODO list application using OrbitDB and IPFS">
</svelte:head>

<main class="container mx-auto p-6 max-w-4xl">
  <h1 class="text-3xl font-bold mb-6 text-center">P2P TODO List</h1>

  <DatabaseSelector 
    selectedPeerId={appState.selectedPeerId}
    peers={appState.peers}
    peerOrbitDbAddresses={appState.peerOrbitDbAddresses}
    onDatabaseSwitch={handlePeerDbSwitch}
    onSelectedPeerIdChange={(peerId) => appStateManager.updateState({ selectedPeerId: peerId })}
  />

  <LoadingState loading={appState.loading} error={appState.error} />
  
  {#if !appState.loading && !appState.error}
    <TodoForm 
      inputText={appState.inputText}
      assigneeText={appState.assigneeText}
      peers={appState.peers}
      onAddTodo={handleAddTodo}
      onInputTextChange={(text) => appStateManager.updateState({ inputText: text })}
      onAssigneeTextChange={(text) => appStateManager.updateState({ assigneeText: text })}
    />

    <TodoList 
      todos={appState.todos}
      peers={appState.peers}
      onToggleComplete={handleToggleComplete}
      onDelete={handleDelete}
      onAssign={handleAssign}
    />

    <PeerStatus peers={appState.peers} myPeerId={appState.myPeerId} />

    <WritePermissions 
      showWritePermissions={appState.showWritePermissions}
      canWriteToCurrentDB={appState.canWriteToCurrentDB}
      dbAddress={appState.dbAddress}
      selectedPeerId={appState.selectedPeerId}
      writePermissionRequests={appState.writePermissionRequests}
      outgoingWritePermissionRequests={appState.outgoingWritePermissionRequests}
      formatPeerId={formatPeerId}
      onToggleShow={() => { 
        appStateManager.updateState({ showWritePermissions: !appState.showWritePermissions }); 
        appStateManager.updateWritePermissionRequests(); 
      }}
      onRequestWritePermission={handleRequestWritePermission}
      onGrantWritePermission={handleGrantWritePermission}
      onDenyWritePermission={handleDenyWritePermission}
    />

    <IPFSAnalyzer 
      showIPFSDetails={appState.showIPFSDetails}
      ipfsAnalysis={appState.ipfsAnalysis}
      formatBytes={formatBytes}
      formatPeerId={formatPeerId}
      onRefreshIPFSAnalysis={analyzeIPFS}
      onToggleShow={() => { 
        appStateManager.updateState({ showIPFSDetails: !appState.showIPFSDetails }); 
        if (!appState.showIPFSDetails && !appState.ipfsAnalysis) analyzeIPFS(); 
      }}
    />

    <DatabaseManager 
      showDatabaseDetails={appState.showDatabaseDetails}
      browserDatabases={appState.browserDatabases}
      viewingDatabase={appState.viewingDatabase}
      databaseContents={appState.databaseContents}
      storageUsage={appState.storageUsage}
      formatBytes={formatBytes}
      onRefreshDatabases={refreshDatabases}
      onToggleShow={() => { 
        appStateManager.updateState({ showDatabaseDetails: !appState.showDatabaseDetails }); 
        if (!appState.showDatabaseDetails) refreshDatabases(); 
      }}
      onViewDatabaseContents={viewDatabaseContents}
      onDeleteSingleDatabase={deleteSingleDatabase}
      onDeleteAllDatabases={deleteAllDatabases}
      onDeleteAllInactiveDatabases={deleteAllInactiveDatabases}
    />

    <RelayStatus 
      showRelayDetails={appState.showRelayDetails}
      relayStatus={appState.relayStatus}
      formatPeerId={formatPeerId}
      onToggleShow={handleToggleRelayDetails}
      onRefreshCache={handleRefreshCache}
    />
  {/if}
</main>

<footer class="mt-10 text-center text-xs text-gray-500 space-y-1">
  <div class="font-medium text-gray-600">
    P2P TODO List v{__APP_VERSION__}
  </div>
  {#if appState.dbAddress}
    <div>
      <strong>OrbitDB Address:</strong>
      <code class="bg-gray-100 px-1 rounded">{appState.dbAddress}</code>
    </div>
  {/if}
  {#if appState.dbName}
    <div>
      <strong>DB Name:</strong>
      <code class="bg-gray-100 px-1 rounded">{appState.dbName}</code>
    </div>
  {/if}
</footer>
