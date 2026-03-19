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

| Model | Params | Use in TruthLens | Where |
|---|---|---|---|
| **Nemotron Speech ASR** | 0.6B | Voice → text transcription, sub-100ms streaming latency | NIM Cloud (build.nvidia.com) |
| **Nemotron 3 Nano** | 30B (3B active) | L1 Pulse — fast structured output, <1s | Nebius Token Factory |
| **Nemotron 3 Super** | 120B (12B active) | L2 Analysis + L3 Patterns — deep reasoning, 1M context | Nebius Token Factory |

**The all-Nemotron pitch:**
Three Nemotron models, three analysis tiers, one ecosystem.
- ASR (0.6B) converts voice to text in real time
- Nano (3B active) flags claims in under a second
- Super (12B active) reasons deeply with 1M tokens of context
- All open weights, all NVIDIA, all running concurrently

### Models to be aware of (announced GTC 2026)

| Model | What it does | Status | Relevance |
|---|---|---|---|
| **Nemotron 3 Ultra** | ~500B frontier model, 5x throughput on Blackwell | Coming soon | Could replace Super for L2/L3 if available |
| **Nemotron 3 Omni** | Multimodal: audio + vision + language in one model | Announced, not yet released | Future: direct audio-in claim analysis, no ASR step needed |
| **Nemotron 3 VoiceChat** | 12B end-to-end speech-to-speech, full duplex | Free endpoint on build.nvidia.com (early access) | Future: conversational TruthLens that talks back |
| **Nemotron ASR Streaming** | 600M streaming speech-to-text, 80ms chunks | Available (NIM, downloadable) | Alternative to Web Speech API — more accurate, NVIDIA-native |

### Voice input strategy

**Primary: NIM ASR (all-Nemotron stack)**

```
Browser mic → getUserMedia → MediaRecorder (10s WebM/Opus chunks)
    → POST audio blob to /api/transcribe (thin Next.js proxy)
    → NIM Cloud ASR (grpc.nvcf.nvidia.com:443)
    → text chunk returned to browser
    → addChunk() Convex mutation → L1/L2/L3
```

This is the one place we keep a Next.js API route -- binary audio blobs
are awkward to pass through Convex mutations. The route is a thin proxy:
receive audio, forward to NIM, return text. All analysis stays in Convex.

**Fallback: Web Speech API**

If the NIM endpoint is unavailable or the user doesn't have an NVIDIA API key,
the hook falls back to the browser's `SpeechRecognition` API. Same `addChunk`
mutation, same pipeline.

```
Fallback:            Browser mic → Web Speech API → text chunks → addChunk()
Future (announced):  Browser mic → audio → Nemotron 3 Omni → direct analysis
```

### Provider Configuration

```typescript
// convex/analysis.ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const nebius = createOpenAICompatible({
  name: "nebius",
  apiKey: process.env.NEBIUS_API_KEY,
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  supportsStructuredOutputs: true,
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

**Critical config notes:**

- **`apiKey`** -- use this instead of manually setting `Authorization` headers.
  The provider auto-adds `Bearer <key>`. Set the key in the Convex dashboard,
  not in `.env` files (Convex actions run on Convex Cloud, not your machine).
- **`supportsStructuredOutputs: true`** -- tells the AI SDK that Nebius supports
  native `json_schema` response format. Without this, the SDK falls back to
  tool-based extraction which is slower and less reliable with Nemotron models.
- **`baseURL` trailing slash** -- Nebius requires it: `https://api.tokenfactory.nebius.com/v1/`

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

Primary voice mode uses **Nemotron Speech ASR** via NIM Cloud for server-side
transcription. Falls back to the browser's Web Speech API if NIM is unavailable.

### How it works

```
User speaks
    │
    ▼
getUserMedia({ audio: true })
    │
    ▼
MediaRecorder (timeslice: 10000ms, WebM/Opus)
    │
    ├── ondataavailable every ~10s ──▶ audio blob
    │                                      │
    │                                POST /api/transcribe
    │                                      │
    │                               NIM Cloud ASR (gRPC)
    │                                      │
    │                               text chunk returned
    │                                      │
    │                          addChunk({ sessionId, text })
    │                                      │
    │                               L1 fires immediately
    │                               L2 every 3rd chunk
    │                               L3 after 6+ chunks
    │
    └── (during wait) ──▶ show recording indicator / waveform
```

Voice segments ARE the text chunks. Each ~10 second audio blob becomes one
text chunk. No `splitIntoChunks` needed -- the MediaRecorder timeslice creates
the chunking naturally.

