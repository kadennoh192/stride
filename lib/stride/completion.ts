import { nextOccurrence } from './domain';
import { stringValue, type EntityEdit, type Task } from './types';

async function occurrenceId(task: Task, occurrence: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${task.id}\n${occurrence}`),
  );
  const digest = [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `completion-${digest.slice(0, 40)}`;
}

/** Build one deterministic completion event and its matching task transition. */
export async function completionEdits(task: Task, completed = new Date()) {
  const next = nextOccurrence(task, completed);
  const occurrence = stringValue(
    task.data.occurrence || task.data.due || 'once',
  );
  const id = await occurrenceId(task, occurrence);
  if (task.data.completedAt)
    return {
      id,
      next: '',
      reopened: true,
      edits: [
        {
          id: task.id,
          kind: 'task',
          data: { completedAt: '', status: 'To do' },
        },
        { id, kind: 'completion', data: { _deleted: true } },
      ] satisfies EntityEdit[],
    };
  const at = completed.toISOString();
  return {
    id,
    next,
    reopened: false,
    edits: [
      {
        id,
        kind: 'completion',
        data: {
          task: task.id,
          title: task.data.title,
          at,
          due: task.data.due,
          _deleted: false,
        },
      },
      {
        id: task.id,
        kind: 'task',
        data: next
          ? {
              due: next,
              recurrenceAnchor: task.data.recurrenceAnchor || task.data.due,
              time: task.data.time,
              occurrence: next,
              completedAt: '',
              status: 'To do',
              checklist: (task.data.checklist || []).map((item) => ({
                ...item,
                done: false,
              })),
              subtasks: task.data.subtasks.map((item) => ({
                ...item,
                done: false,
              })),
            }
          : { completedAt: at, status: 'Done' },
      },
    ] satisfies EntityEdit[],
  };
}
