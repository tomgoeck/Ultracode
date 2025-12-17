// src/contextBuilder.js
// Builds intelligent context for Planner and Executor

const fs = require("fs");
const path = require("path");

/**
 * ContextBuilder aggregates project knowledge into actionable context
 * for LLM-based planning and execution.
 */
class ContextBuilder {
  constructor(featureStore) {
    this.featureStore = featureStore;
  }

  /**
   * Build complete context for feature planning
   * @param {Object} project - Project object from FeatureStore
   * @param {Object} feature - Feature object to plan
   * @param {Object} options - Additional options
   * @returns {Object} Context object with all relevant information
   */
  async buildPlanningContext(project, feature, options = {}) {
    const context = {
      // Core guidelines from project.md
      guidelines: await this._loadProjectMd(project),

      // What has been built so far
      completedFeatures: this._getCompletedFeatures(project),

      // Current file structure
      fileTree: this._getFileTree(project.folder_path, options.maxDepth || 3),

      // Feature-specific information
      feature: {
        name: feature.name,
        description: feature.description,
        priority: feature.priority,
        dod: feature.dod,
      },

      // Dependencies context
      dependencies: this._getDependencyContext(feature),

      // Project metadata
      project: {
        name: project.name,
        stack: this._extractStack(project),
      },
    };

    // Add similar features context if requested
    if (options.includeSimilarFeatures) {
      context.similarFeatures = this._findSimilarFeatures(feature, project);
    }

    return context;
  }

  /**
   * Build context for code execution (more focused, includes relevant code)
   * @param {Object} project - Project object
   * @param {Object} feature - Feature object
   * @param {Object} subtask - Current subtask
   * @returns {Object} Execution context
   */
  async buildExecutionContext(project, feature, subtask) {
    const context = {
      // Core guidelines
      guidelines: await this._loadProjectMd(project),

      // Feature context
      feature: {
        name: feature.name,
        description: feature.description,
        technicalSummary: feature.technical_summary,
      },

      // Current subtask
      subtask: {
        intent: subtask.intent,
        applyType: subtask.apply_type,
        applyPath: subtask.apply_path,
      },

      // Related files (if modifying existing file)
      relatedFiles: this._getRelatedFiles(project.folder_path, subtask.apply_path),

      // Completed subtasks for this feature
      completedWork: this._getCompletedSubtasks(feature),

      // File tree
      fileTree: this._getFileTree(project.folder_path, 2),
    };

    return context;
  }

  /**
   * Format context as a prompt string for LLM
   * @param {Object} context - Context object
   * @param {string} type - 'planning' or 'execution'
   * @returns {string} Formatted prompt
   */
  formatAsPrompt(context, type = "planning") {
    const sections = [];

    // Guidelines
    if (context.guidelines) {
      sections.push("# Project Guidelines\n\n" + context.guidelines);
    }

    // Project info
    if (context.project) {
      sections.push(`# Project: ${context.project.name}\n\n${context.project.stack || ""}`);
    }

    // Feature info
    if (context.feature) {
      sections.push(
        `# Feature: ${context.feature.name}\n\n` +
          `**Priority:** ${context.feature.priority || "N/A"}\n` +
          `**Description:** ${context.feature.description || "N/A"}\n` +
          (context.feature.dod ? `**Definition of Done:**\n${context.feature.dod}\n` : "")
      );
    }

    // Completed features (planning only)
    if (type === "planning" && context.completedFeatures && context.completedFeatures.length > 0) {
      sections.push(
        "# Previously Completed Features\n\n" +
          context.completedFeatures
            .map(
              (f) =>
                `## ${f.name}\n` +
                `- **Files:** ${f.files.join(", ")}\n` +
                `- **Summary:** ${f.technicalSummary || "N/A"}\n`
            )
            .join("\n")
      );
    }

    // Dependencies
    if (context.dependencies && context.dependencies.length > 0) {
      sections.push(
        "# Dependencies (Already Completed)\n\n" +
          context.dependencies.map((d) => `- ${d.name}: ${d.technicalSummary || "completed"}`).join("\n")
      );
    }

    // File tree
    if (context.fileTree && context.fileTree.length > 0) {
      const treeStr = this._formatFileTree(context.fileTree);
      sections.push(`# Current File Structure\n\n\`\`\`\n${treeStr}\n\`\`\``);
    }

    // Related files (execution only)
    if (type === "execution" && context.relatedFiles && context.relatedFiles.length > 0) {
      sections.push(
        "# Related Files\n\n" +
          context.relatedFiles
            .map((f) => `## ${f.path}\n\`\`\`\n${f.content.substring(0, 1000)}...\n\`\`\``)
            .join("\n\n")
      );
    }

    // Completed work (execution only)
    if (type === "execution" && context.completedWork && context.completedWork.length > 0) {
      sections.push(
        "# Completed Subtasks for this Feature\n\n" +
          context.completedWork.map((st) => `- ${st.intent} (${st.apply_path || "N/A"})`).join("\n")
      );
    }

    return sections.join("\n\n---\n\n");
  }

  // ===== PRIVATE METHODS =====

  /**
   * Load project.md content
   * @private
   */
  async _loadProjectMd(project) {
    const projectMdPath = path.join(project.folder_path, "project.md");
    try {
      return fs.readFileSync(projectMdPath, "utf8");
    } catch {
      return "";
    }
  }

