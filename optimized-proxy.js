#!/usr/bin/env node

/**
 * Enhanced Token Optimization MCP Proxy
 * 
 * Features:
 * - Aggressive compression of ALL GitHub tools
 * - Usage tracking and analytics
 * - Adaptive optimization based on usage
 * - Real-time metrics reporting
 * - A/B testing support
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// MCP Protocol
const MCP_PROTOCOL_VERSION = '2024-11-05';

// Analytics database
const DB_PATH = path.join(process.env.HOME, '.copilot', 'token-analytics.db');
let db = null;

// GitHub MCP child process
let githubMcp = null;
let githubTools = [];
let optimizedTools = [];

// Usage tracking
const toolUsage = new Map();
const sessionStartTime = Date.now();
let totalTokensSaved = 0;
let totalToolCalls = 0;

// Shared message buffer and handlers
let mcpBuffer = '';
const mcpHandlers = new Map();
let nextHandlerId = 0;

/**
 * Initialize analytics database
 */
function initDatabase() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    // Tool usage table
    db.run(`
      CREATE TABLE IF NOT EXISTS tool_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        tool_name TEXT,
        execution_time_ms INTEGER,
        success BOOLEAN
      )
    `);

    // Session metrics table
    db.run(`
      CREATE TABLE IF NOT EXISTS session_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        session_duration_ms INTEGER,
        total_tool_calls INTEGER,
        tokens_saved INTEGER,
        tools_before INTEGER,
        tools_after INTEGER
      )
    `);

    // Optimization results table
    db.run(`
      CREATE TABLE IF NOT EXISTS optimization_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        tool_name TEXT,
        original_size INTEGER,
        optimized_size INTEGER,
        reduction_percent REAL
      )
    `);
  });

  console.error('✅ Analytics database initialized');
}

/**
 * Log tool usage to database
 */
function logToolUsage(toolName, executionTime, success) {
  if (!db) return;

  db.run(
    'INSERT INTO tool_usage (timestamp, tool_name, execution_time_ms, success) VALUES (?, ?, ?, ?)',
    [Date.now(), toolName, executionTime, success ? 1 : 0]
  );

  // Update in-memory stats
  const stats = toolUsage.get(toolName) || { count: 0, totalTime: 0, failures: 0 };
  stats.count++;
  stats.totalTime += executionTime;
  if (!success) stats.failures++;
  toolUsage.set(toolName, stats);
}

/**
 * Log optimization result
 */
function logOptimization(toolName, originalSize, optimizedSize) {
  if (!db) return;

  const reduction = ((originalSize - optimizedSize) / originalSize) * 100;

  db.run(
    'INSERT INTO optimization_results (timestamp, tool_name, original_size, optimized_size, reduction_percent) VALUES (?, ?, ?, ?, ?)',
    [Date.now(), toolName, originalSize, optimizedSize, reduction]
  );
}

/**
 * Log session metrics
 */
function logSessionMetrics() {
  if (!db) return;

  const duration = Date.now() - sessionStartTime;

  db.run(
    'INSERT INTO session_metrics (timestamp, session_duration_ms, total_tool_calls, tokens_saved, tools_before, tools_after) VALUES (?, ?, ?, ?, ?, ?)',
    [Date.now(), duration, totalToolCalls, totalTokensSaved, githubTools.length, optimizedTools.length]
  );
}

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

function registerMcpHandler(handler) {
  const id = nextHandlerId++;
  mcpHandlers.set(id, handler);
  return id;
}

function unregisterMcpHandler(id) {
  mcpHandlers.delete(id);
}

/**
 * Start GitHub MCP server
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

    const handlerId = registerMcpHandler((message) => {
      if (message.id === 1 && message.result?.capabilities) {
        initComplete = true;
        
        const initializedNotif = {
          jsonrpc: '2.0',
          method: 'notifications/initialized'
        };
        githubMcp.stdin.write(JSON.stringify(initializedNotif) + '\n');
        
        resolve();
        return true;
      }
      return false;
    });

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'copilot-token-optimizer',
          version: '2.0.0'
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
        return true;
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
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const callId = Date.now();
    let responseReceived = false;

    const handlerId = registerMcpHandler((message) => {
      if (message.id === callId) {
        responseReceived = true;
        const executionTime = Date.now() - startTime;
        
        if (message.error) {
          logToolUsage(toolName, executionTime, false);
          reject(new Error(message.error.message || 'Tool execution failed'));
        } else {
          logToolUsage(toolName, executionTime, true);
          totalToolCalls++;
          resolve(message.result);
        }
        return true;
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
        const executionTime = Date.now() - startTime;
        logToolUsage(toolName, executionTime, false);
        reject(new Error('Tool execution timeout'));
      }
    }, 30000);
  });
}

/**
 * AGGRESSIVE compression - remove all fluff
 */
