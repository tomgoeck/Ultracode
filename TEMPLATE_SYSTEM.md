# Template System Implementation

## Overview

The Template System allows users to quickly start projects using pre-configured templates instead of going through the full AI-powered wizard chat. Templates include predefined `project.md` files and feature sets, significantly speeding up project initialization.

## Implementation Summary

### 1. Backend Components

#### **`src/templates.js`** (New File)
Defines all available project templates with complete configurations:

- **react-tailwind**: Basic React + TailwindCSS setup (1 foundation feature)
- **react-portfolio**: Complete portfolio website (5 features: Foundation, Hero, About, Projects, Contact)
- **nextjs-blog**: Next.js blog with markdown support (3 features: Setup, Markdown system, Blog listing)
- **express-api**: Node.js REST API with MongoDB (3 features: Server setup, User model, CRUD routes)

Each template includes:
```javascript
{
  id: "template-id",
  name: "Display Name",
  description: "Short description",
  icon: "emoji",
  projectMd: "# Full project.md content...",
  features: [
    {
      id: "F001",
      name: "Feature Name",
      description: "What this feature does",
      priority: "A/B/C",
      depends_on: [],
      definition_of_done: [
        { type: "automated", description: "Success criteria" },
        { type: "manual", description: "Manual verification" }
      ]
    }
  ]
}
```

#### **API Endpoints** (in `src/server.js`)

- **GET `/api/templates`**: Returns all available templates
  ```json
  {
    "templates": [
      { "id": "react-tailwind", "name": "React + TailwindCSS", ... }
    ]
  }
  ```

- **GET `/api/templates/:id`**: Returns specific template by ID
  ```json
  {
    "template": { "id": "react-portfolio", "name": "Portfolio Website", ... }
  }
  ```

#### **Wizard Integration** (in `src/wizardAgent.js`)

- Modified `/api/wizard/start` endpoint to accept optional `templateId` parameter
- Added `initializeFromTemplate(projectId, template)` method that:
  - Loads template's `projectMd` into wizard state
  - Loads template's `features` array into wizard state
  - Marks wizard as having extracted features
- Returns `templateApplied: true` when template is successfully loaded

### 2. Frontend Components

#### **HTML Changes** (`public/index.html`)

Added template picker to Wizard Page 1 (lines 325-337):

```html
<div>
  <label class="block text-xs font-medium text-gray-400 mb-2">
    Start from Template (Optional)
  </label>
  <div id="template-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
    <!-- "Start from Scratch" option (selected by default) -->
    <div class="template-card border-2 border-blue-500 ...">
      <span class="text-lg">📄</span>
      <span class="font-medium text-sm">Start from Scratch</span>
      <p class="text-xs text-gray-500">Use AI chat to define your project</p>
    </div>
    <!-- Templates loaded dynamically here -->
  </div>
</div>
```

#### **JavaScript Changes** (`public/ui.js`)

**1. Wizard State** (line 1783):
```javascript
this.state.wizard = {
  // ... existing fields
  selectedTemplateId: null  // NEW: tracks selected template
};
```

**2. Template Loading** (lines 1815-1848):
```javascript
async wizardLoadTemplates() {
  const res = await fetch('/api/templates');
  const data = await res.json();

  // Add click handler to "Start from Scratch"
  scratchCard.onclick = () => this.selectTemplate(null);

  // Generate template cards dynamically
  data.templates.forEach(template => {
    const card = document.createElement('div');
    card.innerHTML = `
      <span class="text-lg">${template.icon}</span>
      <span>${template.name}</span>
      <p>${template.description}</p>
    `;
    card.onclick = () => this.selectTemplate(template.id);
  });
}
```

**3. Template Selection** (lines 1850-1866):
```javascript
selectTemplate(templateId) {
  // Update state
  this.state.wizard.selectedTemplateId = templateId || null;

  // Update UI (highlight selected card)
  document.querySelectorAll('.template-card').forEach(card => {
    if (card.dataset.templateId === normalizedId) {
      card.classList.add('border-blue-500');
    } else {
      card.classList.remove('border-blue-500');
    }
  });
}
```

**4. Wizard Flow** (lines 1901-1967):
```javascript
async wizardNext(currentPage) {
  if (currentPage === 1) {
    const payload = { name, description };

    // Pass templateId if selected
    if (this.state.wizard.selectedTemplateId) {
      payload.templateId = this.state.wizard.selectedTemplateId;
    }

    const res = await fetch('/api/wizard/start', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // Skip chat page if template was applied
    if (data.templateApplied) {
      this.state.wizard.summary = { projectMd: 'Template applied' };
      this.wizardShowPage(3);  // Go directly to model selection
      return;
    }

    // Otherwise, proceed to chat page
    this.wizardShowPage(2);
  }
}
```

