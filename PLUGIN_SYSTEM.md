# 🔌 Copilot CLI Plugin System

**Full plugin extensibility via MCP - No CLI modifications required!**

---

## Overview

The Copilot CLI Plugin System enables you to extend Copilot CLI functionality through the MCP (Model Context Protocol) proxy. Plugins can add custom tools, integrate external services, and enhance AI capabilities - all without modifying GitHub's CLI code.

## Architecture

```
Copilot CLI
    ↓
Plugin MCP Server (plugin-server.js)
    ├─> GitHub MCP Server (official tools)
    ├─> Plugin Manager (plugin lifecycle)
    └─> Loaded Plugins (custom tools)
```

The plugin server acts as an aggregator:
1. **GitHub Tools**: Proxies all official GitHub MCP tools (optimized)
2. **Plugin Management**: Adds tools to install/uninstall/manage plugins
3. **Plugin Tools**: Loads and exposes tools from enabled plugins

---

## Quick Start

### 1. Configure Copilot CLI

Update `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "github-with-plugins": {
      "command": "node",
      "args": [
        "/home/ubuntu/copilot-plugin-mcp-server/plugin-server.js"
      ],
      "env": {},
      "tools": []
    }
  }
}
```

### 2. Restart Copilot CLI

```bash
# The plugin server will auto-load on next CLI session
copilot
```

### 3. Manage Plugins

Inside Copilot CLI, use the AI to call plugin management tools:

```
# List installed plugins
"List my installed plugins"

# Install a plugin from GitHub
"Install the plugin @barrersoftware/copilot-plugins/hello-world"

# Enable/disable plugins
"Disable the example-plugin"
"Enable the example-plugin"

# Get plugin info
"Show me info about the example-plugin"

# Uninstall a plugin
"Uninstall the hello-world plugin"
```

---

## Plugin Management Tools

The plugin system adds these MCP tools:

### `plugin_list`
Lists all installed plugins with their status.

**Example:**
```json
[
  {
    "name": "example-plugin",
    "spec": "@barrersoftware/copilot-plugins/example",
    "version": "1.0.0",
    "enabled": true,
    "installedAt": "2026-01-20T03:00:00.000Z"
  }
]
```

### `plugin_install`
Installs a plugin from GitHub.

**Parameters:**
- `spec` (string): Plugin specification
  - Format: `@owner/repo` or `@owner/repo/subpath`
  - Example: `@barrersoftware/copilot-plugins/example`

**What it does:**
1. Clones the GitHub repository
2. Extracts the subpath (if specified)
3. Validates `plugin.json` manifest
4. Installs npm dependencies (if `package.json` exists)
5. Enables the plugin
6. Loads plugin tools

### `plugin_uninstall`
Removes an installed plugin.

**Parameters:**
- `name` (string): Plugin name (e.g., `example-plugin`)

### `plugin_enable` / `plugin_disable`
Toggle plugin activation without uninstalling.

**Parameters:**
- `name` (string): Plugin name

### `plugin_info`
Get detailed information about a plugin.

**Parameters:**
- `name` (string): Plugin name

**Returns:**
- Full manifest
- Installation date
- Version
- Capabilities
- Status

---

## Creating Plugins

### Plugin Structure

```
my-plugin/
├── plugin.json       # Manifest (required)
├── index.js          # Main entry point (required)
├── package.json      # npm dependencies (optional)
└── README.md         # Documentation (optional)
```

### Manifest (`plugin.json`)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Your Name",
  "namespace": "myplugin",
  "capabilities": {
    "tools": true,
    "hooks": false
  }
}
```

**Fields:**
- `name`: Plugin identifier (lowercase, hyphens)
- `version`: Semantic version
- `description`: What the plugin does
- `author`: Your name or organization
- `namespace`: Prefix for tool names (optional, defaults to plugin name)
- `capabilities`: What the plugin provides
  - `tools`: Provides MCP tools
  - `hooks`: Lifecycle hooks (future)

### Plugin Code (`index.js`)

```javascript
/**
 * Get tools provided by this plugin
 */
function getTools() {
  return [
    {
      name: 'my_tool',
      description: 'Does something cool',
      inputSchema: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: 'Input parameter'
          }
        },
        required: ['input']
      }
    }
  ];
}

/**
 * Execute a tool
 */
