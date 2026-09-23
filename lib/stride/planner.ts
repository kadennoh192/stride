import {
  dateKey,
  shiftDate,
  type Assignment,
  type Entity,
  type Project,
  type Settings,
  type Task,
} from './types';

export type WorkItem = Task | Assignment;
export interface PlanBlock {
  id: string;
  kind: 'task' | 'assignment';
  title: string;
  start: string;
  end: string;
  fixed: boolean;
}
export interface PlanIssue {
  id: string;
  title: string;
  reason: string;
}
export interface PlanProposal {
  blocks: PlanBlock[];
  changes: {
    id: string;
    kind: 'task' | 'assignment';
    plannedStart: string;
    before: string;
  }[];
  issues: PlanIssue[];
  days: { date: string; available: number; planned: number; fixed: number }[];
}

const duration = (item: WorkItem) =>
  Math.max(1, Number(item.data.duration) || 30);
const startOf = (item: WorkItem) => item.data.plannedStart || '';
const active = (item: WorkItem) =>
  item.kind === 'task' ? !item.data.completedAt : item.data.status !== 'Done';
const zoneOf = (settings: Settings) =>
  settings.timezone ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  'UTC';

/** Turn a wall-clock date and time into an instant, including DST transitions. */
export function zonedInstant(date: string, time: string, zone: string): Date {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let instant = wall;
  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(
      format
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const actual = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += wall - actual;
  }
  return new Date(instant);
}

function deadline(
  item: WorkItem,
  projects: Map<string, Project>,
  zone: string,
): number {
  const own = item.data.due || '';
  const project =
    item.kind === 'task'
      ? projects.get(item.data.project)?.data.deadline || ''
      : '';
  const date =
    own && project ? (own < project ? own : project) : own || project;
  if (!date) return Infinity;
  const time = own === date && item.data.time ? item.data.time : '23:59';
  return zonedInstant(date, time, item.data.timezone || zone).getTime();
}

function fixedBlocks(items: WorkItem[], zone: string): PlanBlock[] {
  return items
    .filter(
      (item) =>
        item.kind === 'task' && active(item) && item.data.due && item.data.time,
    )
    .map((item) => {
      const start = zonedInstant(
        item.data.due,
        item.data.time,
        item.data.timezone || zone,
      ).getTime();
      return {
        id: item.id,
        kind: item.kind,
        title: item.data.title,
        start: new Date(start).toISOString(),
        end: new Date(start + duration(item) * 60000).toISOString(),
        fixed: true,
      };
    });
}

function firstFit(
  from: number,
  until: number,
  length: number,
  occupied: PlanBlock[],
  days: { date: string; start: number; end: number }[],
): number | null {
  for (const day of days) {
    let cursor = Math.max(from, day.start);
    if (cursor + length > day.end || cursor + length > until) continue;
    for (const block of occupied) {
      const begin = Date.parse(block.start),
        end = Date.parse(block.end);
      if (end <= cursor || begin >= day.end) continue;
      if (cursor + length <= begin) break;
      cursor = Math.max(cursor, end);
    }
    if (cursor + length <= day.end && cursor + length <= until) return cursor;
  }
  return null;
}

