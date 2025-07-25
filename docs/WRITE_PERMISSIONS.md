# Write Permission System Documentation

The P2P TODO application implements a sophisticated write permission system that ensures proper access control while maintaining collaborative capabilities. This system replaces the previous `write: ['*']` wildcard approach with a secure, time-based permission management system.

## Overview

The write permission system consists of three main components:

1. **WritePermissionAccessController** - Custom OrbitDB access controller
2. **Write Permission Request System** - Global request management
3. **UI Integration** - User interface for managing permissions

## Architecture

### WritePermissionAccessController

Located in `src/lib/access-controllers/WritePermissionAccessController.js`

#### Key Features:
- **Owner-only Write Access**: Only the database owner can write by default
- **Temporary Permissions**: Write permissions are granted for a limited time (48 hours)
- **Automatic Cleanup**: Expired permissions are automatically removed
- **Revocation Support**: Permissions can be revoked at any time

#### Core Methods:
```javascript
// Check if a peer can write to the database
async canAppend(entry, identityProvider)

// Grant write permission to a peer
grantWritePermission(peerId, duration = null)

// Revoke write permission from a peer  
revokeWritePermission(peerId)

// Get all current write permissions
getWritePermissions()

// Clean up expired permissions
cleanupExpiredPermissions()
```

#### Configuration:
```javascript
const accessController = new WritePermissionAccessController({
  ownerPeerId: 'peer-id-string',
  permissionTTL: 48 * 60 * 60 * 1000 // 48 hours in milliseconds
})
```

### Write Permission Request System

Located in `src/lib/write-permissions.js`

#### Global Request Database
The system uses a globally accessible OrbitDB database (`write-permission-requests`) where:
- **All peers can write** permission requests
- **48-hour expiration** for all requests
- **Automatic cleanup** of expired requests

#### Request Lifecycle:
1. **Request Creation**: Peer requests write access to another peer's database
2. **Notification**: Database owner is notified of the request
3. **Decision**: Owner grants or denies the request
4. **Permission Grant**: If granted, requester gains 48-hour write access
5. **Expiration**: Permission automatically expires after 48 hours

#### Key Functions:
```javascript
// Initialize the write permission system
await initializeWritePermissionSystem()

// Request write permission for a database
await requestWritePermission(targetDatabaseAddress, targetPeerID, reason)

// Grant write permission to a requester
await grantWritePermission(requestId)

// Deny write permission request
await denyWritePermission(requestId, reason)

// Get all write permission requests
await getWritePermissionRequests()

// Check if current user has write permission
hasWritePermission(databaseAddress)
```

### Database Integration

The system is integrated into the main database layer (`src/lib/p2p/database.js`):

#### OrbitDB Configuration:
```javascript
orbitdb = await createOrbitDB({
  ipfs: helia,
  id: 'todo-p2p-app',
  directory: './orbitdb-data',
  AccessControllers: {
    'write-permission': WritePermissionAccessControllerFactory()
  }
})
```

#### Database Creation:
```javascript
todoDB = await orbitdb.open('todos', {
  type: 'keyvalue',
  AccessController: WritePermissionAccessControllerFactory({
    ownerPeerId: helia.libp2p.peerId.toString()
  })
})
```

## User Interface

The write permission system is fully integrated into the main application UI (`src/App.svelte`).

### Write Permissions Section

The UI includes a dedicated "Write Permissions" section with:

#### Permission Status Display:
- **Current Status**: Shows if user can write to the current database
- **Database Info**: Displays the current database address
- **Request Button**: Allows requesting permission when viewing another peer's database

#### Incoming Permission Requests:
- **Request List**: Shows all pending requests from other peers
- **Grant/Deny Actions**: Buttons to approve or reject requests
- **Request Details**: Shows requester, reason, and timestamp

#### Outgoing Permission Requests:
- **My Requests**: Shows all requests made by the current user
- **Status Tracking**: Displays request status (pending, granted, denied)
- **Timeline**: Shows request, grant, or denial timestamps

### UI Components:

```html
<!-- Write Permission Status -->
<div class="bg-gray-50 p-4 rounded-md">
  <div class="flex items-center space-x-2 mb-2">
    <div class="w-3 h-3 rounded-full {canWriteToCurrentDB ? 'bg-green-500' : 'bg-red-500'}"></div>
    <span class="font-medium">
      {canWriteToCurrentDB ? 'You can write to this database' : 'You cannot write to this database'}
    </span>
  </div>
  {#if selectedPeerId && !canWriteToCurrentDB}
    <button on:click={() => handleRequestWritePermission(selectedPeerId)}>
      Request Write Permission from {formatPeerId(selectedPeerId)}
    </button>
  {/if}
</div>

<!-- Incoming Requests -->
{#each writePermissionRequests as request}
  <div class="border border-gray-200 p-3 rounded-md">
    <span>From: {formatPeerId(request.requesterPeerId)}</span>
    <p>{request.reason}</p>
    {#if request.status === 'pending'}
      <button on:click={() => handleGrantWritePermission(request.id)}>Grant</button>
      <button on:click={() => handleDenyWritePermission(request.id)}>Deny</button>
    {/if}
  </div>
{/each}
```

