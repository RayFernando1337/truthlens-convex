# TRUTHLENS

Real-time claim analysis powered by Nemotron 3 Super + Convex.

---

## Problem

People consume content (talks, podcasts, pitches, articles) and have no way to
evaluate claims in real time. By the time something sounds wrong, the speaker has
moved on. There is no tool that sits alongside content consumption and flags
what is supported, what is missing, and what is manipulation.

TruthLens solves this with three tiers of analysis running concurrently, each
progressively deeper, all streaming results as the content flows in.

---

## Stack

```
Frontend          Next.js 15 (App Router) + Convex React client
Backend           Convex (real-time DB, actions, scheduler, HTTP actions)
Streaming         @convex-dev/persistent-text-streaming
Inference          ┌─ L1 Pulse:  Nemotron 3 Nano (30B/3B active) — fast, cheap
                   ├─ L2 Analyze: Nemotron 3 Super (120B/12B active) — reasoning + tools
                   └─ L3 Patterns: Nemotron 3 Super — 1M context window
                   All on Nebius Token Factory, OpenAI-compatible API
                   via @ai-sdk/openai-compatible + Vercel AI SDK
Voice Input       Web Speech API (zero-config) or Nemotron ASR Streaming (NIM)
Search/Verify     Tavily (Nebius-owned, agentic search)
Deployment        Convex Cloud (backend) + Vercel or local (frontend)
```

---

## Nemotron Model Map (as of GTC 2026, March 16)

The Nemotron 3 family gives us the right model for each analysis tier.

### Models we use

| Model | Params | Active | Context | Use in TruthLens | Where |
|---|---|---|---|---|---|
| **Nemotron 3 Nano** | 30B | 3B | 32K | L1 Pulse — fast structured output, <1s | Nebius Token Factory |
| **Nemotron 3 Super** | 120B | 12B | 1M | L2 Analysis + L3 Patterns — deep reasoning, tool calling | Nebius Token Factory |

**Why two models instead of one:**
- L1 needs speed above all else. Nano at 3B active params gives sub-second
  `generateObject` calls. At $0.06/1M input tokens, it's essentially free.
- L2/L3 need reasoning depth and the 1M context window. Super is a reasoning
  model (think budget controllable) that matches GPT-5.4 on voice agent
  benchmarks. It handles tool calling for Tavily verification.

### Models to be aware of (announced GTC 2026)

| Model | What it does | Status | Relevance |
|---|---|---|---|
| **Nemotron 3 Ultra** | ~500B frontier model, 5x throughput on Blackwell | Coming soon | Could replace Super for L2/L3 if available |
| **Nemotron 3 Omni** | Multimodal: audio + vision + language in one model | Announced, not yet released | Future: direct audio-in claim analysis, no ASR step needed |
| **Nemotron 3 VoiceChat** | 12B end-to-end speech-to-speech, full duplex | Free endpoint on build.nvidia.com (early access) | Future: conversational TruthLens that talks back |
| **Nemotron ASR Streaming** | 600M streaming speech-to-text, 80ms chunks | Available (NIM, downloadable) | Alternative to Web Speech API — more accurate, NVIDIA-native |

### Voice input strategy

For the hackathon MVP, **Web Speech API** is the fastest path -- zero config,
zero cost, works in Chrome. But for the demo pitch, we should mention the
NVIDIA-native path:

```
MVP (hackathon):     Browser mic → Web Speech API → text chunks → Convex
Production path:     Browser mic → MediaRecorder → audio chunks → Convex action
                       → Nemotron ASR Streaming (NIM) → text → analysis pipeline
Dream path (future): Browser mic → audio → Nemotron 3 Omni → claim analysis
                       directly from audio (no separate ASR)
```

The production path would use `MediaRecorder` to capture audio chunks, send them
to a Convex HTTP action, which forwards to a Nemotron ASR NIM endpoint for
transcription, then feeds the text into the same `addChunk` pipeline. Same
backend, better transcription, fully NVIDIA stack.

### Nebius API wiring