### NIM ASR Cloud Integration

The transcription route is the one Next.js API route in the stack. It proxies
audio blobs to NVIDIA's NIM Cloud ASR endpoint via gRPC.

```typescript
// app/api/transcribe/route.ts
// Thin proxy: receive audio blob, forward to NIM ASR, return text.
// This stays as a Next.js route because binary audio is awkward in Convex
// mutations. All analysis logic remains in Convex.

import { credentials } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

export async function POST(request: Request) {
  const formData = await request.formData();
  const audioFile = formData.get("audio") as File;
  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

  const text = await transcribeWithNIM(audioBuffer);

  return Response.json({ text });
}

async function transcribeWithNIM(audioBuffer: Buffer): Promise<string> {
  // gRPC call to NIM Cloud ASR at grpc.nvcf.nvidia.com:443
  // Uses Riva ASR proto definitions
  // Auth: Bearer ${NVIDIA_API_KEY} in gRPC metadata
  // Returns transcribed text with punctuation + capitalization
  // ...
}
```

**NIM Cloud ASR details:**
- Endpoint: `grpc.nvcf.nvidia.com:443`
- Auth: `Bearer ${NVIDIA_API_KEY}` in gRPC metadata
- Model: Nemotron Speech ASR Streaming (0.6B)
- Input: 16kHz audio (WebM/Opus from MediaRecorder)
- Output: text with punctuation and capitalization
- Latency: sub-100ms per chunk
- Requires: `@grpc/grpc-js`, `@grpc/proto-loader`, Riva proto files

### Voice hook (app/hooks/useVoiceInput.ts)

```typescript
// app/hooks/useVoiceInput.ts
"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseVoiceInputOptions {
  onChunkReady: (text: string) => void;
  useNimAsr?: boolean;
  chunkIntervalMs?: number;
}

export function useVoiceInput({
  onChunkReady,
  useNimAsr = true,
  chunkIntervalMs = 10_000,
}: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [fullTranscript, setFullTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // ── Primary: MediaRecorder → NIM ASR ────────────────────
  const startNimAsr = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    recorder.ondataavailable = async (event) => {
      if (event.data.size === 0) return;
      setIsTranscribing(true);

      const formData = new FormData();
      formData.append("audio", event.data, "chunk.webm");

      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });
        const { text } = await res.json();
        if (text?.trim()) {
          onChunkReady(text.trim());
          setFullTranscript((prev) =>
            prev + (prev ? "\n\n" : "") + text.trim()
          );
        }
      } finally {
        setIsTranscribing(false);
      }
    };

    recorder.start(chunkIntervalMs);
    mediaRecorderRef.current = recorder;
    setIsListening(true);
  }, [onChunkReady, chunkIntervalMs]);

  // ── Fallback: Web Speech API ────────────────────────────
  const startWebSpeech = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    let buffer = "";
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          buffer += event.results[i][0].transcript + " ";
        }
      }
    };

    // Flush buffer periodically
    const timer = setInterval(() => {
      if (buffer.trim()) {
        onChunkReady(buffer.trim());
        setFullTranscript((prev) =>
          prev + (prev ? "\n\n" : "") + buffer.trim()
        );
        buffer = "";
      }
    }, chunkIntervalMs);

    recognition.onend = () => {
      if (recognitionRef.current) recognition.start();
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);

    return () => clearInterval(timer);
  }, [onChunkReady, chunkIntervalMs]);

  const start = useCallback(async () => {
    if (useNimAsr) {
      await startNimAsr();
    } else {
      startWebSpeech();
    }
  }, [useNimAsr, startNimAsr, startWebSpeech]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((t) => t.stop());
      mediaRecorderRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { isListening, isTranscribing, fullTranscript, start, stop };
}
```

### Wiring it to Convex

```typescript
// In TranscriptInput.tsx
const addChunk = useMutation(api.chunks.addChunk);

const { isListening, isTranscribing, fullTranscript, start, stop } =
  useVoiceInput({
    useNimAsr: true, // set false to fallback to Web Speech API
    onChunkReady: (text) => {
      addChunk({ sessionId, text });
    },
  });
```

Each 10-second audio blob becomes one text chunk. `addChunk` fires, L1 runs,
results appear -- all reactive, no polling.

### Two input modes

| Mode | Source | Chunking | Use case |
|---|---|---|---|
| **Paste** | User pastes full text | Split into ~200-word segments client-side | Analyzing articles, transcripts |
| **Live Mic** | MediaRecorder → NIM ASR (or Web Speech API fallback) | 10s audio chunks → text | Live talks, pitches, podcasts |

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

