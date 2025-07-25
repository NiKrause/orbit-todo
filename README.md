# Orbit-Todo

A local-first, peer-to-peer Todo application built with Svelte, Helia (IPFS), and OrbitDB for distributed data storage.

## 📁 Directory Structure

```
todo-p2p/
├── 📱 src/                     # Main application source
│   ├── lib/                    # Core P2P and OrbitDB logic
│   │   ├── access-controllers/ # Custom OrbitDB access controllers
│   │   │   └── WritePermissionAccessController.js  # Time-based write permissions
│   │   ├── p2p/               # Refactored P2P modules
│   │   │   ├── network.js     # LibP2P and Helia network layer
│   │   │   ├── database.js    # OrbitDB database management
│   │   │   ├── todos.js       # Todo CRUD operations
│   │   │   ├── peer-discovery.js  # Peer discovery and connection
│   │   │   └── diagnostics.js # Health checks and diagnostics
│   │   ├── p2p.js             # Main P2P networking (legacy)
│   │   ├── write-permissions.js # Write permission request system
│   │   └── orbit-discovery.js  # Peer discovery logic
│   ├── routes/                # SvelteKit routes
│   ├── utils/                 # Utility functions
│   ├── App.svelte            # Main Svelte component
│   └── main.js               # Application entry point
├── 🚀 relay/                   # Relay server for P2P networking
│   ├── relay.js              # Basic libp2p relay server
│   └── relay-enhanced.js     # Enhanced relay with advanced features
├── 🧪 tests/                   # Testing infrastructure
│   ├── diagnostics/          # Diagnostic tools
│   │   ├── db-diagnostics.html    # Interactive diagnostics UI
│   │   ├── debug-todos.js         # Todo database diagnostic script
│   │   └── inspect-storage.js     # Command-line storage inspector
│   ├── e2e/                  # End-to-end tests (Playwright)
│   │   └── todo.spec.js
│   ├── node/                 # Node.js integration tests
│   │   ├── bob.test.js       # Multi-peer test scenarios
│   │   └── manual.test.js    # Manual testing utilities
│   └── standalone/           # Standalone network tests
│       ├── test-discovery.html        # WebRTC discovery testing
│       ├── test-emitself-simple.js    # emitSelf functionality test
│       └── test-pubsub-visibility.js  # Pubsub self-message test
├── ⚙️  Configuration Files
│   ├── package.json          # Dependencies and scripts
│   ├── vite.config.js        # Vite bundler configuration
│   ├── svelte.config.js      # Svelte configuration
│   ├── tailwind.config.js    # TailwindCSS styling
│   ├── playwright.config.js  # E2E test configuration
│   └── eslint.config.js      # Code linting rules
└── 📖 Documentation
    ├── README.md             # This file
    ├── WRITE_PERMISSIONS.md  # Write permission system documentation
    ├── AI_ASSISTANT_PROMPT.md # AI assistant configuration
    ├── STORAGE_PATTERN.md    # Storage architecture documentation
    └── VERSION_MANAGEMENT.md # Version management documentation
```

### Key Components:

- **🖥️ Frontend**: Svelte-based reactive UI with TailwindCSS
- **🌐 P2P Networking**: libp2p with WebRTC, WebSockets, and Circuit Relay
- **💾 Database**: OrbitDB for distributed, local-first data storage
- **🔍 Discovery**: Peer discovery via libp2p bootstrap and pubsub
- **🧪 Testing**: Comprehensive test suite for P2P functionality
- **🚀 Relay Server**: Optional relay server for peer connectivity

## Write Permission System

The newly implemented write permission system includes the following features:

### Key Features

- **Custom Access Controller**: Uses `WritePermissionAccessController` to allow only the database owner to write by default. Temporary write access is granted based on permission requests, which last for 48 hours. Expired permissions are cleaned automatically.

- **Global Write Permission Requests**: Allows any peer to request write access to a peer's database. Requests are stored in a globally accessible OrbitDB.

- **Incoming/Outgoing Permission Management**: Peers are notified of incoming write permission requests and can grant or deny them. Request statuses are tracked and displayed for both incoming and outgoing requests.

### How It Works

