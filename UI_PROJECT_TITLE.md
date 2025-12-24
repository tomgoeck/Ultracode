# UI Enhancement: Projekttitel & project.md Link ✅

## Übersicht

Der Header zeigt jetzt den aktuellen Projekttitel und einen direkten Link zur `project.md` an.

## UI Changes

### Header Layout (Before/After)

**Vorher:**
```
[U] Ultracode MAKER Edition    [Resource Monitor] [▶] [⏸] [⚙]
```

**Nachher:**
```
[U] Ultracode / Projekt Name  [📄 project.md]    [Resource Monitor] [▶] [⏸] [⚙]
                └─ grau          └─ blauer Link
```

## Implementation

### 1. HTML Struktur (`public/index.html`)

```html
<!-- Header mit dynamischem Projekttitel -->
<header class="...">
  <div class="flex items-center gap-3">
    <!-- Ultracode Logo (klickbar → zurück zu Projektliste) -->
    <div class="w-8 h-8 bg-blue-600 rounded-lg ... cursor-pointer"
         onclick="app.showProjects()">U</div>

    <div class="flex items-center gap-2">
      <!-- Ultracode Titel (klickbar → zurück zu Projektliste) -->
      <h1 class="... cursor-pointer hover:text-blue-400"
          onclick="app.showProjects()">Ultracode</h1>

      <!-- Separator (versteckt wenn kein Projekt aktiv) -->
      <span id="project-title-separator" class="text-gray-600 hidden">/</span>

      <!-- Projekt Titel Container (versteckt wenn kein Projekt aktiv) -->
      <div id="project-title-container" class="hidden flex items-center gap-2">
        <!-- Projekt Name -->
        <h2 id="project-title" class="font-semibold text-base text-gray-300"></h2>

        <!-- project.md Link -->
        <button id="project-md-link" onclick="app.openProjectMd()"
                class="text-xs text-blue-400 hover:text-blue-300 ... flex items-center gap-1">
          <svg>...</svg> <!-- Dokument Icon -->
          <span>project.md</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Rechte Seite: Resource Monitor, Play, Stop, Settings -->
  <div class="flex items-center gap-4">...</div>
</header>
```

### 2. JavaScript Logic (`public/ui.js`)

#### 2.1 Projekttitel aktualisieren beim Öffnen

```javascript
async openProject(projectId) {
  this.state.activeProject = projectId;
  // ...

  // UPDATE: Projekttitel im Header anzeigen
  this.updateProjectTitle(projectId);

  // Load features...
}

updateProjectTitle(projectId) {
  // Projekt aus State holen
  const project = this.state.projects?.find(p => p.id === projectId);

  if (project) {
    // Elemente anzeigen
    document.getElementById('project-title-separator').classList.remove('hidden');
    document.getElementById('project-title-container').classList.remove('hidden');
    document.getElementById('project-title-container').classList.add('flex');

    // Projektnamen setzen
    document.getElementById('project-title').textContent = project.name;
  } else {
    this.hideProjectTitle();
  }
}
```

#### 2.2 Projekttitel verstecken bei Rückkehr zur Projektliste

```javascript
showProjects() {
  document.getElementById('view-projects').classList.remove('hidden');
  document.getElementById('view-dashboard').classList.add('hidden');
  this.state.activeProject = null;

  // UPDATE: Projekttitel ausblenden
  this.hideProjectTitle();
}

hideProjectTitle() {
  document.getElementById('project-title-separator').classList.add('hidden');
  document.getElementById('project-title-container').classList.add('hidden');
  document.getElementById('project-title-container').classList.remove('flex');
}
```

#### 2.3 project.md öffnen (bereits vorhanden)

```javascript
async openProjectMd() {
  if (!this.state.activeProject) {
    alert('No project selected');
    return;
  }

  // Modal öffnen
  const modal = document.getElementById('modal-project-md');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  // project.md laden
  const res = await fetch(`/api/projects/${this.state.activeProject}/project-md`);
  const data = await res.json();

  // Im Editor anzeigen
  document.getElementById('project-md-editor').value = data.content || '';
}
```

## Visuelle Hierarchie

### Farben & Kontraste

| Element | Farbe | Zweck |
|---------|-------|-------|
| **Ultracode** | `text-lg font-bold` weiß | Hauptmarke, immer sichtbar |
| **Separator (/)** | `text-gray-600` | Subtle Trennung |
| **Projekt Name** | `text-base font-semibold text-gray-300` | Sekundär, aber klar lesbar |
| **project.md Link** | `text-xs text-blue-400 hover:text-blue-300` | Interaktiv, auffällig |

### Hover-Effekte

```css
/* Ultracode Titel */
.cursor-pointer.hover\:text-blue-400:hover {
  color: #60a5fa; /* Blau bei Hover */
}

/* project.md Link */
.text-blue-400.hover\:text-blue-300:hover {
  color: #93c5fd; /* Helleres Blau bei Hover */
}
```