### Mutations + Queries (convex/sessions.ts)

```typescript
// convex/sessions.ts — NO "use node" (queries + mutations only)
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {},
  returns: v.id("sessions"),
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
  returns: v.union(
    v.object({
      _id: v.id("sessions"),
      _creationTime: v.number(),
      title: v.optional(v.string()),
      chunkCount: v.number(),
      status: v.union(v.literal("active"), v.literal("complete")),
      createdAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});
```

### Mutations + Queries (convex/chunks.ts)

```typescript
// convex/chunks.ts — NO "use node" (queries + mutations only)
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const addChunk = mutation({
  args: {
    sessionId: v.id("sessions"),
    text: v.string(),
  },
  returns: v.id("chunks"),
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
  returns: v.array(v.object({
    _id: v.id("chunks"),
    _creationTime: v.number(),
    sessionId: v.id("sessions"),
    index: v.number(),
    text: v.string(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});
```

### Actions (convex/analysis.ts) — `"use node"` file, actions ONLY

```typescript
// convex/analysis.ts
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

// ── Provider setup ────────────────────────────────────────
// apiKey auto-adds Authorization: Bearer header.
// supportsStructuredOutputs tells the SDK to use Nebius's native
// json_schema response_format instead of tool-based fallback.
const nebius = createOpenAICompatible({
  name: "nebius",
  apiKey: process.env.NEBIUS_API_KEY,
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  supportsStructuredOutputs: true,
});

const nanoModel = nebius.chatModel("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B");
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
    const { output } = await generateText({
      model: nanoModel,
      output: Output.object({
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
      }),
      system: `You are a real-time claim analyzer. Given a transcript segment, identify claims, flag issues, assess tone and confidence.`,
      prompt: args.text,
    });

    if (!output) throw new Error("L1 returned no structured output");

    await ctx.runMutation(internal.results.writePulse, {
      sessionId: args.sessionId,
      chunkId: args.chunkId,
      chunkIndex: args.chunkIndex,
      ...output,
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

    const searchResults = await searchTavily(transcript.slice(0, 500));

    const { output } = await generateText({
      model: superModel,
      output: Output.object({
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
      }),
      system: `You are a rhetorical analyst. Given transcript segments and search results for verification, produce a structured analysis.`,
      prompt: `Transcript:\n${transcript}\n\nVerification results:\n${JSON.stringify(searchResults)}`,
    });

    if (!output) throw new Error("L2 returned no structured output");

    await ctx.runMutation(internal.results.writeAnalysis, {
      sessionId: args.sessionId,
      triggerChunkIndex: args.triggerChunkIndex,
      ...output,
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

    const { output } = await generateText({
      model: superModel,
      output: Output.object({
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
      }),
      system: `You are a pattern detection system. Given the full transcript, identify cross-claim patterns, contradictions, narrative arcs, and confidence trajectory.`,
      prompt: fullTranscript,
    });

    if (!output) throw new Error("L3 returned no structured output");

    await ctx.runMutation(internal.results.writePatterns, {
      sessionId: args.sessionId,
      triggerChunkIndex: args.triggerChunkIndex,
      ...output,
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
// convex/results.ts — NO "use node" (queries + mutations only)
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

// ── Shared validators (DRY) ──────────────────────────────
const flagValidator = v.object({
  type: v.union(
    v.literal("vague"),
    v.literal("stat"),
    v.literal("prediction"),
    v.literal("attribution"),
    v.literal("logic"),
    v.literal("contradiction")
  ),
  label: v.string(),
});

const patternValidator = v.object({
  type: v.union(
    v.literal("escalation"),
    v.literal("contradiction"),
    v.literal("narrative-arc"),
    v.literal("cherry-picking")
  ),
  description: v.string(),
});

// ── Internal writes (called by actions via ctx.runMutation) ──
export const writePulse = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    chunkId: v.id("chunks"),
    chunkIndex: v.number(),
    claims: v.array(v.string()),
    flags: v.array(flagValidator),
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
    patterns: v.array(patternValidator),
    trustTrajectory: v.array(v.number()),
    overallAssessment: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("patternResults", args);
  },
});

// ── Internal query (used by actions via ctx.runQuery) ─────
export const getChunksForSession = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

// ── Public queries (subscribed to by frontend via useQuery) ──
export const listPulses = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(v.object({
    _id: v.id("pulseResults"),
    _creationTime: v.number(),
    sessionId: v.id("sessions"),
    chunkId: v.id("chunks"),
    chunkIndex: v.number(),
    claims: v.array(v.string()),
    flags: v.array(flagValidator),
    tone: v.string(),
    confidence: v.number(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pulseResults")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const listAnalyses = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(v.object({
    _id: v.id("analysisResults"),
    _creationTime: v.number(),
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
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("analysisResults")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const listPatterns = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(v.object({
    _id: v.id("patternResults"),
    _creationTime: v.number(),
    sessionId: v.id("sessions"),
    triggerChunkIndex: v.number(),
    patterns: v.array(patternValidator),
    trustTrajectory: v.array(v.number()),
    overallAssessment: v.string(),
  })),
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
  api/
    transcribe/
      route.ts              -- thin proxy: audio blob → NIM ASR gRPC → text
  hooks/
    useVoiceInput.ts        -- MediaRecorder + NIM ASR primary, Web Speech fallback
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
protos/
  riva_asr.proto            -- Riva ASR proto definitions (from nvidia-riva/common)
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
- Method: `generateText` + `Output.object()` (AI SDK v6) with Zod schema
- Output: `{ claims[], flags[], tone, confidence }`
- Persistence: written to `pulseResults` table via `writePulse` mutation
- Rendering: inline badges below each transcript segment, auto-updated by `useQuery`
- No tool use. Pure inference speed.

### L2 -- Analysis (5-15s, background)

Fires after every 3rd chunk. Full rhetorical breakdown.

- Triggered by: `ctx.scheduler.runAfter(0, internal.analysis.runAnalysis, ...)`
- Model: **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) — reasoning model, tool calling
- Tool: Tavily search for claim verification (direct `fetch` in action)
- Method: `generateText` + `Output.object()` with full analysis schema
- Output: structured analysis object (tldr, corePoints, evidenceTable, appeals, etc.)
- Persistence: written to `analysisResults` table via `writeAnalysis` mutation
- Rendering: expandable panels in Analysis tab, auto-updated by `useQuery`

### L3 -- Accumulate (ongoing, leverages 1M context)

Fires after 6+ chunks, every 3rd chunk. Sends full session transcript.

- Triggered by: `ctx.scheduler.runAfter(0, internal.analysis.runPatterns, ...)`
- Model: **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) — 1M context window
- Context: entire accumulated transcript (this is the 1M window play)
- Method: `generateText` + `Output.object()` with patterns schema
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
2. Every ~10 seconds, an audio chunk is sent to Nemotron ASR for transcription
3. Transcribed text appears in the transcript panel, L1 flags appear inline within a second
4. After 3 chunks (~30 seconds), L2 analysis panel populates with verified claims
5. After 6 chunks (~60 seconds), L3 patterns tab lights up with trajectory
6. Pitch: "I'm speaking right now and the system is analyzing me in real time.
   Three Nemotron models running concurrently: Nemotron Speech ASR transcribes
   my voice, Nemotron Nano flags claims in under a second, and Nemotron Super
   runs deep analysis with its 1M context window. Three models, three tiers,
   all from the Nemotron 3 family that launched at GTC this week. Convex
   handles the real-time sync -- every result streams to every connected
   client the instant it hits the database. No WebSockets. No polling."

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
    "zod": "latest",
    "@grpc/grpc-js": "latest",
    "@grpc/proto-loader": "latest"
  }
}
```

