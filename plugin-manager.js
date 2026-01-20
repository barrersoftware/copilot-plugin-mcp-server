#!/usr/bin/env node

/**
 * Plugin Manager for Copilot CLI MCP Proxy
 * 
 * Manages plugin installation, loading, and execution
 * Plugins can extend Copilot CLI functionality via MCP tools
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class PluginManager {
  constructor(pluginDir = path.join(process.env.HOME, '.copilot', 'plugins')) {
    this.pluginDir = pluginDir;
    this.metadataFile = path.join(pluginDir, 'plugins.json');
    this.loadedPlugins = new Map();
    
    // Ensure plugin directory exists
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true });
    }
    
    // Ensure metadata file exists
    if (!fs.existsSync(this.metadataFile)) {
      this.saveMetadata({ plugins: {} });
    }
  }

  /**
   * Load plugin metadata
   */
  loadMetadata() {
    try {
      const data = fs.readFileSync(this.metadataFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return { plugins: {} };
    }
  }

  /**
   * Save plugin metadata
   */
  saveMetadata(metadata) {
    fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));
  }

  /**
   * List all installed plugins
   */
  listPlugins() {
    const metadata = this.loadMetadata();
    return Object.entries(metadata.plugins).map(([name, info]) => ({
      name,
      ...info
    }));
  }

  /**
   * Install a plugin from GitHub
   * @param {string} spec - Plugin spec: @owner/repo or @owner/repo/subpath
   */
  async installPlugin(spec) {
    // Parse spec: @owner/repo or @owner/repo/subpath
    const match = spec.match(/^@([^/]+)\/([^/]+)(?:\/(.+))?$/);
    if (!match) {
      throw new Error(`Invalid plugin spec: ${spec}. Use @owner/repo or @owner/repo/subpath`);
    }

    const [, owner, repo, subpath] = match;
    const pluginName = subpath ? `${owner}-${repo}-${subpath.replace(/\//g, '-')}` : `${owner}-${repo}`;
    const pluginPath = path.join(this.pluginDir, pluginName);

    // Check if already installed
    const metadata = this.loadMetadata();
    if (metadata.plugins[pluginName]) {
      throw new Error(`Plugin ${pluginName} already installed`);
    }

    // Clone repository
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    const tempDir = path.join(this.pluginDir, `_temp_${Date.now()}`);
    
    try {
      console.error(`📦 Cloning ${owner}/${repo}...`);
      execSync(`git clone --depth 1 ${repoUrl} "${tempDir}"`, { 
        stdio: 'pipe',
        cwd: this.pluginDir 
      });

      // Move subpath or entire repo to plugin directory
      const sourceDir = subpath ? path.join(tempDir, subpath) : tempDir;
      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Subpath ${subpath} not found in repository`);
      }

      fs.renameSync(sourceDir, pluginPath);

      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Load plugin manifest
      const manifestPath = path.join(pluginPath, 'plugin.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Plugin manifest (plugin.json) not found');
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      // Install dependencies if package.json exists
      const packageJsonPath = path.join(pluginPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        console.error(`📦 Installing dependencies...`);
        execSync('npm install --production', { 
          stdio: 'pipe',
          cwd: pluginPath 
        });
      }

      // Update metadata
      metadata.plugins[pluginName] = {
        spec,
        version: manifest.version || '1.0.0',
        enabled: true,
        installedAt: new Date().toISOString(),
        manifest
      };
      this.saveMetadata(metadata);

      return {
        success: true,
        name: pluginName,
        version: manifest.version || '1.0.0',
        description: manifest.description || 'No description'
      };
    } catch (error) {
      // Clean up on failure
      if (fs.existsSync(pluginPath)) {
        fs.rmSync(pluginPath, { recursive: true, force: true });
      }
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Uninstall a plugin
   */
  uninstallPlugin(name) {
    const metadata = this.loadMetadata();
    if (!metadata.plugins[name]) {
      throw new Error(`Plugin ${name} not found`);
    }

    const pluginPath = path.join(this.pluginDir, name);
    if (fs.existsSync(pluginPath)) {
      fs.rmSync(pluginPath, { recursive: true, force: true });
    }

    delete metadata.plugins[name];
    this.saveMetadata(metadata);

    return { success: true, name };
  }

  /**
   * Enable a plugin
   */
  enablePlugin(name) {
    const metadata = this.loadMetadata();
    if (!metadata.plugins[name]) {
      throw new Error(`Plugin ${name} not found`);
    }

    metadata.plugins[name].enabled = true;
    this.saveMetadata(metadata);

    return { success: true, name, enabled: true };
  }

  /**
   * Disable a plugin
   */
  disablePlugin(name) {
    const metadata = this.loadMetadata();
    if (!metadata.plugins[name]) {
      throw new Error(`Plugin ${name} not found`);
    }

    metadata.plugins[name].enabled = false;
    this.saveMetadata(metadata);

    return { success: true, name, enabled: false };
  }

  /**
   * Load all enabled plugins
   */
  loadPlugins() {
    const metadata = this.loadMetadata();
    const enabledPlugins = Object.entries(metadata.plugins)
      .filter(([, info]) => info.enabled);

    for (const [name, info] of enabledPlugins) {
      try {
        const pluginPath = path.join(this.pluginDir, name);
        const indexPath = path.join(pluginPath, 'index.js');
        
        if (!fs.existsSync(indexPath)) {
          console.error(`⚠️  Plugin ${name}: index.js not found`);
          continue;
        }

        // Load plugin module
        delete require.cache[require.resolve(indexPath)]; // Clear cache
        const plugin = require(indexPath);

        this.loadedPlugins.set(name, {
          module: plugin,
          manifest: info.manifest
        });

        console.error(`✅ Loaded plugin: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to load plugin ${name}:`, error.message);
      }
    }

    return this.loadedPlugins.size;
  }

  /**
   * Get tools from all loaded plugins
   */
  getPluginTools() {
    const tools = [];

    for (const [name, { module, manifest }] of this.loadedPlugins) {
      if (typeof module.getTools === 'function') {
        try {
          const pluginTools = module.getTools();
          for (const tool of pluginTools) {
            tools.push({
              ...tool,
              name: `${manifest.namespace || name}_${tool.name}`,
              pluginName: name
            });
          }
        } catch (error) {
          console.error(`❌ Failed to get tools from ${name}:`, error.message);
        }
      }
    }

    return tools;
  }

  /**
   * Execute a plugin tool
   */
  async executePluginTool(toolName, args) {
    // Find plugin that owns this tool
    for (const [name, { module }] of this.loadedPlugins) {
      if (toolName.startsWith(name) || toolName.startsWith(module.manifest?.namespace)) {
        if (typeof module.executeTool === 'function') {
          return await module.executeTool(toolName, args);
        }
      }
    }

    throw new Error(`No plugin found to handle tool: ${toolName}`);
  }

  /**
   * Get plugin info
   */
  getPluginInfo(name) {
    const metadata = this.loadMetadata();
    const info = metadata.plugins[name];
    
    if (!info) {
      throw new Error(`Plugin ${name} not found`);
    }

    return {
      name,
      ...info
    };
  }
}

module.exports = PluginManager;
