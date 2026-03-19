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
          v.literal("contradiction"),
        ),
        label: v.string(),
      }),
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
      v.object({ claim: v.string(), evidence: v.string() }),
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
          v.literal("cherry-picking"),
        ),
        description: v.string(),
      }),
    ),
    trustTrajectory: v.array(v.number()),
    overallAssessment: v.string(),
  }).index("by_session", ["sessionId"]),
});