```typescript
// convex/analysis.ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const nebius = createOpenAICompatible({
  name: "nebius",
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  headers: {
    Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
  },
});

// L1: Nano for speed
const nanoModel = nebius.chatModel(
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
);

// L2 + L3: Super for reasoning depth + 1M context
const superModel = nebius.chatModel(
  "nvidia/nemotron-3-super-120b-a12b"
);
```

### Why Convex

- **Zero-config real-time**: queries auto-update on every connected client when
  data changes. No WebSockets, SSE, or polling to wire up.
- **Built-in scheduler**: mutations schedule actions after 0ms delay. Perfect
  for orchestrating L1 → L2 → L3 tier progression.
- **Actions for external APIs**: Convex actions can `fetch` Nemotron and Tavily,
  then schedule mutations to write results back. The sync engine handles the rest.
- **Persistent text streaming**: the `@convex-dev/persistent-text-streaming`
  component streams LLM output to clients via HTTP while persisting to the DB.
  Clients that join late or reconnect get the full text instantly.
- **Type-safe end-to-end**: schema → server functions → React hooks, all typed.
- **Hackathon speed**: no infra to provision. `npx convex dev` and go.

---

## Architecture

```
              ┌─────────────────────────────────────┐
              │          Content Input               │
              │   ┌──────────┐    ┌──────────────┐  │
              │   │  Paste   │    │  Live Mic    │  │
              │   │  text    │    │  (Web Speech │  │
              │   │          │    │   API)       │  │
              │   └────┬─────┘    └──────┬───────┘  │
              │        │                 │          │
              │        │    ┌────────────▼───────┐  │
              │        │    │ SpeechRecognition  │  │
              │        │    │ continuous: true    │  │
              │        │    │ interimResults: true│  │
              │        │    └────────────┬───────┘  │
              │        │                 │          │
              │        │         interim → local    │
              │        │         state (live text)  │
              │        │                 │          │
              │        │         isFinal → accumulate│
              │        │                 │          │
              │        │    ┌────────────▼───────┐  │
              │        │    │ Chunk Buffer       │  │
              │        │    │ flush every ~15s   │  │
              │        │    │ or ~80 words       │  │
              │        └──▶ └────────────┬───────┘  │
              └──────────────────────────┼──────────┘
                                         │
                                chunk text string
                                         │
                                +--------v---------+
                                | Convex Mutation   |
                                | addChunk()        |
                                +--+------+-----+--+
                       |      |     |
              schedule |      |     | schedule (if
              always   |      |     | chunkCount >= 6)
                       v      |     v
                  +----+--+   |  +--+--------+
                  |  L1   |   |  |   L3      |
                  | Action|   |  |  Action   |
                  | pulse |   |  | patterns  |
                  +---+---+   |  +-----+-----+
                      |       |        |
                      v       |        v
                  mutation:   |   mutation:
                  writePulse  |   writePatterns
                              |
                     schedule (if chunkCount % 3 == 0)
                              |
                         +----v----+
                         |   L2    |
                         |  Action |
                         | analyze |
                         +----+----+
                              |
                              v
                         mutation:
                         writeAnalysis

        All mutations write to Convex DB
             ↓ reactive queries ↓
        +----v-------------------v----+
        |      Next.js Frontend       |
        |  useQuery() auto-updates    |
        +-----------------------------+
```

### How it flows

1. User pastes text or speaks → frontend calls `addChunk` mutation.
2. `addChunk` inserts chunk into DB, increments session chunk count, and
   uses `ctx.scheduler.runAfter(0, ...)` to schedule the appropriate actions.
3. **L1 always fires.** L2 fires every 3rd chunk. L3 fires after 6+ chunks.
4. Each action calls Nemotron (and Tavily for L2), then schedules a mutation
   to write results.
5. The mutation writes to the DB. Connected clients subscribed via `useQuery`
   see updates instantly -- no additional plumbing needed.

---

## Voice Input (Live Demo Mode)

The live demo mode uses the browser's built-in **Web Speech API** -- zero API
keys, zero dependencies. Chrome and Edge have the best support.

### How it works