export function planWorkspace(
  entities: Entity[],
  settings: Settings,
  now = new Date(),
  horizon = 14,
  onlyMissed = false,
  preferredOrder: string[] = [],
): PlanProposal {
  const zone = zoneOf(settings),
    today = dateKey(now, zone),
    projects = new Map(
      entities
        .filter((e): e is Project => e.kind === 'project')
        .map((p) => [p.id, p]),
    );
  const all = entities
    .filter((e): e is WorkItem => e.kind === 'task' || e.kind === 'assignment')
    .filter(active);
  const items = onlyMissed
    ? all.filter(
        (item) =>
          (item.data.due && item.data.due < today) ||
          (startOf(item) && Date.parse(startOf(item)) < now.getTime()),
      )
    : all;
  const fixed = fixedBlocks(all, zone);
  const blocks = [...fixed].sort((a, b) => a.start.localeCompare(b.start));
  if (onlyMissed)
    for (const item of all)
      if (
        !items.includes(item) &&
        startOf(item) &&
        !(item.kind === 'task' && item.data.due && item.data.time)
      ) {
        const begin = Date.parse(startOf(item));
        if (Number.isFinite(begin))
          blocks.push({
            id: item.id,
            kind: item.kind,
            title: item.data.title,
            start: new Date(begin).toISOString(),
            end: new Date(begin + duration(item) * 60000).toISOString(),
            fixed: false,
          });
      }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  const days = Array.from({ length: horizon }, (_, index) => {
    const date = shiftDate(today, index),
      weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const enabled = settings.workingDays.includes(weekday);
    const start = zonedInstant(date, settings.workStart, zone).getTime(),
      end = zonedInstant(date, settings.workEnd, zone).getTime();
    return { date, start, end: enabled ? end : start };
  });
  const issues: PlanIssue[] = [],
    changes: PlanProposal['changes'] = [];
  const taskMap = new Map(
    all
      .filter((item): item is Task => item.kind === 'task')
      .map((item) => [item.id, item]),
  );
  const pending = items.filter(
    (item) => !(item.kind === 'task' && item.data.due && item.data.time),
  );
  pending.sort(
    (a, b) =>
      deadline(a, projects, zone) - deadline(b, projects, zone) ||
      a.data.priority - b.data.priority ||
      (preferredOrder.includes(a.id)
        ? preferredOrder.indexOf(a.id)
        : Infinity) -
        (preferredOrder.includes(b.id)
          ? preferredOrder.indexOf(b.id)
          : Infinity) ||
      a.data.title.localeCompare(b.data.title),
  );
  const unresolved = new Set(pending.map((item) => item.id));
  for (let pass = 0; pass < pending.length; pass++) {
    let progressed = false;
    for (const item of pending) {
      if (!unresolved.has(item.id)) continue;
      const unmet =
        item.kind === 'task'
          ? item.data.dependencies
              .map((id) => taskMap.get(id))
              .filter((task): task is Task => !!task && !task.data.completedAt)
          : [];
      if (unmet.some((task) => unresolved.has(task.id))) continue;
      unresolved.delete(item.id);
      progressed = true;
      if (unmet.some((task) => !blocks.some((block) => block.id === task.id))) {
        issues.push({
          id: item.id,
          title: item.data.title,
          reason: `Blocked by ${unmet.map((task) => task.data.title).join(', ')}`,
        });
        continue;
      }
      const ready = Math.max(
        now.getTime(),
        ...unmet.map((task) =>
          Date.parse(blocks.find((block) => block.id === task.id)!.end),
        ),
      );
      const originalDeadline = deadline(item, projects, zone);
      const limit =
        onlyMissed && originalDeadline < now.getTime()
          ? Infinity
          : originalDeadline;
      const slot = firstFit(ready, limit, duration(item) * 60000, blocks, days);
      if (slot === null) {
        issues.push({
          id: item.id,
          title: item.data.title,
          reason:
            limit < now.getTime()
              ? 'Deadline passed; no valid slot'
              : 'No capacity before deadline in the next 14 days',
        });
        continue;
      }
      const plannedStart = new Date(slot).toISOString();
      blocks.push({
        id: item.id,
        kind: item.kind,
        title: item.data.title,
        start: plannedStart,
        end: new Date(slot + duration(item) * 60000).toISOString(),
        fixed: false,
      });
      blocks.sort((a, b) => a.start.localeCompare(b.start));
      if (startOf(item) !== plannedStart)
        changes.push({
          id: item.id,
          kind: item.kind,
          before: startOf(item),
          plannedStart,
        });
    }
    if (!progressed) break;
  }
  for (const item of pending)
    if (unresolved.has(item.id))
      issues.push({
        id: item.id,
        title: item.data.title,
        reason: 'Blocked by unmet dependencies',
      });
  for (const item of all) {
    if (item.kind !== 'task' || !item.data.due || !item.data.time) continue;
    const fixedBlock = blocks.find((block) => block.id === item.id);
    const unmet = item.data.dependencies
      .map((id) => taskMap.get(id))
      .filter((task): task is Task => !!task && !task.data.completedAt)
      .filter(
        (task) =>
          !blocks.some(
            (block) =>
              block.id === task.id &&
              Date.parse(block.end) <= Date.parse(fixedBlock!.start),
          ),
      );
    if (unmet.length)
      issues.push({
        id: item.id,
        title: item.data.title,
        reason: `Fixed time is blocked by ${unmet.map((task) => task.data.title).join(', ')}`,
      });
  }
  return {
    blocks,
    changes,
    issues,
    days: days.map((day) => {
      const overlap = (block: PlanBlock) =>
        Math.max(
          0,
          Math.min(day.end, Date.parse(block.end)) -
            Math.max(day.start, Date.parse(block.start)),
        ) / 60000;
      return {
        date: day.date,
        available: Math.max(
          0,
          (day.end - Math.max(day.start, now.getTime())) / 60000,
        ),
        planned: blocks
          .filter((block) => !block.fixed)
          .reduce((sum, block) => sum + overlap(block), 0),
        fixed: blocks
          .filter((block) => block.fixed)
          .reduce((sum, block) => sum + overlap(block), 0),
      };
    }),
  };
}