## Usage Workflow

### 1. Database Creation
When a peer initializes their database:
```javascript
// Each peer creates their own database
await initializeP2P()
const todoDB = await getTodoDatabase() // Owned by current peer only
```

### 2. Peer Discovery and Database Switching
When peers discover each other:
```javascript
// Peer discovers another peer's database
const peerDatabases = getPeerOrbitDbAddresses()

// Switch to peer's database (read-only initially)
await openTodoDatabaseForPeer(peerId)
```

### 3. Permission Request
When a peer wants to write to another peer's database:
```javascript
// Check current write permission
const canWrite = hasWritePermission(databaseAddress)

if (!canWrite) {
  // Request permission
  await requestWritePermission(databaseAddress, targetPeerId, "Need to collaborate on todos")
}
```

### 4. Permission Management
Database owner manages incoming requests:
```javascript
// Get incoming requests
const requests = await getMyWritePermissionRequests()

// Grant permission
await grantWritePermission(requestId)

// Or deny permission
await denyWritePermission(requestId, "Not authorized for this project")
```

### 5. Collaborative Work
Once permission is granted:
```javascript
// Requester can now write to the database
await addTodo("New collaborative todo")
await updateTodo(todoId, { completed: true })
```

## Security Features

### Time-Based Expiration
- **48-Hour Limit**: All permissions expire after 48 hours
- **Automatic Cleanup**: Expired permissions are cleaned up automatically
- **Grace Period**: No grace period - permissions expire exactly at the specified time

### Access Control
- **Owner-Only Default**: Only database owners can write by default
- **Explicit Grants**: Write access must be explicitly granted
- **Revocation**: Permissions can be revoked at any time

### Request Validation
- **Peer Verification**: Requests are validated against the actual peer ID
- **Database Verification**: Requests are validated against existing databases
- **Duplicate Prevention**: Duplicate requests are prevented

## Error Handling

### Common Scenarios:

#### Permission Denied:
```javascript
try {
  await addTodo("New todo")
} catch (error) {
  if (error.message.includes('permission')) {
    // Show permission request UI
    showWritePermissionRequest()
  }
}
```

#### Request Expired:
```javascript
// Automatic cleanup handles expired requests
// No manual intervention required
await cleanupExpiredRequests() // Returns count of cleaned requests
```

#### Network Issues:
```javascript
try {
  await requestWritePermission(dbAddress, peerId, reason)
} catch (error) {
  console.error('Failed to send permission request:', error)
  showToast('Failed to send write permission request')
}
```

## API Reference

### WritePermissionAccessController

#### Constructor
```javascript
new WritePermissionAccessController(options)
```

Options:
- `ownerPeerId` (string): The peer ID of the database owner
- `permissionTTL` (number): Permission duration in milliseconds (default: 48 hours)

#### Methods

##### canAppend(entry, identityProvider)
Check if a peer can write to the database.

**Parameters:**
- `entry` (object): The database entry being written
- `identityProvider` (object): Identity provider instance

**Returns:** `Promise<boolean>`

##### grantWritePermission(peerId, duration?)
Grant write permission to a peer.

**Parameters:**
- `peerId` (string): The peer ID to grant permission to
- `duration` (number, optional): Permission duration in milliseconds

##### revokeWritePermission(peerId)
Revoke write permission from a peer.

**Parameters:**
- `peerId` (string): The peer ID to revoke permission from

##### getWritePermissions()
Get all current write permissions.

**Returns:** `Map<string, object>` - Map of peer IDs to permission objects

##### cleanupExpiredPermissions()
Clean up expired permissions.

**Returns:** `number` - Number of permissions cleaned up

### Write Permission Functions

#### initializeWritePermissionSystem()
Initialize the global write permission request system.

**Returns:** `Promise<OrbitDB>` - The write permission request database

#### requestWritePermission(targetDatabaseAddress, targetPeerID, reason?)
Request write permission for a specific database.

**Parameters:**
- `targetDatabaseAddress` (string): The address of the target database
- `targetPeerID` (string): The peer ID of the database owner
- `reason` (string, optional): Reason for the request

**Returns:** `Promise<object>` - The created request object

#### grantWritePermission(requestId)
Grant a write permission request.

**Parameters:**
- `requestId` (string): The ID of the request to grant

**Returns:** `Promise<object>` - The updated request object

#### denyWritePermission(requestId, reason?)
Deny a write permission request.

