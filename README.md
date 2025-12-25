# Ultracode V2 🤖

**An autonomous coding agent with feature-based development pipeline**

Ultracode V2 transforms software development by autonomously planning, implementing, and testing complete features with human oversight. Built on a MAKER-inspired architecture, it provides a comprehensive project management system for AI-driven development.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

## ✨ Features

- **🎯 Feature-Based Development**: Organize work by features with A/B/C priorities
- **🔄 Complete Pipeline**: Project → Features → Subtasks → Execution → Testing → Git Commits
- **🧠 Multi-LLM Support**: OpenAI, Anthropic Claude, Google Gemini, LM Studio (local models)
- **📊 SQLite Persistence**: Robust database for projects, features, subtasks, and events
- **🎨 Interactive UI**: 3-column dashboard with live updates via Server-Sent Events
- **🧪 Automated Testing**: Puppeteer integration for screenshot-based verification
- **🔗 Dependency Management**: Features can depend on other features with validation
- **📝 Project Wizard**: AI-powered 3-page wizard for project setup
- **🔍 Web Research**: Integrated Tavily search for requirement gathering
- **🔒 Safety First**: Command guards, filesystem sandboxing, human-in-the-loop

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- At least one LLM API key (OpenAI, Anthropic, Gemini) or LM Studio running locally

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/ultracode.git
   cd ultracode
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API keys**
   ```bash
   # Copy the example configuration
   cp config.json.example data/config.json

   # Edit data/config.json and add your API keys
   # Note: data/ folder is gitignored, your keys are safe!
   ```

4. **Start the server**
   ```bash
   npm start
   # or with custom port
   PORT=4173 npm start
   ```

5. **Open the UI**
   Navigate to `http://localhost:4173` (or your custom port)

## 📖 Usage

### Creating Your First Project

1. **Launch the Project Wizard**
   - Click "New Project" in the UI
   - Enter project name and description
   - The wizard creates folder structure and initializes git

2. **Chat with the AI Assistant**
   - Describe your project requirements
   - The AI asks clarifying questions about:
     - Architecture and stack
     - Authentication needs
     - Data models
     - Testing requirements
   - Use web search for research on technologies

3. **Review Generated Plan**
   - AI generates `project.md` with complete specifications
   - Features extracted with A/B/C priorities
   - Definition of Done (DoD) for each feature
   - Select models for Planner, Executor, and Voter

4. **Execute Features**
   - Features appear in priority order
   - Click "Execute Next" to run highest priority feature
   - Watch subtasks execute in real-time
   - Review code and approve changes

### Understanding the Dashboard

```
┌──────────────┬──────────────┬────────────────┐
│  Features    │  Subtasks    │  Terminal      │
│  (Priority)  │  (Status)    │  (Live Logs)   │
│              │              │                │
│  A: ✓ Auth   │  ☑ Created   │  ▶ Starting... │
│  A: ● DB     │  ⏳ Running  │  ✓ Completed   │
│  B: ○ Dark   │  ☐ Pending   │  [Files]       │
│              │              │                │
│  [+ Add]     │  [Chat]      │                │
│  [Execute]   │              │                │
└──────────────┴──────────────┴────────────────┘
```

**Left Column**: Feature list with priority and status
**Middle Column**: Selected feature details and subtasks
**Right Column**: Terminal logs and file browser

### Feature Lifecycle

```
pending → running → completed → verified
          ↓              ↓
       paused        failed
          ↓
       blocked (dependencies not met)
```

- **Pending**: Waiting to be executed
- **Running**: Currently being processed
- **Paused**: Execution paused by user
- **Blocked**: Waiting for dependency features to complete
- **Completed**: All subtasks finished
- **Failed**: Execution encountered errors
- **Verified**: Passed automated tests (if configured)

## 🔧 Configuration

### LLM Providers

The system supports multiple LLM providers simultaneously. Configure in `data/config.json`:

