'use client';
import { stringValue } from './types';

import { useEffect, useRef } from 'react';
import { useStride } from './store';
import { taskData, uid } from './types';
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
}
export function WebMCP() {
  const store = useStride();
  const latest = useRef(store);
  useEffect(() => {
    latest.current = store;
  }, [store]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: 'stride_search',
        description:
          'Search this Stride workspace for tasks, pages, projects, databases, courses and assignments.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (
            !input ||
            typeof input !== 'object' ||
            !('query' in input) ||
            typeof input.query !== 'string'
          )
            throw new Error('query must be a string');
          const query = input.query.toLowerCase();
          return latest.current.entities
            .filter(
              (e) =>
                [
                  'task',
                  'page',
                  'project',
                  'database',
                  'course',
                  'assignment',
                ].includes(e.kind) &&
                stringValue(e.data.title || '')
                  .toLowerCase()
                  .includes(query),
            )
            .slice(0, 50)
            .map((e) => ({ id: e.id, kind: e.kind, title: e.data.title }));
        },
      },
      {
        name: 'stride_create_tasks',
        description:
          'Create and durably save up to 20 Inbox tasks in this workspace. Returns their IDs after saving.',
        inputSchema: {
          type: 'object',
          properties: {
            titles: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 1000 },
              minItems: 1,
              maxItems: 20,
            },
          },
          required: ['titles'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (
            !input ||
            typeof input !== 'object' ||
            !('titles' in input) ||
            !Array.isArray(input.titles) ||
            input.titles.length < 1 ||
            input.titles.length > 20 ||
            input.titles.some(
              (t) => typeof t !== 'string' || !t.trim() || t.length > 1000,
            )
          )
            throw new Error('Provide 1–20 nonempty task titles');
          const edits = input.titles.map((title) => ({
            id: uid(),
            kind: 'task' as const,
            data: taskData(title.trim()),
          }));
          await latest.current.edit(edits, 'Created tasks through WebMCP');
          return {
            created: edits.map((e) => ({ id: e.id, title: e.data.title })),
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, []);
  return null;
}
