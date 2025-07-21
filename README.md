# Todo P2P

A peer-to-peer Todo application built with Svelte, Helia (IPFS), and OrbitDB for distributed data storage.

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## 🔍 Diagnostics & Troubleshooting

### Available Diagnostic Tools

1. **Interactive Diagnostics Interface**: Open `db-diagnostics.html` in your browser
2. **Built-in Debug Commands**: Available in browser console when app is running
3. **Health Check System**: Comprehensive database and network diagnostics
4. **Comprehensive Test Suite**: Full OrbitDB operation testing
5. **P2P Network Diagnostics**: Pubsub and peer connection testing
6. **Complete Data Cleanup**: Nuclear option for clearing all data

### 🛠️ Console Debug Functions

Once your app is running (`npm run dev`), open the browser console (F12) and use these functions:

#### Database Diagnostics
```javascript
// 🐛 Debug current todos and database state
await debugTodos()

// 🧪 Run comprehensive OrbitDB operations test
await testOrbitDB()

// 🏥 Run health check on all P2P components
await healthCheck()

// 🔧 Run health check with automatic recovery
await healthRecover()
```

#### Data Management
```javascript
// 🔄 Force reset all database components (soft reset)
await resetDB()

// 🧹 Nuclear option: Clear ALL OrbitDB data from browser
// This clears IndexedDB, localStorage, sessionStorage, and in-memory data
await window.app.clearAllOrbitDBData()

// 📊 Get current database information
window.app.getCurrentDatabaseInfo()

// 📍 Get current database address
window.app.getTodoDbAddress()
```

#### P2P Network Testing
```javascript
// 🧪 Test pubsub self-message functionality
await testPubsub()

// 🔍 Debug pubsub configuration and state
debugPubsub()

// 📡 Test basic pubsub without self-messages
await testBasicPubsub()

// 🌐 Test OrbitDB topic subscription discovery
await testOrbitDBTopicSubscription()

// 👥 Get connected peers information
await window.app.getConnectedPeers()

// 🆔 Get your peer ID
window.app.getMyPeerId()
```

#### Advanced Debugging
```javascript
// 🔍 Check subscription change event listeners
debugSubscriptionListeners()

// 📊 Get detailed connection information
window.app.getConnectionDetails()

// 🗺️ Get peer OrbitDB address mappings
window.app.getPeerOrbitDbAddresses()

// 🔄 Open database for specific peer
await window.app.openTodoDatabaseForPeer('peer-id-here')
```

### Quick Diagnostics Workflow

#### Step 1: Start Your App
```bash
npm run dev
```

#### Step 2: Basic Health Check
```javascript
// Check if app is loaded
console.log('App available:', !!window.app)

// Run comprehensive diagnostics
await debugTodos()
await healthCheck()
```

#### Step 3: Inspect Browser Storage
1. Open **Developer Tools → Application/Storage tab**
2. Check **Local Storage** for keys containing:
   - `orbitdb`
   - `libp2p`
   - `helia`
   - `relay-discovery`

### Common Issues & Quick Fixes

#### Issue: "No Promise in Promise.any was resolved"
**Cause**: CORS or network connectivity issues
```javascript
// Clear browser cache
localStorage.clear()

// Check relay server connectivity
await window.app.getRelayDiscoveryStatus()
```

#### Issue: Todos show "Unassigned • Created by: ..." but no text
**Cause**: Database corruption or data structure issues
```javascript
// Diagnose data structure
await debugTodos()

// Force database reset if needed
await window.app.forceResetDatabase()
```

#### Issue: App hangs during initialization
**Cause**: Network timeout or P2P connection problems
```javascript
// Check health and attempt recovery
await window.app.runDatabaseHealthCheckAndRecover()

// Nuclear option - full reset
await window.app.forceResetDatabase()
```

### Advanced Diagnostics

#### Interactive Diagnostic Interface
Open `db-diagnostics.html` in your browser for a full GUI diagnostic tool with:
- Real-time health monitoring
- Automatic recovery attempts
- Detailed error reporting
- Storage management

#### Command Line Storage Inspector
```bash
node inspect-storage.js
node inspect-storage.js help  # For detailed help
```

#### Manual Storage Cleanup
```javascript
// Remove specific OrbitDB data
Object.keys(localStorage).forEach(key => {
  if (key.includes('orbitdb') || key.includes('libp2p')) {
    localStorage.removeItem(key)
    console.log('Removed:', key)
  }
})
```

### Expected Diagnostic Output

Healthy todo should look like:
```
--- Todo 1 ---
ID: "1737307123456"
Text: "Buy groceries"        ← Should NOT be empty!
Text type: "string"
Text length: 13
Assignee: null
Completed: false
Created At: "2025-07-19T15:30:23.456Z"
Created By: "12D3K...AbCdE"   ← First 5 chars of PeerId
✅ Todo appears healthy
```

### 🧹 Complete Data Cleanup (Nuclear Option)

If you need to completely start fresh and clear all P2P data:

```javascript
// This will clear EVERYTHING: IndexedDB, localStorage, sessionStorage, and in-memory data
const report = await window.app.clearAllOrbitDBData()
console.log('Cleanup report:', report)
```

**What this clears:**
- All IndexedDB databases (orbitdb, helia, ipfs, libp2p, keystore, blockstore, datastore)
- All localStorage keys containing: orbitdb, helia, ipfs, libp2p, keystore, peer, identity
- All sessionStorage keys containing: orbitdb, helia, ipfs, libp2p, peer
- All in-memory peer discovery data and database caches
- All running P2P components (gracefully stopped)

**Expected output:**
```javascript
🧹 Starting complete OrbitDB data cleanup...
1️⃣ Stopping all P2P components...
2️⃣ Clearing peer discovery data...
3️⃣ Clearing IndexedDB databases...
  - Deleting database: orbitdb-keystore
  - Deleting database: helia-datastore
  - Deleting database: helia-blockstore
4️⃣ Clearing localStorage...
  - Removing localStorage key: libp2p-relay-discovery
5️⃣ Clearing sessionStorage...
6️⃣ Clearing cached data structures...
🎉 OrbitDB data cleanup completed!

// Returns cleanup report:
{
  success: true,
  actions: [
    "Stopped P2P components",
    "Cleared peer discovery data", 
    "Cleared IndexedDB databases",
    "Cleared 3 localStorage keys",
    "No relevant sessionStorage keys found",
    "Cleared in-memory caches"
  ],
  errors: []
}
```

### Emergency Recovery

#### Option 1: Soft Reset (Recommended)
```javascript
// Reset P2P components but keep some cached data
await resetDB()
// Then refresh the page
location.reload()
```

#### Option 2: Complete Cleanup (Nuclear)
```javascript
// Clear absolutely everything
await window.app.clearAllOrbitDBData()
// Then refresh the page
location.reload()
```

#### Option 3: Manual Cleanup (Emergency)
```javascript
// If functions don't work, clear manually
localStorage.clear()
sessionStorage.clear()
// Then refresh the page
location.reload()
```

### Getting Help

When reporting issues, please include:
1. Output from `await debugTodos()`
2. Output from `await window.app.runDatabaseHealthCheck()`
3. Any console errors
4. Browser and OS version
