const app = {
    state: {
        projects: [],
        activeProject: null,
        sse: null
    },

    init() {
        this.fetchProjects();
        this.connectSSE();
    },

    async fetchProjects() {
        // In a real app, we'd list directories in workspaces/. 
        // For now we assume localstorage or fetch from a JSON on server.
        // We'll mock it for the demo or use what we have in memory if persist.
        // Actually, let's fetch tasks which are kind of projects in this architecture.
        try {
            const res = await fetch('/api/tasks');
            const data = await res.json();
            const list = document.getElementById('project-list');
            
            if (data.tasks && data.tasks.length > 0) {
                list.innerHTML = data.tasks.map(t => `
                    <div onclick="app.openProject('${t.id}')" class="group cursor-pointer p-6 rounded-xl border border-gray-800 bg-gray-900 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-900/10">
                        <div class="flex justify-between items-start mb-2">
                            <h3 class="font-bold text-lg text-gray-200 group-hover:text-blue-400">${t.title}</h3>
                            <span class="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 border border-gray-700">${t.status || 'active'}</span>
                        </div>
                        <p class="text-sm text-gray-500 line-clamp-2">ID: ${t.id}</p>
                        <div class="mt-4 flex items-center gap-2 text-xs text-gray-600 font-mono">
                            <span class="w-2 h-2 rounded-full bg-green-500"></span> Last active recently
                        </div>
                    </div>
                `).join('');
            } else {
                list.innerHTML = `<div class="col-span-2 text-center py-12 text-gray-600">No projects found. Create one to start.</div>`;
            }
        } catch (e) {
            console.error(e);
        }
    },

    toggleSettings() {
        const modal = document.getElementById('modal-settings');
        modal.classList.toggle('hidden');
        if (!modal.classList.contains('hidden')) {
            modal.style.display = 'flex';
            this.loadKeys();
        } else {
            modal.style.display = 'none';
        }
    },

    async loadKeys() {
        const res = await fetch('/api/config/keys');
        const data = await res.json();
        if (data.keys) {
            if (data.keys.openai) document.getElementById('key-openai').value = data.keys.openai;
            if (data.keys.anthropic) document.getElementById('key-anthropic').value = data.keys.anthropic;
            if (data.keys.gemini) document.getElementById('key-gemini').value = data.keys.gemini;
        }
    },

    async saveSettings() {
        const keys = {
            openai: document.getElementById('key-openai').value,
            anthropic: document.getElementById('key-anthropic').value,
            gemini: document.getElementById('key-gemini').value,
        };
        await fetch('/api/config/keys', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ keys })
        });
        this.toggleSettings();
        alert('Keys saved!');
    },

    async loadAvailableModels() {
        const agentSelect = document.getElementById('proj-agent');
        const voterSelect = document.getElementById('proj-voter');
        
        // Save current selection if any
        const currentAgent = agentSelect.value;
        const currentVoter = voterSelect.value;

        // Clear and add loading state
        agentSelect.innerHTML = '<option>Loading models...</option>';
        voterSelect.innerHTML = '<option value="">Same as Agent</option>';

        const groups = {
            openai: { label: 'OpenAI', models: [] },
            anthropic: { label: 'Anthropic', models: [] },
            gemini: { label: 'Gemini', models: [] },
            lmstudio: { label: 'Local', models: [] }
        };

        // 1. Get Keys
        const kRes = await fetch('/api/config/keys');
        const kData = await kRes.json();
        const keys = kData.keys || {};

        // 2. Fetch lists in parallel
        const promises = [];
        
        // Helper to probe
        const probe = async (type, apiKey, baseUrl) => {
            try {
                const res = await fetch('/api/providers/probe-models', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ type, apiKey, baseUrl })
                });
                const data = await res.json();
                if (data.models) {
                    groups[type].models = data.models;
                }
            } catch(e) { console.error(`Failed to probe ${type}`, e); }
        };

        if (keys.openai) promises.push(probe('openai', keys.openai));
        if (keys.anthropic) promises.push(probe('anthropic', keys.anthropic));
        if (keys.gemini) promises.push(probe('gemini', keys.gemini));
        // Always probe LM Studio
        promises.push(probe('lmstudio', '', 'http://localhost:1234/v1'));

        await Promise.all(promises);

        // 3. Build Options
        let html = '';
        for (const [type, group] of Object.entries(groups)) {
            if (group.models.length > 0) {
                html += `<optgroup label="${group.label}">`;
                group.models.forEach(m => {
                    // m is a string (model id)
                    // Create ID like "openai:gpt-4o"
                    const id = m.includes(':') ? m : `${type}:${m}`;
                    html += `<option value="${id}">${m}</option>`;
                });
                html += `</optgroup>`;
            }
        }
        
        // Fallback if empty
        if (html === '') {
             html = `<option value="" disabled>No API keys set or models found.</option>`;
        }

        agentSelect.innerHTML = html;
        voterSelect.innerHTML = '<option value="">Same as Agent</option>' + html;
        
        // Restore selection if valid, else select first
        if (currentAgent) agentSelect.value = currentAgent;
        if (currentVoter) voterSelect.value = currentVoter;
    },

    showCreateProjectModal(show = true) {
        const modal = document.getElementById('modal-create-project');
        if (show) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
            this.loadAvailableModels();
        } else {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    },

    async createProject() {
        const name = document.getElementById('proj-name').value;
        const goal = document.getElementById('proj-goal').value;
        const agentModel = document.getElementById('proj-agent').value;
        const voteModel = document.getElementById('proj-voter').value;

        // Capture MAKER parameters
        const k = parseInt(document.getElementById('proj-k').value) || 2;
        const nSamples = parseInt(document.getElementById('proj-nsamples').value) || 3;
        const temperature = parseFloat(document.getElementById('proj-temperature').value) || 0.2;
        const maxChars = parseInt(document.getElementById('proj-maxchars').value) || 4000;

        if (!name || !goal) return alert('Please fill in name and goal');
        if (agentModel === 'Loading...' || !agentModel) return alert('Please wait for models to load or select a valid model');

        const btn = document.querySelector('#modal-create-project button.bg-green-600');
        const originalText = btn.innerText;
        btn.innerText = 'Creating...';
        btn.disabled = true;

        try {
            // 1. Create Workspace
            const pRes = await fetch('/api/projects/create', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, agentModel, voteModel })
            });
            const pData = await pRes.json();

            if (pData.ok) {
                // 2. Start Initial Task with MAKER parameters
                const tRes = await fetch('/api/tasks/create', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        title: `Initial Setup: ${name}`,
                        goal: goal,
                        model: agentModel,
                        voteModel: voteModel,
                        projectId: pData.project.id,
                        // MAKER parameters
                        k: k,
                        nSamples: nSamples,
                        temperature: temperature,
                        redFlags: [{ maxChars: maxChars }]
                    })
                });
                const tData = await tRes.json();

                // Close modal and reset button immediately - task runs in background
                this.showCreateProjectModal(false);
                btn.innerText = originalText;
                btn.disabled = false;

                this.fetchProjects(); // refresh list

                // Navigate to task view immediately - will show live updates via SSE
                if (tData.taskId) {
                    this.openProject(tData.taskId);
                }
            } else {
                alert('Error creating project: ' + pData.error);
                btn.innerText = originalText;
                btn.disabled = false;
            }
        } catch (e) {
            console.error(e);
            alert('Failed to create project');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    },

    showProjects() {
        document.getElementById('view-projects').classList.remove('hidden');
        document.getElementById('view-dashboard').classList.add('hidden');
        document.getElementById('view-dashboard').classList.remove('flex');
        this.state.activeProject = null;
    },

    async renderSidebar() {
        try {
            const res = await fetch('/api/tasks');
            const data = await res.json();
            const list = document.getElementById('nav-project-list');
            if (data.tasks) {
                list.innerHTML = data.tasks.map(t => {
                    const isActive = t.id === this.state.activeProject;
                    const classes = isActive 
                        ? 'bg-blue-900/30 text-blue-300 border-blue-800' 
                        : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border-transparent';
                    
                    return `
                    <div onclick="app.openProject('${t.id}')" class="cursor-pointer px-3 py-2 rounded border ${classes} text-xs truncate transition-colors flex items-center gap-2">
                        <span class="w-1.5 h-1.5 rounded-full ${t.status === 'completed' ? 'bg-gray-600' : 'bg-green-500'}"></span>
                        ${t.title}
                    </div>
                    `;
                }).join('');
            }
        } catch(e) { console.error("Sidebar load failed", e); }
    },

    async openProject(taskId) {
        this.state.activeProject = taskId;
        document.getElementById('view-projects').classList.add('hidden');
        const dash = document.getElementById('view-dashboard');
        dash.classList.remove('hidden');
        dash.classList.add('flex');
        
        document.getElementById('dash-title').innerText = `Task: ${taskId}`;
        document.getElementById('step-log').innerHTML = '<div class="text-gray-500 italic p-2">Loading history...</div>';
        
        this.logToTerminal(`Attached to task ${taskId}...`);
        this.renderSidebar();

        // Fetch history
        try {
            const res = await fetch(`/api/tasks/details?taskId=${taskId}`);
            const data = await res.json();
            const logContainer = document.getElementById('step-log');
            logContainer.innerHTML = ''; // Clear loading

            if (data.task) {
                // Set Status Badge
                this.updateStatusBadge(data.task.status);

                if (data.task.steps) {
                    // Replay steps
                    data.task.steps.forEach(step => {
                        // Simulate start event
                        this.addStepCard({
                            type: 'step-start',
                            taskId,
                            stepId: step.id,
                            intent: step.intent
                        });

                        // If completed or failed, simulate result event
                        if (step.status === 'completed' || step.status === 'failed') {
                            this.addStepCard({
                                type: 'step-result',
                                taskId,
                                stepId: step.id,
                                result: step.result || { error: step.status === 'failed' ? "Failed" : null }
                            });
                        }
                    });
                }
            }
        } catch(e) {
            console.error("Failed to load task history", e);
        }
    },

    updateStatusBadge(status) {
        const badge = document.getElementById('dash-status');
        if (status === 'completed') {
            badge.className = "px-2 py-0.5 rounded text-[10px] bg-blue-900 text-blue-300 border border-blue-700";
            badge.innerText = "Completed";
        } else if (status === 'failed') {
            badge.className = "px-2 py-0.5 rounded text-[10px] bg-red-900 text-red-300 border border-red-700";
            badge.innerText = "Failed";
        } else {
            badge.className = "px-2 py-0.5 rounded text-[10px] bg-green-900 text-green-300 border border-green-700 animate-pulse";
            badge.innerText = "Running";
        }
    },

    logToTerminal(text) {
        const term = document.getElementById('terminal-output');
        term.innerText += `\n[${new Date().toLocaleTimeString()}] ${text}`;
        term.scrollTop = term.scrollHeight;
    },

    switchTab(tab) {
        const term = document.getElementById('terminal-output');
        const files = document.getElementById('file-preview-area');
        const btnTerm = document.getElementById('btn-tab-term');
        const btnFiles = document.getElementById('btn-tab-files');

        if (tab === 'term') {
            term.classList.remove('hidden');
            files.classList.add('hidden');
            btnTerm.className = "text-blue-400 border-b-2 border-blue-400 h-full px-2 font-bold";
            btnFiles.className = "text-gray-500 hover:text-gray-300 h-full px-2";
        } else {
            term.classList.add('hidden');
            files.classList.remove('hidden');
            btnFiles.className = "text-blue-400 border-b-2 border-blue-400 h-full px-2 font-bold";
            btnTerm.className = "text-gray-500 hover:text-gray-300 h-full px-2";
            this.refreshFileTree();
        }
    },

    async refreshFileTree() {
        if (!this.state.activeProject) return;
        const treeContainer = document.getElementById('file-tree');
        treeContainer.innerHTML = '<div class="text-gray-500 italic">Loading files...</div>';
        
        try {
            const res = await fetch(`/api/workspace/tree?taskId=${this.state.activeProject}`);
            const data = await res.json();
            
            if (data.tree) {
                const html = data.tree.map(f => {
                    const icon = f.isDir ? '📁' : '📄';
                    const click = f.isDir ? '' : `onclick="app.viewFile('${f.path}')"`;
                    const cursor = f.isDir ? '' : 'cursor-pointer hover:text-blue-300';
                    return `<div class="py-1 ${cursor}" ${click}>${icon} ${f.name}</div>`;
                }).join('');
                treeContainer.innerHTML = html;
            }
        } catch(e) {
            treeContainer.innerHTML = '<div class="text-red-400">Failed to load files</div>';
        }
    },

    async viewFile(path) {
        const viewer = document.getElementById('code-viewer');
        viewer.innerText = "Loading...";
        try {
            // We use the diff preview endpoint as a generic file reader for now
            const res = await fetch('/api/tasks/preview-diff', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ path, content: "" }) // content empty means we just want 'before' usually, but let's use a simpler read endpoint if strictly needed. 
                // Actually server.js preview-diff returns 'before' which is the current file content.
            });
            const data = await res.json();
            viewer.innerText = data.before || "(Empty file)";
        } catch(e) {
            viewer.innerText = "Error reading file";
        }
    },

    addStepCard(data) {
        const log = document.getElementById('step-log');
        // Check if step exists
        let card = document.getElementById(`step-${data.stepId}`);
        if (!card) {
            card = document.createElement('div');
            card.id = `step-${data.stepId}`;
            card.className = "bg-gray-800 p-3 rounded border border-gray-700 text-xs flex flex-col gap-2";
            log.appendChild(card);
            // Auto scroll
            log.scrollTop = log.scrollHeight;
        }

        if (data.type === 'step-start') {
            card.innerHTML = `
                <div class="flex justify-between items-center text-blue-300 font-bold">
                    <span>Step: ${data.intent.substring(0, 40)}...</span>
                    <span class="animate-pulse">● Running</span>
                </div>
                <div class="text-gray-500 details pl-2 border-l-2 border-gray-700">Starting...</div>
            `;
        } else if (data.type === 'step-result') {
            const statusColor = data.result.error ? 'text-red-400' : 'text-green-400';
            const statusIcon = data.result.error ? '✕' : '✓';
            
            // Safe update header
            const header = card.querySelector('.animate-pulse')?.parentElement;
            if (header) {
                 header.innerHTML = `
                    <span>Step: ${header.innerText.replace('Step: ', '').replace('● Running', '').trim()}</span>
                    <span class="${statusColor}">${statusIcon} Done</span>
                `;
            } else {
                 // Fallback if header structure changed or not found
                 const title = data.intent ? data.intent.substring(0,40) : "Step";
                 const oldHtml = card.innerHTML;
                 // Prepend if totally missing or just replace
                 // Simplest: just don't crash.
            }
            
            let details = '';
            if (data.result.winner) {
                 details += `<div class="text-gray-400 mt-1">Winner selected (Lead by ${data.result.leadBy})</div>`;
            }
            if (data.result.applyResult) {
                 details += `<div class="text-gray-500 mt-1">Applied: ${JSON.stringify(data.result.applyResult)}</div>`;
            }
            if (data.result.error) {
                 details += `<div class="text-red-400 mt-1">Error: ${data.result.error}</div>`;
            }

            const detailsEl = card.querySelector('.details');
            if (detailsEl) detailsEl.innerHTML = details;
        }
    },

    connectSSE() {
        if (this.state.sse) return;
        this.state.sse = new EventSource('/api/events');
        
        this.state.sse.onmessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                
                // Only show events for active task if one is selected
                // (Or show all if we want to be omnipresent, but let's filter)
                if (this.state.activeProject && data.taskId !== this.state.activeProject) return;

                if (data.type === 'step-start' || data.type === 'step-result') {
                    this.addStepCard(data);
                }
                if (data.type === 'task-completed') {
                    this.updateStatusBadge(data.status);
                    this.renderSidebar(); // refresh list status indicators
                }
                if (data.type === 'log') {
                    // Detailed low level logs
                    // console.log("Log:", data.entry);
                }
                if (data.type === 'command-output') {
                    const term = document.getElementById('terminal-output');
                    term.innerText += data.data; // Stream output
                    term.scrollTop = term.scrollHeight;
                }
            } catch (e) {
                console.error("SSE Parse Error", e);
            }
        };
    },
    
    submitTask(e) {
        e.preventDefault();
        alert("Adding new steps to running tasks is not yet implemented in this UI demo.");
    }
};

window.onload = () => app.init();