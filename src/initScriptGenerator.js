// src/initScriptGenerator.js
// Generates init.sh scripts for different project types

/**
 * Generate init.sh script based on project type and dependencies
 * @param {Object} options
 * @param {string} options.projectType - 'node', 'react', 'nextjs', 'php', 'python', 'static'
 * @param {Object} options.dependencies - Package dependencies
 * @param {string} options.packageManager - 'npm', 'yarn', 'pnpm'
 * @returns {string} init.sh script content
 */
function generateInitScript({ projectType = 'static', dependencies = {}, packageManager = 'npm' }) {
  const scripts = [];

  // Common header
  scripts.push('#!/bin/bash');
  scripts.push('# Auto-generated initialization script by Ultracode');
  scripts.push('# This script runs once on first dev-server start');
  scripts.push('');
  scripts.push('set -e  # Exit on error');
  scripts.push('');
  scripts.push('echo "🚀 Initializing project..."');
  scripts.push('');

  // Type-specific initialization
  switch (projectType) {
    case 'node':
    case 'react':
    case 'nextjs':
    case 'vue':
    case 'svelte':
      scripts.push('# Node.js project initialization');
      scripts.push('if [ -f "package.json" ]; then');
      scripts.push('  echo "📦 Installing dependencies..."');

      switch (packageManager) {
        case 'yarn':
          scripts.push('  if ! command -v yarn &> /dev/null; then');
          scripts.push('    echo "⚠️  Yarn not found, using npm instead"');
          scripts.push('    npm install');
          scripts.push('  else');
          scripts.push('    yarn install');
          scripts.push('  fi');
          break;

        case 'pnpm':
          scripts.push('  if ! command -v pnpm &> /dev/null; then');
          scripts.push('    echo "⚠️  pnpm not found, using npm instead"');
          scripts.push('    npm install');
          scripts.push('  else');
          scripts.push('    pnpm install');
          scripts.push('  fi');
          break;

        default: // npm
          scripts.push('  npm install');
      }

      scripts.push('  echo "✅ Dependencies installed"');
      scripts.push('fi');
      scripts.push('');
      break;

    case 'php':
      scripts.push('# PHP project initialization');
      scripts.push('if [ -f "composer.json" ]; then');
      scripts.push('  echo "📦 Installing PHP dependencies..."');
      scripts.push('  if ! command -v composer &> /dev/null; then');
      scripts.push('    echo "⚠️  Composer not found, skipping dependency installation"');
      scripts.push('  else');
      scripts.push('    composer install --no-interaction');
      scripts.push('    echo "✅ PHP dependencies installed"');
      scripts.push('  fi');
      scripts.push('fi');
      scripts.push('');
      break;

    case 'python':
      scripts.push('# Python project initialization');
      scripts.push('if [ -f "requirements.txt" ]; then');
      scripts.push('  echo "📦 Setting up Python virtual environment..."');
      scripts.push('  if [ ! -d "venv" ]; then');
      scripts.push('    python3 -m venv venv');
      scripts.push('    echo "✅ Virtual environment created"');
      scripts.push('  fi');
      scripts.push('  echo "📦 Installing Python packages..."');
      scripts.push('  source venv/bin/activate');
      scripts.push('  pip install -r requirements.txt');
      scripts.push('  echo "✅ Python packages installed"');
      scripts.push('fi');
      scripts.push('');
      break;

    case 'static':
    default:
      scripts.push('# Static website - no initialization needed');
      scripts.push('echo "✅ Static site ready"');
      scripts.push('');
      break;
  }

  // Build step if needed
  if (['react', 'nextjs', 'vue', 'svelte'].includes(projectType)) {
    scripts.push('# Build step (if required)');
    scripts.push('# Uncomment if you need a build before running');
    scripts.push('# npm run build');
    scripts.push('');
  }

  // Footer
  scripts.push('echo "🎉 Initialization complete!"');
  scripts.push('echo ""');

  return scripts.join('\n');
}

/**
 * Detect project type from files in directory
 * @param {string} projectPath - Path to project directory
 * @returns {string} Detected project type
 */
function detectProjectType(projectPath) {
  const fs = require('fs');
  const path = require('path');

  // Check for package.json
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // Check for framework-specific dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.next) return 'nextjs';
      if (deps.react) return 'react';
      if (deps.vue) return 'vue';
      if (deps.svelte) return 'svelte';

      return 'node';
    } catch (err) {
      console.error('[InitScriptGenerator] Error reading package.json:', err.message);
      return 'node';
    }
  }

  // Check for PHP
  const files = fs.readdirSync(projectPath);
  if (files.some(f => f === 'composer.json')) return 'php';
  if (files.some(f => f.endsWith('.php'))) return 'php';

  // Check for Python
  if (files.some(f => f === 'requirements.txt')) return 'python';
  if (files.some(f => f === 'setup.py' || f === 'pyproject.toml')) return 'python';

  // Default to static
  return 'static';
}

/**
 * Detect package manager from lock files
 * @param {string} projectPath
 * @returns {string} 'npm', 'yarn', or 'pnpm'
 */
function detectPackageManager(projectPath) {
  const fs = require('fs');
  const path = require('path');

  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Generate and write init.sh to project directory
 * @param {string} projectPath
 * @returns {string} Path to generated init.sh
 */
function createInitScript(projectPath) {
  const fs = require('fs');
  const path = require('path');

  const projectType = detectProjectType(projectPath);
  const packageManager = detectPackageManager(projectPath);

  console.log(`[InitScriptGenerator] Detected project type: ${projectType}, package manager: ${packageManager}`);

  const scriptContent = generateInitScript({ projectType, packageManager });
  const scriptPath = path.join(projectPath, 'init.sh');

  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
  console.log(`[InitScriptGenerator] Created init.sh at ${scriptPath}`);

  return scriptPath;
}

module.exports = {
  generateInitScript,
  detectProjectType,
  detectPackageManager,
  createInitScript
};
