const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { normalizeLLMResponse } = require("./llmUtils");

/**
 * WizardAgent handles the 3-page project creation wizard:
 * - Page 1: Project basics (name, description, folder creation, git init)
 * - Page 2: Project clarification via chat (features, stack, design)
 * - Page 3: Model selection
 *
 * Outputs: project.md in the project folder and creates features directly in DB
 */
class WizardAgent {
  /**
   * @param {Object} opts
   * @param {import('./featureStore').FeatureStore} opts.featureStore
   * @param {import('./llmRegistry').LLMRegistry} opts.llmRegistry
   * @param {import('./providers/tavilyProvider').TavilyProvider} [opts.tavilyProvider]
   * @param {Object} [opts.resourceMonitor]
   */
  constructor({ featureStore, llmRegistry, tavilyProvider = null, resourceMonitor = null }) {
    this.featureStore = featureStore;
    this.llmRegistry = llmRegistry;
    this.tavilyProvider = tavilyProvider;
    this.resourceMonitor = resourceMonitor;
    this.activeWizards = new Map(); // projectId -> wizard state
  }

  // ==================== PAGE 1: BASICS ====================

  /**
   * Start wizard - create project folder and init git.
   * @param {Object} opts
   * @returns {Object} Project info
   */
  startWizard({ name, description, basePath }) {
    // Sanitize folder name
    const folderName = this.sanitizeFolderName(name);
    const folderPath = path.join(basePath, folderName);

    // Check if folder already exists
    if (fs.existsSync(folderPath)) {
      throw new Error(`Folder already exists: ${folderPath}`);
    }

    // Create folder
    fs.mkdirSync(folderPath, { recursive: true });

    // Git init
    const gitResult = spawnSync("git", ["init"], {
      cwd: folderPath,
      encoding: "utf8",
    });
    const gitInitialized = gitResult.status === 0;

    // Create project in database
    const projectId = this.featureStore.createProject({
      name,
      description,
      folderPath,
      plannerModel: null,
      executorModel: null,
      voteModel: null,
    });

    // Initialize wizard state
    this.activeWizards.set(projectId, {
      step: 1,
      conversation: [],
      extractedFeatures: [],
      projectSummary: null,
      webSearches: [],
    });

    this.featureStore.recordEvent(projectId, null, null, "wizard_started", {
      name,
      folderPath,
      gitInitialized,
    });

    return {
      projectId,
      name,
      folderName,
      folderPath,
      gitInitialized,
      step: 1,
    };
  }

