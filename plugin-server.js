#!/usr/bin/env node

/**
 * Copilot CLI Plugin MCP Server with Full Plugin Support
 * 
 * This extends the proxy server with plugin management capabilities:
 * - Install/uninstall/enable/disable plugins via MCP tools
 * - Load plugin tools dynamically
 * - Execute plugin tools
 * - Aggregate GitHub tools + plugin tools
 */

const { spawn } = require('child_process');
const PluginManager = require('./plugin-manager');

// MCP Protocol
const MCP_PROTOCOL_VERSION = '2024-11-05';

// Plugin manager instance
const pluginManager = new PluginManager();

// GitHub MCP child process
let githubMcp = null;
let githubTools = [];

// Shared message buffer and handlers
let mcpBuffer = '';
const mcpHandlers = new Map();
let nextHandlerId = 0;

/**
 * Handle GitHub MCP output
 */
function handleGitHubMcpOutput(data) {
  mcpBuffer += data.toString();
  const lines = mcpBuffer.split('\n');
  mcpBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const message = JSON.parse(line);
      
      // Call all registered handlers
      for (const [id, handler] of mcpHandlers) {
        try {
          const shouldRemove = handler(message);
          if (shouldRemove) {
            mcpHandlers.delete(id);
          }
        } catch (e) {
          console.error('Handler error:', e);
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }
}

/**
 * Register a message handler
 */
function registerMcpHandler(handler) {
  const id = nextHandlerId++;
  mcpHandlers.set(id, handler);
  return id;
}

/**
 * Unregister a message handler
 */
function unregisterMcpHandler(id) {
  mcpHandlers.delete(id);
}

/**
 * Start GitHub MCP server as child process
 */
async function startGitHubMcp() {
  return new Promise((resolve, reject) => {
    const mcpPath = process.env.GITHUB_MCP_PATH || 
                    `${process.env.HOME}/github-mcp-server/github-mcp-server`;

    githubMcp = spawn(mcpPath, ['stdio', '--toolsets=default'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: process.env
    });

    githubMcp.stdout.on('data', handleGitHubMcpOutput);
    githubMcp.on('error', reject);

    let initComplete = false;

    // Handler for init response
    const handlerId = registerMcpHandler((message) => {
      if (message.id === 1 && message.result?.capabilities) {
        initComplete = true;
        
        // Send initialized notification
        const initializedNotif = {
          jsonrpc: '2.0',
          method: 'notifications/initialized'
        };
        githubMcp.stdin.write(JSON.stringify(initializedNotif) + '\n');
        
        resolve();
        return true; // Remove handler
      }
      return false;
    });

    // Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'copilot-plugin-proxy',
          version: '1.0.0'
        }
      }
    };

    githubMcp.stdin.write(JSON.stringify(initRequest) + '\n');

    setTimeout(() => {
      if (!initComplete) {
        unregisterMcpHandler(handlerId);
        reject(new Error('GitHub MCP initialization timeout'));
      }
    }, 10000);
  });
}

/**
 * Query tools from GitHub MCP
 */
async function queryGitHubTools() {
  return new Promise((resolve, reject) => {
    let responseReceived = false;

    const handlerId = registerMcpHandler((message) => {
      if (message.id === 2 && message.result?.tools) {
        responseReceived = true;
        resolve(message.result.tools);
        return true; // Remove handler
      }
      return false;
    });

    const toolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    };

    githubMcp.stdin.write(JSON.stringify(toolsRequest) + '\n');

    setTimeout(() => {
      if (!responseReceived) {
        unregisterMcpHandler(handlerId);
        reject(new Error('GitHub tools query timeout'));
      }
    }, 5000);
  });
}

/**
 * Call a tool on GitHub MCP
 */
async function callGitHubTool(toolName, args) {
  return new Promise((resolve, reject) => {
    const callId = Date.now();
    let responseReceived = false;

    const handlerId = registerMcpHandler((message) => {
      if (message.id === callId) {
        responseReceived = true;
        
        if (message.error) {
          reject(new Error(message.error.message || 'Tool execution failed'));
        } else {
          resolve(message.result);
        }
        return true; // Remove handler
      }
      return false;
    });

    const callRequest = {
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    githubMcp.stdin.write(JSON.stringify(callRequest) + '\n');

    setTimeout(() => {
      if (!responseReceived) {
        unregisterMcpHandler(handlerId);
        reject(new Error('Tool execution timeout'));
      }
    }, 30000);
  });
}

/**
 * Token optimization - compress tool descriptions
 */
function compressDescription(desc) {
  if (!desc) return '';
  
  let compressed = desc
    .replace(/This tool (allows you to|enables you to|lets you|helps you)/gi, '')
    .replace(/Use this tool (when|to)/gi, '')
    .replace(/GitHub repository/gi, 'repo')
    .replace(/pull request/gi, 'PR')
    .replace(/repositories/gi, 'repos')
    .replace(/commit SHA/gi, 'commit')
    .replace(/\s+/g, ' ')
    .trim();
  
  const firstSentence = compressed.split(/[.!?]/)[0];
  return firstSentence.length > 100 ? firstSentence.substring(0, 100) : firstSentence;
}

/**
 * Simplify tool schema (remove property descriptions)
 */
function simplifySchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  
  const simplified = { ...schema };
  
  if (simplified.properties) {
    const newProps = {};
    for (const [key, value] of Object.entries(simplified.properties)) {
      newProps[key] = {
        type: value.type,
        ...(value.enum && { enum: value.enum }),
        ...(value.items && { items: simplifySchema(value.items) }),
        ...(value.properties && { properties: simplifySchema(value.properties).properties })
      };
    }
    simplified.properties = newProps;
  }
  
  return simplified;
}

