---
name: TruthLens MVP Implementation
overview: "Phased implementation of TruthLens MVP: a real-time claim analysis tool using three Nemotron models on Convex, built in five progressive phases where each phase produces a verifiable, working increment."
todos:
  - id: phase1-scaffold
    content: "Phase 1: Scaffold Next.js + Convex, deploy schema, wire provider, set env vars"
    status: pending
  - id: phase1-verify
    content: "Phase 1 VERIFY: App loads, Convex dashboard shows 5 tables, no errors"
    status: pending
  - id: phase2-sessions-chunks
    content: "Phase 2: Create sessions.ts and chunks.ts with addChunk mutation + scheduler"
    status: pending
  - id: phase2-l1-action
    content: "Phase 2: Create analysis.ts with runPulse action (Nemotron Nano via AI SDK)"
    status: pending
  - id: phase2-results
    content: "Phase 2: Create results.ts with writePulse mutation + listPulses query"
    status: pending
  - id: phase2-ui
    content: "Phase 2: Build TranscriptInput (paste), PulseFeed, Flag, ConfidenceMeter components"
    status: pending
  - id: phase2-verify
    content: "Phase 2 VERIFY: Paste text -> L1 results appear in real-time, two-tab reactivity works"
    status: pending
  - id: phase3-l2l3
    content: "Phase 3: Add runAnalysis (L2 + Tavily) and runPatterns (L3) actions"
    status: pending
  - id: phase3-ui
    content: "Phase 3: Build AnalysisPanel, PatternsPanel, tab navigation"
    status: pending
  - id: phase3-verify
    content: "Phase 3 VERIFY: 3 chunks triggers L2, 6 chunks triggers L3, Tavily verification works"
    status: pending
  - id: phase4-asr
    content: "Phase 4: Create /api/transcribe route with NIM ASR gRPC, download Riva protos"
    status: pending
  - id: phase4-voice-hook
    content: "Phase 4: Create useVoiceInput hook (MediaRecorder primary, Web Speech fallback)"
    status: pending
  - id: phase4-wire-ui
    content: "Phase 4: Add mic toggle to TranscriptInput, wire voice to addChunk"
    status: pending
  - id: phase4-verify
    content: "Phase 4 VERIFY: Speak into mic, transcribed chunks appear, L1 flags show, NIM/fallback both work"
    status: pending
  - id: phase5-design
    content: "Phase 5: Apply design language (dark theme, JetBrains Mono, accent colors)"
    status: pending
  - id: phase5-polish
    content: "Phase 5: Polish all components, add sample transcript, responsive layout"
    status: pending
  - id: phase5-verify
    content: "Phase 5 VERIFY: Full demo script works end-to-end, two-window sync, no errors"
    status: pending
isProject: false
---

# TruthLens MVP -- Phased Implementation Plan

Each phase ends with concrete user-facing verification steps. Nothing moves forward until the previous phase checks out.

---

## Phase 1: Scaffold + Convex Foundation

Stand up the project skeleton, wire Convex, deploy the schema, and confirm the full round-trip works before writing any analysis logic.

**Create/modify:**

- `npx create-next-app@latest truthlens-convex` (App Router, TypeScript, Tailwind)
- Install deps: `convex`, `ai`, `@ai-sdk/openai-compatible`, `zod`, `@grpc/grpc-js`, `@grpc/proto-loader`
- `npx convex dev` -- creates `convex/` folder, connects to Convex Cloud
- `convex/schema.ts` -- all 5 tables (`sessions`, `chunks`, `pulseResults`, `analysisResults`, `patternResults`) with indexes, per the architecture doc (lines 466-547)
- `app/ConvexClientProvider.tsx` -- `"use client"` wrapper with `ConvexReactClient`
- `app/layout.tsx` -- wrap children in `<ConvexClientProvider>`
- Set env vars:
  - `npx convex env set NEBIUS_API_KEY "..."` and `npx convex env set TAVILY_API_KEY "..."`
  - `.env.local`: `NEXT_PUBLIC_CONVEX_URL` and `NVIDIA_API_KEY`

**Verify (user checks):**

- `npm run dev` starts Next.js without errors
- `npx convex dev` shows "Convex functions ready" with no schema validation errors
- Convex dashboard (dashboard.convex.dev) shows all 5 tables
- Browser loads the app at localhost:3000 with no console errors

---

## Phase 2: L1 Pulse Pipeline (Paste Mode)

Build the core loop: paste text, chunk it, fire L1, see results appear in real-time. This is the single most important phase -- it proves the Convex reactive architecture works end-to-end.