1. **Ownership**: Each peer owns their database, set up to allow only them to write.
2. **Permission Requests**: Write permissions are requested via a global request database when switching to another peer's database.
3. **Permission Expiry**: All granted permissions expire after 48 hours and are cleaned up automatically.
4. **UI Integration**: The interface provides sections for managing incoming and outgoing requests and showing current write permissions.

### Usage Flow

- **Database Creation**: Each peer creates their database, owned only by them.
- **Permission Request**: When peers switch to another peer's database, they can request write permissions.
- **Grant/Deny Requests**: Database owners see incoming requests and choose to grant or deny them.

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

### 🧪 Testing & Diagnostics Scripts

The project includes several npm scripts for testing and diagnostics:

```bash
# Main test suites
npm test                    # Run all tests (e2e + node)
npm run test:e2e           # Run Playwright end-to-end tests
npm run test:node          # Run Node.js P2P integration tests
npm run test:manual        # Run manual testing utilities

# Standalone network tests
npm run test:standalone:emitself  # Test emitSelf functionality
npm run test:standalone:pubsub    # Test pubsub self-message visibility

# Diagnostic tools
npm run diagnostics:inspect       # Run command-line storage inspector
npm run diagnostics:todos         # Todo database diagnostic script

# P2P infrastructure
npm run relay                     # Start basic libp2p relay server
npm run relay:enhanced            # Start enhanced relay with advanced features
npm run relay:enhanced:verbose    # Enhanced relay with detailed logging
```

**Interactive tools** (open in browser):
- `tests/diagnostics/db-diagnostics.html` - Full diagnostic interface
- `tests/standalone/test-discovery.html` - WebRTC discovery testing

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## 🌐 Deploying the Relay Server

The Todo P2P app requires a libp2p relay server for peers to discover and connect to each other. Here's how to deploy it to a public server.

### Prerequisites

- A public server (VPS, cloud instance, etc.)
- Node.js 22+ installed
- Port 4001 accessible from the internet
- Optional: Docker installed

### Method 1: Direct Deployment (Without Docker)

