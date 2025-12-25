const app = {
    state: {
        projects: [],
        activeProject: null,
        activeFeature: null,
        runningFeatureId: null,
        stoppingFeatureId: null,
        devServer: null,
        editingFeatureId: null,
        showTokenMonitor: false,
        sse: null,
        wizard: {
            currentPage: 1,
            chatHistory: [],
            projectName: '',
            projectDescription: '',
            summary: null,
            sessionId: null
        },
        modelModal: {
            loaded: false
        }
    },

    setDefaultModel(select, value) {
        if (!select || !value) return false;
        const option = Array.from(select.options).find(opt => opt.value === value);
        if (!option) return false;
        select.value = value;
        return true;
    },

    initSortableFeatures() {
        const list = document.getElementById('feature-list');
        if (!list) return;
        // Only enable dragging for B/C; A stays fixed
        new SimpleSorter(list, {
            onUpdate: (order) => {
                // Filter to B/C and preserve A order at top
                const reordered = [];
                const features = this.state.features || {};
                // Add existing A features first in current order
                Object.values(features)
                    .filter(f => f.priority === 'A')
                    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
                    .forEach((f, idx) => reordered.push({ id: f.id, orderIndex: idx + 1 }));

                // Now append dragged B/C in new order
                order.forEach((item, idx) => {
                    const f = features[item.id];
                    if (!f || f.priority === 'A') return; // skip A
                    reordered.push({ id: item.id, orderIndex: reordered.length + 1 });
                });

                this.saveFeatureOrdering(reordered);
            }
        });
    },

    async saveFeatureOrdering(ordering) {
        if (!this.state.activeProject || !ordering.length) return;
        try {
            const res = await fetch('/api/v2/features/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: this.state.activeProject, ordering })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Failed to reorder features');
            }
            this.logToTerminal('✓ Feature order updated');
            this.loadFeatures(this.state.activeProject);
        } catch (e) {
            console.error('Failed to reorder features', e);
            this.logToTerminal(`✗ Failed to reorder features: ${e.message}`);
        }
    },

    init() {
        this.fetchProjects();
        this.connectSSE();
        this.initResizers();
    },

    async fetchProjects() {
        try {
            // Fetch V2 projects from featureStore
            const res = await fetch('/api/v2/projects');
            const data = await res.json();
            const list = document.getElementById('project-list');

            if (data.projects && data.projects.length > 0) {
                this.state.projects = data.projects;
                list.innerHTML = data.projects.map(p => {
                    const statusColors = {
                        'created': 'bg-gray-700 text-gray-300',
                        'bootstrapping': 'bg-yellow-700 text-yellow-300',
                        'active': 'bg-green-700 text-green-300',
                        'completed': 'bg-blue-700 text-blue-300'
                    };
                    const statusColor = statusColors[p.status] || statusColors['created'];

                    return `
                        <div class="group relative p-6 rounded-xl border border-gray-800 bg-gray-900 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-900/10">
                            <div onclick="app.openProject('${p.id}')" class="cursor-pointer">
                                <div class="flex justify-between items-start mb-2">
                                    <h3 class="font-bold text-lg text-gray-200 group-hover:text-blue-400">${this.escapeHtml(p.name)}</h3>
                                    <span class="text-xs px-2 py-1 rounded ${statusColor}">${p.status}</span>
                                </div>
                                <p class="text-sm text-gray-500 line-clamp-2">${this.escapeHtml(p.description || 'No description')}</p>
                                <div class="mt-4 flex items-center gap-4 text-xs text-gray-600 font-mono">
                                    <span class="flex items-center gap-1">
                                        <span class="w-2 h-2 rounded-full ${p.status === 'active' ? 'bg-green-500' : 'bg-gray-600'}"></span>
                                        ${p.status}
                                    </span>
                                    <span>${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
                                </div>
                            </div>
                            <button
                                onclick="event.stopPropagation(); app.confirmDeleteProject('${p.id}', '${this.escapeHtml(p.name).replace(/'/g, "\\'")}');"
                                class="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-900/20 rounded text-red-400 hover:text-red-300"
                                title="Delete project">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    `;
                }).join('');
            } else {
                list.innerHTML = `<div class="col-span-2 text-center py-12 text-gray-600">No projects found. Create one with the wizard!</div>`;
            }
        } catch (e) {
            console.error('Failed to fetch projects:', e);
            const list = document.getElementById('project-list');
            list.innerHTML = `<div class="col-span-2 text-center py-12 text-red-400">Error loading projects</div>`;
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

    // ==================== MODEL SETTINGS ====================

    async showModelModal() {
        if (!this.state.activeProject) {
            alert('Select a project first');
            return;
        }
        await this.loadModelOptions();
        await this.prefillModelSelection();
        const modal = document.getElementById('modal-models');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    },

    hideModelModal() {
        const modal = document.getElementById('modal-models');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    },

    async loadModelOptions() {
        const plannerSelect = document.getElementById('model-planner');
        const executorSelect = document.getElementById('model-executor');
        const voteSelect = document.getElementById('model-vote');

        [plannerSelect, executorSelect, voteSelect].forEach(sel => {
            sel.innerHTML = '<option>Loading models...</option>';
        });

        const groups = {
            openai: { label: 'OpenAI', models: [] },
            anthropic: { label: 'Anthropic', models: [] },
            gemini: { label: 'Gemini', models: [] },
            lmstudio: { label: 'Local', models: [] }
        };

        // Get Keys
        const kRes = await fetch('/api/config/keys');
        const kData = await kRes.json();
        const keys = kData.keys || {};

        // Probe models helper
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

        const promises = [];
        if (keys.openai) promises.push(probe('openai', keys.openai));
        if (keys.anthropic) promises.push(probe('anthropic', keys.anthropic));
        if (keys.gemini) promises.push(probe('gemini', keys.gemini));
        promises.push(probe('lmstudio', '', 'http://localhost:1234/v1'));

        await Promise.all(promises);

        const buildOptions = () => {
            let html = '';
            for (const [type, group] of Object.entries(groups)) {
                if (group.models.length > 0) {
                    html += `<optgroup label="${group.label}">`;
                    group.models.forEach(m => {
                        const id = m.includes(':') ? m : `${type}:${m}`;
                        html += `<option value="${id}">${m}</option>`;
                    });
                    html += `</optgroup>`;
                }
            }
            if (html === '') {
                html = `<option value="" disabled>No API keys set. Please configure in Settings.</option>`;
            }
            return html;
        };

        const optionsHtml = buildOptions();
        plannerSelect.innerHTML = optionsHtml;
        executorSelect.innerHTML = optionsHtml;
        voteSelect.innerHTML = '<option value="">Same as Executor</option>' + optionsHtml;
    },

    async prefillModelSelection() {
        if (!this.state.activeProject) return;
        try {
            const res = await fetch(`/api/v2/projects/${this.state.activeProject}`);
            const data = await res.json();
            const proj = data.project;
            if (!proj) return;
            const plannerSelect = document.getElementById('model-planner');
            const executorSelect = document.getElementById('model-executor');
            const voterSelect = document.getElementById('model-vote');
            plannerSelect.value = proj.planner_model || '';
            executorSelect.value = proj.executor_model || '';
            voterSelect.value = proj.vote_model || '';

            if (!plannerSelect.value) {
                this.setDefaultModel(plannerSelect, 'openai:gpt-5.2');
            }
            if (!executorSelect.value) {
                this.setDefaultModel(executorSelect, 'openai:gpt-4o-mini');
            }
            if (!voterSelect.value) {
                this.setDefaultModel(voterSelect, 'openai:gpt-4o-mini');
            }
        } catch (e) {
            console.error('Failed to prefill models', e);
        }
    },

    async saveModelSettings() {
        if (!this.state.activeProject) {
            alert('No project selected');
            return;
        }
        const plannerModel = document.getElementById('model-planner').value;
        const executorModel = document.getElementById('model-executor').value;
        const voteModel = document.getElementById('model-vote').value;

        if (!plannerModel || !executorModel) {
            alert('Planner and Executor models are required');
            return;
        }

        try {
            const res = await fetch(`/api/v2/projects/${this.state.activeProject}/models`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plannerModel, executorModel, voteModel })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                this.logToTerminal('✓ Updated project models');
                this.hideModelModal();
                // refresh features to reflect any running state changes
                if (this.state.activeProject) {
                    this.loadFeatures(this.state.activeProject);
                }
            } else {
                throw new Error(data.error || 'Failed to save models');
            }
        } catch (e) {
            console.error('Failed to save models', e);
            alert(`Failed to save models: ${e.message}`);
        }
    },

    async loadKeys() {
        const res = await fetch('/api/config/keys');
        const data = await res.json();
        if (data.keys) {
            if (data.keys.openai) document.getElementById('key-openai').value = data.keys.openai;
            if (data.keys.anthropic) document.getElementById('key-anthropic').value = data.keys.anthropic;
            if (data.keys.gemini) document.getElementById('key-gemini').value = data.keys.gemini;
            if (data.keys.tavily) document.getElementById('key-tavily').value = data.keys.tavily;
        }
    },

    async saveSettings() {
        const keys = {
            openai: document.getElementById('key-openai').value,
            anthropic: document.getElementById('key-anthropic').value,
            gemini: document.getElementById('key-gemini').value,
            tavily: document.getElementById('key-tavily').value,
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
        const planningSelect = document.getElementById('proj-planning');
        
        // Save current selection if any
        const currentAgent = agentSelect.value;
        const currentVoter = voterSelect.value;
        const currentPlanning = planningSelect.value;

        // Clear and add loading state
        agentSelect.innerHTML = '<option>Loading models...</option>';
        voterSelect.innerHTML = '<option value="">Same as Agent</option>';
        planningSelect.innerHTML = '<option value="">Same as Agent</option>';

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
        planningSelect.innerHTML = '<option value="">Same as Agent</option>' + html;
        
        // Restore selection if valid, else set defaults
        if (currentAgent && this.setDefaultModel(agentSelect, currentAgent)) {
            // keep current
        } else {
            this.setDefaultModel(agentSelect, 'openai:gpt-4o-mini');
        }
        if (currentVoter && this.setDefaultModel(voterSelect, currentVoter)) {
            // keep current
        } else {
            this.setDefaultModel(voterSelect, 'openai:gpt-4o-mini');
        }
        if (currentPlanning && this.setDefaultModel(planningSelect, currentPlanning)) {
            // keep current
        } else {
            this.setDefaultModel(planningSelect, 'openai:gpt-5.2');
        }
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
        const planningModel = document.getElementById('proj-planning').value;

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
                body: JSON.stringify({ name, agentModel, voteModel, planningModel })
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
                        planningModel: planningModel,
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
        this.hideProjectTitle();
    },

    async renderSidebar() {
        try {
            const res = await fetch('/api/v2/projects');
            const data = await res.json();
            const list = document.getElementById('nav-project-list');
            if (data.projects) {
                list.innerHTML = data.projects.map(p => {
                    const isActive = p.id === this.state.activeProject;
                    const classes = isActive 
                        ? 'bg-blue-900/30 text-blue-300 border-blue-800' 
                        : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border-transparent';
                    
                    return `
                    <div onclick="app.openProject('${p.id}')" class="cursor-pointer px-3 py-2 rounded border ${classes} text-xs truncate transition-colors flex items-center gap-2">
                        <span class="w-1.5 h-1.5 rounded-full ${p.status === 'active' ? 'bg-green-500' : 'bg-gray-600'}"></span>
                        ${p.name}
                    </div>
                    `;
                }).join('');
            }
        } catch(e) { console.error("Sidebar load failed", e); }
    },

    async openProject(projectId) {
        this.state.activeProject = projectId;
        this.state.activeFeature = null;
        this.state.devServer = null;

        // Switch to dashboard view
        document.getElementById('view-projects').classList.add('hidden');
        const dash = document.getElementById('view-dashboard');
        dash.classList.remove('hidden');
        dash.classList.add('flex');

        // Update project title in header
        this.updateProjectTitle(projectId);

        this.logToTerminal(`Opening project: ${projectId}`);

        // Load features for this project
        await this.loadFeatures(projectId);
        await this.fetchDevServerInfo();
    },

    updateProjectTitle(projectId) {
        // Find project in state
        const project = this.state.projects?.find(p => p.id === projectId);

        if (project) {
            // Show project title elements
            document.getElementById('project-title-separator').classList.remove('hidden');
            document.getElementById('project-title-container').classList.remove('hidden');
            document.getElementById('project-title-container').classList.add('flex');

            // Set project name
            document.getElementById('project-title').textContent = project.name;
        } else {
            // Hide project title if not found
            this.hideProjectTitle();
        }
    },

    hideProjectTitle() {
        document.getElementById('project-title-separator').classList.add('hidden');
        document.getElementById('project-title-container').classList.add('hidden');
        document.getElementById('project-title-container').classList.remove('flex');
    },

    confirmDeleteProject(projectId, projectName) {
        this.state.deleteProjectId = projectId;
        this.state.deleteProjectName = projectName;

        const modal = document.getElementById('modal-delete-project');
        document.getElementById('delete-project-name').textContent = projectName;
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    },

    cancelDeleteProject() {
        this.state.deleteProjectId = null;
        this.state.deleteProjectName = null;

        const modal = document.getElementById('modal-delete-project');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    },

    async deleteProject() {
        const projectId = this.state.deleteProjectId;
        if (!projectId) return;

        try {
            const res = await fetch(`/api/v2/projects/${projectId}`, {
                method: 'DELETE'
            });

            const data = await res.json();

            if (res.ok && data.ok) {
                this.logToTerminal(`✓ Deleted project: ${this.state.deleteProjectName}`);

                // Close modal
                this.cancelDeleteProject();

                // Refresh project list
                await this.fetchProjects();

                // If we were viewing this project, go back to projects view
                if (this.state.activeProject === projectId) {
                    this.backToProjects();
                }
            } else {
                throw new Error(data.error || 'Failed to delete project');
            }
        } catch (err) {
            console.error('Failed to delete project:', err);
            alert(`Failed to delete project: ${err.message}`);
        }
    },

    async loadFeatures(projectId) {
        try {
            const res = await fetch(`/api/v2/features?projectId=${projectId}`);
            const data = await res.json();

            const featureList = document.getElementById('feature-list');

            if (data.features && data.features.length > 0) {
                // Store features in state for dependency lookups
                this.state.features = data.features.reduce((acc, f) => {
                    acc[f.id] = f;
                    return acc;
                }, {});

                // Track running feature (first running found)
                const running = data.features.find(f => f.status === 'running');
                this.state.runningFeatureId = running ? running.id : null;
                if (!this.state.runningFeatureId) {
                    this.state.stoppingFeatureId = null;
                }
                this.updateExecuteButton();

                featureList.innerHTML = data.features.map(f => this.renderFeatureItem(f)).join('');
                this.initSortableFeatures();
            } else {
                featureList.innerHTML = `
                    <div class="text-center py-8 text-gray-500 text-xs">
                        No features yet.<br>
                        Click "+ Add" to create one.
                    </div>
                `;
            }

            // Load resource metrics for project
            await this.loadResourceMetrics(projectId);
        } catch (err) {
            console.error('Failed to load features:', err);
            document.getElementById('feature-list').innerHTML = `
                <div class="text-center py-8 text-red-400 text-xs">
                    Error loading features
                </div>
            `;
        }
    },

    async loadResourceMetrics(projectId) {
        try {
            const res = await fetch(`/api/metrics/project?projectId=${projectId}`);
            const data = await res.json();

            const monitor = document.getElementById('resource-monitor');
            const details = document.getElementById('resource-details');
            const total = document.getElementById('resource-total');

            monitor.classList.toggle('hidden', !this.state.showTokenMonitor);

            const entries = (Array.isArray(data.roles) && data.roles.length > 0)
                ? data.roles
                : (data.models || []);

            if (entries.length > 0) {
                details.innerHTML = entries.map(m => {
                    const label = m.role
                        ? `${m.role} (${m.model || 'unknown'})`
                        : m.name;
                    return `<div class="text-gray-400">${label}: <span class="text-gray-300">${m.tokensFormatted}</span> <span class="text-gray-500">(${m.costFormatted})</span></div>`;
                }).join('');
                total.innerHTML = `Total: <span class="text-white">${data.totalCostFormatted}</span>`;
            } else {
                details.innerHTML = `<div class="text-gray-500">No token data yet</div>`;
                total.innerHTML = ``;
            }
        } catch (err) {
            console.error('Failed to load resource metrics:', err);
            // Silently fail - metrics are non-critical
        }
    },

    toggleTokenMonitor() {
        this.state.showTokenMonitor = !this.state.showTokenMonitor;
        const monitor = document.getElementById('resource-monitor');
        if (!monitor) return;
        monitor.classList.toggle('hidden', !this.state.showTokenMonitor);
        if (this.state.showTokenMonitor && this.state.activeProject) {
            this.loadResourceMetrics(this.state.activeProject);
        }
    },

    renderFeatureItem(feature) {
        const statusColors = {
            'pending': 'bg-gray-700 text-gray-300',
            'running': 'bg-yellow-700 text-yellow-300 animate-pulse',
            'paused': 'bg-orange-700 text-orange-300',
            'completed': 'bg-green-700 text-green-300',
            'verified': 'bg-blue-700 text-blue-300',
            'failed': 'bg-red-700 text-red-300',
            'human_testing': 'bg-purple-700 text-purple-300'
        };

        const priorityColors = {
            'A': 'border-red-500',
            'B': 'border-yellow-500',
            'C': 'border-blue-500'
        };

        const statusIcons = {
            'pending': '○',
            'running': '●',
            'paused': '⏸',
            'completed': '✓',
            'verified': '✓',
            'failed': '✕',
            'human_testing': '👤'
        };

        const statusColor = statusColors[feature.status] || statusColors['pending'];
        const priorityColor = priorityColors[feature.priority] || '';
        const icon = statusIcons[feature.status] || '○';

        const isActive = this.state.activeFeature === feature.id;
        const activeClass = isActive ? 'bg-blue-900/30 border-blue-600' : 'border-gray-700 hover:border-gray-600';

        const retryButton = feature.status === 'failed' ? `
            <button
                onclick="event.stopPropagation(); app.retryFeature('${feature.id}');"
                class="mt-2 w-full px-2 py-1 bg-orange-600 hover:bg-orange-500 rounded text-white text-xs font-medium transition-colors"
                title="Retry this feature">
                🔄 Retry
            </button>
        ` : '';

        const editButtons = `
            <div class="flex items-center gap-2 mt-2">
                <button
                    onclick="event.stopPropagation(); app.showEditFeatureModal('${feature.id}');"
                    class="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-200"
                    title="Edit feature">
                    ✏️ Edit
                </button>
                <button
                    onclick="event.stopPropagation(); app.deleteFeature('${feature.id}');"
                    class="text-[10px] px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-white"
                    title="Delete feature">
                    🗑 Delete
                </button>
            </div>
        `;

        return `
            <div onclick="app.selectFeature('${feature.id}')"
                class="feature-item p-3 rounded-lg border ${activeClass} ${priorityColor} cursor-pointer transition-all"
                data-feature-id="${feature.id}"
                data-sort-id="${feature.id}">
                <div class="flex items-start justify-between mb-1">
                    <div class="flex items-center gap-2">
                        <span class="text-[11px] font-mono font-bold text-gray-400">${feature.priority}</span>
                        <span class="text-xs">${icon}</span>
                        <span class="text-[11px] font-mono text-gray-500">${feature.id || ''}</span>
                    </div>
                    <span class="text-[10px] px-1.5 py-0.5 rounded ${statusColor}">${feature.status}</span>
                </div>
                <h4 class="font-medium text-sm text-gray-200 mb-1">${this.escapeHtml(feature.name)}</h4>
                <p class="text-xs text-gray-500 line-clamp-2">${this.escapeHtml(feature.description || '')}</p>
                ${this.renderDependencyInfo(feature)}
                ${editButtons}
                ${retryButton}
            </div>
        `;
    },

    renderDependencyInfo(feature) {
        if (!feature.depends_on || feature.depends_on.length === 0) {
            return '';
        }

        const allFeatures = this.state.features || {};
        const deps = feature.depends_on.map(depId => {
            // Try to find feature by exact ID first, then by short ID
            let depFeature = allFeatures[depId];
            if (!depFeature) {
                // If not found, try to find by short ID (e.g., "F001" -> "project-xxx-F001")
                depFeature = Object.values(allFeatures).find(f => f.id && f.id.endsWith(`-${depId}`));
            }
            if (!depFeature) {
                return `<span class="text-red-400">${depId} (not found)</span>`;
            }

            const isCompleted = depFeature.status === 'completed' || depFeature.status === 'verified';
            const icon = isCompleted ? '✓' : '○';
            const color = isCompleted ? 'text-green-400' : 'text-yellow-400';

            return `<span class="${color}">${icon} ${this.escapeHtml(depFeature.name)}</span>`;
        }).join(', ');

        // Check if feature is blocked (pending with incomplete dependencies)
        const isBlocked = feature.status === 'pending' && feature.depends_on.some(depId => {
            let dep = allFeatures[depId];
            if (!dep) {
                dep = Object.values(allFeatures).find(f => f.id && f.id.endsWith(`-${depId}`));
            }
            return !dep || (dep.status !== 'completed' && dep.status !== 'verified');
        });

        const icon = isBlocked ? '🔒' : '🔗';
        const textColor = isBlocked ? 'text-orange-400' : 'text-gray-600';

        return `
            <div class="mt-2 text-[10px] ${textColor}">
                ${icon} Depends on: ${deps}
            </div>
        `;
    },

    async selectFeature(featureId) {
        this.state.activeFeature = featureId;

        // Reload feature list to update active state
        await this.loadFeatures(this.state.activeProject);

        // Load feature details
        try {
            const res = await fetch(`/api/v2/features/${featureId}`);
            const data = await res.json();

            if (data.feature) {
                const feature = data.feature;

                // Update header
                document.getElementById('dash-feature-name').innerText = feature.name;
                document.getElementById('dash-feature-desc').innerText = feature.description || 'No description';

                const statusBadge = document.getElementById('dash-feature-status');
                const statusColors = {
                    'pending': 'bg-gray-700 text-gray-300',
                    'running': 'bg-yellow-700 text-yellow-300',
                    'completed': 'bg-green-700 text-green-300',
                    'failed': 'bg-red-700 text-red-300',
                    'human_testing': 'bg-purple-700 text-purple-300'
                };
                statusBadge.className = `px-2 py-0.5 rounded text-[10px] ${statusColors[feature.status] || 'bg-gray-700 text-gray-300'}`;
                statusBadge.innerText = feature.status;

                // Show/hide "Mark as Completed" button based on status
                const markCompletedBtn = document.getElementById('btn-mark-completed');
                if (feature.status === 'human_testing') {
                    markCompletedBtn.classList.remove('hidden');
                } else {
                    markCompletedBtn.classList.add('hidden');
                }

                // Load subtasks
                await this.loadSubtasks(featureId);
            }
        } catch (err) {
            console.error('Failed to load feature details:', err);
        }
    },

    async markFeatureCompleted() {
        if (!this.state.activeFeature) {
            alert('No feature selected');
            return;
        }

        try {
            const res = await fetch(`/api/v2/features/${this.state.activeFeature}/mark-completed`, {
                method: 'POST'
            });

            const data = await res.json();

            if (data.ok) {
                this.logToTerminal('✓ Feature marked as completed');

                // Reload feature list and details
                await this.loadFeatures(this.state.activeProject);
                await this.selectFeature(this.state.activeFeature);
            } else {
                alert(`Failed to mark as completed: ${data.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Failed to mark feature as completed:', err);
            alert(`Error: ${err.message}`);
        }
    },

    async loadSubtasks(featureId) {
        try {
            const res = await fetch(`/api/v2/subtasks?featureId=${featureId}`);
            const data = await res.json();

            const subtaskList = document.getElementById('subtask-list');

            if (data.subtasks && data.subtasks.length > 0) {
                subtaskList.innerHTML = data.subtasks.map((st, idx) => {
                    const statusIcons = {
                        'pending': '☐',
                        'running': '⏳',
                        'completed': '☑',
                        'failed': '☒'
                    };

                    const statusColors = {
                        'pending': 'text-gray-500',
                        'running': 'text-yellow-400',
                        'completed': 'text-green-400',
                        'failed': 'text-red-400'
                    };

                    const icon = statusIcons[st.status] || '☐';
                    const color = statusColors[st.status] || 'text-gray-500';

                    const retryButton = st.status === 'failed' ? `
                        <button
                            onclick="app.retrySubtask('${st.id}')"
                            class="ml-2 px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                            title="Retry this subtask">
                            Retry
                        </button>
                    ` : '';

                    const errorDisplay = st.status === 'failed' && st.error ? `
                        <div class="text-[10px] text-red-400 mt-1 break-all">❌ ${this.escapeHtml(st.error)}</div>
                    ` : '';

                    return `
                        <div class="p-2 rounded bg-gray-800 border border-gray-700">
                            <div class="flex items-start gap-2">
                                <span class="${color} text-sm">${icon}</span>
                                <div class="flex-1">
                                    <div class="flex items-center justify-between">
                                        <div class="text-xs ${color === 'text-gray-500' ? 'text-gray-300' : color}">${this.escapeHtml(st.intent)}</div>
                                        ${retryButton}
                                    </div>
                                    ${st.apply_path ? `<div class="text-[10px] text-gray-600 mt-1">${st.apply_type}: ${st.apply_path}</div>` : ''}
                                    ${st.status === 'completed' && st.completed_at ? `
                                        <div class="text-[10px] text-gray-600 mt-1">✓ ${new Date(st.completed_at).toLocaleTimeString()}</div>
                                    ` : ''}
                                    ${errorDisplay}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                subtaskList.innerHTML = `
                    <div class="text-center py-8 text-gray-500 text-xs italic">
                        No subtasks yet.<br>
                        Execute this feature to generate subtasks.
                    </div>
                `;
            }
        } catch (err) {
            console.error('Failed to load subtasks:', err);
            document.getElementById('subtask-list').innerHTML = `
                <div class="text-center py-8 text-red-400 text-xs">
                    Error loading subtasks
                </div>
            `;
        }
    },

    async retrySubtask(subtaskId) {
        if (!confirm('Retry this subtask?')) return;

        try {
            this.logToTerminal(`⟳ Retrying subtask...`);

            const res = await fetch(`/api/v2/subtasks/${subtaskId}/retry`, {
                method: 'POST',
            });

            const data = await res.json();

            if (data.ok) {
                this.logToTerminal(`✓ Subtask retry completed successfully`);
                // Reload subtasks to show updated status
                if (this.state.selectedFeatureId) {
                    await this.selectFeature(this.state.selectedFeatureId);
                }
            } else {
                this.logToTerminal(`❌ Retry failed: ${data.error}`);
                alert(`Retry failed: ${data.error}`);
            }
        } catch (err) {
            console.error('Retry error:', err);
            this.logToTerminal(`❌ Retry error: ${err.message}`);
            alert(`Retry error: ${err.message}`);
        }
    },

    // ==================== FEATURE EXECUTION ====================

    async executeNext() {
        // If a feature is running, treat this as STOP (pause after current subtask)
        if (this.state.runningFeatureId) {
            return this.stopExecution();
        }

        if (!this.state.activeProject) {
            alert('No project selected');
            return;
        }

        const btn = document.getElementById('btn-execute');
        btn.disabled = true;
        btn.innerText = 'Starting...';

        try {
            const res = await fetch(`/api/v2/projects/${this.state.activeProject}/execute-next`, {
                method: 'POST'
            });

            const data = await res.json();

            if (data.started || data.ok) {
                this.state.runningFeatureId = data.featureId || null;
                this.updateExecuteButton();
                this.logToTerminal(`✓ Started execution of feature: ${data.featureName || 'unknown'}`);
                await this.loadFeatures(this.state.activeProject);
            } else if (data.message) {
                // Resolve dependency IDs to names
                const allFeatures = this.state.features || {};
                const blockedInfo = data.blocked && data.blocked.length
                    ? `\n\n📋 Blocked features:\n${data.blocked.map(b => {
                        const depNames = (b.dependsOn || []).map(depId => {
                            let dep = allFeatures[depId];
                            if (!dep) {
                                dep = Object.values(allFeatures).find(f => f.id && f.id.endsWith(`-${depId}`));
                            }
                            return dep ? dep.name : depId;
                        });
                        return `  • ${b.name} (waiting for: ${depNames.join(', ') || 'unknown'})`;
                    }).join('\n')}`
                    : '';
                const msg = `${data.message}${blockedInfo}`;
                this.logToTerminal(`⚠️ ${data.message}`);
                if (blockedInfo) {
                    this.logToTerminal(blockedInfo);
                }

                // Show better formatted alert
                const alertMsg = data.blocked && data.blocked.length
                    ? `No runnable features.\n\n${data.blocked.length} feature(s) are blocked by dependencies.\nComplete the required features first.`
                    : data.message;
                alert(alertMsg);
            }
        } catch (err) {
            console.error('Failed to execute next feature:', err);
            alert('Failed to start execution');
        } finally {
            btn.disabled = false;
            this.updateExecuteButton();
        }
    },

    async stopExecution() {
        const featureId = this.state.runningFeatureId || this.state.activeFeature;
        if (!featureId) {
            alert('No running feature to stop');
            return;
        }

        try {
            const res = await fetch(`/api/v2/features/${featureId}/pause`, {
                method: 'POST'
            });
            const data = await res.json();
            if (data.ok) {
                this.state.stoppingFeatureId = featureId;
                this.updateExecuteButton();
            }
            this.logToTerminal(data.message || 'Pause requested (will stop after current subtask)');
        } catch (err) {
            console.error('Failed to request pause:', err);
            alert('Failed to stop execution');
            this.state.stoppingFeatureId = null;
            this.updateExecuteButton();
        }
    },

    async retryFeature(featureId) {
        if (!confirm('Retry this failed feature? This will clear all subtasks and restart from scratch.')) {
            return;
        }

        try {
            const res = await fetch(`/api/v2/features/${featureId}/retry`, {
                method: 'POST'
            });

            const data = await res.json();

            if (res.ok && data.ok) {
                this.logToTerminal(`🔄 ${data.message}`);

                // Refresh feature list
                await this.loadFeatures(this.state.activeProject);

                // If this was the active feature, reload subtasks
                if (this.state.activeFeature === featureId) {
                    await this.loadSubtasks(featureId);
                }
            } else {
                throw new Error(data.error || 'Failed to retry feature');
            }
        } catch (err) {
            console.error('Failed to retry feature:', err);
            alert(`Failed to retry feature: ${err.message}`);
        }
    },

    // ==================== FEATURE MANAGEMENT ====================

    showAddFeatureModal() {
        if (!this.state.activeProject) {
            alert('No project selected');
            return;
        }

        const modal = document.getElementById('modal-add-feature');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Reset form
        document.getElementById('add-feature-name').value = '';
        document.getElementById('add-feature-desc').value = '';
        document.getElementById('add-feature-priority').value = 'B';
        document.getElementById('add-feature-dod').value = '';

        // Load dependency options
        this.loadDependencyOptions();
    },

    hideAddFeatureModal() {
        const modal = document.getElementById('modal-add-feature');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    },

    async loadDependencyOptions() {
        if (!this.state.activeProject) return;

        try {
            const res = await fetch(`/api/v2/features?projectId=${this.state.activeProject}`);
            const data = await res.json();

            const select = document.getElementById('add-feature-depends');
            select.innerHTML = '<option value="">None</option>';

            if (data.features) {
                data.features.forEach(f => {
                    if (f.status === 'completed' || f.status === 'verified') {
                        select.innerHTML += `<option value="${f.id}">${f.priority}: ${f.name}</option>`;
                    }
                });
            }
        } catch (err) {
            console.error('Failed to load dependency options:', err);
        }
    },

    async addFeature() {
        const name = document.getElementById('add-feature-name').value.trim();
        const description = document.getElementById('add-feature-desc').value.trim();
        const priority = document.getElementById('add-feature-priority').value;
        const dependsOn = document.getElementById('add-feature-depends').value;
        const dod = document.getElementById('add-feature-dod').value.trim();

        if (!name) {
            alert('Please enter a feature name');
            return;
        }

        try {
            const res = await fetch('/api/v2/features', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: this.state.activeProject,
                    name,
                    description,
                    priority,
                    dependsOn: dependsOn ? [dependsOn] : [],
                    dod
                })
            });

            const data = await res.json();

            if (data.feature) {
                this.hideAddFeatureModal();
                await this.loadFeatures(this.state.activeProject);
                this.logToTerminal(`✓ Feature added: ${name}`);
            } else {
                alert('Failed to add feature: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Failed to add feature:', err);
            alert('Failed to add feature');
        }
    },

    async showEditFeatureModal(featureId) {
        this.state.editingFeatureId = featureId;
        try {
            const res = await fetch(`/api/v2/features/${featureId}`);
            const data = await res.json();
            if (!data.feature) throw new Error('Feature not found');
            document.getElementById('edit-feature-name').value = data.feature.name || '';
            document.getElementById('edit-feature-desc').value = data.feature.description || '';
            const modal = document.getElementById('modal-edit-feature');
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
        } catch (e) {
            console.error('Failed to load feature', e);
            alert('Failed to load feature');
        }
    },

    hideEditFeatureModal() {
        this.state.editingFeatureId = null;
        const modal = document.getElementById('modal-edit-feature');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    },

    async saveFeatureEdits() {
        const featureId = this.state.editingFeatureId;
        if (!featureId) return;
        const name = document.getElementById('edit-feature-name').value.trim();
        const description = document.getElementById('edit-feature-desc').value.trim();
        if (!name) {
            alert('Name required');
            return;
        }
        try {
            const res = await fetch(`/api/v2/features/${featureId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            const data = await res.json();
            if (res.ok && data.ok !== false) {
                this.hideEditFeatureModal();
                await this.loadFeatures(this.state.activeProject);
                this.logToTerminal('✓ Feature updated');
            } else {
                throw new Error(data.error || 'Failed to update feature');
            }
        } catch (e) {
            console.error('Failed to update feature', e);
            alert(`Failed to update feature: ${e.message}`);
        }
    },

    async deleteFeature(featureId) {
        if (!confirm('Delete this feature? This cannot be undone.')) return;
        try {
            const res = await fetch(`/api/v2/features/${featureId}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok && data.ok !== false) {
                await this.loadFeatures(this.state.activeProject);
                if (this.state.activeFeature === featureId) {
                    this.state.activeFeature = null;
                    document.getElementById('subtask-list').innerHTML = `
                        <div class="text-gray-500 italic text-center py-8">Select a feature to view subtasks</div>
                    `;
                }
                this.logToTerminal('🗑 Feature deleted');
            } else {
                throw new Error(data.error || 'Failed to delete feature');
            }
        } catch (e) {
            console.error('Delete failed', e);
            alert(`Failed to delete feature: ${e.message}`);
        }
    },

    async sendFeatureChat(e) {
        e.preventDefault();

        if (!this.state.activeFeature) {
            alert('Please select a feature first');
            return;
        }

        const input = document.getElementById('feature-chat-input');
        const message = input.value.trim();

        if (!message) return;

        input.value = '';
        this.logToTerminal(`[Chat] ${message}`);

        try {
            const res = await fetch(`/api/v2/features/${this.state.activeFeature}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            const data = await res.json();

            if (data.ok && data.response) {
                this.logToTerminal(`[AI] ${data.response}`);
            } else if (data.error) {
                this.logToTerminal(`[Error] ${data.error}`);
            }
        } catch (err) {
            console.error('Feature chat error:', err);
            this.logToTerminal('[Error] Chat failed');
        }
    },

    // ==================== PROJECT.MD ====================

    async openProjectMd() {
        if (!this.state.activeProject) {
            alert('No project selected');
            return;
        }

        const modal = document.getElementById('modal-project-md');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        const editor = document.getElementById('project-md-editor');
        editor.value = 'Loading...';

        try {
            const res = await fetch(`/api/v2/project-md?projectId=${this.state.activeProject}`);
            const data = await res.json();

            if (data.content !== undefined) {
                editor.value = data.content || '# Project Guidelines\n\nAdd your project guidelines here...';
            } else {
                editor.value = '# Error\n\nFailed to load project.md';
            }
        } catch (err) {
            console.error('Failed to load project.md:', err);
            editor.value = '# Error\n\nFailed to load project.md';
        }
    },

    hideProjectMdModal() {
        const modal = document.getElementById('modal-project-md');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    },

    async saveProjectMd() {
        if (!this.state.activeProject) return;

        const content = document.getElementById('project-md-editor').value;

        try {
            const res = await fetch(`/api/v2/project-md`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: this.state.activeProject, content })
            });

            const data = await res.json();

            if (data.ok) {
                this.hideProjectMdModal();
                this.logToTerminal('✓ project.md saved');
            } else {
                alert('Failed to save project.md');
            }
        } catch (err) {
            console.error('Failed to save project.md:', err);
            alert('Failed to save project.md');
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

    initResizers() {
        const dash = document.getElementById('view-dashboard');
        const colFeatures = document.getElementById('col-features');
        const colSubtasks = document.getElementById('col-subtasks');
        const colTerminal = document.getElementById('col-terminal');
        const dragFeatures = document.getElementById('drag-features');
        const dragSubtasks = document.getElementById('drag-subtasks');

        if (!dash || !colFeatures || !colSubtasks || !colTerminal || !dragFeatures || !dragSubtasks) return;

        let startX = 0;
        let startWidth = 0;
        let target = null;

        const onMouseMove = (e) => {
            if (!target) return;
            const dx = e.clientX - startX;
            const newWidth = Math.max((startWidth + dx), target.minWidth || 200);
            target.col.style.width = `${newWidth}px`;
        };

        const onMouseUp = () => {
            target = null;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        const startDrag = (col) => (e) => {
            e.preventDefault();
            target = col;
            startX = e.clientX;
            startWidth = col.col.getBoundingClientRect().width;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        colFeatures.minWidth = 200;
        colSubtasks.minWidth = 240;

        dragFeatures.addEventListener('mousedown', startDrag({ col: colFeatures, minWidth: 200 }));
        dragSubtasks.addEventListener('mousedown', startDrag({ col: colSubtasks, minWidth: 240 }));
    },

    async fetchDevServerInfo() {
        if (!this.state.activeProject) return;
        try {
            const res = await fetch(`/api/v2/projects/${this.state.activeProject}/dev-server`);
            const data = await res.json();
            if (data.running && data.info) {
                this.state.devServer = data.info;
                this.logToTerminal(`🟢 Dev server running at ${data.info.url}`);
            } else {
                this.state.devServer = null;
            }
        } catch (e) {
            console.error('Failed to fetch dev server info', e);
        }
    },

    async startDevServer() {
        if (!this.state.activeProject) {
            alert('Select a project first');
            return;
        }
        try {
            const res = await fetch(`/api/v2/projects/${this.state.activeProject}/dev-server/start`, { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.ok) {
                this.state.devServer = { port: data.port, url: data.url, type: data.type };
                this.logToTerminal(`🟢 Dev server started at ${data.url}`);
                try {
                    window.open(data.url, '_blank');
                } catch (e) {
                    console.warn('Failed to open browser tab automatically', e);
                }
            } else {
                throw new Error(data.error || 'Failed to start dev server');
            }
        } catch (e) {
            console.error('Failed to start dev server', e);
            alert(`Failed to start dev server: ${e.message}`);
        }
    },

    async stopDevServer() {
        if (!this.state.activeProject) return;
        try {
            const res = await fetch(`/api/v2/projects/${this.state.activeProject}/dev-server/stop`, { method: 'POST' });
            if (res.ok) {
                this.state.devServer = null;
                this.logToTerminal('🛑 Dev server stopped');
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Failed to stop dev server');
            }
        } catch (e) {
            console.error('Failed to stop dev server', e);
            alert(`Failed to stop dev server: ${e.message}`);
        }
    },

    updateExecuteButton() {
        const btn = document.getElementById('btn-execute');
        if (!btn) return;

        if (this.state.runningFeatureId) {
            if (this.state.stoppingFeatureId) {
                btn.innerText = 'Stopping...';
            } else {
                btn.innerText = 'Stop after subtask';
            }
            btn.classList.remove('bg-green-600', 'hover:bg-green-500');
            btn.classList.add('bg-red-700', 'hover:bg-red-600');
            btn.disabled = false;
        } else {
            btn.innerText = 'Execute Next';
            btn.classList.remove('bg-red-700', 'hover:bg-red-600');
            btn.classList.add('bg-green-600', 'hover:bg-green-500');
            this.state.stoppingFeatureId = null;
            btn.disabled = false;
        }
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

            if (data.tree && data.tree.length > 0) {
                const fileCount = data.tree.filter(f => !f.isDir).length;
                const html = data.tree.map(f => {
                    const icon = f.isDir ? '📁' : '📄';
                    const click = f.isDir ? '' : `onclick="app.viewFile('${f.path.replace(/'/g, "\\'")}')"`;
                    const cursor = f.isDir ? 'text-gray-500' : 'cursor-pointer hover:text-blue-300';
                    const indent = f.path.split('/').length > 1 ? 'pl-' + (f.path.split('/').length - 1) * 2 : '';
                    return `<div class="py-1 ${cursor} ${indent}" ${click}>${icon} ${f.name}</div>`;
                }).join('');
                treeContainer.innerHTML = `<div class="text-gray-500 text-[10px] mb-2 border-b border-gray-700 pb-1">${fileCount} files</div>` + html;
            } else {
                treeContainer.innerHTML = '<div class="text-gray-500 italic">No files generated yet</div>';
            }
        } catch(e) {
            console.error('Failed to load file tree:', e);
            treeContainer.innerHTML = '<div class="text-red-400">Failed to load files</div>';
        }
    },

    async viewFile(path) {
        const viewer = document.getElementById('code-viewer');
        viewer.innerHTML = '<div class="text-gray-500 italic p-4">Loading...</div>';

        try {
            // Fetch file content with taskId
            const res = await fetch('/api/tasks/preview-diff', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    path,
                    content: "",
                    taskId: this.state.activeProject
                })
            });
            const data = await res.json();

            if (data.before !== undefined) {
                const content = data.before || "(Empty file)";

                // Detect language from file extension
                const ext = path.split('.').pop().toLowerCase();
                const langMap = {
                    'js': 'javascript',
                    'jsx': 'javascript',
                    'ts': 'typescript',
                    'tsx': 'typescript',
                    'html': 'xml',
                    'css': 'css',
                    'json': 'json',
                    'py': 'python',
                    'rb': 'ruby',
                    'java': 'java',
                    'cpp': 'cpp',
                    'c': 'c',
                    'md': 'markdown',
                    'sh': 'bash',
                    'yml': 'yaml',
                    'yaml': 'yaml',
                    'xml': 'xml',
                    'sql': 'sql',
                    'go': 'go',
                    'rs': 'rust',
                    'php': 'php',
                    'swift': 'swift',
                    'kt': 'kotlin',
                };
                const language = langMap[ext] || 'plaintext';

                // Create code element with language class
                viewer.innerHTML = `<code class="language-${language}"></code>`;
                const codeEl = viewer.querySelector('code');
                codeEl.textContent = content;

                // Apply syntax highlighting
                if (window.hljs) {
                    hljs.highlightElement(codeEl);
                }
            } else {
                viewer.innerHTML = '<div class="text-red-400 p-4">Error: Could not read file</div>';
            }
        } catch(e) {
            console.error('Error reading file:', e);
            viewer.innerHTML = '<div class="text-red-400 p-4">Error reading file</div>';
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

                // Feature events
                if (data.type === 'feature-started') {
                    if (data.projectId === this.state.activeProject) {
                        const modelInfo = data.model ? ` (model=${data.model})` : '';
                        this.logToTerminal(`▶ Feature started: ${data.feature?.name || data.featureId}${modelInfo}`);
                        this.state.runningFeatureId = data.featureId || null;
                        this.state.stoppingFeatureId = null;
                        this.updateExecuteButton();
                        this.loadFeatures(this.state.activeProject);
                    }
                }
                if (data.type === 'feature-planning') {
                    if (data.projectId === this.state.activeProject) {
                        const modelInfo = data.plannerModel ? ` (planner=${data.plannerModel})` : '';
                        this.logToTerminal(`📋 Planning feature...${modelInfo}`);
                    }
                }
                if (data.type === 'planner-progress') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`🧭 Planner: ${data.message || ''}`);
                    }
                }
                if (data.type === 'feature-planned') {
                    if (data.projectId === this.state.activeProject) {
                        const modelInfo = data.plannerModel ? ` (planner=${data.plannerModel})` : '';
                        this.logToTerminal(`✓ Feature planned: ${data.subtaskCount} subtasks${modelInfo}`);
                        if (data.featureId === this.state.activeFeature) {
                            this.loadSubtasks(data.featureId);
                        }
                    }
                }
                if (data.type === 'subtask-started') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`  → Subtask: ${data.subtask?.intent || 'unknown'}`);
                        if (data.featureId === this.state.activeFeature) {
                            this.loadSubtasks(data.featureId);
                        }
                    }
                }
                if (data.type === 'subtask-completed') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`  ✓ Subtask completed`);
                        if (data.featureId === this.state.activeFeature) {
                            this.loadSubtasks(data.featureId);
                        }
                    }
                }
                if (data.type === 'subtask-failed') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`  ✗ Subtask failed: ${data.error || 'unknown'}`);
                        if (data.featureId === this.state.activeFeature) {
                            this.loadSubtasks(data.featureId);
                        }
                    }
                }
                if (data.type === 'feature-completed') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`✓ Feature completed`);
                        this.state.runningFeatureId = null;
                        this.state.stoppingFeatureId = null;
                        this.updateExecuteButton();
                        this.loadFeatures(this.state.activeProject);
                        if (data.featureId === this.state.activeFeature) {
                            this.loadSubtasks(data.featureId);
                        }
                    }
                }
                if (data.type === 'feature-awaiting-test') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`👤 Feature ready for human testing (Priority ${data.priority})`);
                        this.state.runningFeatureId = null;
                        this.state.stoppingFeatureId = null;
                        this.updateExecuteButton();
                        this.loadFeatures(this.state.activeProject);
                        if (data.featureId === this.state.activeFeature) {
                            this.selectFeature(data.featureId); // Refresh to show "Mark as Completed" button
                        }
                    }
                }
                if (data.type === 'feature-manually-completed') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`✓ Feature manually marked as completed`);
                        this.loadFeatures(this.state.activeProject);
                        if (data.featureId === this.state.activeFeature) {
                            this.selectFeature(data.featureId); // Refresh to hide button
                        }
                    }
                }
                if (data.type === 'feature-paused') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`⏸ Feature paused`);
                        this.state.runningFeatureId = null;
                        this.state.stoppingFeatureId = null;
                        this.updateExecuteButton();
                        this.loadFeatures(this.state.activeProject);
                    }
                }
                if (data.type === 'feature-failed') {
                    if (data.projectId === this.state.activeProject) {
                        this.logToTerminal(`✗ Feature failed`);
                        this.state.runningFeatureId = null;
                        this.state.stoppingFeatureId = null;
                        this.updateExecuteButton();
                        this.loadFeatures(this.state.activeProject);
                    }
                }

                if (data.type === 'feature-pause-requested') {
                    if (data.featureId === this.state.runningFeatureId) {
                        this.state.stoppingFeatureId = data.featureId;
                        this.updateExecuteButton();
                        this.logToTerminal('Pause requested (will stop after current subtask)');
                    }
                }

                // Voting transparency
                if (data.type === 'vote-summary') {
                    // Only log if belongs to current project
                    if (!this.state.activeProject || data.projectId === this.state.activeProject) {
                        const top = (data.top || []).join(' | ');
                        const model = data.voteModel || 'unknown-model';
                        const temps = data.temps && data.temps.length ? `temps=[${data.temps.join(',')}]` : '';
                        const preview = data.winnerPreview ? `preview="${data.winnerPreview.replace(/\s+/g, ' ').slice(0, 80)}..."` : '';
                        this.logToTerminal(`🗳️ Vote: model=${model}, samples=${data.samples}, unique=${data.unique}, k=${data.k}, winnerVotes=${data.winnerVotes}, marginMet=${data.marginMet ? 'yes' : 'no'}${temps ? `, ${temps}` : ''}${top ? `, top=${top}` : ''}${preview ? `, ${preview}` : ''}`);
                    }
                }

                // Legacy task events (for backwards compatibility)
                if (this.state.activeProject && data.taskId !== this.state.activeProject) return;

                if (data.type === 'step-start' || data.type === 'step-result') {
                    this.addStepCard(data);
                }
                if (data.type === 'step-start') {
                    this.logToTerminal(`[step ${data.stepId}] started: ${data.intent || '...'}`);
                }
                if (data.type === 'step-completed') {
                    let detail = '';
                    if (data.marginMet) {
                        const leadText = data.leadBy !== undefined ? ` lead: ${data.leadBy}` : '';
                        detail = `voting decided.${leadText}`;
                    } else if (data.leadBy !== undefined) {
                        detail = `winner chosen (no voting margin reached, lead: ${data.leadBy})`;
                    } else {
                        detail = 'completed.';
                    }
                    const applyInfo = data.applyResult?.path ? ` file=${data.applyResult.path}` : '';
                    const modelInfo = data.voteModel ? ` model=${data.voteModel}` : '';
                    this.logToTerminal(`[step ${data.stepId}] ${detail}${applyInfo}${modelInfo}`);
                }
                if (data.type === 'step-error') {
                    this.logToTerminal(`[step ${data.stepId}] ERROR: ${data.error || 'unknown error'}`);
                }
                if (data.type === 'task-completed') {
                    this.updateStatusBadge(data.status);
                    this.renderSidebar(); // refresh list status indicators
                    this.logToTerminal(`[task ${data.taskId}] completed (${data.status})`);
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
    },

    // ==================== WIZARD FUNCTIONS ====================

    startWizard() {
        // Reset wizard state
        this.state.wizard = {
            currentPage: 1,
            chatHistory: [],
            projectName: '',
            projectDescription: '',
            projectId: null,
            projectFolderName: null,
            projectFolderPath: null,
            summary: null,
            sessionId: 'wizard-' + Date.now(),
            selectedTemplateId: null
        };

        // Show modal
        const modal = document.getElementById('modal-wizard');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Reset form fields
        document.getElementById('wizard-name').value = '';
        document.getElementById('wizard-description').value = '';
        document.getElementById('wizard-chat').innerHTML = '';
        document.getElementById('wizard-chat-input').value = '';
        document.getElementById('wizard-summary-content').innerHTML = '<p>No summary generated yet. Use the chat to discuss your project and refresh the summary.</p>';
        document.getElementById('btn-wizard-create')?.setAttribute('disabled', 'disabled');
        document.getElementById('btn-wizard-next-3')?.setAttribute('disabled', 'disabled');
        const btnSummary = document.getElementById('btn-wizard-summary');
        if (btnSummary) {
            btnSummary.classList.remove('bg-gray-800', 'text-gray-200', 'bg-green-700');
            btnSummary.classList.add('bg-blue-600', 'text-white');
            btnSummary.innerText = 'Generate Summary';
        }
        this.toggleWizardArtifacts(false);

        // Show page 1
        this.wizardShowPage(1);

        // Load models (templates removed)
        this.wizardLoadModels();
    },


    cancelWizard() {
        const modal = document.getElementById('modal-wizard');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    },

    wizardShowPage(pageNum) {
        if (pageNum === 3 && !this.state.wizard.summary) {
            alert('Please generate the summary (project.md) before continuing.');
            return;
        }
        this.state.wizard.currentPage = pageNum;

        // Hide all pages
        for (let i = 1; i <= 3; i++) {
            const pageEl = document.getElementById(`wizard-page-${i}`);
            if (pageEl) {
                pageEl.classList.add('hidden');
                pageEl.style.display = 'none';
            }
            const stepIndicator = document.getElementById(`wizard-step-${i}`);
            if (i < pageNum) {
                // Completed steps
                stepIndicator.className = 'w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold';
            } else if (i === pageNum) {
                // Active step
                stepIndicator.className = 'w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold';
            } else {
                // Future steps
                stepIndicator.className = 'w-8 h-8 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-sm font-bold';
            }
        }

        // Show current page
        const page = document.getElementById(`wizard-page-${pageNum}`);
        if (page) {
            page.classList.remove('hidden');
            page.style.display = pageNum === 2 ? 'flex' : 'block';
        }
    },

    async wizardNext(currentPage) {
        if (currentPage === 1) {
            // Validate page 1
            const name = document.getElementById('wizard-name').value.trim();
            const desc = document.getElementById('wizard-description').value.trim();

            if (!name) {
                alert('Please enter a project name');
                return;
            }

            this.state.wizard.projectName = name;
            this.state.wizard.projectDescription = desc;

            // Initialize server-side wizard (creates project folder/db entry)
            try {
                const payload = {
                    name,
                    description: desc
                };

                // Add template ID if one is selected
                if (this.state.wizard.selectedTemplateId) {
                    payload.templateId = this.state.wizard.selectedTemplateId;
                }

                const res = await fetch('/api/wizard/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok || !data.ok) {
                    alert(data.error || 'Failed to start wizard. Please check logs.');
                    return;
                }
                this.state.wizard.projectId = data.projectId;
                this.state.wizard.projectFolderName = data.folderName;
                this.state.wizard.projectFolderPath = data.folderPath;
                this.state.wizard.sessionId = data.projectId; // align IDs for all endpoints

                // If template was applied, mark as having summary and skip chat
                if (data.templateApplied) {
                    this.state.wizard.summary = { projectMd: 'Template applied', featuresJson: {} };
                    this.logToTerminal(`✓ Template "${this.state.wizard.selectedTemplateId}" applied`);
                    this.wizardShowPage(3);
                    return;
                }
            } catch (err) {
                console.error('Wizard start failed', err);
                alert('Failed to start wizard. Please check logs.');
                return;
            }

            // Initialize chat with first LLM turn using name/description (only if no template)
            this.wizardShowPage(2);
            await this.wizardInitChat();

        } else if (currentPage === 2) {
            // Require summary before moving to model selection
            if (!this.state.wizard.summary) {
                const ok = await this.wizardExtractSummary();
                if (!ok) return;
            }
            this.wizardShowPage(3);
        }
    },

    wizardPrev(currentPage) {
        if (currentPage > 1) {
            this.wizardShowPage(currentPage - 1);
        }
    },

    async wizardInitChat() {
        if (this.state.wizard.chatHistory.length > 0) return; // already started
        const kickoff = this.buildWizardKickoffMessage();
        await this.wizardSendChatMessage(kickoff);
    },

    buildWizardKickoffMessage() {
        const { projectName, projectDescription } = this.state.wizard;
        const descLine = projectDescription ? `Description: ${projectDescription}` : 'No description provided yet.';
        return `Project name: ${projectName}\n${descLine}\n\nPlease restate your understanding, ask the minimum questions to disambiguate, propose an initial stack + priorities (A/B/C), and note any missing info. Respond in Markdown.`;
    },

    wizardAddMessage(role, content) {
        const chatContainer = document.getElementById('wizard-chat');
        const isUser = role === 'user';

        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message flex ${isUser ? 'justify-end' : 'justify-start'}`;

        // Render markdown for assistant messages, plain text for user
        let renderedContent;
        if (isUser) {
            renderedContent = this.escapeHtml(content);
        } else {
            // Use marked.js to render markdown
            if (typeof marked !== 'undefined') {
                renderedContent = marked.parse(content);
            } else {
                renderedContent = this.escapeHtml(content);
            }
        }

        msgDiv.innerHTML = `
            <div class="max-w-[80%] ${isUser ? 'bg-blue-600' : 'bg-gray-800'} rounded-lg px-4 py-2 text-sm">
                ${isUser ? '' : '<div class="text-xs text-gray-400 mb-1 font-bold">AI Assistant</div>'}
                <div class="${isUser ? 'whitespace-pre-wrap' : 'chat-markdown'}">${renderedContent}</div>
            </div>
        `;

        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Syntax highlighting for code blocks
        if (!isUser && typeof hljs !== 'undefined') {
            msgDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        // Store in history
        this.state.wizard.chatHistory.push({ role, content });
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async wizardSendChat(e) {
        e.preventDefault();

        const input = document.getElementById('wizard-chat-input');
        const message = input.value.trim();
        if (!message) return;
        input.value = '';

        await this.wizardSendChatMessage(message);
    },

    async wizardSendChatMessage(message) {
        const chatModel = document.getElementById('wizard-chat-model').value;
        if (!chatModel || chatModel === 'Loading models...') {
            alert('Please wait for models to load or configure API keys in Settings');
            return false;
        }

        // Add user message
        this.wizardAddMessage('user', message);

        // Show typing indicator
        const chatContainer = document.getElementById('wizard-chat');
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typing-indicator';
        typingDiv.className = 'typing-indicator flex items-center gap-1 text-gray-500 text-xs';
        typingDiv.innerHTML = '<span>●</span><span>●</span><span>●</span> AI is typing...';
        chatContainer.appendChild(typingDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        try {
            const res = await fetch('/api/wizard/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.state.wizard.sessionId,
                    projectId: this.state.wizard.projectId,
                    message,
                    chatModel,
                    projectName: this.state.wizard.projectName,
                    projectDescription: this.state.wizard.projectDescription,
                    chatHistory: this.state.wizard.chatHistory
                })
            });

            const data = await res.json();
            document.getElementById('typing-indicator')?.remove();

            if (data.response) {
                this.wizardAddMessage('assistant', data.response);
                return true;
            } else {
                this.wizardAddMessage('assistant', 'Sorry, I encountered an error. Please try again.');
                return false;
            }
        } catch (err) {
            console.error('Chat error:', err);
            document.getElementById('typing-indicator')?.remove();
            this.wizardAddMessage('assistant', 'Sorry, I encountered a connection error. Please try again.');
            return false;
        }
    },

    async wizardWebSearch() {
        const query = prompt('What would you like to search for?');
        if (!query) return;

        this.wizardAddMessage('user', `🔍 Web search: ${query}`);

        // Show typing indicator
        const chatContainer = document.getElementById('wizard-chat');
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typing-indicator';
        typingDiv.className = 'typing-indicator flex items-center gap-1 text-gray-500 text-xs';
        typingDiv.innerHTML = '<span>●</span><span>●</span><span>●</span> Searching web...';
        chatContainer.appendChild(typingDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        try {
            if (!this.state.wizard.projectId) {
                this.wizardAddMessage('assistant', 'Web search needs a project. Please ensure the wizard was started.');
                document.getElementById('typing-indicator')?.remove();
                return;
            }

            const res = await fetch('/api/wizard/web-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: this.state.wizard.projectId,
                    query
                })
            });

            const data = await res.json();

            document.getElementById('typing-indicator')?.remove();

            if (data.context) {
                this.wizardAddMessage('assistant', `Web search results:\n\n${data.context}`);
            } else if (data.results) {
                const formatted = (data.results || [])
                    .map((r, i) => `${i + 1}. ${r.title || 'Untitled'}\n${r.url || ''}\n${r.content || ''}`)
                    .join('\n\n');
                this.wizardAddMessage('assistant', formatted || 'No results found or web search is not configured.');
            } else {
                this.wizardAddMessage('assistant', 'No results found or web search is not configured.');
            }
        } catch (err) {
            console.error('Web search error:', err);
            document.getElementById('typing-indicator')?.remove();
            this.wizardAddMessage('assistant', 'Web search failed. Please check your Tavily API key in settings.');
        }
    },

    async wizardExtractSummary() {
        const btn = event?.target;
        const originalText = btn?.innerText;
        if (btn) {
            btn.innerText = 'Generating...';
            btn.disabled = true;
        }

        // Get selected chat model
        const chatModel = document.getElementById('wizard-chat-model').value;
        if (!chatModel || chatModel === 'Loading models...') {
            alert('Please wait for models to load or configure API keys in Settings');
            if (btn) {
                btn.innerText = originalText;
                btn.disabled = false;
            }
            return;
        }

        try {
            const res = await fetch('/api/wizard/extract-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.state.wizard.sessionId,
                    projectId: this.state.wizard.projectId,
                    chatModel,
                    projectName: this.state.wizard.projectName,
                    projectDescription: this.state.wizard.projectDescription,
                    chatHistory: this.state.wizard.chatHistory
                })
            });

            const data = await res.json();
            const warnings = data.warnings || [];
            const warnText = warnings.length ? `Warnings: ${warnings.join('; ')}` : '';

            if (!res.ok || !data.ok) {
            const errText = data.error || `Failed to generate summary (HTTP ${res.status})`;
            const combined = warnText ? `${errText}\n${warnText}` : errText;
            this.wizardAddMessage('assistant', `⚠️ Summary failed: ${combined}`);
            if (data.rawPreview) {
                    this.wizardAddMessage('assistant', `Model output (truncated):\n\n\`\`\`text\n${data.rawPreview}\n\`\`\``);
                }
                alert(errText);
                return false;
            }

            // Build summary object for UI preview
            const features = (data.featuresJson?.features || []).map(f => ({
                name: f.name || 'Untitled feature',
                priority: f.priority || 'A'
            }));
            const summary = {
                stack: data.featuresJson?.tech_stack || data.featuresJson?.stack || 'Not specified',
                features,
                projectMd: data.projectMd
            };
            this.state.wizard.summary = summary;
            this.state.wizard.projectMd = data.projectMd;
            this.state.wizard.featuresJson = data.featuresJson;
            this.state.wizard.projectType = data.projectType;
            this.state.wizard.initSh = data.initSh;
            this.state.wizard.packageJson = data.packageJson;

            // Enable finalize now that summary exists
            document.getElementById('btn-wizard-create')?.removeAttribute('disabled');
            const nextBtn = document.getElementById('btn-wizard-next-3');
            if (nextBtn) {
                nextBtn.removeAttribute('disabled');
                nextBtn.classList.remove('bg-gray-700');
                nextBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
            }
            const btnSummary = document.getElementById('btn-wizard-summary');
            if (btnSummary) {
                btnSummary.innerText = 'Summary Ready';
                btnSummary.classList.remove('bg-blue-600');
                btnSummary.classList.add('bg-green-700');
            }
            this.toggleWizardArtifacts(true);

            // Update summary preview on page 3
            const summaryContent = document.getElementById('wizard-summary-content');
            summaryContent.innerHTML = `
                <div class="space-y-2">
                    <div><strong class="text-gray-300">Stack:</strong> <span class="text-gray-400">${summary.stack}</span></div>
                    <div><strong class="text-gray-300">Features (${features.length}):</strong></div>
                    <ul class="list-disc list-inside text-gray-400 space-y-1 pl-2">
                        ${features.map(f => `<li><strong>${f.priority}</strong>: ${f.name}</li>`).join('')}
                    </ul>
                    ${warnings.length ? `<div class="text-amber-300 text-xs">Warnings: ${warnings.join('; ')}</div>` : ''}
                </div>
            `;

            this.wizardAddMessage('assistant', `✓ Summary generated! You can now proceed to model selection.${warnText ? `\n${warnText}` : ''}`);
            return true;
        } catch (err) {
            console.error('Summary extraction error:', err);
            this.wizardAddMessage('assistant', 'Sorry, summary extraction failed. Please keep chatting to add more context or try again.');
            alert('Failed to extract summary. Please try again.');
            return false;
        } finally {
            if (btn) {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    },

    toggleWizardArtifacts(show) {
        const container = document.getElementById('wizard-artifacts');
        if (!container) return;
        const span = container.querySelector('span');
        const md = document.getElementById('link-project-md');
        if (!span || !md) return;
        if (show) {
            span.classList.remove('hidden');
            md.classList.remove('hidden');
        } else {
            span.classList.add('hidden');
            md.classList.add('hidden');
        }
    },

    wizardOpenFile(file) {
        if (!this.state.wizard.projectId) return;
        alert(`Open ${file} in your editor at projects/${this.state.wizard.projectId}/${file}`);
    },

    async wizardLoadModels() {
        const chatSelect = document.getElementById('wizard-chat-model');
        const plannerSelect = document.getElementById('wizard-planner-model');
        const executorSelect = document.getElementById('wizard-executor-model');
        const voterSelect = document.getElementById('wizard-voter-model');

        const currentChat = chatSelect.value;
        const currentPlanner = plannerSelect.value;
        const currentExecutor = executorSelect.value;
        const currentVoter = voterSelect.value;

        chatSelect.innerHTML = '<option>Loading models...</option>';
        plannerSelect.innerHTML = '<option>Loading models...</option>';
        executorSelect.innerHTML = '<option>Loading...</option>';
        voterSelect.innerHTML = '<option value="">Same as Executor</option>';

        const groups = {
            openai: { label: 'OpenAI', models: [] },
            anthropic: { label: 'Anthropic', models: [] },
            gemini: { label: 'Gemini', models: [] },
            lmstudio: { label: 'Local', models: [] }
        };

        // Get Keys
        const kRes = await fetch('/api/config/keys');
        const kData = await kRes.json();
        const keys = kData.keys || {};

        // Probe models
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

        const promises = [];
        if (keys.openai) promises.push(probe('openai', keys.openai));
        if (keys.anthropic) promises.push(probe('anthropic', keys.anthropic));
        if (keys.gemini) promises.push(probe('gemini', keys.gemini));
        promises.push(probe('lmstudio', '', 'http://localhost:1234/v1'));

        await Promise.all(promises);

        // Build options
        let html = '';
        for (const [type, group] of Object.entries(groups)) {
            if (group.models.length > 0) {
                html += `<optgroup label="${group.label}">`;
                group.models.forEach(m => {
                    const id = m.includes(':') ? m : `${type}:${m}`;
                    html += `<option value="${id}">${m}</option>`;
                });
                html += `</optgroup>`;
            }
        }

        if (html === '') {
             html = `<option value="" disabled>No API keys set. Please configure in Settings.</option>`;
        }

        chatSelect.innerHTML = html;
        plannerSelect.innerHTML = html;
        executorSelect.innerHTML = html;
        voterSelect.innerHTML = '<option value="">Same as Executor</option>' + html;

        // Restore or set default chat model to gpt-4o-mini if available
        const chatOptions = Array.from(chatSelect.options);
        const gpt4oMini = chatOptions.find(opt => opt.value.includes('gpt-4o-mini'));
        if (currentChat && this.setDefaultModel(chatSelect, currentChat)) {
            // keep current
        } else if (gpt4oMini) {
            chatSelect.value = gpt4oMini.value;
        }

        // Restore or set default planner/executor/voter models
        if (currentPlanner && this.setDefaultModel(plannerSelect, currentPlanner)) {
            // keep current
        } else {
            this.setDefaultModel(plannerSelect, 'openai:gpt-5.2');
        }
        if (currentExecutor && this.setDefaultModel(executorSelect, currentExecutor)) {
            // keep current
        } else {
            this.setDefaultModel(executorSelect, 'openai:gpt-4o-mini');
        }
        if (currentVoter && this.setDefaultModel(voterSelect, currentVoter)) {
            // keep current
        } else {
            this.setDefaultModel(voterSelect, 'openai:gpt-4o-mini');
        }
    },

    async wizardFinalize() {
        const plannerModel = document.getElementById('wizard-planner-model').value;
        const executorModel = document.getElementById('wizard-executor-model').value;
        const voterModel = document.getElementById('wizard-voter-model').value;
        const projectId = this.state.wizard.projectId || this.state.wizard.sessionId;

        if (!plannerModel || !executorModel) {
            alert('Please select models before creating the project');
            return;
        }

        if (!this.state.wizard.summary) {
            alert('Please generate a summary first (go back to chat page)');
            return;
        }

        if (!projectId) {
            alert('Project not initialized. Please restart the wizard.');
            return;
        }

        const btn = document.getElementById('btn-wizard-create');
        btn.innerText = 'Creating...';
        btn.disabled = true;

        try {
            // Call finalize endpoint
            const res = await fetch('/api/wizard/finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    sessionId: this.state.wizard.sessionId,
                    projectName: this.state.wizard.projectName,
                    description: this.state.wizard.projectDescription,
                    summary: this.state.wizard.summary,
                    projectMd: this.state.wizard.projectMd,
                    featuresJson: this.state.wizard.featuresJson,
                    projectType: this.state.wizard.projectType,
                    initSh: this.state.wizard.initSh,
                    packageJson: this.state.wizard.packageJson,
                    plannerModel,
                    executorModel,
                    voteModel: voterModel || executorModel
                })
            });

            const data = await res.json();

            if (data.ok) {
                // Success! Close wizard and navigate to project
                this.cancelWizard();
                this.fetchProjects();

                const name = data.project?.name || this.state.wizard.projectName || 'Project';
                alert(`Project "${name}" created successfully!`);

                // Navigate to project dashboard (we'll need to update this once we integrate with feature view)
                // For now, just refresh the project list
            } else {
                alert('Error creating project: ' + (data.error || 'Unknown error'));
                btn.innerText = 'Create Project';
                btn.disabled = false;
            }
        } catch (err) {
            console.error('Finalize error:', err);
            alert('Failed to create project. Please try again.');
            btn.innerText = 'Create Project';
            btn.disabled = false;
        }
    },

    toggleWizardArtifacts(show) {
        const container = document.getElementById('wizard-artifacts');
        if (!container) return;
        const span = container.querySelector('span');
        const md = document.getElementById('link-project-md');
        if (!span || !md) return;
        if (show) {
            span.classList.remove('hidden');
            md.classList.remove('hidden');
        } else {
            span.classList.add('hidden');
            md.classList.add('hidden');
        }
    },

    wizardOpenFile(file) {
        // Simple preview using the summary cache
        if (file === 'project.md' && this.state.wizard.projectMd) {
            alert(this.state.wizard.projectMd);
            return;
        }
        const folder = this.state.wizard.projectFolderPath || this.state.wizard.projectFolderName || this.state.wizard.projectId || 'projects/<name>';
        alert(`Summary not cached. Check ${folder}/${file} after creation.`);
    }
};

window.onload = () => app.init();