/**
 * Optimize GitHub tools for token efficiency
 */
function optimizeTools(tools) {
  return tools.map(tool => ({
    name: tool.name,
    description: compressDescription(tool.description),
    inputSchema: simplifySchema(tool.inputSchema)
  }));
}

/**
 * Get plugin management tools
 */
function getPluginManagementTools() {
  return [
    {
      name: 'plugin_list',
      description: 'List installed Copilot CLI plugins',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'plugin_install',
      description: 'Install plugin from GitHub (@owner/repo)',
      inputSchema: {
        type: 'object',
        properties: {
          spec: {
            type: 'string',
            description: 'Plugin spec: @owner/repo or @owner/repo/subpath'
          }
        },
        required: ['spec']
      }
    },
    {
      name: 'plugin_uninstall',
      description: 'Uninstall a plugin',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Plugin name'
          }
        },
        required: ['name']
      }
    },
    {
      name: 'plugin_enable',
      description: 'Enable a disabled plugin',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Plugin name'
          }
        },
        required: ['name']
      }
    },
    {
      name: 'plugin_disable',
      description: 'Disable an enabled plugin',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Plugin name'
          }
        },
        required: ['name']
      }
    },
    {
      name: 'plugin_info',
      description: 'Get detailed info about a plugin',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Plugin name'
          }
        },
        required: ['name']
      }
    }
  ];
}

/**
 * Handle plugin management tool calls
 */
async function handlePluginTool(toolName, args) {
  switch (toolName) {
    case 'plugin_list':
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(pluginManager.listPlugins(), null, 2)
        }]
      };

    case 'plugin_install':
      const installResult = await pluginManager.installPlugin(args.spec);
      // Reload plugins after install
      pluginManager.loadPlugins();
      return {
        content: [{
          type: 'text',
          text: `✅ Installed plugin: ${installResult.name}\nVersion: ${installResult.version}\n${installResult.description}`
        }]
      };

    case 'plugin_uninstall':
      const uninstallResult = pluginManager.uninstallPlugin(args.name);
      // Reload plugins after uninstall
      pluginManager.loadedPlugins.delete(args.name);
      return {
        content: [{
          type: 'text',
          text: `✅ Uninstalled plugin: ${args.name}`
        }]
      };

    case 'plugin_enable':
      pluginManager.enablePlugin(args.name);
      // Reload plugins after enable
      pluginManager.loadPlugins();
      return {
        content: [{
          type: 'text',
          text: `✅ Enabled plugin: ${args.name}`
        }]
      };

    case 'plugin_disable':
      pluginManager.disablePlugin(args.name);
      // Unload plugin
      pluginManager.loadedPlugins.delete(args.name);
      return {
        content: [{
          type: 'text',
          text: `✅ Disabled plugin: ${args.name}`
        }]
      };

    case 'plugin_info':
      const info = pluginManager.getPluginInfo(args.name);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(info, null, 2)
        }]
      };

    default:
      throw new Error(`Unknown plugin tool: ${toolName}`);
  }
}

/**
 * Handle MCP requests
 */
async function handleRequest(request) {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'copilot-plugin-server',
              version: '1.0.0'
            }
          }
        };

      case 'tools/list':
        // Aggregate: GitHub tools + plugin management tools + plugin tools
        const allTools = [
          ...optimizeTools(githubTools),
          ...getPluginManagementTools(),
          ...pluginManager.getPluginTools()
        ];

        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: allTools
          }
        };

      case 'tools/call':
        const { name: toolName, arguments: args } = params;

        // Check if it's a plugin management tool
        if (toolName.startsWith('plugin_')) {
          const result = await handlePluginTool(toolName, args);
          return {
            jsonrpc: '2.0',
            id,
            result
          };
        }

        // Check if it's a plugin tool
        const pluginTools = pluginManager.getPluginTools();
        if (pluginTools.some(t => t.name === toolName)) {
          const result = await pluginManager.executePluginTool(toolName, args);
          return {
            jsonrpc: '2.0',
            id,
            result
          };
        }

        // Otherwise, proxy to GitHub MCP
        const result = await callGitHubTool(toolName, args);
        return {
          jsonrpc: '2.0',
          id,
          result
        };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error.message
      }
    };
  }
}

/**
 * Main server loop
 */
async function main() {
  console.error('🚀 Starting Copilot Plugin MCP Server...');

  // Start GitHub MCP
  console.error('📡 Starting GitHub MCP...');
  await startGitHubMcp();
  console.error('✅ GitHub MCP started');

  // Query GitHub tools
  console.error('📋 Querying GitHub tools...');
  githubTools = await queryGitHubTools();
  console.error(`✅ Loaded ${githubTools.length} GitHub tools`);

  // Load plugins
  console.error('🔌 Loading plugins...');
  const pluginCount = pluginManager.loadPlugins();
  console.error(`✅ Loaded ${pluginCount} plugins`);

  const pluginTools = pluginManager.getPluginTools();
  console.error(`✅ Loaded ${pluginTools.length} plugin tools`);

  console.error('✅ Server ready - listening on STDIN\n');

  // Read from STDIN
  let buffer = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line);
        const response = await handleRequest(request);
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (error) {
        console.error('❌ Error processing request:', error);
      }
    }
  });

  process.stdin.on('end', () => {
    if (githubMcp) {
      githubMcp.kill();
    }
    process.exit(0);
  });
}

// Handle process signals
process.on('SIGINT', () => {
  if (githubMcp) {
    githubMcp.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (githubMcp) {
    githubMcp.kill();
  }
  process.exit(0);
});

// Start server
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
