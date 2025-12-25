// src/serverManager.js
// Manages starting/stopping local development servers for testing

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ServerManager {
  constructor(featureStore = null) {
    this.runningServers = new Map(); // projectId -> { process, port, url }
    this.featureStore = featureStore; // Optional: for reading project_type from DB
  }

  /**
   * Detect server type and start appropriate dev server
   * @param {string} projectPath - Path to project folder
   * @param {string} projectId - Project ID
   * @returns {Promise<{port: number, url: string}>}
   */
  async startServer(projectPath, projectId) {
    // Check if already running
    if (this.runningServers.has(projectId)) {
      const existing = this.runningServers.get(projectId);
      console.log(`[ServerManager] Server already running for ${projectId} at ${existing.url}`);
      return { port: existing.port, url: existing.url };
    }

    // Check and run init.sh if it exists and hasn't been run yet
    await this._runInitScriptIfNeeded(projectPath, projectId);

    // Try to get project_type from database first
    let serverType = null;
    if (this.featureStore && projectId) {
      try {
        const project = this.featureStore.getProject(projectId);
        if (project && project.project_type) {
          serverType = this._mapProjectTypeToServerType(project.project_type);
          console.log(`[ServerManager] Using project_type from DB: ${project.project_type} -> ${serverType}`);
        }
      } catch (err) {
        console.warn(`[ServerManager] Failed to read project_type from DB:`, err.message);
      }
    }

    // Fallback to auto-detection if no project_type in DB
    if (!serverType) {
      serverType = this._detectServerType(projectPath);
      console.log(`[ServerManager] Auto-detected server type: ${serverType}`);
    }
    // Start on a high, likely-free port (fallback to random if unavailable)
    const port = await this._findAvailablePort(42000);

    console.log(`[ServerManager] Starting ${serverType} server for ${projectId} at port ${port}`);

    let serverProcess;
    let url;

    switch (serverType) {
      case 'node':
        serverProcess = await this._startNodeServer(projectPath, port);
        url = `http://localhost:${port}`;
        break;

      case 'php':
        serverProcess = await this._startPhpServer(projectPath, port);
        url = `http://localhost:${port}`;
        break;

      case 'static':
      default:
        serverProcess = await this._startStaticServer(projectPath, port);
        url = `http://localhost:${port}`;
        break;
    }

    this.runningServers.set(projectId, {
      process: serverProcess,
      port,
      url,
      type: serverType
    });

    // Wait a bit for server to fully start
    await this._waitForServer(url, 10000);

    console.log(`[ServerManager] Server ready at ${url}`);
    return { port, url };
  }

  /**
   * Stop server for a project
   * @param {string} projectId
   */
  stopServer(projectId) {
    const server = this.runningServers.get(projectId);
    if (!server) {
      console.log(`[ServerManager] No server running for ${projectId}`);
      return;
    }

    console.log(`[ServerManager] Stopping server for ${projectId}`);

    try {
      server.process.kill('SIGTERM');
      this.runningServers.delete(projectId);
    } catch (err) {
      console.error(`[ServerManager] Error stopping server:`, err.message);
    }
  }

  /**
   * Stop all running servers
   */
  stopAllServers() {
    console.log(`[ServerManager] Stopping ${this.runningServers.size} servers`);
    for (const [projectId] of this.runningServers) {
      this.stopServer(projectId);
    }
  }

  /**
   * Get server info if running
   * @param {string} projectId
   * @returns {{port: number, url: string, type: string} | null}
   */
  getServerInfo(projectId) {
    const server = this.runningServers.get(projectId);
    if (!server) return null;
    return {
      port: server.port,
      url: server.url,
      type: server.type
    };
  }

  // ===== PRIVATE METHODS =====

  /**
   * Map project_type from database to internal server type
   * @param {string} projectType - From database (e.g., 'react-vite', 'nextjs', 'php', etc.)
   * @returns {string} - Internal server type ('node', 'php', 'static', 'python')
   */
  _mapProjectTypeToServerType(projectType) {
    const mapping = {
      // Node.js based projects
      'react-vite': 'node',
      'vue-vite': 'node',
      'svelte-vite': 'node',
      'nextjs': 'node',
      'astro': 'node',
      'express-api': 'node',
      'react-express-fullstack': 'node',

      // PHP projects
      'php': 'php',

      // Python projects
      'python-flask': 'python',
      'python-django': 'python',

      // Static projects
      'static-html': 'static',
    };

    return mapping[projectType] || 'static'; // Default to static if unknown
  }

  /**
   * Detect what type of server to start (fallback when no project_type in DB)
   */
  _detectServerType(projectPath) {
    // Check for Node.js project
    if (fs.existsSync(path.join(projectPath, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
      if (pkg.scripts && (pkg.scripts.start || pkg.scripts.dev)) {
        return 'node';
      }
    }

    // Check for PHP
    const files = fs.readdirSync(projectPath);
    if (files.some(f => f.endsWith('.php'))) {
      return 'php';
    }

    // Check for Python
    if (files.some(f => f === 'requirements.txt' || f === 'manage.py')) {
      return 'python';
    }

    // Check for static HTML
    if (files.some(f => f === 'index.html')) {
      return 'static';
    }

    return 'static'; // Default fallback
  }

  /**
   * Run init.sh script if it exists and hasn't been run yet
   * Creates a .init-done marker file after successful execution
   */
  async _runInitScriptIfNeeded(projectPath, projectId) {
    const initScriptPath = path.join(projectPath, 'init.sh');
    const initDoneMarker = path.join(projectPath, '.init-done');

    // Check if init.sh exists
    if (!fs.existsSync(initScriptPath)) {
      return; // No init script, nothing to do
    }

    const alreadyInitialized = fs.existsSync(initDoneMarker);
    if (alreadyInitialized) {
      const needsInit = this._needsDependencyInstall(projectPath);
      if (!needsInit) {
        console.log(`[ServerManager] Project ${projectId} already initialized`);
        return;
      }
      console.log(`[ServerManager] Dependencies missing; re-running init for ${projectId}`);
    }

    console.log(`[ServerManager] Running initialization script for ${projectId}...`);

    try {
      // Make init.sh executable
      fs.chmodSync(initScriptPath, '755');

      // Execute init.sh
      const { execSync } = require('child_process');
      const output = execSync('bash init.sh', {
        cwd: projectPath,
        stdio: 'pipe',
        timeout: 300000 // 5 minute timeout
      });

      console.log(`[ServerManager] Initialization output:\n${output.toString()}`);

      // Create marker file to indicate successful initialization
      fs.writeFileSync(initDoneMarker, new Date().toISOString());
      console.log(`[ServerManager] Initialization completed successfully for ${projectId}`);

    } catch (err) {
      console.error(`[ServerManager] Initialization failed for ${projectId}:`, err.message);
      throw new Error(`Project initialization failed: ${err.message}`);
    }
  }

  /**
   * Start Node.js server
   */
  async _startNodeServer(projectPath, port) {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
    const script = pkg.scripts.dev || pkg.scripts.start || 'start';

    const proc = spawn('npm', ['run', script], {
      cwd: projectPath,
      env: { ...process.env, PORT: port },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data) => {
      console.log(`[Node Server] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Node Server] ${data.toString().trim()}`);
    });

    proc.on('error', (err) => {
      console.error('[Node Server] Failed to start:', err.message);
    });

    return proc;
  }

  _needsDependencyInstall(projectPath) {
    const candidates = this._getNodeInstallDirs(projectPath);
    for (const dir of candidates) {
      const pkgPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const hasDeps = pkg && (pkg.dependencies || pkg.devDependencies);
        if (!hasDeps) continue;
      } catch {
        continue;
      }
      if (!fs.existsSync(path.join(dir, 'node_modules'))) {
        return true;
      }
    }
    return false;
  }

  _getNodeInstallDirs(projectPath) {
    const dirs = new Set();
    const rootPkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(rootPkgPath)) return [];

    dirs.add(projectPath);

    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      const scripts = pkg?.scripts || {};
      for (const script of Object.values(scripts)) {
        if (typeof script !== 'string') continue;
        const match = script.match(/--prefix\s+([^\s]+)/);
        if (!match) continue;
        const target = match[1].replace(/^["']|["']$/g, '');
        const resolved = path.resolve(projectPath, target);
        dirs.add(resolved);
      }
    } catch {
      return Array.from(dirs);
    }

    return Array.from(dirs);
  }

  /**
   * Start PHP built-in server
   */
  async _startPhpServer(projectPath, port) {
    const proc = spawn('php', ['-S', `localhost:${port}`], {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data) => {
      console.log(`[PHP Server] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      console.error(`[PHP Server] ${data.toString().trim()}`);
    });

    proc.on('error', (err) => {
      console.error('[PHP Server] Failed to start:', err.message);
    });

    return proc;
  }

  /**
   * Start static file server (Node.js http-server style)
   */
  async _startStaticServer(projectPath, port) {
    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const server = http.createServer((req, res) => {
      let filePath = path.join(projectPath, req.url === '/' ? 'index.html' : req.url);

      const extname = String(path.extname(filePath)).toLowerCase();
      const contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(filePath, (error, content) => {
        if (error) {
          if (error.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>', 'utf-8');
          } else {
            res.writeHead(500);
            res.end('Server Error: ' + error.code);
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
    });

    server.listen(port);
    console.log(`[Static Server] Serving ${projectPath} at http://localhost:${port}`);

    // Return fake process object with kill method
    return {
      kill: () => {
        server.close();
        console.log(`[Static Server] Stopped`);
      }
    };
  }

  /**
   * Find an available port starting from basePort
   */
  async _findAvailablePort(basePort) {
    const net = require('net');

    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(basePort, () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
      server.on('error', () => {
        // Jump by a small random offset to avoid collisions on common ports
        const next = basePort + Math.floor(Math.random() * 10) + 1;
        const wrapped = next > 65000 ? 1024 : next;
        resolve(this._findAvailablePort(wrapped));
      });
    });
  }

  /**
   * Wait for server to be ready
   */
  async _waitForServer(url, timeout = 10000) {
    const http = require('http');
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(url, (res) => {
            resolve();
          });
          req.on('error', reject);
          req.setTimeout(1000);
        });
        return true;
      } catch (err) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    throw new Error(`Server at ${url} did not respond within ${timeout}ms`);
  }
}

module.exports = { ServerManager };
