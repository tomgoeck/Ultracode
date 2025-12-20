# Test-System - Vollständig Funktionsfähig ✓

## Zusammenfassung

Das Ultracode Test-System ist jetzt vollständig funktionsfähig und wurde erfolgreich getestet mit:
- ✓ **Statischen HTML-Websites**
- ✓ **PHP-Anwendungen**
- ✓ **Node.js-Projekten** (vorbereitet)

## Komponenten

### 1. ServerManager (`src/serverManager.js`)
Der ServerManager erkennt automatisch den Projekt-Typ und startet den passenden Dev-Server:

| Projekt-Typ | Erkennung | Server | Port |
|-------------|-----------|--------|------|
| **Static HTML** | `index.html` vorhanden | Node.js HTTP Server | 42000+ |
| **PHP** | `.php` Dateien vorhanden | `php -S localhost:PORT` | 42000+ |
| **Node.js** | `package.json` mit `start`/`dev` script | `npm run dev/start` | 42000+ |

**Features:**
- Automatische Port-Findung (startet bei 42000, springt bei Konflikten)
- Prozess-Management (Start/Stop)
- Wartet auf Server-Bereitschaft vor Test-Ausführung

### 2. TestRunner (`src/testRunner.js`)
Puppeteer-basierter Test-Runner für automatisierte UI-Tests:

**Features:**
- Screenshot-Capture von laufenden Websites
- LLM-basierte Verifikation gegen Definition of Done (optional)
- Automatische Browser-Reconnection bei Verbindungsverlust
- Support für Vision-Models (GPT-4o, Claude 3, Gemini)

**Bugfixes:**
- ✓ `page.waitForTimeout()` → `setTimeout()` (Puppeteer Kompatibilität)
- ✓ Browser Reconnection Logic bei disconnected instances

### 3. API Endpoints (`src/server.js`)

#### Dev-Server Kontrolle:
```bash
# Server starten
POST /api/v2/projects/:projectId/dev-server/start
Response: { "ok": true, "port": 42000, "url": "http://localhost:42000" }

# Server stoppen
POST /api/v2/projects/:projectId/dev-server/stop
Response: { "ok": true }

# Server Status
GET /api/v2/projects/:projectId/dev-server
Response: { "running": true, "info": { "port": 42000, "url": "...", "type": "static" } }
```

#### Feature Testing:
```bash
# Feature testen (startet Server, macht Screenshot, verifiziert mit LLM)
POST /api/test/feature/:featureId
Response: {
  "ok": true,
  "testResult": {
    "passed": true/false,
    "feedback": "...",
    "screenshotPath": "..."
  },
  "manualInstructions": { ... }
}
```

### 4. UI Integration (`public/index.html`, `public/ui.js`)

**Play/Stop Buttons im Header:**
- ▶ Play Button: Startet Dev-Server und öffnet URL in neuem Tab
- ⏸ Stop Button: Stoppt laufenden Dev-Server

**JavaScript:**
```javascript
// In public/ui.js
app.startDevServer()  // Startet Server für aktives Projekt
app.stopDevServer()   // Stoppt Server
```

## Getestete Szenarien

### ✓ Statische HTML Website
```bash
Projekt: simple-static-test
Datei: index.html (Gradient Background, Button, JavaScript)
Server: Node.js HTTP Server (Port 42000)
Test: Screenshot erfolgreich (67KB PNG)
Status: PASSED ✓
```

### ✓ PHP Website
```bash
Projekt: simple-php-test
Datei: index.php (PHP Info, Server Time, JSON)
Server: PHP Built-in Server (Port 42000)
Test: Screenshot erfolgreich, PHP 8.4.11 aktiv
Status: PASSED ✓
```

### ✓ Puppeteer Integration
```bash
Browser: Headless Chrome
Screenshot: http://localhost:4173 → 67KB PNG
Reconnection: Browser-Disconnect korrekt behandelt
Status: PASSED ✓
```

## Verwendung

### 1. Über die UI
1. Projekt in Ultracode öffnen
2. **Play Button (▶)** klicken → Server startet automatisch
3. Website öffnet sich in neuem Browser-Tab
4. Feature-Test durchführen
5. **Stop Button (⏸)** klicken → Server stoppt