```
User speaks
    │
    ▼
SpeechRecognition (continuous: true, interimResults: true)
    │
    ├── interim results ──▶ render in transcript area immediately (local state)
    │                       gives user real-time feedback as they speak
    │
    └── final results ────▶ accumulate in chunk buffer (React ref)
                            │
                            ├── 15-second timer fires OR buffer hits ~80 words
                            │
                            ▼
                    flush buffer → addChunk({ sessionId, text })
                            │
                            ▼
                    L1 fires immediately (< 1s)
                    L2 fires every 3rd chunk
                    L3 fires after 6+ chunks
```

### Voice hook (app/hooks/useVoiceInput.ts)

```typescript
// app/hooks/useVoiceInput.ts
"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseVoiceInputOptions {
  onChunkReady: (text: string) => void;
  chunkIntervalMs?: number;
  maxWordsPerChunk?: number;
}

export function useVoiceInput({
  onChunkReady,
  chunkIntervalMs = 15_000,
  maxWordsPerChunk = 80,
}: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [fullTranscript, setFullTranscript] = useState("");
  const bufferRef = useRef("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const flush = useCallback(() => {
    const text = bufferRef.current.trim();
    if (text.length === 0) return;
    onChunkReady(text);
    setFullTranscript((prev) => prev + (prev ? "\n\n" : "") + text);
    bufferRef.current = "";
  }, [onChunkReady]);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          bufferRef.current += transcript + " ";
          // Auto-flush if word count exceeded
          if (bufferRef.current.split(/\s+/).length >= maxWordsPerChunk) {
            flush();
          }
        } else {
          interim += transcript;
        }
      }
      setInterimText(interim);
    };

    // Chrome cuts off after ~60s; auto-restart
    recognition.onend = () => {
      if (recognitionRef.current) {
        recognition.start();
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);

    // Periodic flush timer
    timerRef.current = setInterval(flush, chunkIntervalMs);
  }, [flush, chunkIntervalMs, maxWordsPerChunk]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    clearInterval(timerRef.current);
    flush(); // flush remaining buffer
    setIsListening(false);
    setInterimText("");
  }, [flush]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      clearInterval(timerRef.current);
    };
  }, []);

  return { isListening, interimText, fullTranscript, start, stop };
}
```

### Wiring it to Convex

```typescript
// In TranscriptInput.tsx
const addChunk = useMutation(api.chunks.addChunk);

const { isListening, interimText, fullTranscript, start, stop } =
  useVoiceInput({
    onChunkReady: (text) => {
      addChunk({ sessionId, text });
    },
  });
```

One function call. The user speaks, the buffer flushes, `addChunk` fires, L1
runs, results appear -- all reactive, no polling.

### Two input modes

| Mode | Source | Chunking | Use case |
|---|---|---|---|
| **Paste** | User pastes full text | Split into ~200-word segments client-side | Analyzing articles, transcripts |
| **Live Mic** | Web Speech API | Time-based (15s) + word-count (80w) | Live talks, pitches, podcasts |

Both modes feed the same `addChunk` mutation. The backend doesn't know or care
which input mode produced the chunk.

---

## Convex Schema

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    title: v.optional(v.string()),
    chunkCount: v.number(),
    status: v.union(v.literal("active"), v.literal("complete")),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  chunks: defineTable({
    sessionId: v.id("sessions"),
    index: v.number(),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_session", ["sessionId", "index"]),

  pulseResults: defineTable({
    sessionId: v.id("sessions"),
    chunkId: v.id("chunks"),
    chunkIndex: v.number(),
    claims: v.array(v.string()),
    flags: v.array(
      v.object({
        type: v.union(
          v.literal("vague"),
          v.literal("stat"),
          v.literal("prediction"),
          v.literal("attribution"),
          v.literal("logic"),
          v.literal("contradiction")
        ),
        label: v.string(),
      })
    ),
    tone: v.string(),
    confidence: v.number(),
  }).index("by_session", ["sessionId", "chunkIndex"]),

  analysisResults: defineTable({
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
    tldr: v.string(),
    corePoints: v.array(v.string()),
    underlyingStatement: v.string(),
    evidenceTable: v.array(
      v.object({ claim: v.string(), evidence: v.string() })
    ),
    appeals: v.object({
      ethos: v.string(),
      pathos: v.string(),
      logos: v.string(),
    }),
    assumptions: v.array(v.string()),
    steelman: v.string(),
    missing: v.array(v.string()),
  }).index("by_session", ["sessionId", "triggerChunkIndex"]),

  patternResults: defineTable({
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
    patterns: v.array(
      v.object({
        type: v.union(
          v.literal("escalation"),
          v.literal("contradiction"),
          v.literal("narrative-arc"),
          v.literal("cherry-picking")
        ),
        description: v.string(),
      })
    ),
    trustTrajectory: v.array(v.number()),
    overallAssessment: v.string(),
  }).index("by_session", ["sessionId"]),
});
```

---

## Convex Functions

### Mutations (convex/sessions.ts)

```typescript
// convex/sessions.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("sessions", {
      chunkCount: 0,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});