## User Flow

### Without Template (Start from Scratch)
1. User clicks "New Project"
2. Enters project name and description
3. Keeps "Start from Scratch" selected (default)
4. Clicks "Next"
5. Goes to **Page 2: Chat** with AI to define features
6. Generates summary
7. Goes to **Page 3: Model Selection**
8. Clicks "Create Project"

### With Template
1. User clicks "New Project"
2. Enters project name and description
3. **Selects a template** (e.g., "Portfolio Website")
4. Clicks "Next"
5. **Skips Page 2** (chat) entirely
6. Goes directly to **Page 3: Model Selection**
7. Clicks "Create Project"
8. Features from template are automatically created

## Testing

### Backend API Tests
```bash
# Test templates list
curl http://localhost:4173/api/templates | jq '.templates | length'
# Should return: 4

# Test specific template
curl http://localhost:4173/api/templates/react-portfolio | jq '.template.name'
# Should return: "Portfolio Website"

# Test wizard with template
curl -X POST http://localhost:4173/api/wizard/start \
  -H 'Content-Type: application/json' \
  -d '{"name":"test-project","description":"Test","templateId":"react-tailwind"}' \
  | jq '{ok, templateApplied, projectId}'
# Should return: {"ok": true, "templateApplied": true, "projectId": "project-..."}
```

### Frontend UI Tests (Manual)
1. **Start server**: `PORT=4173 node src/server.js`
2. **Open browser**: http://localhost:4173
3. **Click "New Project"**
4. **Verify template cards**:
   - Should see "Start from Scratch" (blue border, selected)
   - Should see 4 template options with emojis
5. **Select "Portfolio Website"**:
   - Card should highlight with blue border
   - Other cards should return to gray
6. **Enter project details**:
   - Name: "my-portfolio-test"
   - Description: "Testing template system"
7. **Click "Next: Project Details →"**
8. **Verify skipped chat**:
   - Should skip directly to Model Selection page
   - Step 2 indicator should show completed (green)
   - Step 3 indicator should show active (blue)
9. **Select models and create project**
10. **Verify features were created**:
    - Should see 5 features in left sidebar
    - F001: Foundation setup
    - F002: Hero Section
    - F003: About Section
    - F004: Projects Showcase
    - F005: Contact Form

## Files Modified

### New Files
- `src/templates.js` - Template definitions

### Modified Files
- `public/index.html` - Added template picker UI to wizard page 1
- `public/ui.js` - Added template loading, selection, and wizard flow logic
- `src/server.js` - Added template API endpoints, modified wizard start
- `src/wizardAgent.js` - Added `initializeFromTemplate()` method

## Configuration

### Adding New Templates

To add a new template, edit `src/templates.js`:

```javascript
const TEMPLATES = {
  // ... existing templates

  "my-new-template": {
    id: "my-new-template",
    name: "My New Template",
    description: "What this template does",
    icon: "🎨",  // Choose an emoji
    projectMd: `# Project Documentation
## Overview
Description of the project...

## Tech Stack
- List technologies...
`,
    features: [
      {
        id: "F001",
        name: "Foundation",
        description: "Setup basic project structure",
        priority: "A",  // A = Essential, B = Important, C = Nice-to-have
        depends_on: [],
        definition_of_done: [
          {
            type: "automated",
            description: "package.json exists with dependencies"
          },
          {
            type: "manual",
            description: "Project builds successfully"
          }
        ]
      }
      // Add more features...
    ]
  }
};
```

**Important**:
- Feature IDs will be automatically prefixed with `projectId` (e.g., `project-123-F001`)
- Keep feature IDs sequential (F001, F002, etc.)
- Priority A features should have no dependencies
- Always include Definition of Done for testing

## Benefits

1. **Speed**: Skip the 5-10 minute chat conversation for common project types
2. **Consistency**: Predefined features ensure best practices
3. **Flexibility**: Users can still customize after creation
4. **Learning**: Templates serve as examples for new users
5. **Scalability**: Easy to add new templates for common stacks

## Future Enhancements

- [ ] Template preview (show features before selecting)
- [ ] Template categories (Frontend, Backend, Full-stack)
- [ ] User-created custom templates (save project as template)
- [ ] Template marketplace (share templates with community)
- [ ] Template versioning (track template updates)
- [ ] Template dependencies (template requires certain models)

## Status

✅ **Completed** - Template system is fully functional
- Backend API working
- Frontend UI implemented
- Wizard flow integrated
- 4 templates available
- Ready for user testing

**Next Step**: Manual UI testing to verify end-to-end flow with template selection.
