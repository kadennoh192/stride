import { stringValue } from './types';
import { dateKey, shiftDate, type Task } from './types';
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
  const completedDay = dateKey(completed, task.data.timezone);
  if (frequency === 'after-days') return shiftDate(completedDay, amount);
  const base = task.data.due || completedDay;
  if (frequency === 'daily' || frequency === 'weekly') {
    const interval = amount * (frequency === 'weekly' ? 7 : 1);
    if (base > completedDay) return shiftDate(base, interval);
    const elapsed = Math.floor(
      (Date.parse(`${completedDay}T12:00Z`) - Date.parse(`${base}T12:00Z`)) /
        86400000,
    );
    return shiftDate(base, (Math.floor(elapsed / interval) + 1) * interval);
  }
  if (frequency === 'weekdays') {
    let next = shiftDate(base > completedDay ? base : completedDay, 1);
    while ([0, 6].includes(new Date(next + 'T12:00Z').getUTCDay()))
      next = shiftDate(next, 1);
    return next;
  }
  const day = task.data.recurrenceAnchor
    ? new Date(stringValue(task.data.recurrenceAnchor) + 'T12:00Z').getUTCDate()
    : new Date(base + 'T12:00Z').getUTCDate();
  if (frequency === 'monthly' || frequency === 'yearly') {
    const interval = (frequency === 'yearly' ? 12 : 1) * amount;
    const start = new Date(base + 'T12:00Z');
    const end = new Date(completedDay + 'T12:00Z');
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      end.getUTCMonth() -
      start.getUTCMonth();
    let steps =
      base > completedDay ? 1 : Math.max(1, Math.ceil(months / interval));
    const candidate = (count: number) => {
      const date = new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth() + count * interval,
          1,
          12,
        ),
      );
      const last = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate();
      date.setUTCDate(Math.min(day, last));
      return date.toISOString().slice(0, 10);
    };
    let next = candidate(steps);
    if (next <= completedDay) next = candidate(++steps);
    return next;
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