- `@grpc/grpc-js` + `@grpc/proto-loader` -- for NIM ASR gRPC calls in the
  transcription proxy route. Also need Riva proto files from
  [nvidia-riva/common](https://github.com/nvidia-riva/common/tree/main/riva/proto).
- Tavily is a simple REST call inside Convex actions. No SDK needed.

---

## Environment Variables

**Convex backend** (set via dashboard or CLI, NOT `.env` files):

```bash
npx convex env set NEBIUS_API_KEY "your-nebius-key"
npx convex env set TAVILY_API_KEY "your-tavily-key"
```

These are accessed as `process.env.NEBIUS_API_KEY` inside `"use node"` actions.
Convex actions run on Convex Cloud, so local `.env` files don't apply to them.

**Next.js frontend + ASR proxy** (set in `.env.local`):

```
NEXT_PUBLIC_CONVEX_URL=  # output from npx convex dev
NVIDIA_API_KEY=          # NIM Cloud API key from build.nvidia.com (for ASR)
```

The `NVIDIA_API_KEY` is used by the `/api/transcribe` Next.js route to
authenticate with the NIM Cloud ASR gRPC endpoint. This key is NOT set in
Convex because the ASR proxy runs in Next.js, not in a Convex action.

---

## Compatibility Notes

### AI SDK v6 migration

`generateObject` is deprecated as of AI SDK v6. Use `generateText` with
`Output.object()` instead. The architecture uses the new pattern:

```typescript
// Old (deprecated)
const { object } = await generateObject({ model, schema, prompt });

// New (AI SDK v6)
const { output } = await generateText({
  model,
  output: Output.object({ schema }),
  prompt,
});
```

The new API is more flexible -- you can combine structured output with tool
calling in the same request, which opens up future possibilities for L2
(e.g., letting the model decide when to call Tavily vs. answer directly).

### Nebius structured output support

Nebius Token Factory supports two JSON modes:

| Mode | `response_format` | Use case |
|---|---|---|
| **JSON Schema** | `{ type: "json_schema" }` | Strict schema adherence (what we use) |
| **JSON Object** | `{ type: "json_object" }` | Arbitrary JSON, model decides structure |

Setting `supportsStructuredOutputs: true` on the provider tells the AI SDK to
use `json_schema` mode. Nebius also supports `zodResponseFormat` from the
OpenAI SDK if you drop down to the raw client.

### Nebius function calling

Nebius supports OpenAI-compatible function calling with `tool_choice: "auto"`.
Both Nemotron Nano and Super support tool use. This means L2 could be enhanced
to let the model decide when Tavily verification is needed rather than always
calling it.

### Convex `"use node"` actions

Actions that call external APIs need the `"use node"` directive at the top of
the file. Key constraints:

- Actions cannot read/write the DB directly -- use `ctx.runQuery` and
  `ctx.runMutation` to go through query/mutation functions.
- Actions can `fetch` any external URL.
- `process.env` reads from Convex dashboard environment variables.
- Actions have a 10-minute timeout (plenty for LLM calls).

---

## What changed from v1

| Concern | Before (v1) | Now (Convex) |
|---|---|---|
| API routes | 3 Next.js POST routes | 1 thin audio proxy (`/api/transcribe`) -- everything else is Convex |
| Voice input | None | MediaRecorder → Nemotron ASR (NIM Cloud) → text chunks |
| Real-time updates | Client polling or SSE | Automatic via `useQuery` subscriptions |
| Orchestration | Manual in route handlers | `ctx.scheduler.runAfter` in mutations |
| Persistence | None (stateless routes) | Every result stored in Convex DB |
| External API calls | Next.js server actions | Convex `"use node"` actions with `fetch` |
| Models | 1 model (Super for everything) | 3 Nemotron models (ASR + Nano + Super) |
| Type safety | Manual Zod parsing | Schema-validated DB + typed function args |
| Infrastructure | Vercel serverless | Convex Cloud (backend) + Vercel (frontend) |
| Streaming LLM output | `streamText` via SSE | `generateText` + `Output.object()` → write to DB → reactive query |

---

## Convex Best Practices Checklist

Verified against Convex plugin rules and skills:

- [x] **`returns` validators on all public functions** -- `sessions.get`,
  `chunks.listBySession`, `results.listPulses`, etc. all have `returns` defined
- [x] **`args` validators on all functions** -- every function uses `v.*` validators
- [x] **Scheduler uses `internal.*` only** -- `ctx.scheduler.runAfter(0, internal.analysis.runPulse, ...)`
  never schedules public `api.*` functions
- [x] **`"use node"` file separation** -- `convex/analysis.ts` has `"use node"` and
  contains only `internalAction` exports. Queries and mutations live in separate
  files (`sessions.ts`, `chunks.ts`, `results.ts`)
- [x] **Actions use `ctx.runMutation` / `ctx.runQuery`** -- never access `ctx.db`
  directly from actions
- [x] **Indexed queries** -- all queries use `.withIndex()`, no `.filter()` calls
- [x] **Flat relational schema** -- no deep nesting, ID references between tables
- [x] **Small bounded arrays** -- `claims`, `flags`, `patterns` are bounded by
  the LLM output schema (typically <20 items)
- [x] **Environment variables via Convex dashboard** -- `process.env.NEBIUS_API_KEY`
  and `process.env.TAVILY_API_KEY` set via `npx convex env set`, not `.env` files
- [x] **No `Date.now()` in queries** -- only used in mutations (`sessions.create`,
  `chunks.addChunk`)
- [ ] **Authentication** -- skipped for hackathon MVP, add via Convex Auth or
  Clerk when ready
- [ ] **Pagination** -- `pulseResults` could grow large for long sessions; add
  cursor-based pagination post-MVP

That is the entire stack. Three API keys. Three Nemotron models. Three analysis
tiers. One thin audio proxy route. Everything else is Convex.
