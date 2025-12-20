# Automatisches init.sh System ✅

## Übersicht

Das Ultracode init.sh System automatisiert die Projekt-Initialisierung komplett in der UI. Es eliminiert manuelle Schritte wie `npm install`, `composer install`, etc.

## Wie es funktioniert

### 1. **Bei Projekterstellung** (`wizardAgent.js`)
Beim Abschluss des Wizards (Page 3 - Model Selection) wird automatisch ein `init.sh` Script generiert:

```javascript
// src/wizardAgent.js:711-719
const { createInitScript } = require('./initScriptGenerator');
const initScriptPath = createInitScript(folderPath);
```

Das Script wird basierend auf dem erkannten Projekt-Typ erstellt.

### 2. **Beim ersten Dev-Server Start** (`serverManager.js`)
Vor dem Server-Start wird geprüft, ob `init.sh` existiert und ausgeführt werden muss:

```javascript
// src/serverManager.js:27-28
// Check and run init.sh if it exists and hasn't been run yet
await this._runInitScriptIfNeeded(projectPath, projectId);
```

**Ablauf:**
1. Prüft ob `init.sh` existiert
2. Prüft ob `.init-done` Marker vorhanden (= bereits initialisiert)
3. Falls nicht: Führt `init.sh` aus (Timeout: 5 Minuten)
4. Bei Erfolg: Erstellt `.init-done` Marker mit Timestamp
5. Startet den Dev-Server

### 3. **Smart Detection** (`initScriptGenerator.js`)

Der Generator erkennt automatisch den Projekt-Typ:

| Datei vorhanden | Erkannter Typ | Installiert |
|-----------------|---------------|-------------|
| `package.json` + `next` dependency | `nextjs` | npm install |
| `package.json` + `react` dependency | `react` | npm install |
| `package.json` + `vue` dependency | `vue` | npm install |
| `package.json` (generic) | `node` | npm install |
| `composer.json` | `php` | composer install |
| `requirements.txt` | `python` | venv + pip install |
| `index.html` (nur) | `static` | ✓ Nichts (ready) |

## Generierte init.sh Beispiele

### Node.js / React Projekt
```bash
#!/bin/bash
set -e  # Exit on error

echo "🚀 Initializing project..."

# Node.js project initialization
if [ -f "package.json" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo "✅ Dependencies installed"
fi

echo "🎉 Initialization complete!"
```

### PHP Projekt
```bash
#!/bin/bash
set -e

echo "🚀 Initializing project..."

# PHP project initialization
if [ -f "composer.json" ]; then
  echo "📦 Installing PHP dependencies..."
  if ! command -v composer &> /dev/null; then
    echo "⚠️  Composer not found, skipping dependency installation"
  else
    composer install --no-interaction
    echo "✅ PHP dependencies installed"
  fi
fi

echo "🎉 Initialization complete!"
```

### Python Projekt
```bash
#!/bin/bash
set -e

echo "🚀 Initializing project..."

# Python project initialization
if [ -f "requirements.txt" ]; then
  echo "📦 Setting up Python virtual environment..."
  if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✅ Virtual environment created"
  fi
  echo "📦 Installing Python packages..."
  source venv/bin/activate
  pip install -r requirements.txt
  echo "✅ Python packages installed"
fi

echo "🎉 Initialization complete!"
```

### Statisches HTML Projekt
```bash
#!/bin/bash
set -e

echo "🚀 Initializing project..."

# Static website - no initialization needed
echo "✅ Static site ready"

echo "🎉 Initialization complete!"
```

## Package Manager Erkennung

Das System erkennt automatisch den verwendeten Package Manager:

| Lock-File vorhanden | Verwendet |
|---------------------|-----------|
| `pnpm-lock.yaml` | `pnpm install` |
| `yarn.lock` | `yarn install` |
| (keines) | `npm install` |

**Fallback-Logik:**
```bash
if ! command -v pnpm &> /dev/null; then
  echo "⚠️  pnpm not found, using npm instead"
  npm install
else
  pnpm install
fi
```

## Verwendung

### Automatisch (empfohlen)
1. Erstelle Projekt über Wizard
2. Klicke Play Button (▶) → init.sh wird automatisch ausgeführt
3. Dev-Server startet
4. **Beim nächsten Start**: init.sh wird übersprungen (`.init-done` existiert)

### Manuell (für Testing)
```bash
# init.sh ausführen
cd projects/my-project
bash init.sh

# .init-done löschen um neu zu initialisieren
rm .init-done
```

## Debugging

### init.sh wird nicht ausgeführt
```bash
# Prüfe ob init.sh existiert
ls -la projects/my-project/init.sh

# Prüfe ob bereits initialisiert
ls -la projects/my-project/.init-done

# Lösche .init-done um neu zu initialisieren
rm projects/my-project/.init-done
```

### Initialisierung schlägt fehl
```bash
# Server-Logs checken
tail -f /tmp/ultracode-server.log | grep -i init

# Manuell testen
cd projects/my-project
bash -x init.sh  # Mit Debug-Output
```

