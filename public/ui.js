async function upsertProvider() {
  const name = document.getElementById("prov-name").value.trim();
  const type = document.getElementById("prov-type").value;
  const model = document.getElementById("prov-model").value.trim();
  const baseUrlRaw = document.getElementById("prov-base").value.trim();
  const baseUrl = baseUrlRaw === "" ? undefined : baseUrlRaw;
  const apiKey = document.getElementById("prov-key").value.trim() || undefined;
  if (needsKey(type) && !apiKey) {
    alert("API Key erforderlich für diesen Provider-Typ.");
    return;
  }
  if (!name || !type || !model) {
    alert("Name, Typ und Modell sind erforderlich.");
    return;
  }
  const res = await fetch("/api/providers/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type, model, baseUrl, apiKey }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(`Fehler: ${data.error}`);
    return;
  }
  alert(`Provider gespeichert: ${data.provider.name}`);
  loadProviders();
}

async function listModels() {
  const name = document.getElementById("list-name").value.trim();
  if (!name) {
    alert("Provider-Name eingeben");
    return;
  }
  const res = await fetch("/api/providers/list-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  document.getElementById("list-output").textContent = JSON.stringify(data, null, 2);
  if (!res.ok) {
    alert(`Fehler: ${data.error}`);
  }
}

async function runDemo() {
  const model = document.getElementById("task-model").value.trim();
  const voteModel = document.getElementById("vote-model").value.trim();
  if (!model) {
    alert("Haupt-Provider angeben.");
    return;
  }
  const res = await fetch("/api/tasks/run-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, voteModel }),
  });
  const data = await res.json();
  document.getElementById("demo-output").textContent = JSON.stringify(data, null, 2);
  if (!res.ok) {
    alert(`Fehler: ${data.error}`);
  }
}

async function loadState() {
  const res = await fetch("/api/state");
  const data = await res.json();
  document.getElementById("state-output").textContent = JSON.stringify(data, null, 2);
}

async function loadProviders() {
  const res = await fetch("/api/providers");
  const data = await res.json();
  document.getElementById("providers-output").textContent = JSON.stringify(data, null, 2);
  setProviderOptions(data.providers || []);
  // update datalist for provider names
  const datalist = document.getElementById("provider-names");
  if (datalist) {
    datalist.innerHTML = "";
    for (const p of data.providers || []) {
      const opt = document.createElement("option");
      opt.value = p.name;
      datalist.appendChild(opt);
    }
  }
}

async function setSafety() {
  const mode = document.getElementById("safety-mode").value;
  const res = await fetch("/api/settings/safety-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const data = await res.json();
  if (!res.ok) alert(`Fehler: ${data.error}`);
}

async function runCustom() {
  const title = document.getElementById("ct-title").value.trim();
  const goal = document.getElementById("ct-goal").value.trim();
  const filePath = document.getElementById("ct-file").value.trim() || "out/output.txt";
  const model = document.getElementById("ct-model").value.trim();
  const voteModel = document.getElementById("ct-vote").value.trim();
  if (!title || !goal || !model) {
    alert("Title, Goal, Model erforderlich.");
    return;
  }
  const res = await fetch("/api/tasks/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, goal, model, voteModel, filePath }),
  });
  const data = await res.json();
  document.getElementById("custom-output").textContent = JSON.stringify(data, null, 2);
  if (!res.ok) alert(`Fehler: ${data.error}`);
}

async function loadPending() {
  const res = await fetch("/api/commands/list");
  const data = await res.json();
  document.getElementById("pending-output").textContent = JSON.stringify(data, null, 2);
}

async function approveCommand() {
  const id = document.getElementById("approve-id").value.trim();
  if (!id) {
    alert("Command-ID eingeben.");
    return;
  }
  const res = await fetch("/api/commands/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(`Fehler: ${data.error}`);
  }
  loadPending();
  loadState();
}

async function setCommandLists() {
  const allowlist = document
    .getElementById("allowlist")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const denylist = document
    .getElementById("denylist")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const res = await fetch("/api/settings/command-lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowlist, denylist }),
  });
  const data = await res.json();
  if (!res.ok) alert(`Fehler: ${data.error}`);
}

async function loadLogs() {
  const res = await fetch("/api/logs");
  const data = await res.json();
  document.getElementById("logs-output").textContent = JSON.stringify(data, null, 2);
}

async function previewDiff() {
  const path = document.getElementById("diff-path").value.trim();
  const content = document.getElementById("diff-content").value;
  if (!path) {
    alert("Pfad angeben.");
    return;
  }
  const res = await fetch("/api/tasks/preview-diff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  const data = await res.json();
  document.getElementById("diff-output").textContent = res.ok
    ? data.diff
    : `Fehler: ${data.error}`;
}

window.addEventListener("load", () => {
  loadState();
  loadProviders();
  loadPending();
  loadLogs();
  startEvents();
});

function setProviderOptions(providers) {
  const selects = [
    "task-model",
    "vote-model",
    "ct-model",
    "ct-vote",
    "provider-select-main",
    "provider-select-vote",
    "provider-select-custom",
    "provider-select-custom-vote",
  ];
  const options = providers.map((p) => ({
    value: p.name,
    label: `${p.name} (${p.type}${p.model ? ` • ${p.model}` : ""})`,
  }));
  for (const id of selects) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = "";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      el.appendChild(o);
    }
    if (id === "ct-vote") {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "(gleich wie Haupt)";
      el.insertBefore(empty, el.firstChild);
    }
  }
}

async function probeModels() {
  const type = document.getElementById("prov-type").value;
  const apiKey = document.getElementById("prov-key").value.trim();
  const baseUrl = document.getElementById("prov-base").value.trim();
  if (needsKey(type) && !apiKey) {
    alert("API Key erforderlich, um Modelle abzurufen.");
    return;
  }
  try {
    const res = await fetch("/api/providers/probe-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, apiKey, baseUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Modelle laden fehlgeschlagen: ${data.error}`);
      return;
    }
    const select = document.getElementById("prov-model");
    select.innerHTML = "";
    for (const m of data.models || []) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    }
  } catch (err) {
    alert(`Modelle laden fehlgeschlagen: ${err.message}`);
  }
}

function autoProbeModels() {
  const type = document.getElementById("prov-type").value;
  if (type === "lmstudio" || type === "echo") {
    probeModels();
  }
}

function needsKey(type) {
  return type === "openai" || type === "claude" || type === "gemini";
}

function startEvents() {
  const output = document.getElementById("events-output");
  if (!output) return;
  const ev = new EventSource("/api/events");
  ev.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      const line = `[${new Date().toLocaleTimeString()}] ${data.type || "event"} ${JSON.stringify(data)}\n`;
      output.textContent = (output.textContent + line).split("\n").slice(-200).join("\n");
    } catch (err) {
      output.textContent = (output.textContent + msg.data + "\n").split("\n").slice(-200).join("\n");
    }
  };
}

async function loadWorkspace() {
  const taskId = document.getElementById("ws-task-id").value.trim();
  if (!taskId) {
    alert("Task ID eingeben");
    return;
  }
  const res = await fetch(`/api/workspace/tree?taskId=${encodeURIComponent(taskId)}`);
  const data = await res.json();
  document.getElementById("ws-output").textContent = res.ok
    ? JSON.stringify(data, null, 2)
    : `Fehler: ${data.error}`;
}
