# Security Policy

## Supported Versions

Currently, only the latest version of Ultracode V2 receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in Ultracode, please follow these steps:

### 1. DO NOT Create a Public Issue

Please **do not** create a public GitHub issue for security vulnerabilities. This could put all users at risk.

### 2. Report Privately

Send an email to the maintainers with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### 3. Response Time

We aim to:
- Acknowledge receipt within 48 hours
- Provide an initial assessment within 7 days
- Release a fix within 30 days for critical vulnerabilities

## Security Best Practices

### API Key Management

**CRITICAL**: Never commit API keys to version control!

1. **Storage**: All API keys are stored in `data/config.json`
2. **Gitignore**: The `data/` folder is gitignored by default
3. **Example File**: Use `config.json.example` as a template (contains no real keys)

**Before committing:**
```bash
# Check for sensitive data
git status
git diff

# Ensure data/ is ignored
git check-ignore data/config.json
# Should output: data/config.json
```

### If You Accidentally Committed Keys

1. **Immediately rotate all exposed API keys**
   - OpenAI: https://platform.openai.com/api-keys
   - Anthropic: https://console.anthropic.com/
   - Google AI: https://makersuite.google.com/app/apikey
   - Tavily: https://tavily.com/

2. **Remove from git history**
   ```bash
   # Remove file from all commits
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch data/config.json" \
     --prune-empty --tag-name-filter cat -- --all

   # Force push (if already pushed)
   git push origin --force --all
   ```

3. **Inform maintainers** if the leak was in a public fork

### Command Execution Safety

Ultracode executes commands in project workspaces. To stay safe:

1. **Review Generated Code**: Always review code before execution
2. **Safety Mode**: Use `"safetyMode": "ask"` for manual approval of risky commands
3. **Sandboxing**: Features execute within `workspaces/<project-id>/` only
4. **Execution Guards**: Commands are validated before execution

### Filesystem Sandboxing

- **Project Guard**: Restricts file operations to project workspace
- **No Parent Directory Access**: Cannot write outside workspace
- **Command Validation**: Potentially dangerous commands require approval

### Network Safety

- **LLM API Calls**: Only to configured providers
- **Web Search**: Only via Tavily API (if configured)
- **No Arbitrary URLs**: The system doesn't make unauthorized network requests

## Known Security Considerations

### 1. LLM-Generated Code

**Risk**: AI models can generate code with vulnerabilities

**Mitigation**:
- Always review generated code
- Run security scanners on generated projects
- Test in isolated environments first
- Use safety mode for sensitive projects

### 2. Command Injection

**Risk**: Maliciously crafted prompts could attempt command injection

**Mitigation**:
- Execution guards validate all commands
- Commands are executed in sandboxed workspaces
- Safety mode allows manual review

### 3. API Key Exposure

**Risk**: Keys stored in plaintext in config.json

**Mitigation**:
- data/ folder is gitignored
- File permissions should be restricted (user-only read/write)
- Consider using environment variables for production

**Recommended**:
```bash
# Restrict config.json permissions
chmod 600 data/config.json
```

### 4. Third-Party Dependencies

**Risk**: Dependencies could have vulnerabilities

**Mitigation**:
- Minimal dependencies (currently only Puppeteer)
- Regular updates via `npm audit`
- Check before installing new dependencies

**Check for vulnerabilities**:
```bash
npm audit
npm audit fix
```

### 5. Generated Project Code

**Risk**: Generated projects may contain vulnerabilities

**Mitigation**:
- Review generated code before deployment
- Run security scanners (ESLint security plugins, etc.)
- Test in staging environments
- Don't deploy generated code to production without review

## Security Checklist for Contributors

Before submitting a PR:

- [ ] No API keys in code
- [ ] No hardcoded credentials
- [ ] No sensitive data in examples
- [ ] Input validation for user-provided data
- [ ] Proper error handling (no sensitive info in errors)
- [ ] Command execution uses guards
- [ ] File operations respect sandbox
- [ ] Dependencies are up to date

## Dependency Security

### Updating Dependencies

```bash
# Check for vulnerabilities
npm audit

# Update to fix issues
npm audit fix

# Update all to latest (test thoroughly!)
npm update
```

### Currently Used Dependencies

- **puppeteer**: Browser automation for testing
  - Used for screenshot verification
  - Runs in isolated contexts

## Responsible Disclosure

We follow responsible disclosure principles:

1. **Report**: Contact maintainers privately
2. **Fix**: We develop and test a patch
3. **Release**: Security update released
4. **Disclosure**: Public disclosure after users have time to update

## Security Updates

Security updates will be:
- Released as patch versions (e.g., 2.0.1)
- Documented in release notes
- Announced in GitHub security advisories

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security Best Practices](https://docs.npmjs.com/about-security-audits)

---

**Stay secure! 🔒**
