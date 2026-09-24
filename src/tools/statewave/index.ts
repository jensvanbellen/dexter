import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { StatewaveClient } from './client.js';
import { formatToolResult } from '../types.js';

/**
 * Default memory subject for this user's durable investing context (portfolio,
 * risk tolerance, goals, trade history). Personal, not repo-scoped, so it is
 * shared with the user's other Statewave-backed agents.
 */
const DEFAULT_SUBJECT = 'user:jens';

async function callStatewave(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const text = await StatewaveClient.get().call(name, args);
    return formatToolResult({ result: text });
  } catch (error) {
    return formatToolResult({ error: `Statewave unavailable: ${(error as Error).message}` });
  }
}

export const STATEWAVE_SEARCH_DESCRIPTION = `
Semantic search over the user's durable, compiled Statewave memories.

## When to Use

- ALWAYS before giving personalized financial advice (buy/sell, sizing, recommendations)
- To recall the user's portfolio, risk tolerance, investment goals, and trade history
- To recall preferences or decisions the user shared in prior sessions or other tools

## When NOT to Use

- For current market/financial data (use the finance tools)
`.trim();

export const statewaveSearchTool = new DynamicStructuredTool({
  name: 'statewave_search_memories',
  description: 'Search the user\'s durable Statewave memories by free-text query.',
  schema: z.object({
    query: z.string().describe('Natural language query for memory recall.'),
    subject: z.string().default(DEFAULT_SUBJECT).describe('Memory subject. Defaults to the user\'s personal context.'),
    limit: z.number().int().positive().optional().describe('Max memories to return.'),
  }),
  func: async (input) =>
    callStatewave('statewave_search_memories', {
      query: input.query,
      subject: input.subject,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

export const STATEWAVE_GET_CONTEXT_DESCRIPTION = `
Assemble a compact, ranked context bundle for the user, tailored to a task.

## When to Use

- Before a multi-step analysis or recommendation, to load relevant durable context in one call
- When you need the most relevant memories for a specific question rather than a raw search
`.trim();

export const statewaveGetContextTool = new DynamicStructuredTool({
  name: 'statewave_get_context',
  description: 'Assemble a ranked context bundle for the user, tailored to a task query.',
  schema: z.object({
    query: z.string().describe('The task or question to tailor the context bundle to.'),
    subject: z.string().default(DEFAULT_SUBJECT).describe('Memory subject. Defaults to the user\'s personal context.'),
    max_tokens: z.number().int().positive().optional().describe('Approximate token budget for the bundle.'),
  }),
  func: async (input) =>
    callStatewave('statewave_get_context', {
      query: input.query,
      subject: input.subject,
      ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
    }),
});

export const STATEWAVE_TIMELINE_DESCRIPTION = `
Retrieve the user's raw Statewave episodes in chronological order (read-only).

## When to Use

- To review the sequence of past decisions, trades, or events
- To inspect what was recorded before compiling or when investigating a discrepancy
`.trim();

export const statewaveTimelineTool = new DynamicStructuredTool({
  name: 'statewave_get_timeline',
  description: 'List the user\'s raw Statewave episodes in chronological order.',
  schema: z.object({
    subject: z.string().default(DEFAULT_SUBJECT).describe('Memory subject. Defaults to the user\'s personal context.'),
    since: z.string().optional().describe('ISO timestamp lower bound (inclusive).'),
    until: z.string().optional().describe('ISO timestamp upper bound (inclusive).'),
    kinds: z.array(z.string()).optional().describe('Filter to these episode kinds.'),
    limit: z.number().int().positive().optional().describe('Max episodes to return.'),
  }),
  func: async (input) =>
    callStatewave('statewave_get_timeline', {
      subject: input.subject,
      ...(input.since !== undefined ? { since: input.since } : {}),
      ...(input.until !== undefined ? { until: input.until } : {}),
      ...(input.kinds !== undefined ? { kinds: input.kinds } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

export const STATEWAVE_LIST_SUBJECTS_DESCRIPTION = `
List the memory subjects this Statewave instance knows about, with per-subject
episode and memory counts. Read-only. Use to discover available subjects.
`.trim();

export const statewaveListSubjectsTool = new DynamicStructuredTool({
  name: 'statewave_list_subjects',
  description: 'List Statewave memory subjects with their episode and memory counts.',
  schema: z.object({
    limit: z.number().int().positive().optional().describe('Max subjects to return.'),
    offset: z.number().int().nonnegative().optional().describe('Pagination offset.'),
  }),
  func: async (input) =>
    callStatewave('statewave_list_subjects', {
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
    }),
});

export const STATEWAVE_INGEST_DESCRIPTION = `
Store a single durable fact or decision the user shared into Statewave memory.

## When to Use

- When the user states a durable preference, goal, risk tolerance, or portfolio rule
- When a concrete decision is made (e.g. a trade, a target allocation)

## When NOT to Use

- For transient chatter, market data, or anything already recorded
- Never store secrets or credentials
`.trim();

export const statewaveIngestTool = new DynamicStructuredTool({
  name: 'statewave_ingest_episode',
  description: 'Write a durable fact or decision into the user\'s Statewave memory log.',
  schema: z.object({
    kind: z.string().describe('Episode kind, e.g. "preference", "decision", "fact".'),
    text: z.string().describe('The fact or decision to record, in plain language.'),
    subject: z.string().default(DEFAULT_SUBJECT).describe('Memory subject. Defaults to the user\'s personal context.'),
    occurred_at: z.string().optional().describe('ISO timestamp of the event. Defaults to now.'),
    source: z.string().optional().describe('Origin of the episode. Defaults to "dexter".'),
    idempotency_key: z.string().optional().describe('Dedupe key. Defaults to a generated UUID.'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional structured metadata.'),
  }),
  func: async (input) =>
    callStatewave('statewave_ingest_episode', {
      subject: input.subject,
      kind: input.kind,
      text: input.text,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      source: input.source ?? 'dexter',
      idempotency_key: input.idempotency_key ?? globalThis.crypto.randomUUID(),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    }),
});

export const STATEWAVE_COMPILE_DESCRIPTION = `
Compile a subject's accumulated raw episodes into durable, retrievable memories.
Occasional maintenance step; run after ingesting several new episodes so search
and context reflect them. Pass force to recompile everything.
`.trim();

export const statewaveCompileTool = new DynamicStructuredTool({
  name: 'statewave_compile_subject',
  description: 'Compile the user\'s raw Statewave episodes into durable memories.',
  schema: z.object({
    subject: z.string().default(DEFAULT_SUBJECT).describe('Memory subject. Defaults to the user\'s personal context.'),
    force: z.boolean().optional().describe('Recompile all episodes instead of only new ones.'),
  }),
  func: async (input) =>
    callStatewave('statewave_compile_subject', {
      subject: input.subject,
      ...(input.force !== undefined ? { force: input.force } : {}),
    }),
});
