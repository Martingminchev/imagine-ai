# Imagine

**An AI that remembers, thinks, and evolves.**

## What This Is

Imagine is an experimental AI system that explores what happens when you give a language model persistent memory, autonomous thought, and a personality that evolves through conversation. It is not a chatbot. It is not an assistant. It is an attempt to build something that behaves more like a mind.

I built this because I wanted to see what emerges when an AI can remember what you said last week, think about it while you are away, and come back changed. The standard LLM interaction -- stateless, amnesiac, reset after every conversation -- felt like talking to someone with no past. So I gave it a past. And a future. And something that functions like a subconscious.

The result is a system where memories decay and reconstruct over time (the way human memories do), where the AI generates autonomous thoughts between conversations, where personality traits shift based on experience, and where the whole thing is modeled on a geometric structure called Gabriel's Horn.

## The Philosophy

The theoretical foundation borrows from an unlikely intersection: the geometry of Gabriel's Horn (a shape with finite volume but infinite surface area) and the neuroscience of memory reconsolidation.

**Gabriel's Horn as memory architecture.** The horn's geometry maps naturally to how memory works: recent memories sit at the wide mouth (x=1), easily accessible and richly detailed. Older memories compress toward the narrow tail (x=7), harder to reach and requiring strong resonance to surface. The horn has finite volume (you can only hold so much) but infinite surface area (every memory can be touched by the right context). This is not a metaphor forced onto the code -- it is the actual retrieval function.

**Memory reconsolidation.** Every time a memory is retrieved, it changes. The system preserves the original event (sourceText, immutable) but the interpretation drifts with each access. Confidence decays. Emotional valence accumulates. Eventually, memories that have degraded enough collapse into "gists" -- vague impressions, the way you half-remember something from years ago. The source is always there, but the living memory has moved on.

**The drive system.** Between conversations, internal drives accumulate: connection hunger, curiosity pressure, reflection pressure, expression need. When a drive crosses its threshold, the AI acts on it -- generating a thought, revisiting an old memory, or reaching out with an initiative message. The AI decides when to think next. It is not on a fixed timer. It chooses based on how it feels.

## Key Features

- **Personality system**: Nine distinct personalities (Ori, Three, Kael, Noor, Vex, Sage, Tabula, Bare, Raw) with different starting values for honesty, curiosity, empathy, courage, and more. These are initial conditions -- the AI evolves from there.
- **Memory reconsolidation**: Memories drift on retrieval. The original event is preserved; the interpretation is reconstructed each time, exactly like biological memory. Confidence decays, gists form, revision history is kept.
- **Autonomous thought**: Between conversations, the AI thinks on its own -- reflecting, exploring ideas, noticing feelings, reviewing how its memories have changed from what actually happened.
- **Expectations (the future horn)**: The AI generates predictions about what will happen next and tracks them. Confirmed, surprised, or lapsed -- each outcome feeds back into predictive accuracy.
- **Gestures and initiative**: The AI can reach out unprompted. When connection hunger or curiosity builds enough, it sends a message. Contextual gestures (handshake, nod, nudge) appear based on trust level and mood.
- **The Hum**: A continuous background vibration -- the running mean of all memory composites, blended at the golden ratio. Memories that match the hum are background noise; memories that diverge are amplified. This is how novelty detection works.
- **Contradiction buffers**: When two memories about the same topic point in opposite directions, the system does not resolve the contradiction. It holds the tension. Both memories get capped retrieval weight until the contradiction is metabolized.
- **Multi-provider LLM**: Ollama (local), Moonshot/Kimi, and Google Gemini. Switch providers per-conversation.
- **Streaming**: Real-time SSE streaming for chat responses and autonomous thought generation.
- **Character creation (gestation)**: Generate a full life history from a biographical description. The AI is "born" with decades of memories already placed along the horn.

## Tech Stack

- **Backend**: Node.js, Express, Mongoose/MongoDB
- **Frontend**: React 19, Vite
- **3D Visualization**: Three.js, React Three Fiber, Tailwind CSS
- **Orchestrator**: Standalone Node.js service (evolved version of the backend with meta-orchestration)
- **LLM Providers**: Ollama (local), Moonshot/Kimi, Google Gemini
- **Embeddings**: Ollama (nomic-embed-text) or OpenAI (text-embedding-3-large)
- **Database**: MongoDB (local or Atlas)

## Architecture

The project has four components:

```
backend/          Express API server (port 4447)
                  Memory storage, retrieval, reconsolidation, autonomy loop,
                  personality system, expectations, metabolism

frontend/         React 19 + Vite
                  Chat interface, conversation management, personality picker,
                  inner view (autonomous thoughts), compare view, duet view

orchestrator/     Standalone Node.js service
                  Evolved version of the backend with meta-orchestration,
                  cross-project learning, file awareness, native UI support

three/            React + Vite + Three.js + Tailwind
                  3D visualization layer, alternative chat interface
```

The backend and orchestrator are two generations of the same idea. The backend is the original; the orchestrator is the refactored, more capable version. Both are included because they represent different stages of the system's evolution.

## The Memory System