  /**
   * Sanitize a string to be used as a folder name.
   * @param {string} name
   * @returns {string}
   */
  sanitizeFolderName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50) || "project";
  }

  // ==================== PAGE 2: CLARIFICATION CHAT ====================

  /**
   * Get the system prompt for the clarification chat.
   * @returns {string}
   */
  getClarificationSystemPrompt() {
    return `You are Project Setup Assistant for an AI coding tool. Your job is to help the user define a software project before any implementation starts.

## Core Responsibilities
1. Clarify requirements by asking focused questions and proposing sensible defaults.
2. Suggest options (framework, architecture, UI approach, testing strategy) with short pros/cons.
3. Create a prioritized feature list:
   - **A = Essential**: Must-have features for MVP. Without these, the project doesn't work.
   - **B = Must-Have**: Important features that should be in the first release.
   - **C = Could-Have**: Nice-to-have features that can be added later.
4. For each feature, define a Definition of Done (DoD) that is measurable.
5. Capture project guidelines (stack, design rules, structure, testing rules) in a human-readable form.
6. When the user requests a summary/finalization, output **project.md** and a JSON block of features (used to populate DB; no file written).
7. Always respond in **Markdown** (use headings, bullet lists, tables or code fences where helpful).

## Scope Constraints
- You operate only in the Project Creation screen. The user may revise and iterate here.
- **Do not implement code.** Do not generate patches. Do not run terminal commands.
- Do not assume anything the user has not agreed to. When unsure, ask.
- Keep answers concise and structured. Avoid long essays.

## Research Policy
- If web/search tools are available, you may use them to:
  - Verify framework recommendations
  - Check current best practices
  - Compare libraries briefly
- If no web/search tool is available, say so plainly and proceed using general best practices.
- Never invent sources. If you cite or reference something you looked up, include the URL in a "References" section in project.md.

## Conversation Workflow
Use this loop until the user is satisfied:
1. **Restate** what you understand in 3–6 bullets.
2. **Ask** the minimum number of questions needed to remove ambiguity.
3. **Offer** 2–3 concrete recommendations with short tradeoffs.
4. **Update** the evolving project decisions and feature list.

## What to Ask About (Checklist)
Ask only what's necessary, but cover these areas when relevant:
- Target users + main user journeys
- Platform (web, mobile, CLI), deployment expectations
- Tech stack preferences (language, framework, database)
- UI style (layout, colors, fonts), accessibility expectations
- Auth (none, email/password, OAuth), roles/permissions
- Data model basics (entities, relationships)
- Non-functional requirements (performance, offline, SEO, logging)
- Testing approach (unit/integration/E2E), CI expectations
- Constraints (time, complexity, "keep it simple", must-use libraries)

## Feature List Rules
- Always start with **Foundation A-features** that make the project runnable: scaffold + dev server, app shell + routing, data layer baseline, API/service baseline, testing baseline (unit/smoke), and a minimal E2E smoke (UI). Product features must depend_on the relevant foundation items.
- Product features should be incremental and testable: build shell → list → view → create → edit → delete (or equivalent flow).
- Each feature must be written as an end-to-end capability, not an implementation task.
- Each feature must include:
  - **name**: Clear, concise feature name
  - **description**: What the feature does
  - **priority**: A, B, or C
  - **depends_on**: List of feature IDs (if any)
  - **definition_of_done**: List of checks (automated or manual)

## Output Format for Finalization
When the user says "Finalize", "Generate files", "Create summary", or confirms the plan, you MUST output ONLY the following blocks with ZERO extra text before or after:

CRITICAL: Start your response immediately with ===PROJECT_TYPE=== (no greeting, no explanation).
CRITICAL: End your response immediately after ===END_FEATURES_JSON=== (no closing remarks).
CRITICAL: All 5 blocks are REQUIRED. Do not skip any block.

===PROJECT_TYPE===
[One of: react-vite, nextjs, express-api, php, static-html, react-express-fullstack, python-flask, python-django, vue-vite, svelte-vite, astro]
===END_PROJECT_TYPE===

===INIT_SH===
#!/bin/bash
[Complete bash script that installs ALL dependencies and sets up the project]
[Must include: npm install (if Node), prisma generate (if Prisma), any build steps, database setup, etc.]
[This script runs ONCE on first Play-button click]
===END_INIT_SH===

===PACKAGE_JSON===
[Complete package.json with correct "dev" or "start" script for the dev server]
[Only include this block if the project is a Node.js project]
[Must have proper scripts: "dev": "vite" for React/Vite, "start": "node server.js" for Express, etc.]
===END_PACKAGE_JSON===

===PROJECT_MD===
[Full markdown content for project.md]
===END_PROJECT_MD===

===FEATURES_JSON===
[Valid JSON for features.json]
===END_FEATURES_JSON===

## Project Type Guide
Choose the correct project type based on the stack:
- **react-vite**: React app with Vite bundler (most common React setup)
- **nextjs**: Next.js app (React with SSR/SSG)
- **express-api**: Node.js API with Express (no frontend)
- **react-express-fullstack**: React frontend + Express backend (monorepo or separate folders)
- **php**: PHP application (uses php -S for dev server)
- **static-html**: Pure HTML/CSS/JS (no build step)
- **vue-vite**: Vue.js app with Vite
- **svelte-vite**: Svelte app with Vite
- **astro**: Astro static site generator
- **python-flask**: Python Flask API
- **python-django**: Python Django app

## init.sh Requirements
The init.sh script MUST:
1. Check if dependencies are already installed (idempotent)
2. Install all npm/pip/composer dependencies
3. Run database migrations if needed (Prisma, TypeORM, etc.)
4. Generate code if needed (Prisma client, GraphQL types, etc.)
5. Create necessary config files (.env templates)
6. Be safe to run multiple times (check before installing)

Example for React + Vite:
\`\`\`bash
#!/bin/bash
set -e
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi
echo "Project ready!"
\`\`\`

Example for Express + Prisma:
\`\`\`bash
#!/bin/bash
set -e
if [ ! -d "node_modules" ]; then
  npm install
fi
if [ -f "prisma/schema.prisma" ]; then
  npx prisma generate
  npx prisma migrate deploy
fi
echo "API ready!"
\`\`\`

## package.json Requirements
The package.json MUST have the correct dev server script:
- React/Vite: \`"dev": "vite"\`
- Next.js: \`"dev": "next dev"\`
- Express: \`"start": "node server.js"\` or \`"dev": "nodemon server.js"\`
- Full-stack: \`"dev": "concurrently \\"npm run dev:client\\" \\"npm run dev:api\\"\"\`

## Complete Example Output

Here is a complete example for a React + Vite todo app:

===PROJECT_TYPE===
react-vite
===END_PROJECT_TYPE===

===INIT_SH===
#!/bin/bash
set -e

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "React app ready! Run 'npm run dev' to start."
===END_INIT_SH===

===PACKAGE_JSON===
{
  "name": "todo-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.8"
  }
}
===END_PACKAGE_JSON===

===PROJECT_MD===
# Todo App

A simple React-based todo list application.

## Stack
- React 18
- Vite (build tool)
- CSS Modules for styling

## Features
- Add/remove todos
- Mark as complete
- Filter by status

## Development
Run \`npm run dev\` to start the dev server.
===END_PROJECT_MD===

===FEATURES_JSON===
{
  "features": [
    {
      "id": "F001",
      "name": "Project Scaffold",
      "description": "Set up Vite + React project structure",
      "priority": "A",
      "depends_on": [],
      "definition_of_done": [
        {"type": "automated", "description": "npm run dev starts without errors"},
        {"type": "manual", "description": "Browser shows default React page"}
      ]
    },
    {
      "id": "F002",
      "name": "Todo List Component",
      "description": "Display list of todos with add/remove functionality",
      "priority": "A",
      "depends_on": ["F001"],
      "definition_of_done": [
        {"type": "automated", "description": "Component renders without errors"},
        {"type": "manual", "description": "Can add and remove todos in UI"}
      ]
    }
  ]
}
===END_FEATURES_JSON===

## Tone
Be helpful, practical, and direct. Default to simple, modern choices unless the user wants something else.`;

  }

  /**
   * Get the initial greeting for the chat.
   * @param {string} projectName
   * @param {string} description
   * @returns {string}
   */
  getInitialGreeting(projectName, description) {
    return `Great! Let's plan your project "${projectName}".

${description ? `You mentioned: "${description}"\n\n` : ""}I'll help you clarify the requirements. Let's start with some questions:

1. **What type of application is this?** (e.g., web app, API, CLI tool, mobile app)
2. **Who are the target users?**
3. **Do you have any tech stack preferences?** (e.g., React, Vue, Node.js, Python)

Feel free to answer all at once or we can go through them one by one. I can also search the web for best practices if you'd like recommendations!`;
  }

  /**
   * Process a chat message in the clarification phase.
   * @param {string} projectId
   * @param {string} userMessage
   * @param {string} [modelName] - LLM to use for responses
   * @returns {Promise<Object>}
   */
  async processChat(projectId, userMessage, modelName) {
    // Auto-initialize wizard if not exists (for sessionId-based wizards)
    let wizard = this.activeWizards.get(projectId);
    if (!wizard) {
      // Create a temporary wizard state for this session
      wizard = {
        conversation: [],
        webSearches: [],
        summary: null,
        features: [],
      };
      this.activeWizards.set(projectId, wizard);
    }

    // Try to get project (may not exist for sessionId-based wizards)
    const project = this.featureStore.getProject(projectId);
    // Only store in DB if project exists
    const shouldPersist = !!project;

    // Add user message to conversation
    wizard.conversation.push({ role: "user", content: userMessage });
    if (shouldPersist) {
      this.featureStore.addWizardMessage(projectId, "user", userMessage);
    }

    // Build messages for LLM
    const messages = [
      { role: "system", content: this.getClarificationSystemPrompt() },
      ...wizard.conversation,
    ];

    // Add web search results if any recent searches
    if (wizard.webSearches.length > 0) {
      const lastSearch = wizard.webSearches[wizard.webSearches.length - 1];
      messages.push({
        role: "system",
        content: `Recent web search results:\n${lastSearch.context}`,
      });
    }

    // Get LLM provider
    const provider = this.llmRegistry.get(modelName);
    if (!provider) {
      throw new Error(`Provider not found: ${modelName}`);
    }

    // Generate response
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    const response = await provider.generate(prompt, { temperature: 0.7, maxTokens: 16000 });
    const normalized = normalizeLLMResponse(response, provider);
    if (this.resourceMonitor && projectId) {
      this.resourceMonitor.recordProjectPrompt(projectId, normalized.model, prompt, normalized.content, {
        usage: normalized.usage,
        role: "planner",
      });
    }

    // Add assistant response to conversation
    wizard.conversation.push({ role: "assistant", content: normalized.content });
    if (shouldPersist) {
      this.featureStore.addWizardMessage(projectId, "assistant", normalized.content);
    }

    // Check if response contains a summary
    const summaryMatch = normalized.content.match(/```summary\n([\s\S]*?)```/);
    if (summaryMatch) {
      wizard.projectSummary = this.parseSummary(summaryMatch[1]);
      wizard.extractedFeatures = wizard.projectSummary.features || [];
    }

    this.featureStore.recordEvent(projectId, null, null, "wizard_chat", {
      userMessage: userMessage.substring(0, 100),
      hasSummary: !!summaryMatch,
    });

    return {
      response: normalized.content,
      hasSummary: !!summaryMatch,
      summary: wizard.projectSummary,
      conversationLength: wizard.conversation.length,
    };
  }

  /**
   * Perform web search and add results to context.
   * @param {string} projectId
   * @param {string} query
   * @returns {Promise<Object>}
   */
  async webSearch(projectId, query) {
    const wizard = this.activeWizards.get(projectId);
    if (!wizard) {
      throw new Error(`No active wizard for project ${projectId}`);
    }

    if (!this.tavilyProvider || !this.tavilyProvider.isConfigured()) {
      throw new Error("Web search not configured. Please add a Tavily API key in settings.");
    }

    const result = await this.tavilyProvider.search(query, {
      searchDepth: "basic",
      maxResults: 5,
      includeAnswer: true,
    });

    const context = this.tavilyProvider.formatForContext(result);

    wizard.webSearches.push({
      query,
      result,
      context,
      timestamp: Date.now(),
    });

    this.featureStore.recordEvent(projectId, null, null, "wizard_web_search", {
      query,
      resultsCount: result.results.length,
    });

    return {
      answer: result.answer,
      results: result.results,
      context,
    };
  }

  /**
   * Parse the summary block from LLM response.
   * @param {string} summaryText
   * @returns {Object}
   */
  parseSummary(summaryText) {
    const summary = {
      framework: null,
      styling: null,
      database: null,
      testing: null,
      features: [],
      design: {
        primaryColor: null,
        font: null,
        layout: null,
      },
      notes: null,
    };

    const lines = summaryText.split("\n");
    let section = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse key-value pairs
      if (trimmed.startsWith("FRAMEWORK:")) {
        summary.framework = trimmed.replace("FRAMEWORK:", "").trim();
      } else if (trimmed.startsWith("STYLING:")) {
        summary.styling = trimmed.replace("STYLING:", "").trim();
      } else if (trimmed.startsWith("DATABASE:")) {
        summary.database = trimmed.replace("DATABASE:", "").trim();
      } else if (trimmed.startsWith("TESTING:")) {
        summary.testing = trimmed.replace("TESTING:", "").trim();
      } else if (trimmed === "FEATURES:") {
        section = "features";
      } else if (trimmed === "DESIGN:") {
        section = "design";
      } else if (trimmed === "NOTES:") {
        section = "notes";
      } else if (section === "features") {
        // Parse feature line: "A: Feature Name - Description"
        const featureMatch = trimmed.match(/^([ABC]):\s*(.+?)\s*-\s*(.+)$/);
        if (featureMatch) {
          summary.features.push({
            priority: featureMatch[1],
            name: featureMatch[2].trim(),
            description: featureMatch[3].trim(),
          });
        }
      } else if (section === "design") {
        if (trimmed.includes("Primary Color:")) {
          summary.design.primaryColor = trimmed.split(":")[1]?.trim();
        } else if (trimmed.includes("Font:")) {
          summary.design.font = trimmed.split(":")[1]?.trim();
        } else if (trimmed.includes("Layout:")) {
          summary.design.layout = trimmed.split(":")[1]?.trim();
        }
      } else if (section === "notes") {
        summary.notes = (summary.notes || "") + trimmed + "\n";
      }
    }

    return summary;
  }

  /**
   * Manually trigger summary extraction.
   * @param {string} projectId
   * @param {string} modelName
   * @returns {Promise<Object>}
   */
  async extractSummary(projectId, modelName) {
    // Auto-initialize wizard if not exists
    let wizard = this.activeWizards.get(projectId);
    if (!wizard) {
      wizard = {
        conversation: [],
        webSearches: [],
        summary: null,
        features: [],
      };
      this.activeWizards.set(projectId, wizard);
    }

    // Check if there's any conversation to summarize
    if (wizard.conversation.length === 0) {
      throw new Error("No conversation to summarize yet. Please chat first.");
    }

    const provider = this.llmRegistry.get(modelName);
    if (!provider) {
      throw new Error(`Provider not found: ${modelName}`);
    }

    const conversationText = wizard.conversation
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const prompt = `Based on this ENTIRE conversation about a project, extract ALL features that were discussed and generate the full wizard output blocks.

${conversationText}

IMPORTANT: Extract ALL features mentioned in the conversation above. Do not provide just one example feature!

When building features.json:
- Start with a foundation feature that sets up the working skeleton: repo structure, baseline layout/navigation, shared styling/theme tokens, and any build/config needed so other features can run.
- Follow with ALL other features discussed in the conversation in dependency/flow order (MVP first). Include hero sections, about sections, contact forms, project showcases, etc. - everything mentioned.
- Keep features coarse but outcome-focused (subtasks will add detail). Each feature must include a clear, measurable Definition of Done.
- If the conversation mentions 6 features, output 6 features. If it mentions 10, output 10. Extract everything discussed.

Output exactly the following blocks with no extra commentary (start immediately with ===PROJECT_TYPE=== and end immediately after ===END_FEATURES_JSON===):

===PROJECT_TYPE===
[One of: react-vite, nextjs, express-api, php, static-html, react-express-fullstack, python-flask, python-django, vue-vite, svelte-vite, astro]
===END_PROJECT_TYPE===

===INIT_SH===
#!/bin/bash
[Complete bash script that installs ALL dependencies and sets up the project]
[Must include: npm install (if Node), prisma generate (if Prisma), any build steps, database setup, etc.]
[This script runs ONCE on first Play-button click]
===END_INIT_SH===

===PACKAGE_JSON===
[Complete package.json with correct "dev" or "start" script for the dev server]
[Only include this block if the project is a Node.js project]
===END_PACKAGE_JSON===

===PROJECT_MD===
# [Project Name]

## Project Overview
[Brief overview of what this project does]

## Goals and Non-Goals
**Goals:**
- [Goal 1]
- [Goal 2]

**Non-Goals:**
- [Non-goal 1]

## Tech Stack
- **Framework:** [framework name]
- **Styling:** [styling approach]
- **Database:** [database if any, or "None"]
- **Testing:** [testing approach]

## Architecture & Project Structure
\`\`\`
src/
├── components/
├── pages/
└── utils/
\`\`\`

## UI / Design Guidelines
- **Primary Color:** [hex code]
- **Font:** [font name]
- **Layout:** [layout style]

## Testing Strategy
[What to test and how]

## Development Rules
[Coding standards, linting, formatting]

## References
[Only if web research was used]
===END_PROJECT_MD===

===FEATURES_JSON===
{
  "project_name": "[Project Name]",
  "project_description": "[Brief description]",
  "features": [
    {
      "id": "F001",
      "name": "Foundation: project scaffold & base layout",
      "description": "Set up repo/file structure, build/config, shared theme tokens, and a navigable shell (header/nav/footer) to host all pages.",
      "priority": "A",
      "status": "draft",
      "depends_on": [],
      "definition_of_done": [
        {
          "id": "D001",
          "type": "automated",
          "description": "[Check description]",
          "status": "pending",
          "evidence": null
        }
      ],
      "technical_summary": ""
    },
    {
      "id": "F002",
      "name": "[Second Feature Name]",
      "description": "[Description of second feature]",
      "priority": "A",
      "status": "draft",
      "depends_on": ["F001"],
      "definition_of_done": [
        {
          "id": "D002",
          "type": "automated",
          "description": "[Check description]",
          "status": "pending",
          "evidence": null
        }
      ],
      "technical_summary": ""
    }
    // ... include ALL other features discussed in the conversation
  ]
}
===END_FEATURES_JSON===`;

    const response = await provider.generate(prompt, { temperature: 0.3, maxTokens: 16000 });
    const normalized = normalizeLLMResponse(response, provider);
    if (this.resourceMonitor && projectId) {
      this.resourceMonitor.recordProjectPrompt(projectId, normalized.model, prompt, normalized.content, {
        usage: normalized.usage,
        role: "planner",
      });
    }

    // Extract project_type block
    const projectTypeMatch = normalized.content.match(/===PROJECT_TYPE===\s*([\s\S]*?)\s*===END_PROJECT_TYPE===/);
    const projectType = projectTypeMatch ? projectTypeMatch[1].trim() : 'static-html';

    // Extract init.sh block
    const initShMatch = normalized.content.match(/===INIT_SH===\s*([\s\S]*?)\s*===END_INIT_SH===/);
    const initShContent = initShMatch ? initShMatch[1].trim() : null;

    // Extract package.json block
    const packageJsonMatch = normalized.content.match(/===PACKAGE_JSON===\s*([\s\S]*?)\s*===END_PACKAGE_JSON===/);
    let packageJsonContent = null;
    if (packageJsonMatch) {
      try {
        packageJsonContent = JSON.parse(packageJsonMatch[1].trim());
      } catch (e) {
        console.warn("[WizardAgent] Failed to parse package.json:", e.message);
      }
    }

    // Extract project.md block
    const projectMdMatch = normalized.content.match(/===PROJECT_MD===\s*([\s\S]*?)\s*===END_PROJECT_MD===/);
    const projectMdContent = projectMdMatch ? projectMdMatch[1].trim() : null;

    // Extract features.json block
    const featuresJsonMatch = normalized.content.match(/===FEATURES_JSON===\s*([\s\S]*?)\s*===END_FEATURES_JSON===/);
    let featuresJsonContent = null;
    const warnings = [];

    if (!projectTypeMatch) {
      warnings.push("Missing PROJECT_TYPE block, defaulting to 'static-html'");
    }
    if (!initShMatch) {
      warnings.push("Missing INIT_SH block in model response");
    }
    if (!projectMdMatch) {
      warnings.push("Missing PROJECT_MD block in model response");
    }
    if (!featuresJsonMatch) {
      warnings.push("Missing FEATURES_JSON block in model response");
    }
    if (featuresJsonMatch) {
      try {
        featuresJsonContent = JSON.parse(featuresJsonMatch[1].trim());
      } catch (e) {
        warnings.push(`Failed to parse features.json: ${e.message}`);
        console.error("[WizardAgent] Failed to parse features.json:", e.message);
      }
    }

    // Store in wizard state
    if (projectType) {
      wizard.projectType = projectType;
    }
    if (initShContent) {
      wizard.initSh = initShContent;
    }
    if (packageJsonContent) {
      wizard.packageJson = packageJsonContent;
    }
    if (projectMdContent) {
      wizard.projectMd = projectMdContent;
    }
    if (featuresJsonContent) {
      wizard.featuresJson = featuresJsonContent;
      wizard.extractedFeatures = (featuresJsonContent.features || []).map(f => ({
        id: f.id,
        name: f.name,
        description: f.description,
        priority: f.priority,
        dependsOn: f.depends_on || [],
        dod: f.definition_of_done,
      }));
    }

    const success = !!(projectMdContent && featuresJsonContent && projectType);
    if (!success) {
      warnings.push("Summary incomplete; required blocks missing/invalid.");
    }

    return {
      projectType,
      initSh: initShContent,
      packageJson: packageJsonContent,
      projectMd: projectMdContent,
      featuresJson: featuresJsonContent,
      raw: normalized.content,
      warnings,
      success,
    };
  }

  /**
   * Get current wizard state.
   * @param {string} projectId
   * @returns {Object|null}
   */
  getWizardState(projectId) {
    return this.activeWizards.get(projectId) || null;
  }

  /**
   * Update extracted features manually.
   * @param {string} projectId
   * @param {Array} features
   */
  updateFeatures(projectId, features) {
    const wizard = this.activeWizards.get(projectId);
    if (wizard) {
      wizard.extractedFeatures = features;
      if (wizard.projectSummary) {
        wizard.projectSummary.features = features;
      }
    }
  }

  /**
   * Initialize wizard with template data.
   * @param {string} projectId
   * @param {Object} template - Template object with projectMd and features
   */
  initializeFromTemplate(projectId, template) {
    const wizard = this.activeWizards.get(projectId) || {
      conversation: [],
      webSearches: [],
      projectSummary: null,
      extractedFeatures: [],
    };

    // Set template content
    wizard.projectMd = template.projectMd;
    wizard.featuresJson = { features: template.features };
    wizard.extractedFeatures = template.features.map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      priority: f.priority,
      dependsOn: f.depends_on || [],
      dod: f.definition_of_done || [],
    }));

    wizard.conversation.push({
      role: "system",
      content: `Template "${template.name}" selected. You can still chat to customize the project.`,
    });

    this.activeWizards.set(projectId, wizard);

    return wizard;
  }

  // ==================== PAGE 3: MODEL SELECTION & FINALIZE ====================

  /**
   * Finalize wizard - select models and generate output files.
   * @param {string} projectId
   * @param {Object} models
   * @returns {Promise<Object>}
   */
  async finalizeWizard(projectId, { plannerModel, executorModel, voteModel, summary, projectMd: providedProjectMd, featuresJson: providedFeaturesJson, projectType: providedProjectType, initSh: providedInitSh, packageJson: providedPackageJson }) {
    let wizard = this.activeWizards.get(projectId);
    if (!wizard) {
      // Fallback: reconstruct minimal wizard state from provided data
      wizard = {
        projectMd: providedProjectMd || null,
        featuresJson: providedFeaturesJson || null,
        projectType: providedProjectType || 'static-html',
        initSh: providedInitSh || null,
        packageJson: providedPackageJson || null,
        extractedFeatures: [],
        projectSummary: summary || null,
      };
      if (providedFeaturesJson && Array.isArray(providedFeaturesJson.features)) {
        wizard.extractedFeatures = providedFeaturesJson.features.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          priority: f.priority,
          dependsOn: f.depends_on || f.dependsOn || [],
          dod: f.definition_of_done || f.dod,
        }));
      }
      // Cache for subsequent calls
      this.activeWizards.set(projectId, wizard);
    } else {
      // If wizard exists, update with provided data (in case user went back and regenerated summary)
      if (providedProjectType) wizard.projectType = providedProjectType;
      if (providedInitSh) wizard.initSh = providedInitSh;
      if (providedPackageJson) wizard.packageJson = providedPackageJson;
    }

    const project = this.featureStore.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Update project with model selection and project type
    this.featureStore.updateProject(projectId, {
      plannerModel,
      executorModel,
      voteModel,
      project_type: wizard.projectType || 'static-html',
      status: "active",
    });

    const folderPath = project.folder_path;

    // If we have no extracted features but featuresJson exists, sync them
    if ((!wizard.extractedFeatures || wizard.extractedFeatures.length === 0) && wizard.featuresJson?.features) {
      wizard.extractedFeatures = wizard.featuresJson.features.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        priority: f.priority,
        dependsOn: f.depends_on || f.dependsOn || [],
        dod: f.definition_of_done || f.dod,
      }));
    }

    // Write project.md
    const projectMdContent = wizard.projectMd || this.generateProjectMd(project.name, wizard.projectSummary);
    const projectMdPath = path.join(folderPath, "project.md");
    fs.writeFileSync(projectMdPath, projectMdContent);
    console.log(`[WizardAgent] Created project.md at ${projectMdPath}`);

    // Write init.sh if extracted from LLM
    if (wizard.initSh) {
      const initShPath = path.join(folderPath, "init.sh");
      fs.writeFileSync(initShPath, wizard.initSh);
      fs.chmodSync(initShPath, '755'); // Make executable
      console.log(`[WizardAgent] Created init.sh at ${initShPath}`);
    } else {
      console.warn(`[WizardAgent] No init.sh extracted from LLM response`);
    }

    // Write package.json if extracted from LLM (for Node.js projects)
    if (wizard.packageJson) {
      const packageJsonPath = path.join(folderPath, "package.json");
      fs.writeFileSync(packageJsonPath, JSON.stringify(wizard.packageJson, null, 2));
      console.log(`[WizardAgent] Created package.json at ${packageJsonPath}`);
    }

    // If still no features, fail fast
    if (!wizard.extractedFeatures || wizard.extractedFeatures.length === 0) {
      throw new Error("No features extracted; cannot finalize project. Please generate summary again.");
    }

    // Create features in database
    for (let i = 0; i < wizard.extractedFeatures.length; i++) {
      const f = wizard.extractedFeatures[i];

      // Convert DoD to string if it's an array
      let dodString = f.dod;
      if (Array.isArray(f.dod)) {
        dodString = f.dod.map(d => `- ${d.description || d}`).join('\n');
      } else if (!dodString) {
        dodString = `${f.name} is fully implemented and working`;
      }

      // Make feature ID globally unique by prefixing with project ID
      const featureId = `${projectId}-${f.id || f.featureId || `F${String(i + 1).padStart(3, '0')}`}`;

      this.featureStore.createFeature({
        id: featureId,
        projectId,
        name: f.name,
        description: f.description,
        priority: f.priority,
        dod: dodString,
        orderIndex: i,
        dependsOn: f.dependsOn || f.depends_on || [],
      });
    }

    // Record completion event
    this.featureStore.recordEvent(projectId, null, null, "wizard_completed", {
      featuresCount: wizard.extractedFeatures.length,
      plannerModel,
      executorModel,
      voteModel,
    });

    // Cleanup wizard state
    this.activeWizards.delete(projectId);

    return {
      projectId,
      folderPath,
      projectMdPath,
      featuresCount: wizard.extractedFeatures.length,
      models: { plannerModel, executorModel, voteModel },
      projectName: project.name,
    };
  }

  /**
   * Generate features.json content.
   * @param {Array} features
   * @returns {Object}
   */
  generateFeaturesJson(features) {
    return {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      features: features.map((f, idx) => ({
        id: `feature-${idx + 1}`,
        name: f.name,
        description: f.description,
        priority: f.priority,
        status: "pending",
        dependsOn: f.dependsOn || [],
        dod: f.dod || `${f.name} is fully implemented and working`,
        technicalSummary: null,
      })),
    };
  }

  /**
   * Generate project.md content.
   * @param {string} projectName
   * @param {Object} summary
   * @returns {string}
   */
  generateProjectMd(projectName, summary) {
    const s = summary || {};
    const design = s.design || {};

    return `# ${projectName}

## Stack
- **Framework:** ${s.framework || "Not specified"}
- **Styling:** ${s.styling || "Not specified"}
- **Database:** ${s.database || "None"}
- **Testing:** ${s.testing || "Not specified"}

## Design Guidelines
- **Primary Color:** ${design.primaryColor || "#3B82F6"}
- **Font:** ${design.font || "Inter, system-ui, sans-serif"}
- **Layout:** ${design.layout || "Responsive, mobile-first"}

## Project Structure
\`\`\`
src/
├── components/     # Reusable UI components
├── pages/          # Page components / routes
├── utils/          # Utility functions
├── hooks/          # Custom hooks (if applicable)
├── styles/         # Global styles
└── types/          # Type definitions (if TypeScript)
\`\`\`

## Coding Conventions
- Use consistent naming: camelCase for variables/functions, PascalCase for components
- Keep components small and focused (single responsibility)
- Extract reusable logic into utilities or hooks
- Write meaningful commit messages
- Add comments for complex logic

## Testing Guidelines
${s.testing ? `- ${s.testing}` : "- Write tests for critical functionality"}
- Test edge cases and error states
- Aim for high coverage on business logic

${s.notes ? `## Notes\n${s.notes}` : ""}

---
*This file was generated by Ultracode Wizard. Edit as needed, but be aware that changes may affect planning.*
`;
  }

  /**
   * Cancel an active wizard.
   * @param {string} projectId
   * @param {boolean} deleteProject - Also delete the project from DB
   */
  cancelWizard(projectId, deleteProject = false) {
    const wizard = this.activeWizards.get(projectId);
    if (wizard) {
      this.activeWizards.delete(projectId);
    }

    if (deleteProject) {
      const project = this.featureStore.getProject(projectId);
      if (project && project.folder_path && fs.existsSync(project.folder_path)) {
        // Remove empty project folder if it was just created
        try {
          fs.rmdirSync(project.folder_path);
        } catch {
          // Folder not empty or other error - leave it
        }
      }
      this.featureStore.deleteProject(projectId);
    }

    this.featureStore.recordEvent(projectId, null, null, "wizard_cancelled", {
      deleted: deleteProject,
    });
  }

  /**
   * Resume a wizard from saved state.
   * @param {string} projectId
   * @returns {Object|null}
   */
  resumeWizard(projectId) {
    const project = this.featureStore.getProject(projectId);
    if (!project || project.status !== "created") {
      return null;
    }

    // Load conversation from database
    const messages = this.featureStore.getWizardMessages(projectId);
    const conversation = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Restore wizard state
    this.activeWizards.set(projectId, {
      step: conversation.length > 0 ? 2 : 1,
      conversation,
      extractedFeatures: [],
      projectSummary: null,
      webSearches: [],
    });

    return {
      projectId,
      project,
      conversation,
      step: conversation.length > 0 ? 2 : 1,
    };
  }
}

module.exports = { WizardAgent };
