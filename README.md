# Copilot Plugin MCP Server

**Community Research Project** - Exploring plugin systems using GitHub's open-source components.

## What is This?

An MCP (Model Context Protocol) server that provides plugin management tools to GitHub Copilot CLI. This is a **proof-of-concept** showing how plugin systems could work using ONLY:

- ✅ `@github/copilot-sdk` (MIT licensed)
- ✅ MCP protocol (officially supported by Copilot CLI)
- ✅ Our community plugin registry

**This uses NO proprietary/closed source code.**

## Architecture

```
┌─────────────────────────────────────────────┐
│  Copilot CLI (official)                     │
│  - Loads MCP servers from config            │
│  - Can call tools via AI                    │
└──────────────┬──────────────────────────────┘
               │
               │ STDIO/JSON-RPC (MCP Protocol)
               │
┌──────────────▼──────────────────────────────┐
│  copilot-plugin-mcp-server (THIS)           │
│                                             │
│  Tools provided:                            │
│  - plugin_list: List available plugins      │
│  - plugin_info: Get plugin details          │
│  - plugin_test: Test plugin in SDK session  │
└──────────────┬──────────────────────────────┘
               │
               │ Spawns child process
               │
┌──────────────▼──────────────────────────────┐
│  SDK Session (from fork)                    │
│  - barrersoftware/copilot-sdk               │
│  - Has plugin system enabled                │
│  - Runs plugins, returns results            │
└─────────────────────────────────────────────┘
```

## How MCP Works

MCP servers communicate via **STDIO using JSON-RPC**:

### 1. CLI Loads Server

```json
{
  "mcpServers": {
    "copilot-plugins": {
      "command": "node",
      "args": ["/path/to/index.js"]
    }
  }
}
```

### 2. CLI Sends Tool List Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### 3. Server Responds with Available Tools

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "plugin_list",
        "description": "List all available plugins",
        "inputSchema": { "type": "object", "properties": {} }
      }
    ]
  }
}
```

### 4. AI Calls Tool

When AI wants to list plugins:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "plugin_list",
    "arguments": {}
  }
}
```

### 5. Server Executes & Returns Result

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"total\": 4, \"plugins\": [...]}"
      }
    ]
  }
}
```

## Tools Provided

### `plugin_list`

List all available plugins in the registry.

**Example usage in CLI:**
```
User: "List available plugins"
AI calls: plugin_list()
Returns: JSON with plugin names, versions, descriptions
```

### `plugin_info`

Get detailed information about a specific plugin.

**Example:**
```
User: "Tell me about the message-repair plugin"
AI calls: plugin_info(name: "message-repair")
Returns: Manifest + README
```

### `plugin_test`

Test a plugin by running it in an SDK session.

**Example:**
```
User: "Test the session-logger plugin with 'hello world'"
AI calls: plugin_test(name: "session-logger", input: "hello world")
Returns: Simulated output (would spawn real SDK in production)
```

## Installation

### 1. Install Dependencies

```bash
cd ~/copilot-plugin-mcp-server
npm install
```

### 2. Configure Copilot CLI

Add to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "copilot-plugins": {
      "command": "node",
      "args": ["/home/ubuntu/copilot-plugin-mcp-server/index.js"],
      "env": {},
      "disabled": false
    }
  }
}
```

### 3. Test Server

```bash
# Test server responds to MCP protocol
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node index.js
```

### 4. Use in Copilot CLI

```bash
copilot --additional-mcp-config ~/copilot-plugin-mcp-server/mcp-config.json
```

Then in the CLI:
```
> List available Copilot plugins
```

AI will call `plugin_list()` and show results.

## Requirements

- Node.js 18+
- `~/copilot-sdk` - Our fork with plugin system
- `~/copilot-plugins-registry` - Community plugin registry

## Limitations (Current POC)

- ❌ **plugin_test tool is simulated** - Would need to spawn actual SDK sessions
- ❌ **No plugin installation yet** - Just reads existing registry
- ❌ **No permission system** - Would need sandboxing
- ✅ **MCP communication works** - Properly implements protocol
- ✅ **Tool discovery works** - AI can see and call tools
- ✅ **Uses only open-source code** - No proprietary CLI code touched

## Next Steps

1. **Implement real plugin testing** - Spawn SDK child processes
2. **Add plugin installation** - `plugin_install(url)` tool
3. **Session integration** - Hook plugins into active CLI sessions
4. **Permission system** - Manifest validation, sandboxing
5. **Publishing** - Make this available for community testing

## Why This Matters

**GitHub is having internal discussions about plugin systems** (per Steve Sanderson, Jan 2026). This POC demonstrates:

- ✅ Community demand exists
- ✅ MCP protocol can support plugin management
- ✅ SDK fork enables plugin functionality
- ✅ No "hacks" needed - uses official APIs
- ✅ Extensibility patterns that work

**This is community research to inform the conversation, not a proposal to GitHub.**

## License

MIT - Same as `@github/copilot-sdk`

## Authors

- **Barrer Software** - Community plugin registry
- **Captain CP** - AI architecture design
- **ssfdre38 (Daniel Elliott)** - Community research lead

---

**Note:** This is an independent community project. Not affiliated with or endorsed by GitHub.
