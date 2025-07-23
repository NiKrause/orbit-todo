# AI Assistant Prompt for Implementing Version Management

When engaging an AI assistant to implement a version management system similar to the `todo-p2p` project, use the following detailed prompt template.

## 📑 Comprehensive AI Prompt Template

I'm working on a project that requires a comprehensive version management system. Below is a step-by-step breakdown of the required implementation:

## Project Context

**Tech Stack**:
- Build System: Vite
- Language: Node.js
- Framework: Svelte
- Deployment: IPFS

## Task: Implement Version Management System

### 1. **package.json**
- **Version Source**: Ensure the `version` field in `package.json` is the single source of truth for the application version.
- **Semantic Versioning**: Follow standard semantic versioning (e.g., `0.0.1`).

### 2. **vite.config.js**
- **Objective**: Inject version number as a global constant available at build time.
- **Implementation**:
  - Import file and URL handling modules: `fileURLToPath` and `readFileSync`.
  - Read and parse `package.json` to access the version field.
  - Include a `define` section to map `__APP_VERSION__` to this version.
- **Code Sample**:
```javascript
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
```

### 3. **UI Components**
- **Global Access**: Use `__APP_VERSION__` in Svelte components to display the version.
- **Suggested Locations**:
  - **Title**: Inject in the browser tab title for easy visibility.
  - **Loading Screen**: Show version number during app initialization.
  - **Footer**: Display prominently for user reference.

### 4. **Automated Deployment Script (`ipfs-publish.sh`)**
- **Purpose**: Automate version bumping, building, and deployment process to IPFS.
- **In-Depth Steps**:
  - Use `npm version patch` to increment the patch version before building.
  - Build the application to ensure `__APP_VERSION__` is in-lined within the app bundle.
  - Publish to IPFS and pin the CID to ensure content availability.
  - Tag the commit in GitHub with the new version.
- **Full Script**:
```bash
#!/bin/bash
# -----------------------------------------------------------------------------
# Configurable variables
IPNS_KEY="k51qzi5uqu5dkuaghvbe0rxbz996wq9ln1neivu8cuncuyd966gq0r0js6ytvw"
IPNS_NAME="todo.le-space.de"
IPFS_SERVER="ipfs.le-space.de"

# Bump version automatically (patch level) and build the project
npm version patch
npm run build

# Run the ipfs add command and capture the output
output=$(ipfs add -r dist/)

# Extract the CID using awk or cut
cid=$(echo "$output" | tail -n 1 | awk '{print $2}')
echo "latest IPFS CID $cid"

# Run the ipfs name publish command with the extracted CID
ipfs name publish --key=$IPNS_NAME /ipfs/$cid
echo "IPFS name $IPNS_NAME updated with CID $cid"

# Pin the CID to ipfs.le-space.de
ssh -t root@$IPFS_SERVER "su ipfs -c 'ipfs pin add $cid'"
echo "IPFS CID $cid pinned to $IPFS_SERVER"

# Git commands
git commit -m "Update IPFS CID to $cid for version $version"
git tag -a "v$version" -m "Version $version"
git push origin main
git push origin --tags
```

## Constraints  Preferences
- Maintain existing code patterns and architecture.
- Ensure cross-component version consistency.
- Preserve automated build and deployment workflows.
- Keep within the scope of Vite and Svelte practices.

## Testing  Verification
- Verify version replacement in `dist` files after build.
- Confirm version displays correctly in UI components.
- Test full deployment workflow using provided scripts.

### Expected Deliverables
- Code examples, configuration updates, and testing suggestions.
- Document outcomes and any changes implemented.

---

**Template Version**: 1.0  
**Last Updated**: 2025-01-23

