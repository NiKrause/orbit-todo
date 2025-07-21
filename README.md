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

### Quick Diagnostics

#### Step 1: Start Your App
```bash
npm run dev
```

#### Step 2: Open Browser Console (F12) and Run:

```javascript
// Check if app is loaded
console.log('App available:', !!window.app)

// Run comprehensive todo diagnostics
await debugTodos()

// Check raw todo data
await window.app.getAllTodos()

// Run full health check
await window.app.runDatabaseHealthCheck()
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

### Emergency Recovery

If your database is completely corrupted:

1. **Clear everything**:
   ```javascript
   localStorage.clear()
   sessionStorage.clear()
   ```

2. **Force reset**:
   ```javascript
   await window.app.forceResetDatabase()
   ```

3. **Refresh page** and try again

### Getting Help

When reporting issues, please include:
1. Output from `await debugTodos()`
2. Output from `await window.app.runDatabaseHealthCheck()`
3. Any console errors
4. Browser and OS version
