# Version Management System

## Overview

The P2P TODO List application implements an automated version management system that synchronizes version information across the entire application stack - from package.json through the web interface to deployment and Git tagging.

## System Architecture

```
package.json (source of truth)
    ↓
vite.config.js (reads version at build time)
    ↓
__APP_VERSION__ (global constant)
    ↓
UI Components (displays version)
    ↓
ipfs-publish.sh (automated deployment)
    ↓
Git Tags & IPFS Publishing
```

## Components

### 1. Version Source (`package.json`)
- **Location**: Root level `version` field
- **Format**: Semantic versioning (e.g., `"0.0.1"`)
- **Role**: Single source of truth for all version information

### 2. Build-Time Injection (`vite.config.js`)

```javascript
// Reads package.json version at build time
const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

// Injects as global constant
define: {
  __APP_VERSION__: JSON.stringify(pkg.version),
}
```

**Key Features:**
- ✅ No runtime dependencies
- ✅ Version embedded at build time
- ✅ Available globally as `__APP_VERSION__`
- ✅ Automatically updates when version changes

### 3. UI Display Locations

The version appears in **4 strategic locations**:

#### 3.1 Browser Title (`src/App.svelte`)
```svelte
<svelte:head>
  <title>P2P TODO List {__APP_VERSION__}</title>
</svelte:head>
```

#### 3.2 Loading Screen
```svelte
{#if loading}
  <div class="text-center py-8">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
    <p class="mt-4 text-gray-600">Initializing P2P connection...</p>
    <p class="mt-2 text-xs text-gray-400">v{__APP_VERSION__}</p>
  </div>
```

#### 3.3 Footer (Primary Display)
```svelte
<footer class="mt-10 text-center text-xs text-gray-500 space-y-1">
  <div class="font-medium text-gray-600">
    P2P TODO List v{__APP_VERSION__}
  </div>
  <!-- Technical information follows -->
</footer>
```

#### 3.4 Meta Tags
```svelte
<meta name="description" content="A peer-to-peer TODO list application using OrbitDB and IPFS">
```

### 4. Automated Publishing (`ipfs-publish.sh`)

The publish script handles the complete deployment pipeline:

```bash
#!/bin/bash
# Bump version automatically (patch level) and build the project
npm version patch
npm run build

# IPFS publishing workflow
# ... (IPFS operations)

# Git tagging and pushing
version=$(node -p "require('./package.json').version")
git commit -m "Update IPFS CID to $cid for version $version"
git tag -a "v$version" -m "Version $version"
git push origin main
git push origin --tags
```

**Features:**
- ✅ Automatic version bumping (`npm version patch`)
- ✅ Fresh build with new version embedded
- ✅ IPFS publishing with CID tracking
- ✅ Git tagging with semantic versions
- ✅ Remote server pinning and validation

### 5. npm Scripts Integration

```json
{
  "scripts": {
    "dev": "vite --port 5173",
    "build": "vite build",
    "ipfs-publish": "./ipfs-publish.sh"
  }
}
```

## Usage Guide

### Development Workflow

```bash
# Start development with version display
npm run dev

# Build with current version embedded
npm run build

# Test version integration
grep -r "0.0.1" dist/  # Should find version in built files
```

### Publishing Workflow

```bash
# Complete automated publish (recommended)
npm run ipfs-publish

# Manual version management (if needed)
npm version patch  # 0.0.1 → 0.0.2
npm version minor  # 0.0.2 → 0.1.0  
npm version major  # 0.1.0 → 1.0.0
```

### Version Information Access

In any Svelte component:
```svelte
<script>
  // Version is available globally
  console.log('App version:', __APP_VERSION__);
</script>

<p>Running version: {__APP_VERSION__}</p>
```

## Technical Implementation Details

### Build Process Flow

1. **Vite Configuration Phase**
   - Reads `package.json` synchronously
   - Parses version string
   - Creates global constant definition

2. **Build Phase**
   - Vite processes all source files
   - Replaces `__APP_VERSION__` with actual version string
   - Generates optimized production bundle

3. **Runtime Phase**
   - Version appears as string literals in built code
   - No runtime JSON parsing or file reading
   - Zero performance impact

### Version Synchronization

| Component | Version Source | Update Trigger |
|-----------|---------------|----------------|
| `package.json` | Manual/npm version | Developer action |
| `vite.config.js` | Reads package.json | Build time |
| UI Components | `__APP_VERSION__` | Build time |
| Git Tags | package.json | Deploy script |
| IPFS Metadata | package.json | Deploy script |

### Security Considerations

- ✅ Version embedded at build time (no runtime exposure)
- ✅ No sensitive information in version strings
- ✅ Standard semantic versioning format
- ✅ Git tags provide audit trail

## Troubleshooting

### Common Issues

**Problem**: Version not updating in UI
```bash
# Solution: Ensure clean build
rm -rf dist/
npm run build
```

**Problem**: `__APP_VERSION__` appears as literal text
```bash
# Check vite.config.js has define section
grep -A 5 "define:" vite.config.js
```

**Problem**: Git tag conflicts during publish
```bash
# Check existing tags
git tag -l
# Remove problematic tag if needed
git tag -d v0.0.1
```

### Verification Commands

```bash
# Verify version in built files
npm run build && grep -r "$(node -p 'require("./package.json").version')" dist/

# Verify vite configuration
node -e "console.log('Version reading works:', require('fs').readFileSync('vite.config.js', 'utf8').includes('__APP_VERSION__'))"

# Test publish script components
./ipfs-publish.sh --dry-run  # If implemented
```

## Dependencies

### Required
- ✅ **vite**: Build tool and dev server
- ✅ **Node.js**: Built-in `fs` and `JSON.parse()`

### Optional  
- ✅ **IPFS CLI**: For publishing functionality
- ✅ **Git**: For version tagging
- ✅ **SSH Access**: For remote server operations

## Best Practices

1. **Always use npm version commands** for version bumping
2. **Test locally before publishing** to verify version display
3. **Keep version format consistent** with semantic versioning
4. **Monitor Git tags** to avoid conflicts
5. **Document version changes** in commit messages

## Migration Notes

This implementation was modeled after the `bolt-orbitdb-blog` project and provides:
- ✅ Identical version injection mechanism
- ✅ Similar UI placement strategy  
- ✅ Compatible publishing workflow
- ✅ Consistent developer experience

## Future Enhancements

Potential improvements for consideration:
- [ ] Build timestamp alongside version
- [ ] Environment-specific version suffixes
- [ ] Automated changelog generation
- [ ] Version comparison in UI updates
- [ ] API version header injection
