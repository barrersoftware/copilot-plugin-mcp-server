#!/usr/bin/env node

/**
 * Copilot Plugin Proxy MCP Server
 * 
 * PROXY ARCHITECTURE:
 * - Aggregates GitHub MCP tools + our plugin tools
 * - CLI sees ONE unified MCP server
 * - Plugin testing spawns SDK with GitHub MCP access
 * 
 * Flow:
 * 1. Spawn GitHub MCP server as child
 * 2. Query its tools
 * 3. Merge with our plugin tools
 * 4. Proxy GitHub tool calls → GitHub MCP
 * 5. Handle plugin tool calls ourselves
 * 6. For plugin_test: spawn SDK + plugin + GitHub MCP
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
  CallToolRequestSchema, 
  ListToolsRequestSchema 
} = require('@modelcontextprotocol/sdk/types.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const readline = require('readline');

// Paths
const SDK_PATH = path.join(process.env.HOME, 'copilot-sdk');
const PLUGIN_REGISTRY = path.join(process.env.HOME, 'copilot-plugins-registry/plugins');
const GITHUB_MCP_BIN = path.join(process.env.HOME, 'github-mcp-server/github-mcp-server');

class ProxyMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'copilot-plugin-proxy',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Our plugin tools
    this.pluginTools = [
      {
        name: 'plugin_list',
        description: 'List all available Copilot plugins in the community registry',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'plugin_info',
        description: 'Get detailed information about a specific Copilot plugin',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Plugin name',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'plugin_test',
        description: 'Test a plugin by running it in an SDK session with full GitHub MCP access',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Plugin name to test',
            },
            input: {
              type: 'string',
              description: 'Test input/prompt to send to the plugin-enabled session',
            },
          },
          required: ['name', 'input'],
        },
      },
    ];

    this.githubTools = [];
    this.githubMcp = null;
    this.githubMcpReady = false;
    this.jsonRpcId = 0;

    this.setupHandlers();
  }

  async startGitHubMCP() {
    console.error('[Proxy] Starting GitHub MCP server...');
    
    // Spawn GitHub MCP server with stdio command
    this.githubMcp = spawn(GITHUB_MCP_BIN, ['stdio', '--toolsets=default'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env, // Pass through GitHub token
    });

    // Handle GitHub MCP stderr (debug logs)
    this.githubMcp.stderr.on('data', (data) => {
      console.error('[GitHub MCP]', data.toString().trim());
    });

    // Handle GitHub MCP process exit
    this.githubMcp.on('exit', (code) => {
      console.error(`[Proxy] GitHub MCP server exited with code ${code}`);
      this.githubMcpReady = false;
    });

    // Query GitHub MCP for its tools
    try {
      const tools = await this.queryGitHubTools();
      this.githubTools = tools;
      this.githubMcpReady = true;
      console.error(`[Proxy] GitHub MCP ready with ${tools.length} tools`);
    } catch (error) {
      console.error('[Proxy] Failed to query GitHub MCP tools:', error.message);
      this.githubTools = [];
      this.githubMcpReady = false;
    }
  }

  async queryGitHubTools() {
    return new Promise((resolve, reject) => {
      const requestId = ++this.jsonRpcId;
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/list',
        params: {},
      });

      let responseBuffer = '';
      const timeout = setTimeout(() => {
        reject(new Error('Timeout querying GitHub MCP tools'));
      }, 10000);

      const onData = (data) => {
        responseBuffer += data.toString();
        
        // Try to parse JSON-RPC response
        try {
          const lines = responseBuffer.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const response = JSON.parse(line);
            if (response.id === requestId && response.result) {
              clearTimeout(timeout);
              this.githubMcp.stdout.removeListener('data', onData);
              resolve(response.result.tools || []);
              return;
            }
          }
        } catch (err) {
          // Not complete JSON yet, keep buffering
        }
      };

      this.githubMcp.stdout.on('data', onData);
      this.githubMcp.stdin.write(request + '\n');
    });
  }

  async proxyToGitHub(toolName, args) {
    if (!this.githubMcpReady) {
      return {
        content: [
          {
            type: 'text',
            text: 'GitHub MCP server not ready. Cannot proxy tool call.',
          },
        ],
        isError: true,
      };
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.jsonRpcId;
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      });

      let responseBuffer = '';
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout proxying tool call: ${toolName}`));
      }, 30000);

      const onData = (data) => {
        responseBuffer += data.toString();
        
        try {
          const lines = responseBuffer.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const response = JSON.parse(line);
            if (response.id === requestId) {
              clearTimeout(timeout);
              this.githubMcp.stdout.removeListener('data', onData);
              
              if (response.error) {
                resolve({
                  content: [
                    {
                      type: 'text',
                      text: `GitHub MCP error: ${response.error.message}`,
                    },
                  ],
                  isError: true,
                });
              } else {
                resolve(response.result);
              }
              return;
            }
          }
        } catch (err) {
          // Keep buffering
        }
      };

      this.githubMcp.stdout.on('data', onData);
      this.githubMcp.stdin.write(request + '\n');
    });
  }

  // TOKEN OPTIMIZATION: Compress tool descriptions and schemas
  compressDescription(desc) {
    if (!desc) return desc;
    
    // Strip verbose fluff, keep only essential info
    let compressed = desc
      .replace(/This tool allows you to /gi, '')
      .replace(/You must have .+ access to .+?\./gi, '')
      .replace(/The .+ parameter /gi, '')
      .replace(/\. The .+ is not case sensitive/gi, '')
      .replace(/supports GitHub Flavored Markdown/gi, 'GFM')
      .replace(/GitHub repository/gi, 'repo')
      .replace(/repository/gi, 'repo')
      .replace(/organization/gi, 'org')
      .replace(/pull request/gi, 'PR')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Truncate at first sentence if still too long
    if (compressed.length > 100) {
      const firstSentence = compressed.match(/^[^.!?]+[.!?]/);
      if (firstSentence) {
        compressed = firstSentence[0];
      } else {
        compressed = compressed.substring(0, 100) + '...';
      }
    }
    
    return compressed;
  }

  simplifySchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    
    const simplified = { ...schema };
    
    // Remove verbose property descriptions
    if (simplified.properties) {
      simplified.properties = Object.entries(simplified.properties).reduce((acc, [key, prop]) => {
        acc[key] = {
          type: prop.type,
          ...(prop.enum && { enum: prop.enum }),
          ...(prop.items && { items: this.simplifySchema(prop.items) }),
          ...(prop.properties && { properties: this.simplifySchema(prop.properties).properties }),
        };
        // Keep description only if very short (< 30 chars)
        if (prop.description && prop.description.length < 30) {
          acc[key].description = prop.description;
        }
        return acc;
      }, {});
    }
    
    // Keep only essential schema fields
    const result = {
      type: simplified.type,
      ...(simplified.properties && { properties: simplified.properties }),
      ...(simplified.required && { required: simplified.required }),
      ...(simplified.items && { items: this.simplifySchema(simplified.items) }),
    };
    
    return result;
  }

  optimizeTools(tools) {
    const originalSize = JSON.stringify(tools).length;
    
    const optimized = tools.map(tool => ({
      name: tool.name,
      description: this.compressDescription(tool.description),
      inputSchema: this.simplifySchema(tool.inputSchema),
    }));
    
    const optimizedSize = JSON.stringify(optimized).length;
    const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
    
    console.error(`[Proxy] Token optimization: ${originalSize} → ${optimizedSize} bytes (${savings}% reduction)`);
    
    return optimized;
  }

  setupHandlers() {
    // List all tools (ours + GitHub's, TOKEN OPTIMIZED)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Optimize GitHub tools before merging
      const optimizedGitHubTools = this.optimizeTools(this.githubTools);
      
      const allTools = [
        ...this.pluginTools,
        ...optimizedGitHubTools,
      ];

      console.error(`[Proxy] Listing ${allTools.length} tools (${this.pluginTools.length} plugin + ${optimizedGitHubTools.length} GitHub optimized)`);

      return {
        tools: allTools,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      console.error(`[Proxy] Tool call: ${name}`);

      // Check if it's our plugin tool
      const isPluginTool = this.pluginTools.some(t => t.name === name);

      if (isPluginTool) {
        // Handle plugin tools ourselves
        switch (name) {
          case 'plugin_list':
            return await this.listPlugins();
          case 'plugin_info':
            return await this.getPluginInfo(args.name);
          case 'plugin_test':
            return await this.testPlugin(args.name, args.input);
          default:
            throw new Error(`Unknown plugin tool: ${name}`);
        }
      } else {
        // Proxy to GitHub MCP
        return await this.proxyToGitHub(name, args);
      }
    });
  }

  async listPlugins() {
    try {
      const plugins = await fs.readdir(PLUGIN_REGISTRY);
      const pluginList = [];

      for (const pluginName of plugins) {
        let manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'plugin.json');
        let usePackageJson = false;
        
        try {
          await fs.access(manifestPath);
        } catch {
          manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'package.json');
          usePackageJson = true;
        }
        
        try {
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          pluginList.push({
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            hooks: usePackageJson ? (manifest.copilot?.hooks || []) : (manifest.hooks || []),
            manifestType: usePackageJson ? 'package.json' : 'plugin.json',
          });
        } catch (err) {
          console.error(`[Proxy] Failed to load plugin ${pluginName}:`, err.message);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total: pluginList.length,
              plugins: pluginList,
              note: 'These plugins can be tested with plugin_test tool. When tested, they run in real SDK sessions with full GitHub MCP access.',
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing plugins: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async getPluginInfo(pluginName) {
    try {
      let manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'plugin.json');
      try {
        await fs.access(manifestPath);
      } catch {
        manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'package.json');
      }
      
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      
      const readmePath = path.join(PLUGIN_REGISTRY, pluginName, 'README.md');
      let readme = '';
      try {
        readme = await fs.readFile(readmePath, 'utf8');
      } catch (err) {
        readme = 'No README available';
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              manifest,
              readme,
              testCommand: `Use plugin_test with name: "${pluginName}" to test this plugin in a real SDK session`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting plugin info: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async testPlugin(pluginName, testInput) {
    try {
      // TODO: Implement actual SDK session spawning with plugin + GitHub MCP
      // For now, return plan
      
      const manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'plugin.json');
      let manifest;
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch {
        const pkgPath = path.join(PLUGIN_REGISTRY, pluginName, 'package.json');
        manifest = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'planned',
              message: 'Plugin testing implementation in progress',
              plugin: manifest.name,
              testInput,
              expectedBehavior: {
                step1: 'Spawn SDK session with plugin loaded',
                step2: 'Configure SDK to use GitHub MCP (same instance we proxy)',
                step3: 'Send test input to SDK session',
                step4: 'Plugin hooks execute (onBeforeSend, etc.)',
                step5: 'Capture plugin behavior and SDK output',
                step6: 'Return results showing plugin worked',
              },
              benefits: [
                'Plugin runs in REAL SDK environment',
                'Plugin has FULL GitHub tool access',
                'Demonstrates actual plugin functionality',
                'Not just metadata - actual working demo',
              ],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error testing plugin: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    // Start GitHub MCP first
    await this.startGitHubMCP();

    // Then start our proxy server
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Proxy] Copilot Plugin Proxy MCP Server running');
  }
}

// Run proxy server
const server = new ProxyMCPServer();
server.run().catch(console.error);