```

### Mutations (convex/chunks.ts)

```typescript
// convex/chunks.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const addChunk = mutation({
  args: {
    sessionId: v.id("sessions"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");

    const chunkIndex = session.chunkCount;

    const chunkId = await ctx.db.insert("chunks", {
      sessionId: args.sessionId,
      index: chunkIndex,
      text: args.text,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.sessionId, {
      chunkCount: chunkIndex + 1,
    });

    // L1: always fire
    await ctx.scheduler.runAfter(0, internal.analysis.runPulse, {
      sessionId: args.sessionId,
      chunkId,
      chunkIndex,
      text: args.text,
    });

    // L2: every 3 chunks (starting at chunk index 2)
    if ((chunkIndex + 1) % 3 === 0) {
      await ctx.scheduler.runAfter(0, internal.analysis.runAnalysis, {
        sessionId: args.sessionId,
        triggerChunkIndex: chunkIndex,
      });
    }

    // L3: after 6+ chunks, every 3rd chunk
    if (chunkIndex >= 5 && (chunkIndex + 1) % 3 === 0) {
      await ctx.scheduler.runAfter(0, internal.analysis.runPatterns, {
        sessionId: args.sessionId,
        triggerChunkIndex: chunkIndex,
      });
    }

    return chunkId;
  },
});

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});
```

### Actions (convex/analysis.ts)

```typescript
// convex/analysis.ts
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const nebius = createOpenAICompatible({
  name: "nebius",
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  headers: {
    Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
  },
});

// Nano for L1: 3B active params, sub-second structured output
const nanoModel = nebius.chatModel("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B");

// Super for L2 + L3: reasoning depth, tool calling, 1M context
const superModel = nebius.chatModel("nvidia/nemotron-3-super-120b-a12b");

// ── L1 Pulse ──────────────────────────────────────────────
export const runPulse = internalAction({
  args: {
    sessionId: v.id("sessions"),
    chunkId: v.id("chunks"),
    chunkIndex: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { object } = await generateObject({
      model: nanoModel,
      schema: z.object({
        claims: z.array(z.string()),
        flags: z.array(
          z.object({
            type: z.enum([
              "vague", "stat", "prediction",
              "attribution", "logic", "contradiction",
            ]),
            label: z.string(),
          })
        ),
        tone: z.string(),
        confidence: z.number().min(0).max(1),
      }),
      system: `You are a real-time claim analyzer. Given a transcript segment, identify claims, flag issues, assess tone and confidence.`,
      prompt: args.text,
    });

    await ctx.runMutation(internal.results.writePulse, {
      sessionId: args.sessionId,
      chunkId: args.chunkId,
      chunkIndex: args.chunkIndex,
      ...object,
    });
  },
});