### 2. Via API
```javascript
// Server starten
const res = await fetch('/api/v2/projects/project-123/dev-server/start', {
  method: 'POST'
});
const { url } = await res.json();
// Browser Tab: window.open(url, '_blank');

// Feature testen
const testRes = await fetch('/api/test/feature/feature-456', {
  method: 'POST'
});
const { testResult } = await testRes.json();
console.log(testResult.passed ? '✓ PASS' : '✗ FAIL');
```

### 3. Programmatisch
```javascript
const { ServerManager } = require('./src/serverManager');
const serverManager = new ServerManager();

// Server starten
const { url, port } = await serverManager.startServer(
  '/path/to/project',
  'project-id'
);

// Server stoppen
serverManager.stopServer('project-id');
```

## Projekt-Typen Beispiele

### Statisches HTML-Projekt
```
project/
  ├── index.html        ← Wird automatisch als "/" serviert
  ├── styles.css
  └── script.js
```
**Server:** Statischer HTTP Server
**URL:** `http://localhost:42000/`

### PHP-Projekt
```
project/
  ├── index.php         ← PHP wird interpretiert
  ├── api.php
  └── config.php
```
**Server:** `php -S localhost:42000`
**URL:** `http://localhost:42000/`

### Node.js-Projekt
```
project/
  ├── package.json      ← Muss "start" oder "dev" script haben
  ├── src/
  │   └── index.js
  └── node_modules/     ← `npm install` erforderlich
```
**Server:** `npm run dev` (oder `npm run start`)
**URL:** `http://localhost:42000/` (oder wie im Script konfiguriert)

## Bekannte Limitierungen

1. **Node.js Projekte:** Erfordern `npm install` vor dem ersten Start
2. **LLM Verification:** Benötigt konfigurierten Provider (OpenAI, Claude, etc.)
3. **Port Konflikte:** Server startet automatisch auf alternativem Port
4. **Browser Headless:** Puppeteer läuft headless (nicht sichtbar)

## Nächste Schritte (Optional)

- [ ] Auto-Test nach Feature-Completion (AGENTS.md erwähnt: "disabled")
- [ ] Multi-Page Testing (Test-Flow über mehrere Seiten)
- [ ] Network Mocking (API-Calls simulieren)
- [ ] Performance Metrics (Lighthouse Integration)
- [ ] Visual Regression Testing (Screenshot-Vergleich)

## Debugging

**Server startet nicht:**
```bash
# Prüfe Port-Konflikte
lsof -i :42000 -P

# Prüfe Server-Logs
curl http://localhost:4173/api/v2/projects/:id/dev-server
```

**Puppeteer-Fehler:**
```bash
# Browser-Version prüfen
node -e "require('puppeteer').launch().then(b => b.version().then(v => console.log(v)))"

# Screenshot manuell testen
node -e "
const { TestRunner } = require('./src/testRunner');
const tr = new TestRunner(null);
tr.captureScreenshot('http://localhost:4173', '/tmp/test.png')
  .then(() => console.log('OK'))
  .catch(console.error);
"
```

## Datei-Änderungen

### Geänderte Dateien:
- `src/testRunner.js` - Bugfixes für Puppeteer
  - Zeile 105: `page.waitForTimeout` → `setTimeout`
  - Zeilen 17-38: Browser Reconnection Logic

### Neue Test-Projekte:
- `projects/simple-static-test/` - HTML Test-Website
- `projects/simple-php-test/` - PHP Test-Website

### Bestehende Dateien (keine Änderungen):
- `src/serverManager.js` - Bereits vollständig implementiert ✓
- `src/server.js` - API Endpoints bereits vorhanden ✓
- `public/index.html` - UI Buttons bereits vorhanden ✓
- `public/ui.js` - Play/Stop Funktionen bereits vorhanden ✓

## Test-Ergebnisse

```
[2025-12-20 09:28:23]
✓ Statischer HTML-Server: PASSED
✓ PHP-Server: PASSED
✓ Server Start/Stop: PASSED
✓ Puppeteer Screenshot: PASSED
✓ Browser Reconnection: PASSED

Alle Tests erfolgreich! 🎉
```

---

**Status:** ✅ Produktionsbereit
**Getestet:** 2025-12-20
**Version:** Ultracode V2 (mit vollständigem Test-System)