  /**
   * Get completed features with technical summaries
   * @private
   */
  _getCompletedFeatures(project) {
    const allFeatures = this.featureStore.getFeaturesByProject(project.id);

    return allFeatures
      .filter((f) => f.status === "completed" || f.status === "verified")
      .map((f) => {
        const subtasks = this.featureStore.getSubtasksByFeature(f.id);
        const files = [...new Set(subtasks.map((st) => st.apply_path).filter(Boolean))];

        return {
          name: f.name,
          priority: f.priority,
          technicalSummary: f.technical_summary || "No summary available",
          files,
        };
      });
  }

  /**
   * Get file tree as array of paths
   * @private
   */
  _getFileTree(folderPath, maxDepth = 3) {
    const files = [];

    const walk = (dir, depth = 0) => {
      if (depth > maxDepth) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files, node_modules, .git, etc.
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === ".ultracode" ||
            entry.name === "dist" ||
            entry.name === "build"
          ) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(folderPath, fullPath);

          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else {
            files.push(relativePath);
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    };

    walk(folderPath);
    return files.sort();
  }

  /**
   * Format file tree as indented string
   * @private
   */
  _formatFileTree(files) {
    // Group by directory
    const tree = {};

    for (const file of files) {
      const parts = file.split(path.sep);
      let current = tree;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;

        if (isLast) {
          if (!current.__files) current.__files = [];
          current.__files.push(part);
        } else {
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      }
    }

    // Render tree
    const render = (node, prefix = "", isLast = true) => {
      let result = "";
      const entries = Object.keys(node).filter((k) => k !== "__files");
      const files = node.__files || [];

      // Directories first
      entries.forEach((dir, idx) => {
        const isLastEntry = idx === entries.length - 1 && files.length === 0;
        const connector = isLastEntry ? "└── " : "├── ";
        const nextPrefix = prefix + (isLastEntry ? "    " : "│   ");

        result += prefix + connector + dir + "/\n";
        result += render(node[dir], nextPrefix, isLastEntry);
      });

      // Files
      files.forEach((file, idx) => {
        const isLastFile = idx === files.length - 1;
        const connector = isLastFile ? "└── " : "├── ";
        result += prefix + connector + file + "\n";
      });

      return result;
    };

    return render(tree);
  }

  /**
   * Get dependency context (completed features this feature depends on)
   * @private
   */
  _getDependencyContext(feature) {
    if (!feature.depends_on || feature.depends_on.length === 0) {
      return [];
    }

    return feature.depends_on
      .map((depId) => {
        const dep = this.featureStore.getFeature(depId);
        if (!dep) return null;

        return {
          name: dep.name,
          technicalSummary: dep.technical_summary,
          status: dep.status,
        };
      })
      .filter(Boolean);
  }

  /**
   * Find similar completed features (by name/description similarity)
   * @private
   */
  _findSimilarFeatures(feature, project) {
    const completed = this._getCompletedFeatures(project);

    // Simple keyword matching for now (can be enhanced with embeddings later)
    const keywords = (feature.name + " " + feature.description)
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    return completed
      .map((f) => {
        const fText = (f.name + " " + f.technicalSummary).toLowerCase();
        const matches = keywords.filter((kw) => fText.includes(kw)).length;

        return { ...f, similarity: matches };
      })
      .filter((f) => f.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);
  }

  /**
   * Get related files for execution context
   * @private
   */
  _getRelatedFiles(folderPath, targetPath) {
    if (!targetPath) return [];

    const files = [];
    const fullTargetPath = path.join(folderPath, targetPath);

    // If target file exists, include it
    try {
      if (fs.existsSync(fullTargetPath) && fs.statSync(fullTargetPath).isFile()) {
        const content = fs.readFileSync(fullTargetPath, "utf8");
        files.push({
          path: targetPath,
          content,
          reason: "Target file (will be modified)",
        });
      }
    } catch {}

    // Include files in same directory (for imports/context)
    try {
      const dir = path.dirname(fullTargetPath);
      const dirFiles = fs.readdirSync(dir);

      for (const file of dirFiles.slice(0, 3)) {
        // Limit to 3 files
        const filePath = path.join(dir, file);
        if (filePath === fullTargetPath) continue;

        if (fs.statSync(filePath).isFile() && file.match(/\.(js|ts|jsx|tsx|py|rb|go)$/)) {
          const content = fs.readFileSync(filePath, "utf8");
          files.push({
            path: path.relative(folderPath, filePath),
            content: content.substring(0, 500), // Limited preview
            reason: "Related file in same directory",
          });
        }
      }
    } catch {}

    return files;
  }

  /**
   * Get completed subtasks for a feature
   * @private
   */
  _getCompletedSubtasks(feature) {
    const subtasks = this.featureStore.getSubtasksByFeature(feature.id);

    return subtasks
      .filter((st) => st.status === "completed")
      .map((st) => ({
        intent: st.intent,
        apply_path: st.apply_path,
        apply_type: st.apply_type,
      }));
  }

  /**
   * Extract tech stack from project.md or features
   * @private
   */
  _extractStack(project) {
    // Try to extract from project.md
    const projectMdPath = path.join(project.folder_path, "project.md");
    try {
      const content = fs.readFileSync(projectMdPath, "utf8");

      // Look for "Stack" or "Tech Stack" section
      const stackMatch = content.match(/##?\s*(?:Tech\s*)?Stack\s*\n([\s\S]*?)(?=\n##|$)/i);
      if (stackMatch) {
        return stackMatch[1].trim();
      }
    } catch {}

    return "";
  }
}

module.exports = { ContextBuilder };
