import { stringValue } from './types';
import {
  dateKey,
  shiftDate,
  type Task,
  type Entity,
  type DatabaseRow,
  type Property,
} from './types';
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + 'T12:00Z').toISOString().slice(0, 10) === value
  );
}
export function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function nextOccurrence(task: Task, completed = new Date()): string {
  const rule = task.data.recurrence;
  if (!rule || rule === 'none') return '';
  const [frequency, amountString] = rule.split(':');
  const amount = Math.max(1, Math.min(365, Number(amountString) || 1));
  const base = frequency.startsWith('after')
    ? dateKey(completed, task.data.timezone)
    : task.data.due || dateKey(completed, task.data.timezone);
  if (frequency === 'daily' || frequency === 'after-days')
    return shiftDate(base, amount);
  if (frequency === 'weekly') return shiftDate(base, 7 * amount);
  if (frequency === 'weekdays') {
    let next = shiftDate(base, 1);
    while ([0, 6].includes(new Date(next + 'T12:00Z').getUTCDay()))
      next = shiftDate(next, 1);
    return next;
  }
  const d = new Date(base + 'T12:00Z');
  const day = task.data.recurrenceAnchor
    ? new Date(stringValue(task.data.recurrenceAnchor) + 'T12:00Z').getUTCDate()
    : d.getUTCDate();
  if (frequency === 'monthly' || frequency === 'yearly') {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (frequency === 'yearly' ? 12 : 1) * amount);
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  }
  return '';
}
export function dependencyCycle(
  id: string,
  dependencies: string[],
  tasks: Task[],
) {
  const map = new Map(tasks.map((t) => [t.id, t.data.dependencies]));
  map.set(id, dependencies);
  const walk = (node: string, path: Set<string>): boolean => {
    if (path.has(node)) return true;
    const next = new Set(path).add(node);
    return (map.get(node) || []).some((d) => walk(d, next));
  };
  return walk(id, new Set());
}
export function filterTasks(
  tasks: Task[],
  filter: {
    query?: string;
    project?: string;
    tag?: string;
    priority?: string;
    status?: string;
  },
) {
  const q = (filter.query || '').toLowerCase();
  return tasks.filter(
    (t) =>
      (!q ||
        `${t.data.title} ${t.data.description} ${t.data.tags.join(' ')}`
          .toLowerCase()
          .includes(q)) &&
      (!filter.project || t.data.project === filter.project) &&
      (!filter.tag || t.data.tags.includes(filter.tag)) &&
      (!filter.priority || t.data.priority === Number(filter.priority)) &&
      (!filter.status || t.data.status === filter.status),
  );
}
export function safeURL(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)
      ? url.href
      : '';
  } catch {
    return '';
  }
}
export function embedURL(value: string) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return '';
    if (['www.youtube.com', 'youtube.com'].includes(u.hostname)) {
      const id = u.searchParams.get('v') || u.pathname.split('/embed/')[1];
      return id && /^[\w-]{11}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : '';
    }
    if (u.hostname === 'youtu.be' && /^[\w-]{11}$/.test(u.pathname.slice(1)))
      return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (u.hostname === 'player.vimeo.com' && /^\/video\/\d+$/.test(u.pathname))
      return u.href;
    return '';
  } catch {
    return '';
  }
}
// Wall time -> UTC. Ambiguous times select the earliest matching instant; gaps advance to the first real minute.
export function zonedInstant(date: string, time: string, zone: string): number {
  if (
    !validDate(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !validZone(zone)
  )
    return NaN;
  const target = Date.parse(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const wall = (ms: number) => {
    const p = fmt.formatToParts(ms);
    const get = (k: string) => p.find((x) => x.type === k)?.value;
    return Date.parse(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`,
    );
  };
  let guess = target;
  for (let i = 0; i < 4; i++) guess += target - wall(guess);
  let earliest = Infinity;
  for (let d = -180; d <= 180; d++) {
    const test = guess + d * 60000;
    if (wall(test) === target) earliest = Math.min(earliest, test);
  }
  if (Number.isFinite(earliest)) return earliest;
  for (let d = -180; d <= 180; d++) {
    const test = guess + d * 60000;
    const w = wall(test);
    if (w >= target && w < target + 3 * 3600000) return test;
  }
  return guess;
}
export function propertyValue(
  row: DatabaseRow,
  property: Property,
  entities: Entity[],
): unknown {
  if (property.type !== 'rollup') return row.data.values[property.id];
  const ids = row.data.values[property.relation || ''];
  const related = entities.filter(
    (e) => Array.isArray(ids) && ids.includes(e.id),
  );
  const values = related
    .map((e) =>
      Number(
        e.kind === 'row'
          ? (e.data.values as Record<string, unknown>)?.[
              property.property || ''
            ]
          : e.data[property.property || ''],
      ),
    )
    .filter(Number.isFinite);
  switch (property.aggregate) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'average':
      return values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
    case 'min':
      return values.length ? Math.min(...values) : 0;
    case 'max':
      return values.length ? Math.max(...values) : 0;
    default:
      return related.length;
  }
}
