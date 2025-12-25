# Contributing to Ultracode V2

First off, thank you for considering contributing to Ultracode! It's people like you that make Ultracode such a great tool for autonomous software development.

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct:
- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on what is best for the community
- Show empathy towards other community members

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** to demonstrate the steps
- **Describe the behavior you observed** and what you expected
- **Include screenshots** if relevant
- **Include your environment details**: OS, Node version, LLM provider used

**Bug Report Template:**
```markdown
**Description:**
A clear description of the bug

**Steps to Reproduce:**
1. Step one
2. Step two
3. ...

**Expected Behavior:**
What you expected to happen

**Actual Behavior:**
What actually happened

**Environment:**
- OS: [e.g., macOS 14.0]
- Node Version: [e.g., 18.17.0]
- Ultracode Version: [e.g., 2.0.0]
- LLM Provider: [e.g., OpenAI GPT-4o]

**Screenshots:**
If applicable
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the proposed feature
- **Explain why this enhancement would be useful**
- **List any alternative solutions** you've considered

### Pull Requests

1. **Fork the repository** and create your branch from `master`
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. **Make your changes**
   - Follow the coding style used in the project
   - Add comments for complex logic
   - Update documentation if needed

3. **Test your changes**
   - Ensure the server starts without errors
   - Test all affected features in the UI
   - Add tests if applicable

4. **Commit your changes**
   ```bash
   git commit -m "feat: add amazing feature"
   ```

   Use conventional commit messages:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting, etc.)
   - `refactor:` - Code refactoring
   - `test:` - Adding or updating tests
   - `chore:` - Maintenance tasks

5. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```

6. **Open a Pull Request**
   - Reference any related issues
   - Describe what your PR does
   - Include screenshots for UI changes

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- Git
- At least one LLM API key for testing

### Setup Steps

1. **Clone your fork**
   ```bash
   git clone https://github.com/your-username/ultracode.git
   cd ultracode
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API keys**
   ```bash
   cp config.json.example data/config.json
   # Edit data/config.json with your API keys
   ```

4. **Start the development server**
   ```bash
   npm start
   ```

5. **Make changes and test**
   - Backend changes: Restart the server
   - Frontend changes: Refresh the browser

## Project Structure

Understanding the codebase:

```
src/
├── server.js              # Main HTTP server and API routes
├── featureStore.js        # SQLite database operations
├── featureManager.js      # Feature lifecycle management
├── featurePlanner.js      # LLM-based feature planning
├── wizardAgent.js         # Project creation wizard
├── orchestrator.js        # Step execution engine
├── llmRegistry.js         # LLM provider registry
├── providers/             # LLM provider implementations
│   ├── openaiProvider.js
│   ├── claudeProvider.js
│   ├── geminiProvider.js
│   ├── lmstudioProvider.js
│   └── tavilyProvider.js
├── gitCommitter.js        # Git integration
├── projectGuard.js        # Filesystem sandboxing
└── executionGuard.js      # Command safety

public/
├── index.html             # Main UI
└── ui.js                  # Frontend JavaScript
```

## Coding Guidelines

### JavaScript Style

- Use **ES6+ features** where appropriate
- Use **async/await** instead of callbacks
- Use **const/let**, never **var**
- Use **template literals** for string interpolation
- Add **JSDoc comments** for functions

Example:
```javascript
/**
 * Executes a feature by planning and running all subtasks
 * @param {string} featureId - The feature ID to execute
 * @returns {Promise<Object>} The execution result
 */
async function executeFeature(featureId) {
  const feature = await store.getFeature(featureId);
  // ... implementation
  return result;
}
```

### Database Changes

If you modify the database schema:
1. Update the schema in `featureStore.js`
2. Add migration logic if needed
3. Document the change in your PR
4. Test with a fresh database

### UI Changes

- Keep the UI responsive and accessible
- Test on different screen sizes
- Use existing CSS classes from TailwindCSS CDN
- Ensure SSE updates work correctly

### Adding New LLM Providers

1. Create a new file in `src/providers/`
2. Implement the provider interface:
   ```javascript
   class NewProvider {
     async generate(prompt, options) { /* ... */ }
     async listModels() { /* ... */ }
   }
   ```
3. Register in `providerFactory.js`
4. Add configuration example to `config.json.example`
5. Update documentation

## Testing

While we don't have a formal test suite yet, please manually test:

### Before Submitting a PR

- [ ] Server starts without errors
- [ ] Can create a new project via wizard
- [ ] Can add features manually
- [ ] Can execute features (plan + subtasks)
- [ ] UI updates in real-time via SSE
- [ ] No console errors in browser
- [ ] Configuration changes persist
- [ ] File operations work within project sandbox

### For UI Changes

- [ ] Test in Chrome/Firefox/Safari
- [ ] Test with different window sizes
- [ ] Check mobile responsiveness
- [ ] Verify no visual regressions

## Documentation

- Update **README.md** if you add new features
- Update **CLAUDE.md** for technical/architectural changes
- Add **JSDoc comments** for new functions
- Include **examples** in documentation

## Questions?

Feel free to:
- Open a [GitHub Discussion](https://github.com/yourusername/ultracode/discussions)
- Comment on an existing issue
- Ask in your Pull Request

## Recognition

Contributors will be recognized in:
- GitHub contributors page
- Release notes for significant contributions
- Special mentions for major features

Thank you for making Ultracode better! 🚀
