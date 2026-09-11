import { stringValue } from './types';
import type { Change, Field, Kind, Entity, Conflict, Data } from './types';
import { validZone, validDate } from './domain';
export const kinds: Kind[] = [
  'task',
  'project',
  'page',
  'block',
  'database',
  'row',
  'habit',
  'habitLog',
  'session',
  'countdown',
  'settings',
  'view',
  'comment',
  'completion',
  'template',
  'favorite',
];
const id = /^[a-zA-Z0-9_-]{1,150}$/;
const stamp = /^\d{15}-[a-zA-Z0-9-]{1,100}$/;
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
export class ValidationError extends Error {}
const invalid = (message: string): never => {
  throw new ValidationError(message);
};
function safeValue(value: unknown, depth = 0): boolean {
  if (depth > 30) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 100000;
  if (Array.isArray(value))
    return value.length <= 10000 && value.every((v) => safeValue(v, depth + 1));
  if (typeof value === 'object')
    return Object.entries(value).every(
      ([k, v]) =>
        !['__proto__', 'constructor', 'prototype'].includes(k) &&
        safeValue(v, depth + 1),
    );
  return false;
}
export function validField(v: unknown): v is Field {
  if (!v || typeof v !== 'object') return false;
  const f = v as Field;
  return (
    typeof f.entity === 'string' &&
    id.test(f.entity) &&
    kinds.includes(f.kind) &&
    typeof f.key === 'string' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(f.key) &&
    !['__proto__', 'constructor', 'prototype'].includes(f.key) &&
    typeof f.stamp === 'string' &&
    stamp.test(f.stamp) &&
    (f.base === undefined ||
      f.base === '' ||
      (typeof f.base === 'string' && stamp.test(f.base))) &&
    (f.entityBase === undefined ||
      f.entityBase === '' ||
      (typeof f.entityBase === 'string' && stamp.test(f.entityBase))) &&
    safeValue(f.value)
  );
}
export function validChange(v: unknown): v is Change {
  if (!v || typeof v !== 'object') return false;
  const c = v as Change;
  return (
    typeof c.id === 'string' &&
    id.test(c.id) &&
    typeof c.label === 'string' &&
    c.label.length < 500 &&
    typeof c.at === 'string' &&
    Number.isFinite(Date.parse(c.at)) &&
    Array.isArray(c.fields) &&
    c.fields.length > 0 &&
    c.fields.length <= 1000 &&
    c.fields.every(validField)
  );
}
export function validateEntity(e: Entity) {
  if (
    !id.test(e.id) ||
    !kinds.includes(e.kind) ||
    !e.data ||
    Array.isArray(e.data) ||
    typeof e.data !== 'object' ||
    !safeValue(e.data)
  )
    throw new ValidationError('Invalid workspace record');
  if (e.deleted) return;
  if (e.kind === 'task') {
    const d = e.data;
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 1000)
      throw new ValidationError(
        'Give the task a title (up to 1,000 characters).',
      );
    if (d.due && !validDate(stringValue(d.due)))
      throw new ValidationError('Invalid due date');
    if (d.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(stringValue(d.time)))
      throw new ValidationError('Invalid time');
    if (d.time && !d.due)
      throw new ValidationError('Choose a date for the task time.');
    if (!validZone(stringValue(d.timezone)))
      throw new ValidationError('Choose a valid timezone');
    if (![1, 2, 3, 4].includes(Number(d.priority)))
      throw new ValidationError('Invalid priority');
    for (const key of ['tags', 'dependencies', 'reminders'])
      if (!strings(d[key])) invalid(`Invalid ${key}`);
    for (const key of ['subtasks', 'checklist']) {
      if (key === 'checklist' && d[key] === undefined) continue;
      if (!Array.isArray(d[key]) || !(d[key] as unknown[]).every(checkItem))
        invalid(`Invalid ${key}`);
    }
    if (!['To do', 'In progress', 'Done'].includes(String(d.status)))
      invalid('Invalid task status');
    for (const key of [
      'description',
      'project',
      'section',
      'parent',
      'completedAt',
    ])
      optional(d, key, (v) => typeof v === 'string');
    if (d.completedAt && !instant(d.completedAt))
      invalid('Invalid completion timestamp');
    if (
      !/^(none|weekdays|(?:daily|weekly|monthly|yearly|after-days)(?::[1-9]\d{0,2})?)$/.test(
        stringValue(d.recurrence),
      )
    )
      throw new ValidationError('Invalid recurrence');
    if (!finite(d.duration, 0, 10080))
      throw new ValidationError(
        'Duration must be between 0 and 10,080 minutes.',
      );
    if (d.repeatMinutes && !finite(d.repeatMinutes, 5, 1440))
      throw new ValidationError(
        'Repeating reminders must be at least 5 minutes apart.',
      );
  }
  if (
    ['project', 'page', 'database', 'habit', 'countdown'].includes(e.kind) &&
    (typeof e.data.title !== 'string' ||
      !e.data.title.trim() ||
      stringValue(e.data.title).length > 1000)
  )
    throw new ValidationError('A title is required');
  validateShape(e);
}
function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}
function finite(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
function instant(v: unknown) {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function checkItem(v: unknown) {
  return (
    object(v) &&
    typeof v.id === 'string' &&
    id.test(v.id) &&
    typeof v.title === 'string' &&
    typeof v.done === 'boolean'
  );
}
function optional(data: Data, key: string, check: (value: unknown) => boolean) {
  if (data[key] !== undefined && data[key] !== null && !check(data[key]))
    invalid(`Invalid ${key}`);
}
const blocks = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'number',
  'check',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'table',
  'image',
  'file',
  'link',
  'embed',
  'database',
];
const properties = [
  'text',
  'number',
  'select',
  'multi-select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'files',
  'person',
  'relation',
  'rollup',
  'formula',
];
function validateShape(e: Entity) {
  const d = e.data;
  switch (e.kind) {
    case 'project':
      optional(d, 'sections', strings);
      break;
    case 'page':
      optional(d, 'parent', (v) => typeof v === 'string' && (!v || id.test(v)));
      break;
    case 'block':
      if (
        typeof d.page !== 'string' ||
        !id.test(d.page) ||
        !blocks.includes(String(d.type)) ||
        !finite(d.order, -1e12, 1e12)
      )
        invalid('Invalid page block');
      optional(d, 'text', (v) => typeof v === 'string');
      optional(d, 'rich', object);
      optional(d, 'checked', (v) => typeof v === 'boolean');
      optional(d, 'file', (v) => typeof v === 'string' && (!v || id.test(v)));
      break;
    case 'database': {
      if (!Array.isArray(d.properties)) invalid('Invalid database properties');
      const seen = new Set<string>();
      for (const p of d.properties as unknown[]) {
        if (
          !object(p) ||
          typeof p.id !== 'string' ||
          !id.test(p.id) ||
          p.id.length > 95 ||
          seen.has(p.id) ||
          typeof p.name !== 'string' ||
          !p.name.trim() ||
          !properties.includes(String(p.type)) ||
          !strings(p.options)
        )
          invalid('Invalid or duplicate database property');
        seen.add((p as { id: string }).id);
      }
      break;
    }
    case 'row':
      if (
        typeof d.database !== 'string' ||
        !id.test(d.database) ||
        typeof d.title !== 'string'
      )
        invalid('Invalid database row');
      optional(d, 'values', object);
      break;
    case 'habit':
      if (
        !finite(d.goal, Number.MIN_VALUE, 1e9) ||
        !Array.isArray(d.days) ||
        !d.days.length ||
        !d.days.every((v) => Number.isInteger(v) && v >= 0 && v <= 6)
      )
        invalid('Choose a positive habit goal and scheduled days');
      optional(
        d,
        'reminder',
        (v) => v === '' || (typeof v === 'string' && time.test(v)),
      );
      break;
    case 'habitLog':
      if (
        typeof d.habit !== 'string' ||
        !id.test(d.habit) ||
        typeof d.date !== 'string' ||
        !validDate(d.date) ||
        !finite(d.value, 0, 1e9)
      )
        invalid('Invalid habit history');
      break;
    case 'session':
      if (
        !instant(d.at) ||
        !finite(d.duration, 0, 86400) ||
        !['focus', 'break', 'longBreak'].includes(String(d.phase))
      )
        invalid('Invalid focus session');
      break;
    case 'completion':
      if (typeof d.task !== 'string' || !id.test(d.task) || !instant(d.at))
        invalid('Invalid completion history');
      break;
    case 'countdown':
      if (typeof d.date !== 'string' || !Number.isFinite(Date.parse(d.date)))
        invalid('Choose a valid countdown date');
      break;
    case 'comment':
      if (
        typeof d.target !== 'string' ||
        !id.test(d.target) ||
        typeof d.text !== 'string'
      )
        invalid('Invalid page comment');
      break;
    case 'settings':
      optional(
        d,
        'timezone',
        (v) => v === '' || (typeof v === 'string' && validZone(v)),
      );
      for (const key of ['hidden', 'navOrder']) optional(d, key, strings);
      for (const key of ['focusMinutes', 'breakMinutes', 'longBreakMinutes'])
        optional(d, key, (v) => finite(v, 1, 240));
      optional(d, 'cycles', (v) => finite(v, 1, 12) && Number.isInteger(v));
      for (const key of ['quietStart', 'quietEnd'])
        optional(d, key, (v) => typeof v === 'string' && time.test(v));
      optional(
        d,
        'activeTimer',
        (v) =>
          object(v) &&
          typeof v.id === 'string' &&
          id.test(v.id) &&
          finite(v.end) &&
          finite(v.remaining, 0, 86400) &&
          finite(v.duration, 0, 86400) &&
          typeof v.running === 'boolean' &&
          ['focus', 'break', 'longBreak'].includes(String(v.phase)),
      );
      break;
    default:
      break;
  }
}
export function validConflict(v: unknown): v is Conflict {
  if (
    !object(v) ||
    typeof v.id !== 'string' ||
    v.id.length > 1000 ||
    !instant(v.at) ||
    !validField(v.local) ||
    !validField(v.remote)
  )
    return false;
  return (
    v.entity === v.local.entity &&
    v.entity === v.remote.entity &&
    v.key === v.local.key &&
    v.key === v.remote.key &&
    v.local.kind === v.remote.kind
  );
}

/** Check edited graph paths against the staged transaction, including indirect loops. */
export function validateGraph(
  edited: Entity[],
  lookup: (id: string) => Entity | undefined,
) {
  for (const edge of ['parent', 'dependencies'] as const) {
    const done = new Set<string>();
    for (const root of edited) {
      if (
        root.deleted ||
        !['task', 'page'].includes(root.kind) ||
        done.has(root.id)
      )
        continue;
      const path = new Set<string>();
      const stack: { id: string; exit: boolean }[] = [
        { id: root.id, exit: false },
      ];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.exit) {
          path.delete(node.id);
          done.add(node.id);
          continue;
        }
        if (path.has(node.id))
          invalid(
            edge === 'parent'
              ? 'Nested items cannot contain a parent cycle.'
              : 'Dependencies cannot form a cycle.',
          );
        if (done.has(node.id)) continue;
        const entity = lookup(node.id);
        if (!entity || entity.deleted) continue;
        path.add(node.id);
        stack.push({ id: node.id, exit: true });
        const refs =
          edge === 'parent'
            ? entity.data.parent
              ? [entity.data.parent]
              : []
            : entity.kind === 'task'
              ? (entity.data.dependencies as string[])
              : [];
        for (const ref of refs) {
          const target = lookup(ref);
          if (target && target.kind !== entity.kind)
            invalid(
              'A parent or dependency must reference the same type of item.',
            );
          stack.push({ id: ref, exit: false });
        }
      }
    }
  }
}