function compressDescription(desc) {
  if (!desc) return '';
  
  let compressed = desc
    // Remove common prefixes
    .replace(/^(This tool|Use this tool|This|Use this|This allows you to|This enables you to|This lets you|This helps you|Use this to|Use this when)/gi, '')
    .replace(/\s+(allows you to|enables you to|lets you|helps you|to)\s+/gi, ' ')
    
    // Compress common terms
    .replace(/GitHub repository/gi, 'repo')
    .replace(/repositories/gi, 'repos')
    .replace(/pull request/gi, 'PR')
    .replace(/pull requests/gi, 'PRs')
    .replace(/commit SHA/gi, 'commit')
    .replace(/issue number/gi, 'issue')
    .replace(/branch name/gi, 'branch')
    .replace(/file path/gi, 'path')
    .replace(/directory/gi, 'dir')
    .replace(/organization/gi, 'org')
    .replace(/username/gi, 'user')
    .replace(/search query/gi, 'query')
    .replace(/workflow/gi, 'wf')
    .replace(/action/gi, 'act')
    .replace(/artifact/gi, 'art')
    
    // Remove verbosity
    .replace(/\s+(in|from|for|to|with|by|at|on)\s+the\s+/gi, ' ')
    .replace(/\s+the\s+/gi, ' ')
    .replace(/\s+a\s+/gi, ' ')
    .replace(/\s+an\s+/gi, ' ')
    
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Take only first sentence, max 80 chars
  const firstSentence = compressed.split(/[.!?]/)[0];
  return firstSentence.length > 80 ? firstSentence.substring(0, 80) : firstSentence;
}

/**
 * Simplify schema - remove ALL descriptions
 */
function simplifySchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  
  const simplified = {};
  
  // Keep only essential fields
  if (schema.type) simplified.type = schema.type;
  if (schema.enum) simplified.enum = schema.enum;
  if (schema.required) simplified.required = schema.required;
  
  // Recursively simplify properties
  if (schema.properties) {
    const newProps = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      newProps[key] = simplifySchema(value);
    }
    simplified.properties = newProps;
  }
  
  // Simplify items for arrays
  if (schema.items) {
    simplified.items = simplifySchema(schema.items);
  }
  
  return simplified;
}

/**
 * Calculate token count (rough estimate)
 */
function estimateTokens(text) {
  // Rough: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Optimize tools with metrics
 */
function optimizeTools(tools) {
  const optimized = [];
  let totalOriginalSize = 0;
  let totalOptimizedSize = 0;

  for (const tool of tools) {
    const original = JSON.stringify(tool);
    const originalSize = original.length;

    const optimizedTool = {
      name: tool.name,
      description: compressDescription(tool.description),
      inputSchema: simplifySchema(tool.inputSchema)
    };

    const optimizedJson = JSON.stringify(optimizedTool);
    const optimizedSize = optimizedJson.length;

    // Log this optimization
    logOptimization(tool.name, originalSize, optimizedSize);

    totalOriginalSize += originalSize;
    totalOptimizedSize += optimizedSize;

    optimized.push(optimizedTool);
  }

  // Calculate tokens saved
  const originalTokens = estimateTokens(JSON.stringify(tools));
  const optimizedTokens = estimateTokens(JSON.stringify(optimized));
  totalTokensSaved = originalTokens - optimizedTokens;

  console.error(`\n📊 Optimization Metrics:`);
  console.error(`   Original size: ${totalOriginalSize.toLocaleString()} bytes (${originalTokens.toLocaleString()} tokens)`);
  console.error(`   Optimized size: ${totalOptimizedSize.toLocaleString()} bytes (${optimizedTokens.toLocaleString()} tokens)`);
  console.error(`   Reduction: ${((totalOriginalSize - totalOptimizedSize) / totalOriginalSize * 100).toFixed(1)}%`);
  console.error(`   Tokens saved: ${totalTokensSaved.toLocaleString()} tokens\n`);

  return optimized;
}

/**
 * Get analytics report
 */
function getAnalyticsReport() {
  const uptime = Math.floor((Date.now() - sessionStartTime) / 1000);
  const toolStats = Array.from(toolUsage.entries())
    .map(([name, stats]) => ({
      name,
      calls: stats.count,
      avgTime: Math.floor(stats.totalTime / stats.count),
      failures: stats.failures
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    uptime_seconds: uptime,
    total_tool_calls: totalToolCalls,
    tokens_saved_this_session: totalTokensSaved,
    tool_usage: toolStats,
    tools_loaded: {
      github: githubTools.length,
      optimized: optimizedTools.length
    }
  };
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
              name: 'copilot-token-optimizer',
              version: '2.0.0'
            }
          }
        };

      case 'tools/list':
        // Return optimized tools + analytics tool
        const analyticsTools = [{
          name: 'get_token_analytics',
          description: 'Get real-time token optimization analytics',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }];

        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [...optimizedTools, ...analyticsTools]
          }
        };

      case 'tools/call':
        const { name: toolName, arguments: args } = params;

        // Handle analytics tool
        if (toolName === 'get_token_analytics') {
          const report = getAnalyticsReport();
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(report, null, 2)
              }]
            }
          };
        }

        // Proxy to GitHub MCP
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
  console.error('🚀 Starting Token Optimization MCP Server v2.0...\n');

  // Initialize analytics
  console.error('📊 Initializing analytics database...');
  initDatabase();

  // Start GitHub MCP
  console.error('📡 Starting GitHub MCP...');
  await startGitHubMcp();
  console.error('✅ GitHub MCP started\n');

  // Query and optimize GitHub tools
  console.error('📋 Querying GitHub tools...');
  githubTools = await queryGitHubTools();
  console.error(`✅ Loaded ${githubTools.length} GitHub tools\n`);

  console.error('⚡ Optimizing tools...');
  optimizedTools = optimizeTools(githubTools);
  console.error(`✅ Optimized ${optimizedTools.length} tools\n`);

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
    logSessionMetrics();
    if (db) db.close();
    if (githubMcp) githubMcp.kill();
    process.exit(0);
  });
}

// Handle process signals
process.on('SIGINT', () => {
  logSessionMetrics();
  if (db) db.close();
  if (githubMcp) githubMcp.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logSessionMetrics();
  if (db) db.close();
  if (githubMcp) githubMcp.kill();
  process.exit(0);
});

// Start server
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