#### 1. Prepare Your Server
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22 (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be 22.x.x
npm --version
```

#### 2. Deploy the Application
```bash
# Clone your repository
git clone https://github.com/your-username/todo-p2p.git
cd todo-p2p

# Install dependencies
npm install

# Create a production environment file
cp .env.example .env
# Edit .env if needed
```

#### 3. Configure Firewall
```bash
# Allow port 4001 (relay server port)
sudo ufw allow 4001

# If using a cloud provider, also configure security groups
# to allow TCP traffic on port 4001
```

#### 4. Run the Relay Server
```bash
# Test run (foreground)
npm run relay

# Production run with PM2 (recommended)
npm install -g pm2
pm2 start relay/relay.js --name "todo-p2p-relay"
pm2 save
pm2 startup  # Follow the instructions to auto-start on reboot
```

#### 5. Verify Deployment
```bash
# Check if relay is running
netstat -tlnp | grep :4001

# Check PM2 status
pm2 status

# View logs
pm2 logs todo-p2p-relay
```

### Method 2: Docker Deployment

#### 1. Create Dockerfile
Create a `Dockerfile` in your project root:

```dockerfile
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY relay/ ./relay/
COPY .env* ./

# Expose port
EXPOSE 4001

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S relay -u 1001
USER relay

# Start the relay server
CMD ["node", "relay/relay.js"]
```

#### 2. Create Docker Compose (Optional)
Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  todo-p2p-relay:
    build: .
    ports:
      - "4001:4001"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4001/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
```

#### 3. Deploy with Docker
```bash
# Build and run
docker-compose up -d

# Or with plain Docker
docker build -t todo-p2p-relay .
docker run -d --name todo-p2p-relay -p 4001:4001 --restart unless-stopped todo-p2p-relay

# Check status
docker-compose ps
docker logs todo-p2p-relay
```

### Updating Your App Configuration

Once your relay server is deployed, update your app configuration:

#### 1. Update the Relay Address
In `src/lib/p2p.js`, change the relay address:

```javascript
// Replace localhost with your server's IP or domain
const RELAY_BOOTSTRAP_ADDR = '/ip4/YOUR_SERVER_IP/tcp/4001/ws/p2p/12D3KooW...'

// Or use a domain name
const RELAY_BOOTSTRAP_ADDR = '/dns4/your-domain.com/tcp/4001/ws/p2p/12D3KooW...'
```

#### 2. Update Test Configuration
In `tests/node/manual.test.js` and `tests/node/bob.test.js`:

```javascript
const RELAY_MULTIADDR = '/ip4/YOUR_SERVER_IP/tcp/4001/ws/p2p/12D3KooW...'
```

#### 3. Get Your Relay's Peer ID
When the relay starts, it will log its Peer ID:

```bash
# Check relay logs to get the Peer ID
npm run relay
# or
pm2 logs todo-p2p-relay
# or
docker logs todo-p2p-relay

# Look for output like:
# 🚀 Relay server started
# 📡 Relay PeerId: 12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE
# 🔍 Listening on: /ip4/0.0.0.0/tcp/4001/ws
```

### Security Considerations

#### 1. Firewall Configuration
```bash
# Only allow necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 4001
sudo ufw enable
```

#### 2. HTTPS/WSS (Advanced)
For production, consider using HTTPS/WSS:

```javascript
// In relay/relay.js, add TLS configuration
const server = createLibp2p({
  // ... existing config
  addresses: {
    listen: [
      '/ip4/0.0.0.0/tcp/4001/ws',
      '/ip4/0.0.0.0/tcp/4002/wss'  // Add WSS support
    ]
  }
  // Add TLS certificates configuration
})
```

#### 3. Rate Limiting
Consider implementing rate limiting to prevent abuse:

```bash
# Install fail2ban
sudo apt install fail2ban

# Configure rate limiting rules
# (Implementation depends on your specific needs)
```

### Monitoring and Maintenance

#### Health Checks
```bash
# Simple health check script
curl -f http://your-server:4001/health || echo "Relay server is down!"

# Add to crontab for automated monitoring
*/5 * * * * curl -f http://your-server:4001/health || /usr/bin/systemctl restart todo-p2p-relay
```

#### Logs Management
```bash
# With PM2
pm2 logs --lines 50
pm2 flush  # Clear logs

# With Docker
docker logs --tail 50 todo-p2p-relay
docker logs --follow todo-p2p-relay  # Live logs
```

#### Updates
```bash
# Direct deployment
cd todo-p2p
git pull origin main
npm install
pm2 restart todo-p2p-relay

# Docker deployment
git pull origin main
docker-compose down
docker-compose build
docker-compose up -d
```

### Troubleshooting Deployment

#### Common Issues

**Port 4001 not accessible:**
```bash
# Check if process is running
netstat -tlnp | grep :4001

# Check firewall
sudo ufw status

# Check if bound to correct interface
ss -tlnp | grep :4001
```

**Relay server crashes:**
```bash
# Check system resources
free -h
df -h

# Check Node.js version
node --version  # Should be 22+

# Check logs for errors
pm2 logs todo-p2p-relay --lines 100
```

**Peers can't connect:**
```bash
# Verify relay peer ID in app configuration
# Check network connectivity
telnet your-server-ip 4001

# Test WebSocket connection
# Use browser console: new WebSocket('ws://your-server-ip:4001')
```

## 🔍 Diagnostics & Troubleshooting

### Available Diagnostic Tools

1. **Interactive Diagnostics Interface**: Open `tests/diagnostics/db-diagnostics.html` in your browser
2. **Built-in Debug Commands**: Available in browser console when app is running
3. **Health Check System**: Comprehensive database and network diagnostics
4. **Comprehensive Test Suite**: Full OrbitDB operation testing
5. **P2P Network Diagnostics**: Pubsub and peer connection testing
6. **Standalone Network Tests**: Individual P2P component testing
7. **Complete Data Cleanup**: Nuclear option for clearing all data

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
Open `tests/diagnostics/db-diagnostics.html` in your browser for a full GUI diagnostic tool with:
- Real-time health monitoring
- Automatic recovery attempts
- Detailed error reporting
- Storage management

#### Command Line Storage Inspector
```bash
node tests/diagnostics/inspect-storage.js
node tests/diagnostics/inspect-storage.js help  # For detailed help
```

#### Standalone Network Tests
Run individual P2P component tests for debugging:
```bash
# Test emitSelf functionality
node tests/standalone/test-emitself-simple.js

# Test pubsub self-message visibility
node tests/standalone/test-pubsub-visibility.js

# Open WebRTC discovery test interface
open tests/standalone/test-discovery.html
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