### Projekt-Typ falsch erkannt
```javascript
// Test Detection
const { detectProjectType } = require('./src/initScriptGenerator');
console.log(detectProjectType('./projects/my-project'));
```

### init.sh manuell neu generieren
```javascript
const { createInitScript } = require('./src/initScriptGenerator');
createInitScript('./projects/my-project');
```

## Integration in Workflow

### User Journey
```
1. User erstellt Projekt
   → Wizard Page 1: Name + Beschreibung
   → Wizard Page 2: Features definieren
   → Wizard Page 3: Models wählen
   ↓
2. Wizard finalisiert
   → project.md wird erstellt
   → init.sh wird automatisch generiert ✓
   → Features werden in DB erstellt
   ↓
3. User klickt Play Button
   → init.sh wird ausgeführt (nur beim ersten Mal) ✓
   → Dependencies werden installiert
   → .init-done Marker wird erstellt
   → Dev-Server startet
   ↓
4. Browser öffnet sich automatisch
   → User sieht seine Website
   → Features können getestet werden
```

## Vorteile

✅ **Keine manuelle Initialisierung** - Alles passiert in der UI
✅ **Nur einmalige Ausführung** - `.init-done` Marker verhindert Wiederholung
✅ **Multi-Projekt-Support** - Node, PHP, Python, Static
✅ **Package Manager Agnostic** - npm, yarn, pnpm
✅ **Error Handling** - Fortsetzung auch bei Fehlern
✅ **Transparent** - Alle Outputs werden geloggt

## Fehlerbehandlung

### init.sh fehlschlägt
```javascript
// src/serverManager.js:184-187
catch (err) {
  console.error(`[ServerManager] Initialization failed for ${projectId}:`, err.message);
  throw new Error(`Project initialization failed: ${err.message}`);
}
```

**Ergebnis:** Server startet NICHT (verhindert Folge-Fehler)

### Timeout (>5 Minuten)
```javascript
// src/serverManager.js:175
timeout: 300000 // 5 minute timeout
```

**Ergebnis:** Prozess wird abgebrochen, Fehler wird geworfen

### Script existiert nicht
```javascript
// src/serverManager.js:154-156
if (!fs.existsSync(initScriptPath)) {
  return; // No init script, nothing to do
}
```

**Ergebnis:** Normal weitermachen (kein Fehler)

## Customization

### Eigenes init.sh anlegen
Users können manuell ein `init.sh` im Projekt-Root erstellen:

```bash
#!/bin/bash
set -e

echo "Custom initialization..."

# Eigene Commands
npm install
npm run build
echo "DATABASE_URL=..." > .env

echo "Done!"
```

**Wichtig:** `chmod +x init.sh` wird automatisch ausgeführt

### init.sh erweitern
Das generierte Script kann bearbeitet werden:

```bash
# Auto-generated von Ultracode
npm install

# Manuell hinzugefügt:
npm run build
cp .env.example .env
```

## Test-Ergebnisse

```
[2025-12-20 10:52:49]
✅ init.sh Generation: PASSED
✅ Projekt-Typ Erkennung: PASSED (react)
✅ Package Manager Erkennung: PASSED (npm)
✅ init.sh Ausführung: PASSED
   Output: "🚀 Initializing Node.js project..."
           "✅ No dependencies to install"
           "🎉 Initialization complete!"
✅ .init-done Marker: PASSED (erstellt)
✅ Zweiter Start: PASSED (init.sh übersprungen)
```

## Technische Details

### Dateien
- **`src/initScriptGenerator.js`** - Generator für init.sh Scripts
- **`src/serverManager.js`** - Ausführungs-Logik
- **`src/wizardAgent.js`** - Integration in Wizard

### API
```javascript
// Generator
const { createInitScript, detectProjectType, detectPackageManager, generateInitScript }
  = require('./src/initScriptGenerator');

// Verwendung
createInitScript('/path/to/project');  // Erstellt init.sh

// Manual
const type = detectProjectType('/path');
const pm = detectPackageManager('/path');
const script = generateInitScript({ projectType: type, packageManager: pm });
```

### Marker-Datei (.init-done)
```
# Inhalt: ISO Timestamp
2025-12-20T09:52:49.123Z
```

**Zweck:** Verhindert mehrfache Ausführung von init.sh

## Bekannte Limitierungen

1. **Timeout:** Max. 5 Minuten für Initialisierung
2. **Keine Parallelisierung:** Nur ein init.sh zur Zeit pro Projekt
3. **Keine Fortschrittsanzeige:** Output wird gebuffert (erst am Ende sichtbar)
4. **Manuelle .init-done Löschung:** Um neu zu initialisieren

## Zukünftige Verbesserungen

- [ ] Real-time Output-Streaming in UI
- [ ] Progress Bar für lange Installationen
- [ ] Retry-Logik bei Netzwerk-Fehlern
- [ ] Init-Status in Projekt-UI anzeigen
- [ ] Multi-Step Init (pre-install, install, post-install)
- [ ] Environment Variables Setup (.env Template)

---

**Status:** ✅ Produktionsbereit
**Getestet:** 2025-12-20
**Version:** Ultracode V2 (Init-System komplett)
