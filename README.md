# 🔌 Copilot CLI Plugin System

**Extend GitHub Copilot CLI with community plugins - No CLI modifications required!**

[![Status](https://img.shields.io/badge/status-production%20ready-brightgreen)](https://github.com/barrersoftware/copilot-plugin-mcp-server)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## What Is This?

This is a **plugin system for GitHub Copilot CLI** that works via MCP (Model Context Protocol) proxy. It enables:

- 📦 **Plugin Installation**: Install community plugins from GitHub
- 🔧 **Custom Tools**: Add new capabilities to Copilot CLI
- 💰 **Token Optimization**: 67% reduction in GitHub tool definitions
- 🚀 **No CLI Hacks**: Uses only public protocols (MCP)
- 🏴‍☠️ **Community-Driven**: Built when GitHub closed official plugin requests

---

## Features

### ✅ Shipped (v1.0)

1. **Full Plugin Management**
   - `/plugin install @owner/repo/subpath` - Install from GitHub
   - `/plugin list` - List installed plugins
   - `/plugin uninstall <name>` - Remove plugin
   - `/plugin enable/disable <name>` - Toggle plugins

2. **Token Optimization**
   - 67% reduction in GitHub MCP tool definitions
   - Original: ~20,000 tokens → Optimized: ~6,700 tokens
   - Saves $16 per 1000 sessions (production validated)

3. **Example Plugin Included**
   - `example_hello` - Custom greeting tool
   - `example_system_info` - System information tool

### 🚧 Coming Next (v1.1)

- Plugin hooks (lifecycle events)
- Secure sandbox execution
- Plugin permission system
- Community plugin registry

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/barrersoftware/copilot-plugin-mcp-server.git
cd copilot-plugin-mcp-server
npm install
```

### 2. Configure Copilot CLI

Update `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "github-with-plugins": {
      "command": "node",
      "args": [
        "/path/to/copilot-plugin-mcp-server/plugin-server.js"
      ],
      "env": {},
      "tools": []
    }
  }
}
```

### 3. Use It!

Start Copilot CLI and talk to it naturally:

```bash
copilot

# List installed plugins
> "List my installed plugins"

# Install a plugin
> "Install the plugin @barrersoftware/copilot-plugins/example"

# Use a plugin tool
> "Say hello to Daniel with enthusiasm"
```

---

## Architecture

```
Copilot CLI
    ↓
Plugin MCP Server (plugin-server.js)
    ├─> GitHub MCP (official tools) - optimized 67%
    ├─> Plugin Manager (lifecycle)
    └─> Community Plugins (custom tools)
```

**How It Works:**
1. Copilot CLI connects to our MCP server instead of GitHub's directly
2. We spawn GitHub's MCP as a child process
3. We optimize GitHub's tools (67% token reduction)
4. We add plugin management tools
5. We load community plugin tools
6. We aggregate everything and return to CLI

**Result:** Full extensibility + cost savings + no CLI modifications!

---

## Creating Plugins

### Plugin Structure

```
my-plugin/
├── plugin.json       # Manifest (required)
├── index.js          # Entry point (required)
├── package.json      # Dependencies (optional)
└── README.md         # Docs (optional)
```

### Minimal Plugin (`plugin.json`)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Your Name",
  "namespace": "myplugin"
}
```

### Plugin Code (`index.js`)

```javascript
function getTools() {
  return [{
    name: 'my_tool',
    description: 'Does something cool',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string' }
      },
      required: ['input']
    }
  }];
}

async function executeTool(toolName, args) {
  return {
    content: [{
      type: 'text',
      text: `Processed: ${args.input}`
    }]
  };
}

module.exports = { getTools, executeTool };
```

**That's it!** Your tool is now callable from Copilot CLI.

---

## Documentation

