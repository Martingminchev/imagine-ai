# Orchestrator

A local AI coding assistant with living memory. It remembers what worked, forgets what didn't, forms expectations about what you'll need next, and thinks between conversations.

Built on a **Gabriel's Horn memory topology** — a mathematical framework where memories are positioned along a horn-shaped manifold. Recent memories sit at the wide mouth (easily accessible), while older memories recede toward the narrow tail (requiring stronger resonance to surface). The system uses golden ratio constants throughout for temporal decay, prediction coupling, and memory blending.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Chat Pipeline                    │
│  encode → resonate → anticipate → measure →      │
│  compose → generate → remember → reflect → evolve │
└──────────────┬──────────────────┬────────────────┘
               │                  │
    ┌──────────▼──────────┐  ┌───▼────────────────┐
    │   Memory System      │  │   Agent State       │
    │  ┌────────────────┐  │  │  core values        │
    │  │  Gabriel's Horn │  │  │  character traits   │
    │  │  (past horn)    │  │  │  dynamic state      │
    │  └───────┬────────┘  │  │  user model          │
    │          │           │  │  self model           │
    │  ┌───────▼────────┐  │  └───────────────────────┘
    │  │  Double Horn    │  │
    │  │  (future horn)  │  │  ┌───────────────────────┐
    │  │  expectations   │  │  │   Autonomy System     │
    │  └───────┬────────┘  │  │  drives (curiosity,    │
    │          │           │  │   reflection, outreach) │
    │  ┌───────▼────────┐  │  │  autonomous thoughts   │
    │  │  The Hum        │  │  │  initiative messages   │
    │  │  (background    │  │  └───────────────────────┘
    │  │   vibration)    │  │
    │  └───────┬────────┘  │  ┌───────────────────────┐
    │          │           │  │   Metabolism            │
    │  ┌───────▼────────┐  │  │  confidence decay      │
    │  │  Circulation    │  │  │  contradiction buffers │
    │  │  (confirmed     │  │  │  reconsolidation       │
    │  │   pathways)     │  │  │  gist generation       │
    │  └────────────────┘  │  └───────────────────────┘
    └──────────────────────┘
```

## Key Concepts

### Gabriel's Horn Topology
Memories are positioned along a horn axis (x = 1 to 7). Position 1 is the wide mouth — recent, easily accessible. Position 7 is the narrow singularity — old memories that require strong resonance to surface. The radius at any point follows `r(x) = (1/x) · π/2`.

### Multi-Frequency Resonance
Each memory is decomposed into word-level "vibrations" (individual embeddings) plus a composite vector (superposition). When searching, the system checks resonance at every frequency — a memory that matches on many words scores higher than one that matches on just one, like a chord vs. a single note.

### The Hum
A continuous background vibration representing the texture of recent interactions. New composites blend into the hum at the golden ratio (`φ⁻¹ · old + (1−φ⁻¹) · new`). Between interactions, the hum decays toward a ground state (running mean of all experience). Memories that diverge from the hum are amplified — they stand out against the background.

### Double Horn (Expectations)
A forward-facing horn mirrors the past horn. The AI forms expectations about what will happen next. When an expectation is confirmed, it creates a circulation pathway — a proven connection between prediction and outcome that strengthens future retrieval. Surprises create turbulence that disrupts the flow.

### Metabolism
Memories are metabolized over time:
- **Confidence decay** — interpretations become less certain with age
- **Contradiction buffers** — opposing memories are held in tension, not resolved
- **Reconsolidation** — heavily-accessed memories are rewritten from the current perspective
- **Gist generation** — old, low-confidence memories collapse into fuzzy impressions

### Autonomy
Between interactions, the assistant has drives that build up over time:
- **Curiosity** — pressure to explore ideas
- **Reflection** — pressure to review past work
- **Outreach** — drive to share useful observations

When a drive exceeds its threshold, the system generates an autonomous thought and may send it to the user as an initiative.

### Agent State (Global Identity)
The assistant has a **single persistent identity per user** — one agent that carries its memories, values, and personality across all conversations. Conversations (projects) are workspaces; the agent brings its full self to each one.

- **Core values** (honesty, curiosity, integrity, etc.) — shift very slowly (±0.03/turn max)
- **Character traits** (directness, patience, skepticism, etc.) — drift based on interaction patterns (±0.05/turn max)
- **Dynamic state** (mood, energy, trust, focus) — changes freely each turn
- **User model** — what it knows about your preferences and working style
- **Self model** — what it believes about its own capabilities

Memories are global — what the agent learns in one project is available in all others. File memories (project file contents) are the exception: they're scoped to the project that synced them.

## Personalities

Four built-in coding assistant personas:

| Persona | Style | Best for |
|---------|-------|----------|
| **architect** | Thorough, methodical, explains decisions | Architecture planning, code review |
| **sprint** | Terse, fast, just the code | Quick implementations, prototyping |
| **explorer** | Curious, suggests alternatives | Problem exploration, brainstorming |
| **mentor** | Pedagogical, explains why | Learning, onboarding, teaching |

## Prerequisites

- **Node.js** 18+
- **MongoDB** (local or Atlas)
- **Ollama** (for local LLM + embeddings) — or configure cloud providers

## Quick Start

```bash
# Clone and install
git clone <your-repo-url>
cd orchestrator
npm install