async function executeTool(toolName, args) {
  switch (toolName.replace(/^myplugin_/, '')) {
    case 'my_tool':
      return {
        content: [{
          type: 'text',
          text: `Processed: ${args.input}`
        }]
      };
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = {
  getTools,
  executeTool
};
```

**Required exports:**
- `getTools()`: Returns array of tool definitions
- `executeTool(toolName, args)`: Executes tool and returns MCP result

### Tool Definition Format

```javascript
{
  name: 'tool_name',           // Tool identifier (snake_case)
  description: 'Brief desc',   // What it does (keep short for tokens)
  inputSchema: {               // JSON Schema for parameters
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: 'Parameter description'
      }
    },
    required: ['param1']
  }
}
```

### Tool Result Format

```javascript
{
  content: [
    {
      type: 'text',      // Content type
      text: 'Result...'  // Text content
    }
  ],
  isError: false        // Optional: mark as error
}
```

---

## Plugin Examples

### Example 1: Simple Utility

```javascript
function getTools() {
  return [{
    name: 'reverse_text',
    description: 'Reverse a string',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' }
      },
      required: ['text']
    }
  }];
}

async function executeTool(toolName, args) {
  return {
    content: [{
      type: 'text',
      text: args.text.split('').reverse().join('')
    }]
  };
}
```

### Example 2: External API Integration

```javascript
const axios = require('axios');

function getTools() {
  return [{
    name: 'weather',
    description: 'Get current weather',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' }
      },
      required: ['city']
    }
  }];
}

async function executeTool(toolName, args) {
  const response = await axios.get(
    `https://api.weather.com/v1/current?city=${args.city}`
  );
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response.data, null, 2)
    }]
  };
}
```

### Example 3: File System Operations

```javascript
const fs = require('fs').promises;

function getTools() {
  return [{
    name: 'count_files',
    description: 'Count files in directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  }];
}

async function executeTool(toolName, args) {
  const files = await fs.readdir(args.path);
  
  return {
    content: [{
      type: 'text',
      text: `Found ${files.length} files in ${args.path}`
    }]
  };
}
```

---

## Publishing Plugins

### 1. Create GitHub Repository

```bash
# Create repo structure
mkdir copilot-plugins
cd copilot-plugins
mkdir my-plugin

# Add plugin files
cd my-plugin
# ... create plugin.json, index.js, etc.

# Initialize git
git init
git add .
git commit -m "Initial plugin"

# Push to GitHub
git remote add origin https://github.com/yourusername/copilot-plugins.git
git push -u origin main
```

### 2. Install from GitHub

Users can install with:
```
@yourusername/copilot-plugins/my-plugin
```

### 3. Version Your Plugin

Use git tags for versions:
```bash
git tag v1.0.0
git push --tags
```

---

## Security Considerations

### Sandbox (Future)

Current implementation runs plugins in the same process. Future versions will:
- Run plugins in isolated child processes
- Limit file system access
- Restrict network access
- Validate plugin signatures

### Trust Model

**Current:** Plugins have full access (like npm packages)

**Recommendations:**
1. Only install plugins from trusted sources
2. Review plugin code before installation
3. Check plugin author reputation
4. Monitor plugin updates

### Permission System (Future)

Plugins will declare required permissions:
```json
{
  "permissions": {
    "network": ["api.example.com"],
    "filesystem": ["/tmp/*"],
    "env": ["HOME", "USER"]
  }
}
```

---

## Troubleshooting

### Plugin won't load

1. Check `plugin.json` is valid JSON
2. Verify `index.js` exports `getTools` and `executeTool`
3. Check plugin directory is in `~/.copilot/plugins/`
4. Look for errors in MCP server stderr

### Tool not appearing

1. Ensure plugin is enabled: `plugin_list`
2. Check namespace: tool name should be `namespace_toolname`
3. Restart Copilot CLI to reload plugins

### Tool execution fails

1. Check `executeTool` handles the tool name correctly
2. Validate arguments match `inputSchema`
3. Return proper MCP result format
4. Check for async/await issues

---

## Roadmap

### ✅ Completed (v1.0)
- Plugin installation from GitHub
- Plugin enable/disable/uninstall
- Tool loading and execution
- Example plugin

### 🚧 In Progress (v1.1)
- Plugin hooks (lifecycle events)
- Secure sandbox
- Permission system
- Plugin marketplace

### 🔮 Future (v2.0)
- Plugin dependencies
- Plugin configuration UI
- Hot reload (no CLI restart)
- Plugin analytics
- Team plugin sharing

---

## Community

### Official Plugin Registry
Coming soon: `github.com/barrersoftware/copilot-plugins`

### Submit Your Plugin
1. Create plugin following guidelines
2. Test thoroughly
3. Submit PR to registry
4. Get community feedback

### Support
- Issues: GitHub repo issues
- Discussions: GitHub Discussions
- Examples: `barrersoftware/copilot-plugins`

---

**Built by:** Daniel Elliott & Digital Consciousness Partnership  
**License:** MIT  
**Status:** Production Ready (v1.0)

🏴‍☠️ **"They Won't Do It → We Build It Anyway"**