**Create:**

- `convex/sessions.ts` -- `create` mutation + `get` query with `returns` validators (lines 553-588)
- `convex/chunks.ts` -- `addChunk` mutation (inserts chunk, patches session, schedules L1 via `ctx.scheduler.runAfter(0, internal.analysis.runPulse, ...)`), `listBySession` query (lines 490-560)
- `convex/analysis.ts` -- `"use node"` file, `runPulse` internalAction only. Calls Nebius Nano via `generateText` + `Output.object()` with pulse schema, then `ctx.runMutation(internal.results.writePulse, ...)` (lines 562-618)
- `convex/results.ts` -- `writePulse` internalMutation, `listPulses` public query with `returns` validator, shared `flagValidator` (lines 848-963)
- `app/components/TranscriptInput.tsx` -- textarea for paste, "Analyze" button. On submit: call `sessions.create`, split text into ~200-word chunks, call `addChunk` for each with a short delay between
- `app/components/PulseFeed.tsx` -- subscribes via `useQuery(api.results.listPulses, { sessionId })`, renders each pulse result with claims, flags, tone, and confidence
- `app/components/Flag.tsx` -- colored badge component for flag types (vague=yellow, stat=orange, logic=red, etc.)
- `app/components/ConfidenceMeter.tsx` -- thin horizontal bar, 0-1 scale
- `app/page.tsx` -- two-panel layout: input on left, PulseFeed on right

**Verify (user checks):**

- Paste a paragraph of text, click Analyze
- Within 1-3 seconds, L1 pulse results appear in the right panel
- Claims are listed as text, flags show as colored badges
- Confidence meter renders with a value between 0-1
- Paste a longer text (3+ paragraphs) -- multiple pulse results appear progressively
- Open the Convex dashboard -- `sessions`, `chunks`, and `pulseResults` tables have data
- Open the app in two browser tabs -- both show results updating in real-time when one submits text

---

## Phase 3: L2 Analysis + L3 Patterns

Add the deeper analysis tiers. L2 fires every 3rd chunk with Tavily verification. L3 fires after 6+ chunks with full-transcript pattern detection.

**Create/modify:**

- `convex/analysis.ts` -- add `runAnalysis` internalAction (Nemotron Super + Tavily fetch, writes via `internal.results.writeAnalysis`) and `runPatterns` internalAction (Nemotron Super with full transcript, writes via `internal.results.writePatterns`) (lines 618-745)
- `convex/results.ts` -- add `writeAnalysis` and `writePatterns` internalMutations, `listAnalyses` and `listPatterns` public queries with full `returns` validators, `getChunksForSession` internalQuery (lines 886-1013)
- `convex/chunks.ts` -- ensure `addChunk` mutation schedules L2 when `(chunkIndex + 1) % 3 === 0` and L3 when `chunkIndex >= 5 && (chunkIndex + 1) % 3 === 0`
- `app/components/AnalysisPanel.tsx` -- subscribes via `useQuery(api.results.listAnalyses, { sessionId })`, renders TLDR, core points, evidence table, appeals, assumptions, steelman, missing evidence as expandable sections
- `app/components/PatternsPanel.tsx` -- subscribes via `useQuery(api.results.listPatterns, { sessionId })`, renders patterns list, trust trajectory (as a simple line/bar chart), overall assessment
- `app/page.tsx` -- add tab navigation: Pulse | Analysis | Patterns

**Verify (user checks):**

- Paste a medium-length text (at least 600 words / 3 chunks worth)
- L1 pulses appear immediately for each chunk
- After the 3rd chunk, an L2 analysis appears in the Analysis tab within 5-15 seconds
- L2 analysis includes a TLDR, evidence table, and rhetorical appeals
- Paste a long text (at least 1200 words / 6 chunks worth)
- After the 6th chunk, L3 patterns appear in the Patterns tab
- L3 shows pattern types (escalation, contradiction, etc.) and a trust trajectory
- Check Convex dashboard -- `analysisResults` and `patternResults` tables have data
- Check Convex logs -- no errors in scheduled actions
- If Tavily returns results, the evidence table cites them; if Tavily fails, the action still completes gracefully

---

## Phase 4: Voice Input (NIM ASR + Web Speech Fallback)

Add real-time voice input with MediaRecorder sending audio to Nemotron ASR. This is the "wow factor" for the demo.

**Create:**

