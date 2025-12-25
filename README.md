# ⚡ Ultraagent

**A MAKER-based autonomous feature engineering system**

Ultraagent is a **production-grade autonomous software engineering system** that plans, implements, validates, and commits complete software features using a structured multi-agent architecture.

Ultraagent is inspired by the **MAKER architecture** and implements a **general-purpose agent harness** for reliable, auditable, and cost-aware AI-driven development.

Ultraagent is **not a chatbot**.  
It is an **engineering system**.

---

## 🔬 Research Background

Ultraagent is directly inspired by:

> **MAKER: Multi-Agent Architecture for Knowledge-Driven Reasoning**  
> Cognizant AI Lab (2024)  
> https://www.cognizant.com/us/en/ai-lab/blog/maker

From the MAKER paper, Ultraagent adopts:

- Separation of **planning**, **execution**, and **validation**
- Explicit intermediate representations
- Error decorrelation via multiple samples
- Structured voting instead of blind generation
- Human-in-the-loop safety boundaries

Ultraagent extends MAKER from **task execution** to a complete **feature-based software engineering pipeline**.

---

## 🧠 What Ultraagent Is

Ultraagent turns large language models into **reliable engineering agents** by embedding them inside a deterministic system with memory, validation, and control.

### Core Idea

Project
→ Features (prioritized, dependency-aware)
→ Subtasks (atomic, executable)
→ Voting-based execution
→ Validation
→ Git commits

---

## ✨ Key Capabilities

### 🎯 Feature-Based Development
- Work is organized as **features**, not prompts
- Priorities: **A / B / C**
- Explicit dependencies and blocking rules

### 🧠 Structured Agent Roles
- **Planner Agent** — decomposes features into subtasks
- **Executor Agent** — generates concrete code and actions
- **Voting / Verification Agent** — selects safe, correct outputs

### 🗳 Voting & Quality Control
- Multi-sample generation with adaptive temperature
- First-to-lead-by-k voting strategy
- Prompt paraphrasing for error decorrelation
- Red-flag detection before execution

### 📊 Persistent System State
- SQLite (WAL mode) as single source of truth
- Projects, features, subtasks, events
- Full audit trail (event sourcing)

### 🔒 Safety by Design
- Filesystem sandboxing
- Command risk classification
- Human approval for risky actions
- No arbitrary code execution

### 🧪 Optional Automated Verification
- Auto-start dev servers (Node, PHP, static)
- Screenshot-based UI testing (Puppeteer)
- LLM-based verification against Definition of Done

### 📈 Cost & Token Transparency
- Token estimation and pricing per model
- Real-time project cost breakdown
- Zero cost for local models

---

## 🧩 Architecture Overview

┌────────────┐
│   Web UI   │  (live SSE updates)
└─────┬──────┘
▼
┌────────────┐
│ HTTP API   │
└─────┬──────┘
▼
┌────────────┐
│ Feature    │
│ Manager    │
└─────┬──────┘
▼
┌────────────┐
│ Orchestrator│
│ (MAKER)    │
└─────┬──────┘
▼
┌────────────┐
│ Voting     │
│ Engine     │
│ + RedFlags │
└─────┬──────┘
▼
┌────────────┐
│ LLM        │
│ Registry   │
└─────┬──────┘
▼
┌─────────────────────────────┐
│ OpenAI · Claude · Gemini    │
│ Local Models (LM Studio)    │
└─────────────────────────────┘

---

## 🗳 Voting & Verification Agents

Ultraagent applies **targeted voting at deterministic decision gates**, following the MAKER philosophy.

### Why Voting?

LLMs fail in *correlated* ways.  
Voting combined with prompt paraphrasing breaks that correlation and improves reliability.

### Decision Flow

Executor Outputs
↓
Red-Flag Filtering
↓
Vote Tally
↓
[ Approve | Retry | Fail | Human Review ]

Voting is applied to:
- Subtask execution
- Structured JSON outputs
- Ambiguous or risky operations

---

## 🧱 Core Components

- **FeatureStore** — SQLite persistence & event sourcing  
- **FeatureManager** — dependency resolution & execution queue  
- **FeaturePlanner** — LLM-based feature decomposition  
- **ContextBuilder** — intelligent prompt assembly  
- **Orchestrator** — MAKER-style execution engine  
- **VotingEngine** — consensus selection & error filtering  
- **ProjectGuard** — filesystem sandbox  
- **ExecutionGuard** — command safety  
- **ResourceMonitor** — token & cost tracking  

---

## 🧙 Project Creation Wizard

Ultraagent includes a structured **3-step project wizard**:

1. **Project Basics**
   - Name and description
   - Folder creation & git init

2. **AI-Guided Clarification**
   - Architecture & stack
   - Data models & authentication
   - Non-functional requirements
   - Optional web research

3. **Model Assignment**
   - Planner model
   - Executor model
   - Voting model

Outputs:
- `project.md` (engineering specification)
- Feature list with Definition of Done
- `init.sh` for automated bootstrapping

---

## 🚀 Quick Start

### Requirements
- Node.js ≥ 18
- At least one LLM provider (or LM Studio for local models)

### Install

```bash
git clone https://github.com/yourusername/ultraagent.git
cd ultraagent
npm install

Configure

cp config.json.example data/config.json

Add API keys (the data/ directory is gitignored).

Run

npm start
# or
PORT=4173 npm start

Open:
http://localhost:4173

⸻

🧪 Feature Lifecycle

pending → running → completed → verified
          ↓              ↓
       paused          failed
          ↓
       blocked (dependency)

Ultraagent always knows what can run next — and why.

⸻

🧠 Why Ultraagent Exists

Ultraagent demonstrates that:
	•	LLMs become reliable inside systems
	•	Autonomous coding requires memory, structure, and validation
	•	Voting beats prompt cleverness
	•	MAKER-style architectures scale beyond research prototypes

This repository is both:
	•	a usable engineering tool
	•	a reference implementation of modern agent research

⸻

📜 License

MIT License

⸻

🙏 Acknowledgements
	•	Cognizant AI Lab — MAKER architecture
	•	OpenAI, Anthropic, Google
	•	The autonomous agents research community

⸻

Ultraagent — Autonomous engineering, grounded in systems, not prompts.

