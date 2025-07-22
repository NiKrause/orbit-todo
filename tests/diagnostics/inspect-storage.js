#!/usr/bin/env node

/**
 * Quick storage inspector for localStorage data
 * Run this to see what's stored in browser storage
 */

console.log('🔍 Browser Storage Inspector')
console.log('============================\n')

console.log(`
📋 To inspect your browser storage:

1. Open your browser's Developer Tools (F12)
2. Go to the "Application" or "Storage" tab
3. Look for "Local Storage" and "Session Storage"
4. Check for keys containing:
   - "orbitdb"
   - "libp2p" 
   - "helia"
   - "relay-discovery"

🎯 Or run these commands in the browser console:

// Check localStorage keys
Object.keys(localStorage).filter(key => 
  key.includes('orbitdb') || 
  key.includes('libp2p') || 
  key.includes('helia')
)

// Get all localStorage data
Object.fromEntries(Object.entries(localStorage))

// Clear specific OrbitDB data
Object.keys(localStorage).forEach(key => {
  if (key.includes('orbitdb') || key.includes('libp2p')) {
    localStorage.removeItem(key)
    console.log('Removed:', key)
  }
})

🔧 Debugging Commands for Browser Console:

// Check if your app is loaded
console.log('App available:', !!window.app)

// Get todos directly
await window.app.getAllTodos()

// Run diagnostics
await debugTodos()

// Run health check
await window.app.runDatabaseHealthCheck()

// Force reset if corrupted
await window.app.forceResetDatabase()
`)

if (process.argv.length > 2 && process.argv[2] === 'help') {
  console.log(`
🆘 Common Issues and Solutions:

1. "No Promise in Promise.any was resolved"
   - Usually CORS or network connectivity issue
   - Try clearing browser cache
   - Check if relay server is running

2. Todos show "Unassigned • Created by: ..." but no text
   - Database corruption or data structure issue
   - Run debugTodos() to see raw data
   - May need to reset database

3. App hangs on initialization
   - Network timeout or P2P connection issues
   - Check browser console for errors
   - Try force reset

🔧 Quick Fixes:

1. Clear browser storage:
   localStorage.clear()

2. Force app reset:
   await window.app.forceResetDatabase()

3. Check health:
   await window.app.runDatabaseHealthCheck()
  `)
}