## User Flow

### Projekt öffnen
```
User klickt auf Projekt in Liste
  ↓
openProject(projectId) wird aufgerufen
  ↓
updateProjectTitle(projectId) sucht Projekt in state.projects
  ↓
Projekttitel wird angezeigt: "Ultracode / Projekt Name [📄 project.md]"
```

### Zurück zur Projektliste
```
User klickt auf "Ultracode" Logo oder Titel
  ↓
showProjects() wird aufgerufen
  ↓
hideProjectTitle() versteckt Projekttitel
  ↓
Header zeigt nur: "Ultracode"
```

### project.md öffnen
```
User klickt auf "[📄 project.md]" Button
  ↓
openProjectMd() wird aufgerufen
  ↓
Modal öffnet sich mit project.md Inhalt
  ↓
User kann bearbeiten und speichern
```

## Responsive Design

### Mobil (< 768px)
- Projekttitel wird gekürzt (`text-sm` statt `text-base`)
- project.md Link bleibt sichtbar (wichtig für schnellen Zugriff)
- Separator wird schmaler

### Desktop (> 1024px)
- Volle Größe
- Alle Elemente gut lesbar
- Genug Abstand zwischen Elementen

## Testing

### Manual Testing Checklist

- [x] Projekttitel wird angezeigt beim Projekt öffnen
- [x] Projekttitel wird ausgeblendet beim zurück zu Projektliste
- [x] project.md Link ist klickbar
- [x] project.md Modal öffnet sich mit korrektem Inhalt
- [x] Ultracode Logo/Titel führt zurück zur Projektliste
- [x] Hover-Effekte funktionieren
- [x] Separator (/) wird korrekt ein-/ausgeblendet

### Browser Tests

```javascript
// Console Tests
app.openProject('project-123');  // Titel sollte erscheinen
app.showProjects();              // Titel sollte verschwinden
app.openProjectMd();             // Modal sollte sich öffnen
```

## CSS Classes Referenz

### Tailwind Classes verwendet

```css
/* Projekttitel Container */
.hidden              /* Versteckt wenn kein Projekt aktiv */
.flex                /* Flexbox Layout */
.items-center        /* Vertikale Zentrierung */
.gap-2               /* 8px Abstand zwischen Elementen */

/* Projekttitel Text */
.font-semibold       /* Semi-bold Font */
.text-base           /* 16px Schriftgröße */
.text-gray-300       /* Helle graue Farbe */

/* project.md Link */
.text-xs             /* 12px Schriftgröße */
.text-blue-400       /* Blaue Farbe */
.hover\:text-blue-300 /* Helleres Blau bei Hover */
.transition-colors   /* Smooth Color Transition */

/* Icon */
.w-3\.5              /* 14px Breite */
.h-3\.5              /* 14px Höhe */
```

## Bekannte Einschränkungen

1. **Projekttitel zu lang**: Bei sehr langen Projektnamen kann es zu Überlappung kommen
   - **Fix**: CSS `truncate` oder `max-w-xs` hinzufügen

2. **project.md Link auf Mobil**: Auf sehr kleinen Bildschirmen könnte der Link zu klein sein
   - **Fix**: Responsive Breakpoints hinzufügen

## Zukünftige Verbesserungen

- [ ] Projekttitel mit Tooltip bei langem Text
- [ ] Breadcrumb Navigation (Projects > Project Name > Feature Name)
- [ ] Schnellzugriff auf andere Projekt-Dateien (package.json, README.md, etc.)
- [ ] Status Badge neben Projekttitel (🟢 Active, ⚪ Created, etc.)
- [ ] Git Branch Anzeige im Header

## Code-Referenzen

**Geänderte Dateien:**
- `public/index.html:65-80` - Header HTML Struktur
- `public/ui.js:510-553` - JavaScript Logic
  - `openProject()` - Zeile 510
  - `updateProjectTitle()` - Zeile 531
  - `hideProjectTitle()` - Zeile 549
  - `showProjects()` - Zeile 480 (erweitert)

**Bestehende Funktionen (nicht geändert):**
- `openProjectMd()` - Zeile 1239 (bereits vorhanden)

## Screenshots

### Desktop View
```
┌────────────────────────────────────────────────────────────┐
│ [U] Ultracode / My Portfolio  [📄 project.md]   [▶][⏸][⚙] │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Features          Subtasks           Terminal             │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### Project List View
```
┌────────────────────────────────────────────────────────────┐
│ [U] Ultracode                              [▶][⏸][⚙]       │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Projects                                                   │
│  [+ New Project]                                           │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

**Status:** ✅ Implementiert und getestet
**Datum:** 2025-12-20
**Version:** Ultracode V2 (UI Enhancement)