```json
{
  "providers": [
    {
      "name": "GPT-4o-mini",
      "type": "openai",
      "apiKey": "sk-...",
      "model": "gpt-4o-mini"
    },
    {
      "name": "Claude Sonnet",
      "type": "anthropic",
      "apiKey": "sk-ant-...",
      "model": "claude-sonnet-4-5-20250929"
    }
  ],
  "settings": {
    "safetyMode": "auto"
  }
}
```

### Safety Modes

- **`auto`**: Execute all commands automatically
- **`ask`**: Request approval for medium/high risk commands

### Local Models (LM Studio)

1. Start LM Studio and load a model
2. Enable local server (default: `http://localhost:1234`)
3. Add to config:
   ```json
   {
     "name": "Local Model",
     "type": "lmstudio",
     "model": "model-name",
     "baseUrl": "http://localhost:1234"
   }
   ```

## 🏗️ Architecture

### Core Components

- **`featureStore.js`**: SQLite persistence layer (projects, features, subtasks, events)
- **`featureManager.js`**: Feature lifecycle orchestration
- **`featurePlanner.js`**: Decomposes features into atomic subtasks
- **`wizardAgent.js`**: 3-page project creation wizard
- **`orchestrator.js`**: Step execution engine (MAKER-based)
- **`llmRegistry.js`**: Multi-provider LLM management
- **`gitCommitter.js`**: Feature-level git commits
- **`projectGuard.js`**: Filesystem sandboxing
- **`executionGuard.js`**: Command safety validation

### Database Schema

- **projects**: Project metadata, model configs, folder paths
- **features**: Feature definitions with priorities and dependencies
- **subtasks**: Atomic implementation steps
- **events**: Complete audit log
- **wizard_messages**: Chat history from project creation

### API Endpoints

See [CLAUDE.md](CLAUDE.md) for complete API documentation.

## 🧪 Testing

### Running Tests

```bash
npm test
```

### Automated Feature Verification

Ultracode can automatically verify features using Puppeteer:

1. Feature completes execution
2. Dev server starts automatically (Node, PHP, etc.)
3. Screenshot captured
4. LLM verifies against Definition of Done
5. Feature marked as `verified` or `failed`

## 📁 Project Structure

```
Ultracode/
├── src/                    # Backend source code
│   ├── server.js          # HTTP server + API
│   ├── featureStore.js    # SQLite wrapper
│   ├── featureManager.js  # Feature orchestration
│   ├── featurePlanner.js  # Feature → Subtasks
│   ├── wizardAgent.js     # Project wizard
│   └── providers/         # LLM providers
├── public/                 # Frontend UI
│   ├── index.html         # Main dashboard
│   └── ui.js              # Frontend logic
├── data/                   # Runtime data (gitignored)
│   ├── config.json        # API keys & settings
│   ├── ultracode.db       # SQLite database
│   └── audit.log          # Event log
├── workspaces/            # Generated projects (gitignored)
└── docs/                  # Documentation
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Known Issues

See [Issues](https://github.com/yourusername/ultracode/issues) for known bugs and feature requests.

## 🗺️ Roadmap

- [x] Phase 1-5: Core feature pipeline system
- [ ] Phase 6: Puppeteer testing integration
- [ ] Phase 7: Enhanced context flow system
- [ ] Phase 8: Advanced git integration
- [ ] Phase 9: Token tracking UI
- [ ] Phase 10: V1 to V2 migration tools

## 📚 Documentation

- [Technical Documentation](CLAUDE.md) - Complete system architecture
- [Architecture Details](docs/architecture.md) - System design
- [API Reference](CLAUDE.md#api-endpoints) - REST API documentation

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/ultracode/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/ultracode/discussions)

## ⚠️ Security

**Important**: Never commit your `data/config.json` file or share your API keys. The `data/` folder is gitignored by default to protect your credentials.

If you accidentally committed sensitive data:
```bash
# Remove from git history
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch data/config.json" \
  --prune-empty --tag-name-filter cat -- --all

# Rotate your API keys immediately!
```

## 🙏 Acknowledgments

- Inspired by the MAKER architecture
- Built with contributions from the open-source community
- Powered by OpenAI, Anthropic, Google, and local LLM providers

---

**Made with ❤️ by the Ultracode community**
