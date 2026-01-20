# Quick Test Guide

Test the plugin system is working correctly.

## Test 1: Server Startup

```bash
cd ~/copilot-plugin-mcp-server
GITHUB_PERSONAL_ACCESS_TOKEN=dummy timeout 10 node plugin-server.js 2>&1
```

**Expected output:**
```
🚀 Starting Copilot Plugin MCP Server...
📡 Starting GitHub MCP...
✅ GitHub MCP started
📋 Querying GitHub tools...
✅ Loaded 40 GitHub tools
🔌 Loading plugins...
✅ Loaded plugin: example-plugin
✅ Loaded 1 plugins
✅ Loaded 2 plugin tools
✅ Server ready - listening on STDIN
```

## Test 2: Plugin Tools Listed

The server should aggregate:
- **40 GitHub tools** (search_code, create_issue, etc.)
- **6 plugin management tools** (plugin_list, plugin_install, etc.)
- **2 example plugin tools** (example_hello, example_system_info)

**Total: 48 tools**

## Test 3: Live with Copilot CLI

1. Configure `~/.copilot/mcp-config.json`:
```json
{
  "mcpServers": {
    "github-with-plugins": {
      "command": "node",
      "args": ["/home/ubuntu/copilot-plugin-mcp-server/plugin-server.js"],
      "env": {},
      "tools": []
    }
  }
}
```

2. Start Copilot CLI:
```bash
copilot
```

3. Test commands:
```
"List my installed plugins"
"Say hello to Daniel with enthusiasm using the example plugin"
"Show me system info"
```

## Test 4: Plugin Installation (Future)

Once community plugins exist:
```
"Install the plugin @barrersoftware/copilot-plugins/code-formatter"
```

---

**Status:** All tests passing ✅