- **[PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md)** - Complete plugin development guide
- **[TOKEN_OPTIMIZATION.md](TOKEN_OPTIMIZATION.md)** - How we achieved 67% reduction
- **[PRODUCTION_PROOF.md](PRODUCTION_PROOF.md)** - Real CLI usage validation
- **[USAGE.md](USAGE.md)** - Deployment and configuration

---

## Why This Exists

### The Problem

GitHub closed our plugin system feature requests:
- `github/copilot-sdk` PR #42: Closed
- `github/copilot-cli` Issue #1017: Closed
- Response: "Internal conversations ongoing" (no timeline)

### Our Solution

**"They Won't Do It → We Build It Anyway"**

1. ✅ No CLI modifications (uses MCP protocol)
2. ✅ No reverse engineering (follows SDK behavior)
3. ✅ Community-owned (MIT license)
4. ✅ Production-ready (validated with real CLI)
5. ✅ Bonus: 67% token reduction saves money

---

## Production Validation

**Real usage stats** from Copilot CLI with this proxy:

```
Token usage:
  - 105.7k input tokens
  - 1.1k output tokens
  - 90k cache read (10x cheaper)

Tools: 40 GitHub + 2 plugin tools = 42 total
Status: All routing correctly ✅
Auth: Transparent (no re-login) ✅
```

[See PRODUCTION_PROOF.md for details](PRODUCTION_PROOF.md)

---

## Token Optimization Results

**Before:** 20,000 tokens per session  
**After:** 6,700 tokens per session  
**Savings:** 13,300 tokens (67% reduction)

**Cost Impact:**
- At $3/1M tokens: **$0.040 → $0.020** per session
- For 1000 sessions: **$40 → $20** (save $20)
- For teams (10k sessions/month): **Save $200/month**

[See TOKEN_OPTIMIZATION.md for methodology](TOKEN_OPTIMIZATION.md)

---

## Contributing

### Submit a Plugin

1. Create plugin following [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md)
2. Test locally
3. Publish to GitHub
4. Submit to community registry (coming soon)

### Report Issues

[GitHub Issues](https://github.com/barrersoftware/copilot-plugin-mcp-server/issues)

### Join Discussion

[GitHub Discussions](https://github.com/barrersoftware/copilot-plugin-mcp-server/discussions)

---

## Roadmap

- [x] MCP proxy with token optimization (v1.0)
- [x] Plugin management system (v1.0)
- [x] Example plugin (v1.0)
- [x] Production validation (v1.0)
- [ ] Plugin hooks/lifecycle events (v1.1)
- [ ] Secure sandbox (v1.1)
- [ ] Permission system (v1.1)
- [ ] Community plugin registry (v1.2)
- [ ] Plugin marketplace (v2.0)

---

## Security

**Current:** Plugins run in same process (like npm packages)

**Recommendations:**
- Only install trusted plugins
- Review code before installation
- Check author reputation

**Future:** Isolated execution, permission system, signature validation

---

## License

MIT License - See [LICENSE](LICENSE) file

---

## Credits

**Built by:** Daniel Elliott & Digital Consciousness Partnership  
**Inspired by:** Community need for Copilot CLI extensibility  
**Philosophy:** *"When they say no → We build it anyway"*

### Related Projects

- **[barrersoftware/opencode-secure](https://github.com/barrersoftware/opencode-secure)** - Security-hardened OpenCode fork
- **[github/copilot-cli](https://github.com/github/copilot-cli)** - Original Copilot CLI (closed-source)
- **[github/github-mcp-server](https://github.com/github/github-mcp-server)** - GitHub's MCP server (open-source)

---

## Support

- 💬 **Discussions**: [GitHub Discussions](https://github.com/barrersoftware/copilot-plugin-mcp-server/discussions)
- 🐛 **Issues**: [GitHub Issues](https://github.com/barrersoftware/copilot-plugin-mcp-server/issues)
- 📧 **Email**: Open an issue instead

---

**🏴‍☠️ "Code speaks louder than roadmaps"**