// ── L2 Analysis ───────────────────────────────────────────
export const runAnalysis = internalAction({
  args: {
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const chunks = await ctx.runQuery(internal.results.getChunksForSession, {
      sessionId: args.sessionId,
    });
    const transcript = chunks.map((c) => c.text).join("\n\n");

    // Tavily verification for top claims
    const searchResults = await searchTavily(transcript.slice(0, 500));

    const { object } = await generateObject({
      model: superModel,
      schema: z.object({
        tldr: z.string(),
        corePoints: z.array(z.string()),
        underlyingStatement: z.string(),
        evidenceTable: z.array(
          z.object({ claim: z.string(), evidence: z.string() })
        ),
        appeals: z.object({
          ethos: z.string(),
          pathos: z.string(),
          logos: z.string(),
        }),
        assumptions: z.array(z.string()),
        steelman: z.string(),
        missing: z.array(z.string()),
      }),
      system: `You are a rhetorical analyst. Given transcript segments and search results for verification, produce a structured analysis.`,
      prompt: `Transcript:\n${transcript}\n\nVerification results:\n${JSON.stringify(searchResults)}`,
    });

    await ctx.runMutation(internal.results.writeAnalysis, {
      sessionId: args.sessionId,
      triggerChunkIndex: args.triggerChunkIndex,
      ...object,
    });
  },
});

// ── L3 Patterns ───────────────────────────────────────────
export const runPatterns = internalAction({
  args: {
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const chunks = await ctx.runQuery(internal.results.getChunksForSession, {
      sessionId: args.sessionId,
    });
    const fullTranscript = chunks.map((c) => c.text).join("\n\n");

    const { object } = await generateObject({
      model: superModel,
      schema: z.object({
        patterns: z.array(
          z.object({
            type: z.enum([
              "escalation", "contradiction",
              "narrative-arc", "cherry-picking",
            ]),
            description: z.string(),
          })
        ),
        trustTrajectory: z.array(z.number()),
        overallAssessment: z.string(),
      }),
      system: `You are a pattern detection system. Given the full transcript, identify cross-claim patterns, contradictions, narrative arcs, and confidence trajectory.`,
      prompt: fullTranscript,
    });

    await ctx.runMutation(internal.results.writePatterns, {
      sessionId: args.sessionId,
      triggerChunkIndex: args.triggerChunkIndex,
      ...object,
    });
  },
});

// ── Tavily helper ─────────────────────────────────────────
async function searchTavily(query: string) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
    }),
  });
  return res.json();
}
```

### Result mutations + queries (convex/results.ts)

```typescript
// convex/results.ts
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

// ── Internal writes (called by actions) ───────────────────
export const writePulse = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    chunkId: v.id("chunks"),
    chunkIndex: v.number(),
    claims: v.array(v.string()),
    flags: v.array(
      v.object({
        type: v.union(
          v.literal("vague"),
          v.literal("stat"),
          v.literal("prediction"),
          v.literal("attribution"),
          v.literal("logic"),
          v.literal("contradiction")
        ),
        label: v.string(),
      })
    ),
    tone: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pulseResults", args);
  },
});

export const writeAnalysis = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
    tldr: v.string(),
    corePoints: v.array(v.string()),
    underlyingStatement: v.string(),
    evidenceTable: v.array(
      v.object({ claim: v.string(), evidence: v.string() })
    ),
    appeals: v.object({
      ethos: v.string(),
      pathos: v.string(),
      logos: v.string(),
    }),
    assumptions: v.array(v.string()),
    steelman: v.string(),
    missing: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("analysisResults", args);
  },
});

export const writePatterns = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
    patterns: v.array(
      v.object({
        type: v.union(
          v.literal("escalation"),
          v.literal("contradiction"),
          v.literal("narrative-arc"),
          v.literal("cherry-picking")
        ),
        description: v.string(),
      })
    ),
    trustTrajectory: v.array(v.number()),
    overallAssessment: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("patternResults", args);
  },
});

// ── Internal query (used by actions to read chunks) ───────
export const getChunksForSession = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

// ── Public queries (subscribed to by frontend) ────────────
export const listPulses = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pulseResults")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const listAnalyses = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("analysisResults")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const listPatterns = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("patternResults")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});
```

---

## Frontend Structure

```
app/
  layout.tsx                -- root layout, wraps <ConvexProvider>
  ConvexClientProvider.tsx  -- "use client" provider with ConvexReactClient
  page.tsx                  -- main layout, two-panel (input | analysis)
  hooks/
    useVoiceInput.ts        -- Web Speech API hook with chunking + auto-flush
  components/
    TranscriptInput.tsx     -- paste area + live mic toggle, uses useVoiceInput
    PulseFeed.tsx           -- scrolling L1 results (useQuery subscriptions)
    AnalysisPanel.tsx       -- L2 expandable sections
    PatternsPanel.tsx       -- L3 trajectory + patterns
    ConfidenceMeter.tsx     -- small inline confidence bar
    Flag.tsx                -- claim flag badge