- `protos/` -- download Riva ASR proto definitions from [nvidia-riva/common](https://github.com/nvidia-riva/common/tree/main/riva/proto)
- `app/api/transcribe/route.ts` -- POST handler: receive audio blob as FormData, forward to NIM Cloud gRPC (`grpc.nvcf.nvidia.com:443`) with `NVIDIA_API_KEY`, return `{ text }` (lines 266-301)
- `app/hooks/useVoiceInput.ts` -- full hook with `startNimAsr` (MediaRecorder, 10s timeslice, POST to `/api/transcribe`) and `startWebSpeech` fallback (lines 303-433)

**Modify:**

- `app/components/TranscriptInput.tsx` -- add mic toggle button alongside the textarea. When recording: show a pulsing indicator, display transcribed chunks as they arrive, each chunk auto-calls `addChunk`. Three states: idle, recording, transcribing
- `app/page.tsx` -- wire `useVoiceInput` with `onChunkReady` calling `addChunk`

**Verify (user checks):**

- Click the mic button -- browser prompts for microphone permission
- Grant permission -- recording indicator appears (pulsing dot or waveform)
- Speak for 10+ seconds -- first transcribed chunk appears in the transcript area
- L1 flags appear for the transcribed chunk within 1-2 seconds of transcription
- Continue speaking for 30+ seconds -- 3 chunks arrive, L2 analysis triggers
- Click stop -- recording stops, remaining audio is processed
- If NIM ASR is unavailable (no NVIDIA_API_KEY), set `useNimAsr: false` and verify Web Speech API fallback works
- Transcription quality: check that NIM ASR returns properly punctuated, capitalized text
- Error handling: if `/api/transcribe` fails, the UI shows an error message rather than crashing

---

## Phase 5: UI Polish + Demo Prep

Apply the design language, smooth out the experience, and prepare for the hackathon demo.

**Modify:**

- `app/layout.tsx` -- import JetBrains Mono from Google Fonts, set as default font
- `app/globals.css` / Tailwind config -- implement the design language:
  - Background: `#0a0a0a`, Surface: `#141414`, Border: `#222222` (1px solid, sharp corners)
  - Text: `#e5e5e5` primary, `#666666` secondary
  - Accent colors only for meaning: `#ff4400` warnings, `#00cc66` supported, `#ffaa00` partial
- `app/components/TranscriptInput.tsx` -- polish the two-mode UI (paste vs. mic), clear visual state transitions
- `app/components/PulseFeed.tsx` -- align chunks with their pulse results, animate new results appearing
- `app/components/AnalysisPanel.tsx` -- expand/collapse sections, clean typography
- `app/components/PatternsPanel.tsx` -- trust trajectory as a simple SVG line chart or bar chart
- `app/page.tsx` -- responsive two-panel layout, tab bar with active indicator
- Add a sample transcript (tech keynote or product launch) as default paste content for quick demo starts

**Verify (user checks):**

- App is dark-themed with JetBrains Mono font, sharp corners, no decorative gradients
- Colors carry meaning only: red/orange for warnings, green for supported claims, yellow for partial
- Tab switching between Pulse / Analysis / Patterns is instant
- Full paste demo: paste sample transcript, all three tiers populate within 30 seconds
- Full voice demo: speak for 60 seconds, L1 flags appear chunk-by-chunk, L2 and L3 populate
- Open two browser windows side by side -- both update in real-time from the same session
- Mobile responsive: the two-panel layout stacks vertically on small screens
- No console errors, no unhandled promise rejections, no Convex action failures in logs
- Run through the full demo script (Option A: live voice) end-to-end without interruption

---

## Key Files Summary

```
convex/
  schema.ts          -- Phase 1
  sessions.ts        -- Phase 2
  chunks.ts          -- Phase 2 (L2/L3 scheduling added Phase 3)
  analysis.ts        -- Phase 2 (L1), Phase 3 (L2, L3)
  results.ts         -- Phase 2 (L1), Phase 3 (L2, L3)

app/
  layout.tsx                    -- Phase 1, Phase 5
  ConvexClientProvider.tsx      -- Phase 1
  page.tsx                      -- Phase 2, Phase 3, Phase 4, Phase 5
  globals.css                   -- Phase 5
  api/transcribe/route.ts       -- Phase 4
  hooks/useVoiceInput.ts        -- Phase 4
  components/
    TranscriptInput.tsx         -- Phase 2, Phase 4, Phase 5
    PulseFeed.tsx               -- Phase 2, Phase 5
    Flag.tsx                    -- Phase 2
    ConfidenceMeter.tsx         -- Phase 2
    AnalysisPanel.tsx           -- Phase 3, Phase 5
    PatternsPanel.tsx           -- Phase 3, Phase 5

protos/
  riva_asr.proto               -- Phase 4
```