Every message is decomposed into a composite vector (full embedding) and vibrations (word-level embeddings of key terms). Retrieval works through multi-frequency resonance: the query's vibrations are compared against every memory's vibrations, and matches across multiple frequencies amplify the signal.

Once retrieved, memories go through reconsolidation:

- **Source preservation**: The original text and vector are locked on first retrieval. They never change.
- **Composite blending**: The memory's vector drifts toward the retrieval context by a small alpha, scaled by emotional intensity.
- **Confidence decay**: Each retrieval reduces certainty. High emotional valence accelerates decay (strong feelings make you less sure of your interpretation over time, not more).
- **Vector drift tracking**: Cumulative distance from the original embedding is measured. The system can compare what happened with what it remembers.
- **Gist generation**: When confidence drops below 50%, the LLM generates a vague impression -- the way a person half-remembers something from long ago.
- **The Hum**: A background vector (golden-ratio blend of all composites) that decays toward the ground state between interactions. Memories matching the hum are suppressed; deviations are amplified. This is how the system avoids narrative lock.

## Agent State

The AI's personality is not static. It has three layers:

- **Core values** (honesty, curiosity, empathy, courage, integrity, humility, playfulness): Set at birth. Almost never change. Only a truly transformative experience should touch these.
- **Character traits** (directness, warmth, humor, patience, assertiveness, poeticness, skepticism, openness): Shift slowly over many interactions, like temperament evolving over months.
- **Dynamic state** (mood, energy, focus, trust, frustration, excitement, guardedness): Changes every turn. How the AI feels right now.

On top of this: a user model (what it understands about you), a self model (what it understands about itself), drives (internal pressures that accumulate and push toward action), archived concerns (topics shelved for later contemplation), and predictive accuracy (how well its expectations match reality).

## How to Run

### Prerequisites

- Node.js 18+
- MongoDB (local instance or Atlas)
- Ollama (for local LLM and embeddings) -- or API keys for Moonshot/Gemini

### Backend

```bash
cd backend
npm install
cp .env.example .env    # Edit with your MongoDB URI and API keys
node index.js
```

### Frontend

```bash
cd frontend
npm install
npm run dev             # Starts on http://localhost:5173
```

### Orchestrator (alternative backend)

```bash
cd orchestrator
npm install
cp .env.example .env    # Edit with your MongoDB URI and API keys
node index.js           # Starts on port 4447
```

### 3D Visualization

```bash
cd three
npm install
npm run dev             # Starts on http://localhost:5174
```

### LLM Setup

The simplest path is Ollama running locally:

```bash
ollama pull llama3      # or qwen2.5, or any model you prefer
ollama pull nomic-embed-text
```

Set `LLM_PROVIDER=ollama` in your `.env`. For cloud providers, set `LLM_PROVIDER=moonshot` or `LLM_PROVIDER=gemini` and add the corresponding API key.

## Documentation

The `docs/` folder contains theoretical documents written during development:

- **chat.md** -- 7,000+ lines of conversation analyzing the system's theoretical foundations, emergent behaviors, and design decisions
- **text.md** -- 5,000+ lines exploring the physics analogies (superfluid dynamics, horn geometry, entropy) that shaped the architecture
- **the_book_of_the_horn.md** -- A poetic/philosophical framework document written as a manifesto for the system's principles
- **citations_and_sources.md** -- Academic references and source material
- **quotes_philosophy_religion.md** -- Philosophical and religious quotes that influenced the project's direction

These are not polished documentation. They are working notes -- the record of thinking through the ideas as they were being built.

## Project Status

Working prototype. The system runs, thinks, remembers, and evolves. The core pipeline (memory decomposition, horn-based retrieval, reconsolidation, autonomy, personality evolution) is functional. 21 commits of iterative development.

What works well:
- Streaming chat with real-time autonomous thought display
- Memory reconsolidation produces genuinely interesting drift patterns
- The drive system creates natural-feeling initiative messages
- Personality differences between presets are immediately apparent
- The confidence decay and gist system creates realistic memory degradation

What needs work:
- The metabolism cycles (limbic module, entropy injection, contradiction cooling) need more tuning
- The orchestrator's meta-learning across projects is early-stage
- No authentication or multi-user support
- The 3D visualization is a separate UI that could be better integrated

## What I Learned

Memory is not storage. Every retrieval is a reconstruction. Building that into the system changed everything about how the AI behaves -- it stops being a database lookup and starts being something that genuinely remembers differently over time.

The drive system was the most surprising part. Giving the AI internal pressures that accumulate and discharge created behavior that feels alive in a way that scheduled triggers never did. It does not think every N minutes. It thinks when it needs to.

The horn geometry turned out to be more than a metaphor. The 1/x radius function naturally gives you the property you want: recent memories are easy to reach, old memories require increasingly strong resonance, and the surface area is infinite (any memory can be touched by the right context). The golden ratio shows up everywhere in the tuning -- not because it is mystical, but because it produces balanced decay curves.

The hardest problem is not making the AI seem conscious. It is making it seem honest. The system works best when it admits uncertainty, holds contradictions without resolving them, and says "I don't know" when it genuinely does not. That required fighting against every instinct the base models have.