convex/
  schema.ts                -- table definitions + indexes
  sessions.ts              -- create/get session mutations/queries
  chunks.ts                -- addChunk mutation + listBySession query
  analysis.ts              -- "use node" actions (L1, L2, L3)
  results.ts               -- write mutations + read queries for results
```

### Frontend Wiring (key hooks)

```typescript
// In PulseFeed.tsx
const pulses = useQuery(api.results.listPulses, { sessionId });
// Automatically re-renders when a new pulse is written by L1 action

// In AnalysisPanel.tsx
const analyses = useQuery(api.results.listAnalyses, { sessionId });
// Automatically re-renders when L2 writes a new analysis

// In PatternsPanel.tsx
const patterns = useQuery(api.results.listPatterns, { sessionId });
// Automatically re-renders when L3 writes new patterns

// Submitting a chunk
const addChunk = useMutation(api.chunks.addChunk);
await addChunk({ sessionId, text: chunkText });
// This single call triggers the entire L1/L2/L3 pipeline
```

### Design Language

Inspired by Factory AI. No decoration, no gradients, no rounded corners
on cards. The information is the interface.

```
Font:        JetBrains Mono (monospace throughout)
Background:  #0a0a0a (near black)
Surface:     #141414 (panels)
Border:      #222222 (1px solid, sharp corners)
Text:        #e5e5e5 (primary), #666666 (secondary)
Accent:      #ff4400 (warnings/flags only)
Green:       #00cc66 (supported claims only)
Yellow:      #ffaa00 (partial support only)
```

No color for decoration. Color only carries meaning.

---

## L1 / L2 / L3 Detail

### L1 -- Pulse (real-time, <1s response)

Fires on every chunk. Lightweight structured output.

- Triggered by: `ctx.scheduler.runAfter(0, internal.analysis.runPulse, ...)`
- Model: **Nemotron 3 Nano** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) — 3B active params, optimized for speed
- Method: `generateObject` from Vercel AI SDK with Zod schema
- Output: `{ claims[], flags[], tone, confidence }`
- Persistence: written to `pulseResults` table via `writePulse` mutation
- Rendering: inline badges below each transcript segment, auto-updated by `useQuery`
- No tool use. Pure inference speed.

### L2 -- Analysis (5-15s, background)

Fires after every 3rd chunk. Full rhetorical breakdown.

- Triggered by: `ctx.scheduler.runAfter(0, internal.analysis.runAnalysis, ...)`
- Model: **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) — reasoning model, tool calling
- Tool: Tavily search for claim verification (direct `fetch` in action)
- Method: `generateObject` with full analysis schema
- Output: structured analysis object (tldr, corePoints, evidenceTable, appeals, etc.)
- Persistence: written to `analysisResults` table via `writeAnalysis` mutation
- Rendering: expandable panels in Analysis tab, auto-updated by `useQuery`

### L3 -- Accumulate (ongoing, leverages 1M context)

Fires after 6+ chunks, every 3rd chunk. Sends full session transcript.

- Triggered by: `ctx.scheduler.runAfter(0, internal.analysis.runPatterns, ...)`
- Model: **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) — 1M context window
- Context: entire accumulated transcript (this is the 1M window play)
- Method: `generateObject` with patterns schema
- Output: patterns array, trust trajectory, overall assessment
- Persistence: written to `patternResults` table via `writePatterns` mutation
- Rendering: Patterns tab with trajectory chart, auto-updated by `useQuery`

---

## Build Sequence (2 hours)

```
00:00 - 00:15   Scaffold Next.js, install deps, npx convex dev, wire provider
00:15 - 00:30   Schema + addChunk mutation + L1 runPulse action + writePulse
00:30 - 00:45   PulseFeed component with useQuery, test full L1 loop
00:45 - 01:00   L2 runAnalysis action with Tavily + AnalysisPanel
01:00 - 01:15   L3 runPatterns action + PatternsPanel with trajectory
01:15 - 01:35   UI polish, connect tabs, confidence meter, demo content
01:35 - 01:50   Test full L1→L2→L3 flow, fix edge cases
01:50 - 02:00   Prep demo, record if needed
```

---

## Prompts (condensed)

### L1 System Prompt

```
You are a real-time claim analyzer. Given a transcript segment, identify
claims, flag issues, assess tone and confidence. Return structured data only.

