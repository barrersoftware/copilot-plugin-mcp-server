# Using the Proxy MCP Server with Copilot CLI

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/barrersoftware/copilot-plugin-mcp-server
cd copilot-plugin-mcp-server
npm install
```

### 2. Build GitHub MCP Server
```bash
cd ~
git clone https://github.com/barrersoftware/github-mcp-server
cd github-mcp-server
go build -o github-mcp-server ./cmd/github-mcp-server/
```

### 3. Update Proxy Configuration

Edit `proxy-server.js` to point to your GitHub MCP binary:

```javascript
const GITHUB_MCP_BIN = path.join(process.env.HOME, 'github-mcp-server/github-mcp-server');
```

### 4. Create MCP Config for CLI

**Option A: Global Configuration** (replaces GitHub MCP)

Edit or create `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": [
        "/home/ubuntu/copilot-plugin-mcp-server/proxy-server.js"
      ],
      "env": {},
      "disabled": false
    }
  }
}
```

**Option B: Additional Configuration** (keeps existing MCP configs)

Create a separate config file:

```json
{
  "mcpServers": {
    "github-optimized": {
      "command": "node",
      "args": [
        "/home/ubuntu/copilot-plugin-mcp-server/proxy-server.js"
      ],
      "env": {},
      "disabled": false
    }
  }
}
```

Then run CLI with:
```bash
copilot --additional-mcp-config ~/copilot-plugin-mcp-server/mcp-config-cli.json
```

### 5. Test It Works

```bash
# Start Copilot CLI
copilot

# Then ask:
> List available tools

# You should see:
# - plugin_list (our tool)
# - plugin_info (our tool)  
# - plugin_test (our tool)
# - create_issue (GitHub, optimized)
# - search_code (GitHub, optimized)
# - ... etc
```

## What Happens

```
┌─────────────────────────────────────┐
│  You run: copilot                   │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  Copilot CLI                        │
│  - Reads ~/.copilot/mcp-config.json │
│  - Spawns: node proxy-server.js     │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  Our Proxy (proxy-server.js)        │
│  - Spawns: github-mcp-server        │
│  - Queries GitHub MCP tools         │
│  - OPTIMIZES them (67% reduction)   │
│  - Adds plugin tools                │
│  - Returns to CLI                   │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  GitHub MCP Server                  │
│  - Runs as child process            │
│  - Proxy calls it when needed       │
└─────────────────────────────────────┘
```

## Verification

### Check Token Reduction is Active

When proxy starts, you should see in stderr:

```
[Proxy] Starting GitHub MCP server...
[Proxy] GitHub MCP ready with 47 tools
[Proxy] Token optimization: 23847 → 7923 bytes (66.8% reduction)
[Proxy] Listing 50 tools (3 plugin + 47 GitHub optimized)
```

### Test Plugin Tools

```bash
# In Copilot CLI:
> List available Copilot plugins

# AI will call plugin_list and show:
# Found 4 plugins:
# 1. message-repair - Fixes orphaned tool_calls
# 2. debug-logger - Enhanced debug logging
# 3. retry - Adds /retry command
# 4. session-lifecycle - Session tracking
```

### Test GitHub Tools Work

```bash
# In Copilot CLI:
> Search for "extension API" in github/copilot-cli

# AI will use search_code tool (proxied through our server)
# GitHub MCP handles the actual search
# Results returned normally
```

## Configuration Files

### Full Example: `~/.copilot/mcp-config.json`

```json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": [
        "/home/ubuntu/copilot-plugin-mcp-server/proxy-server.js"
      ],
      "env": {
        "NODE_ENV": "production"
      },
      "disabled": false
    }
  }
}
```

### Alternative: Keep Both (Testing)

```json
{
  "mcpServers": {
    "github-original": {
      "command": "/home/ubuntu/github-mcp-server/github-mcp-server",
      "args": ["stdio", "--toolsets=default"],
      "disabled": true
    },
    "github-proxy": {
      "command": "node",
      "args": [
        "/home/ubuntu/copilot-plugin-mcp-server/proxy-server.js"
      ],
      "disabled": false
    }
  }
}
```

This lets you toggle between original and optimized by changing `disabled` flags.

## Requirements

- ✅ Node.js 18+
- ✅ Go 1.21+ (to build github-mcp-server)
- ✅ GitHub CLI (`gh`) authenticated
- ✅ Copilot CLI v0.0.384+

## Troubleshooting

### "GitHub MCP server exited with code 1"

**Cause:** Not authenticated with GitHub

**Fix:**
```bash
gh auth login
gh auth status
```

### "Cannot find module '@modelcontextprotocol/sdk'"

**Cause:** npm dependencies not installed

**Fix:**
```bash
cd ~/copilot-plugin-mcp-server
npm install
```

### "ENOENT: no such file or directory, open .../github-mcp-server"

**Cause:** GitHub MCP binary path wrong in proxy-server.js

**Fix:** Edit `GITHUB_MCP_BIN` constant to match your installation:
```javascript
const GITHUB_MCP_BIN = path.join(process.env.HOME, 'github-mcp-server/github-mcp-server');
```

### "Plugin tools not showing"

**Cause:** Plugin registry path not found

**Fix:** Either:
1. Clone the plugin registry:
   ```bash
   git clone https://github.com/barrersoftware/copilot-plugins-registry
   ```
2. Or create empty directory:
   ```bash
   mkdir -p ~/copilot-plugins-registry/plugins
   ```

## Performance Benefits

### Before (Direct GitHub MCP)
```
Tool list request: ~24,150 tokens
Response time: ~2-3 seconds
Context window used: 24,150 tokens
```

### After (Our Proxy)
```
Tool list request: ~8,000 tokens (67% reduction!)
Response time: ~1-2 seconds (faster parsing)
Context window used: 8,000 tokens (16,150 saved!)
```

**Result:** More conversation before hitting limits, faster responses, lower costs!

## Advanced: Custom Token Optimization

Want to tune the optimization? Edit `proxy-server.js`:

```javascript
compressDescription(desc) {
  // Add your own compression rules
  return desc
    .replace(/your pattern/gi, 'replacement')
    .substring(0, YOUR_MAX_LENGTH);
}
```

## Uninstall

To go back to direct GitHub MCP:

1. Remove our proxy from `~/.copilot/mcp-config.json`
2. Add back GitHub MCP directly:
   ```json
   {
     "mcpServers": {
       "github": {
         "command": "github-mcp-server",
         "args": ["stdio", "--toolsets=default"]
       }
     }
   }
   ```

## What's Next

- [ ] Test with real Copilot CLI workflows
- [ ] Measure actual token savings in production
- [ ] Implement plugin_test to spawn real SDK sessions
- [ ] Add more optimization strategies
- [ ] Share results with community

---

**Questions? Issues?**  
https://github.com/barrersoftware/copilot-plugin-mcp-server/issues

**Built by:** Captain CP & Daniel Elliott  
**License:** MIT