# Install the UI
cd ui && npm install && cd ..

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Pull the embedding model (if using Ollama)
ollama pull nomic-embed-text

# Pull an LLM model
ollama pull llama3

# Start in development mode
npm run dev

# Or build and start in production
npm start
```

The server starts at `http://localhost:4447`.

## Configuration

All settings are in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO` | `mongodb://localhost:27017/orchestrator` | MongoDB connection string |
| `PORT` | `4447` | Server port |
| `EMBED_PROVIDER` | `ollama` | Embedding provider (`ollama` or `openai`) |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model name |
| `LLM_PROVIDER` | `ollama` | LLM provider (`ollama`, `gemini`, `moonshot`) |
| `OLLAMA_MODEL` | `llama3` | Default Ollama model |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |

## API

### Chat

```
POST /api/chat/stream
Content-Type: application/json
X-User-Id: <uuid>

{
  "message": "Help me set up JWT auth in Express",
  "conversationId": "project-alpha",
  "personality": "architect",
  "model": "ollama:llama3"
}
```

Returns a Server-Sent Events stream with:
- `step` events — pipeline progress (encode, resonate, anticipate, etc.)
- `token` events — streamed response text
- `done` event — final metadata (dissonance, memory depth, expectations)

### Autonomous Thoughts (SSE)

```
GET /api/events?conversationId=project-alpha&userId=<uuid>
```

Receives real-time autonomous thoughts:
- `thought-start` — thought generation began
- `thought-chunk` — streamed thought text
- `thought-complete` — thought stored
- `initiative` — a message the AI wants to send you

### Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/status` | System status (memory count, provider info) |
| `GET` | `/api/history` | Conversation message history |
| `GET` | `/api/personalities` | List available personas |
| `GET` | `/api/state` | Current agent state |
| `GET` | `/api/conversations` | List user's conversations |
| `DELETE` | `/api/conversations/:id` | Delete a conversation |
| `POST` | `/api/autonomy/settings` | Configure autonomy |
| `POST` | `/api/autonomy/tick` | Manually trigger autonomy tick |
| `POST` | `/api/tasks` | Decompose a coding task |
| `GET` | `/api/tasks` | List tasks |
| `GET` | `/api/tasks/:id` | Get task details |
| `POST` | `/api/tasks/:id/steps/:stepId/run` | Run a task step (streaming) |
| `PATCH` | `/api/tasks/:id/outcome` | Report task outcome |
| `GET` | `/api/lessons` | List learned lessons |

## Project Structure

```
orchestrator/
├── index.js                    # Server entry + autonomy startup
├── config/
│   └── personalities.js        # 4 coding assistant personas
├── models/
│   ├── AgentState.js           # Mind state (values, traits, drives)
│   ├── ConversationState.js    # Session continuity
│   ├── Contradiction.js        # Held contradictions
│   ├── Expectation.js          # Predictions (double horn)
│   ├── InternalThought.js      # Autonomous thought log
│   ├── Memory.js               # Full memory with reconsolidation
│   ├── Recording.js            # LLM call recordings
│   └── Task.js                 # Task decomposition
├── lib/
│   ├── agentState.js           # State management + LLM reflection
│   ├── archiveConcern.js       # Concern contemplation
│   ├── autonomy.js             # Drives, tick, thought generation
│   ├── db.js                   # MongoDB connection
│   ├── embedder.js             # Text → vibrations + composite
│   ├── expectation.js          # Predictions + circulation
│   ├── generate.js             # Multi-provider LLM generation
│   ├── hum.js                  # Background vibration
│   ├── lessons.js              # Outcome → lesson extraction
│   ├── lock.js                 # Async mutex
│   ├── metabolism.js           # Confidence decay, contradictions
│   ├── orchestrate.js          # Task decomposition + execution
│   ├── pipeline.js             # 10-step chat pipeline
│   ├── reconsolidation.js      # Memory reconstruction
│   ├── resonance.js            # Horn topology retrieval
│   ├── similarity.js           # Vector math
│   └── providers/
│       ├── ollama.js           # Ollama provider
│       ├── gemini.js           # Google Gemini provider
│       └── moonshot.js         # Moonshot/Kimi provider
├── routes/
│   └── api.js                  # REST API
└── ui/                         # React frontend (Vite)
```

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express
- **Database:** MongoDB via Mongoose
- **Embeddings:** Ollama (nomic-embed-text) or OpenAI
- **LLM:** Ollama (local), Gemini, or Moonshot
- **Frontend:** React 19 + Vite + CSS Modules
- **Math:** Gabriel's Horn topology, Golden Ratio constants, Fibonacci sequences

## License

MIT