**Parameters:**
- `requestId` (string): The ID of the request to deny
- `reason` (string, optional): Reason for denial

**Returns:** `Promise<object>` - The updated request object

#### getMyWritePermissionRequests()
Get all write permission requests for my databases.

**Returns:** `Promise<Array<object>>` - Array of request objects

#### getMyOutgoingWritePermissionRequests()
Get all write permission requests I've made.

**Returns:** `Promise<Array<object>>` - Array of request objects

#### hasWritePermission(databaseAddress)
Check if current user has write permission for a database.

**Parameters:**
- `databaseAddress` (string): The database address to check

**Returns:** `boolean` - True if user has write permission

## Configuration

### Environment Variables
```bash
# Optional: Custom permission TTL (in milliseconds)
WRITE_PERMISSION_TTL=172800000  # 48 hours

# Optional: Cleanup interval (in milliseconds)  
PERMISSION_CLEANUP_INTERVAL=3600000  # 1 hour
```

### Custom Configuration
```javascript
// Custom permission duration (24 hours instead of 48)
const accessController = WritePermissionAccessControllerFactory({
  ownerPeerId: myPeerId,
  permissionTTL: 24 * 60 * 60 * 1000
})

// Custom cleanup interval
setInterval(async () => {
  await cleanupExpiredRequests()
}, 30 * 60 * 1000) // Every 30 minutes
```

## Best Practices

### For Database Owners:
1. **Review Requests Promptly**: Don't leave requests pending unnecessarily
2. **Provide Clear Denial Reasons**: Help peers understand why access was denied
3. **Monitor Active Permissions**: Regularly check who has write access
4. **Revoke When Necessary**: Remove access when collaboration ends

### For Permission Requesters:
1. **Provide Clear Reasons**: Explain why you need write access
2. **Respect Denials**: Don't repeatedly request if denied
3. **Use Permissions Responsibly**: Only make necessary changes
4. **Understand Expiration**: Be aware that permissions expire

### For Development:
1. **Test Permission Flows**: Verify grant/deny scenarios work correctly
2. **Handle Edge Cases**: Account for network issues and timeouts
3. **Monitor Performance**: Watch for cleanup overhead
4. **Log Permission Changes**: Track permission grants/revocations for debugging

## Troubleshooting

### Common Issues:

#### "Cannot write to database" Error
**Cause**: No write permission for the current database
**Solution:**
```javascript
// Check permission status
const canWrite = hasWritePermission(dbAddress)
if (!canWrite) {
  // Request permission or switch to your own database
}
```

#### Permission Request Not Showing
**Cause**: Permission request database not initialized
**Solution:**
```javascript
// Manually initialize if needed
await initializeWritePermissionSystem()
```

#### Expired Permissions Not Cleaned
**Cause**: Cleanup not running automatically
**Solution:**
```javascript
// Manual cleanup
await cleanupExpiredRequests()
```

### Debug Commands:

```javascript
// Check current write permissions
console.log('Write permissions:', getCurrentTodoDB().access.getWritePermissions())

// Check permission requests
console.log('My requests:', await getMyWritePermissionRequests())
console.log('Outgoing requests:', await getMyOutgoingWritePermissionRequests())

// Force cleanup
const cleaned = await cleanupExpiredRequests()
console.log('Cleaned permissions:', cleaned)
```

## Migration from Previous System

If you're migrating from the previous `write: ['*']` system:

### 1. Update Database Creation
```javascript
// Old system
todoDB = await orbitdb.open('todos', {
  type: 'keyvalue',
  AccessController: IPFSAccessController({
    write: ['*'] // Anyone can write
  })
})

// New system  
todoDB = await orbitdb.open('todos', {
  type: 'keyvalue',  
  AccessController: WritePermissionAccessControllerFactory({
    ownerPeerId: helia.libp2p.peerId.toString() // Only owner can write
  })
})
```

### 2. Update Access Control Registration
```javascript
// Old system
AccessControllers: {
  'ipfs': IPFSAccessController
}

// New system
AccessControllers: {
  'write-permission': WritePermissionAccessControllerFactory()
}
```

### 3. Initialize Permission System
```javascript
// Add to initialization
await initializeWritePermissionSystem()
```

### 4. Update UI
Add the write permission management section to your UI (see UI Integration section above).

## Future Enhancements

Potential improvements to the write permission system:

1. **Role-Based Permissions**: Different permission levels (read, write, admin)
2. **Granular Permissions**: Permission for specific operations or data types
3. **Permission Delegation**: Allow permission holders to grant access to others
4. **Audit Trail**: Detailed logging of all permission changes
5. **Automatic Expiration Warnings**: Notify users before permissions expire
6. **Bulk Permission Management**: Grant/revoke permissions for multiple peers
7. **Permission Templates**: Pre-defined permission sets for common scenarios