export function nextTask(
  entities: Entity[],
  settings: Settings,
  now = new Date(),
) {
  const plan = planWorkspace(entities, settings, now);
  const zone = zoneOf(settings),
    today = dateKey(now, zone);
  const day = plan.days.find((item) => item.date === today);
  const next = plan.blocks.find(
    (block) =>
      block.kind === 'task' &&
      !block.fixed &&
      Date.parse(block.end) > now.getTime(),
  );
  if (!next)
    return {
      task: null,
      reason: day?.available
        ? 'No ready task fits the remaining working time.'
        : 'Outside working hours or no working time remains.',
      freeMinutes: 0,
    };
  const task =
    entities.find(
      (item): item is Task => item.kind === 'task' && item.id === next.id,
    ) || null;
  const previous = plan.blocks
    .filter((block) => Date.parse(block.end) <= Date.parse(next.start))
    .at(-1);
  const freeMinutes = Math.max(
    0,
    Math.round(
      (Date.parse(next.start) -
        Math.max(
          now.getTime(),
          previous ? Date.parse(previous.end) : now.getTime(),
        )) /
        60000,
    ),
  );
  return {
    task,
    reason: task
      ? `${Date.parse(next.start) <= now.getTime() + 60000 ? 'Ready now' : `Next slot ${new Date(next.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}; P${task.data.priority}, ${duration(task)} minutes${task.data.due ? `, due ${task.data.due}` : ''}.`
      : 'Next block is a School assignment.',
    freeMinutes,
  };
}

export function projectHealth(
  project: Project,
  entities: Entity[],
  settings: Settings,
  now = new Date(),
): string[] {
  const zone = zoneOf(settings),
    today = dateKey(now, zone);
  const tasks = entities.filter(
    (item): item is Task =>
      item.kind === 'task' && item.data.project === project.id,
  );
  const allTasks = entities.filter(
    (item): item is Task => item.kind === 'task',
  );
  const open = tasks.filter((task) => !task.data.completedAt);
  const issues: string[] = [];
  if (open.some((task) => task.data.due && task.data.due < today))
    issues.push('Overdue work');
  if (
    open.some((task) =>
      task.data.dependencies.some((id) =>
        allTasks.some((dep) => dep.id === id && !dep.data.completedAt),
      ),
    )
  )
    issues.push('Unmet dependencies');
  if (
    open.length &&
    !open.some((task) =>
      task.data.dependencies.every(
        (id) => !allTasks.some((dep) => dep.id === id && !dep.data.completedAt),
      ),
    )
  )
    issues.push('No next action');
  const latest = Math.max(
    Date.parse(project.data.startedAt || '') || 0,
    ...tasks.map((task) => Date.parse(task.data.completedAt || '') || 0),
  );
  if (open.length && latest > 0 && now.getTime() - latest > 14 * 86400000)
    issues.push('No progress for 14 days');
  if (project.data.deadline) {
    if (project.data.deadline < today && open.length)
      issues.push('Past project deadline');
    const remaining = open.reduce((sum, task) => sum + duration(task), 0);
    const plan = planWorkspace(
      entities,
      settings,
      now,
      Math.min(
        90,
        Math.max(
          1,
          Math.ceil(
            (Date.parse(project.data.deadline) - Date.parse(today)) / 86400000,
          ) + 1,
        ),
      ),
    );
    const own = new Set(open.map((task) => task.id));
    const capacity = plan.days
      .filter((day) => day.date <= project.data.deadline!)
      .reduce((sum, day) => {
        const start = zonedInstant(
          day.date,
          settings.workStart,
          zone,
        ).getTime();
        const end = zonedInstant(day.date, settings.workEnd, zone).getTime();
        const occupied = plan.blocks
          .filter((block) => !own.has(block.id))
          .reduce(
            (total, block) =>
              total +
              Math.max(
                0,
                Math.min(end, Date.parse(block.end)) -
                  Math.max(start, now.getTime(), Date.parse(block.start)),
              ) /
                60000,
            0,
          );
        return sum + Math.max(0, day.available - occupied);
      }, 0);
    if (remaining > capacity)
      issues.push('Remaining work exceeds capacity before deadline');
  }
  return issues;
}

export function estimateSuggestion(
  task: Task,
  entities: Entity[],
): number | null {
  const peers = entities.filter(
    (item): item is Task =>
      item.kind === 'task' &&
      item.id !== task.id &&
      !!item.data.completedAt &&
      item.data.project === task.data.project &&
      item.data.priority === task.data.priority,
  );
  const samples = peers
    .map((peer) =>
      entities
        .filter(
          (item) =>
            item.kind === 'session' &&
            item.data.phase === 'focus' &&
            item.data.task === peer.id,
        )
        .reduce((sum, session) => sum + Number(session.data.duration) / 60, 0),
    )
    .filter((value) => value > 0);
  if (samples.length < 3) return null;
  samples.sort((a, b) => a - b);
  return Math.max(
    5,
    Math.round(samples[Math.floor(samples.length / 2)] / 5) * 5,
  );
}
