#!/usr/bin/env node

/**
 * Copilot Plugin MCP Server
 * 
 * Provides plugin management tools via Model Context Protocol
 * Uses ONLY open-source components (SDK MIT licensed, MCP documented)
 * 
 * Architecture:
 * - MCP Server receives tool calls from Copilot CLI
 * - Spawns SDK sessions with plugin system enabled
 * - Returns results to AI via JSON-RPC
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

// Path to our SDK fork with plugin system
const SDK_PATH = path.join(process.env.HOME, 'copilot-sdk');
const PLUGIN_REGISTRY = path.join(process.env.HOME, 'copilot-plugins-registry/plugins');

class CopilotPluginServer {
  constructor() {
    this.server = new Server(
      {
        name: 'copilot-plugin-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'plugin_list',
          description: 'List all available plugins in the registry',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'plugin_info',
          description: 'Get detailed information about a specific plugin',
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
          description: 'Test a plugin by running it in an SDK session',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Plugin name to test',
              },
              input: {
                type: 'string',
                description: 'Test input/prompt',
              },
            },
            required: ['name', 'input'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'plugin_list':
          return await this.listPlugins();
        case 'plugin_info':
          return await this.getPluginInfo(args.name);
        case 'plugin_test':
          return await this.testPlugin(args.name, args.input);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async listPlugins() {
    try {
      const plugins = await fs.readdir(PLUGIN_REGISTRY);
      const pluginList = [];

      for (const pluginName of plugins) {
        // Check for plugin.json first, fall back to package.json
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
          // Skip plugins without valid manifest
          console.error(`Failed to load plugin ${pluginName}:`, err.message);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total: pluginList.length,
              plugins: pluginList,
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
      // Check for plugin.json first, fall back to package.json
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
      // This would spawn an SDK session with the plugin loaded
      // For now, return a simulation of what would happen
      
      // Check for plugin.json first, fall back to package.json
      let manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'plugin.json');
      try {
        await fs.access(manifestPath);
      } catch {
        manifestPath = path.join(PLUGIN_REGISTRY, pluginName, 'package.json');
      }
      
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'simulated',
              message: 'Plugin testing would require spawning SDK session',
              plugin: manifest.name,
              testInput,
              expectedHooks: manifest.hooks || [],
              note: 'In production, this would: (1) Spawn SDK process with plugin loaded, (2) Send test input, (3) Capture plugin behavior, (4) Return results',
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Copilot Plugin MCP Server running on stdio');
  }
}

// Run server
const server = new CopilotPluginServer();
server.run().catch(console.error);