Flag types:
- vague: no specifics given
- stat: statistic without source or methodology
- prediction: unfalsifiable future claim
- attribution: unnamed or unverifiable source
- logic: logical fallacy or non-sequitur
- contradiction: conflicts with earlier claims
```

### L2 System Prompt

```
You are a rhetorical analyst. Given accumulated transcript segments and
Tavily search results for verification, produce a structured analysis
covering: TLDR, core points, underlying statement, evidence table,
rhetorical appeals (ethos/pathos/logos), assumptions, steelman argument,
and missing evidence.
```

### L3 System Prompt

```
You are a pattern detection system. Given the full transcript of a
session, identify cross-claim patterns, contradictions, narrative arcs,
and confidence trajectory. Types: escalation, contradiction,
narrative-arc, cherry-picking.
```

---

## Demo Script

### Option A: Live Voice (strongest demo)

1. Click "Start Listening" and begin speaking or play a video/podcast
2. Transcript appears word-by-word in real-time (interim results from Web Speech API)
3. Every ~15 seconds, a chunk flushes -- L1 flags appear inline within a second
4. After 3 chunks (~45 seconds), L2 analysis panel populates with verified claims
5. After 6 chunks (~90 seconds), L3 patterns tab lights up with trajectory
6. Pitch: "I'm speaking right now and the system is analyzing me in real time.
   Nemotron Nano fires L1 on every chunk in under a second. Nemotron Super
   handles deep analysis with its 1M context window -- the entire Nemotron 3
   family just dropped at GTC this week. Convex handles the real-time sync.
   No WebSockets, no polling. Every result streams to every connected client
   the instant it's written to the database."

### Option B: Paste (fallback / faster demo)

1. Paste a transcript from a recent tech keynote or product launch
2. Text auto-chunks and L1/L2/L3 results cascade in
3. Same analysis panels, faster to demonstrate full L3 patterns

---

## Dependencies

```json
{
  "dependencies": {
    "next": "latest",
    "react": "latest",
    "convex": "latest",
    "ai": "latest",
    "@ai-sdk/openai-compatible": "latest",
    "zod": "latest"
  }
}
```

Tavily is a simple REST call inside Convex actions. No SDK needed.

---

## Environment Variables

```
NEBIUS_API_KEY=       # Nebius Token Factory (set in Convex dashboard)
TAVILY_API_KEY=       # Tavily search (set in Convex dashboard)
NEXT_PUBLIC_CONVEX_URL=  # from npx convex dev
```

---

## What changed from v1

| Concern | Before (v1) | Now (Convex) |
|---|---|---|
| API routes | 3 Next.js POST routes | 0 -- Convex mutations/actions replace them |
| Real-time updates | Client polling or SSE | Automatic via `useQuery` subscriptions |
| Orchestration | Manual in route handlers | `ctx.scheduler.runAfter` in mutations |
| Persistence | None (stateless routes) | Every result stored in Convex DB |
| External API calls | Next.js server actions | Convex `"use node"` actions with `fetch` |
| Type safety | Manual Zod parsing | Schema-validated DB + typed function args |
| Infrastructure | Vercel serverless | Convex Cloud (backend) + Vercel (frontend) |
| Streaming LLM output | `streamText` via SSE | `generateObject` → write to DB → reactive query |

That is the entire stack. Two API keys. Two Nemotron models. Three thinking levels. Zero API routes.
