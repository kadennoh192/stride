import {
  dateKey,
  shiftDate,
  stringValue,
  taskData,
  uid,
  type Habit,
  type Task,
} from '@/lib/stride/types';
import { validDate } from '@/lib/stride/domain';
import { completionEdits } from '@/lib/stride/completion';
import { habitLogId } from '@/lib/stride/habits';
import { cloudEntities, saveCloudEdits } from '@/lib/server/workspace';
import { watchOwner } from '@/lib/server/watch';

const noStore = { 'Cache-Control': 'no-store' };

async function snapshot(owner: string) {
  const entities = await cloudEntities(owner);
  const settings = entities.find((entity) => entity.id === 'settings');
  const timezone = stringValue(settings?.data.timezone || 'UTC');
  const today = dateKey(new Date(), timezone);
  const through = shiftDate(today, 14);
  const tasks = (entities.filter((entity) => entity.kind === 'task') as Task[])
    .filter(
      (task) =>
        !task.data.completedAt && (!task.data.due || task.data.due <= through),
    )
    .sort(
      (left, right) =>
        (left.data.due || '9999').localeCompare(right.data.due || '9999') ||
        left.data.priority - right.data.priority,
    )
    .slice(0, 50)
    .map((task) => ({
      id: task.id,
      title: task.data.title,
      due: task.data.due,
      time: task.data.time,
      priority: task.data.priority,
      tags: task.data.tags,
      project: task.data.project,
    }));
  const logs = entities.filter(
    (entity) => entity.kind === 'habitLog' && entity.data.date === today,
  );
  const habits = (
    entities.filter((entity) => entity.kind === 'habit') as Habit[]
  )
    .filter((habit) =>
      habit.data.days.includes(new Date(`${today}T12:00:00Z`).getUTCDay()),
    )
    .map((habit) => ({
      id: habit.id,
      title: habit.data.title,
      icon: habit.data.icon,
      goal: habit.data.goal,
      unit: habit.data.unit,
      value: Number(
        logs.find((log) => log.data.habit === habit.id)?.data.value || 0,
      ),
    }));
  return {
    version: 1,
    serverTime: new Date().toISOString(),
    today,
    timezone,
    tasks,
    habits,
    timer: settings?.data.activeTimer || null,
  };
}

export async function GET(request: Request) {
  const owner = await watchOwner(request);
  if (!owner)
    return Response.json(
      { error: 'Pair this watch again.' },
      { status: 401, headers: noStore },
    );
  try {
    return Response.json(await snapshot(owner), { headers: noStore });
  } catch {
    return Response.json(
      { error: 'Watch sync is temporarily unavailable.' },
      { status: 503, headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  const owner = await watchOwner(request);
  if (!owner)
    return Response.json(
      { error: 'Pair this watch again.' },
      { status: 401, headers: noStore },
    );
  try {
    if (Number(request.headers.get('content-length')) > 20000)
      return Response.json({ error: 'Request too large' }, { status: 413 });
    const text = await request.text();
    if (text.length > 20000)
      return Response.json({ error: 'Request too large' }, { status: 413 });
    const input = JSON.parse(text) as Record<string, unknown>;
    const entities = await cloudEntities(owner);
    if (input.action === 'createTask') {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const due = typeof input.due === 'string' ? input.due : '';
      const time = typeof input.time === 'string' ? input.time : '';
      const priority = Number(input.priority || 4);
      const settings = entities.find((entity) => entity.id === 'settings');
      await saveCloudEdits(
        owner,
        [
          {
            id: uid(),
            kind: 'task',
            data: taskData(title, {
              due,
              time,
              priority,
              timezone: stringValue(settings?.data.timezone || 'UTC'),
            }),
          },
        ],
        'Added task from Apple Watch',
      );
    } else if (input.action === 'completeTask') {
      const task = entities.find(
        (entity): entity is Task =>
          entity.kind === 'task' && entity.id === input.taskId,
      );
      if (!task) throw new Error('Task not found');
      const unmet = entities.filter(
        (entity) =>
          entity.kind === 'task' &&
          task.data.dependencies.includes(entity.id) &&
          !entity.data.completedAt,
      );
      if (unmet.length) throw new Error('Complete dependencies first');
      const transition = await completionEdits(task);
      await saveCloudEdits(
        owner,
        transition.edits,
        'Completed task from Apple Watch',
      );
    } else if (input.action === 'logHabit') {
      const habit = entities.find(
        (entity): entity is Habit =>
          entity.kind === 'habit' && entity.id === input.habitId,
      );
      const date = typeof input.date === 'string' ? input.date : '';
      const value = Number(input.value);
      if (!habit || !validDate(date) || !Number.isFinite(value) || value < 0)
        throw new Error('Invalid habit log');
      const id = await habitLogId(habit.id, date);
      await saveCloudEdits(
        owner,
        [
          {
            id,
            kind: 'habitLog',
            data: { habit: habit.id, date, value, goal: habit.data.goal },
          },
        ],
        'Logged habit from Apple Watch',
      );
    } else if (input.action === 'startTimer') {
      const minutes = Number(input.minutes);
      const task = typeof input.taskId === 'string' ? input.taskId : '';
      if (
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 240 ||
        (task &&
          !entities.some(
            (entity) => entity.kind === 'task' && entity.id === task,
          ))
      )
        throw new Error('Invalid timer');
      const duration = minutes * 60;
      await saveCloudEdits(
        owner,
        [
          {
            id: 'settings',
            kind: 'settings',
            data: {
              activeTimer: {
                id: uid(),
                phase: 'focus',
                duration,
                remaining: duration,
                end: Date.now() + duration * 1000,
                running: true,
                cycle: 1,
                task,
              },
            },
          },
        ],
        'Started focus timer from Apple Watch',
      );
    } else if (input.action === 'pauseTimer') {
      const settings = entities.find((entity) => entity.id === 'settings');
      const timer = settings?.data.activeTimer;
      if (!timer || typeof timer !== 'object')
        throw new Error('No active timer');
      const active = timer as { end: number; remaining: number };
      await saveCloudEdits(
        owner,
        [
          {
            id: 'settings',
            kind: 'settings',
            data: {
              activeTimer: {
                ...timer,
                running: false,
                remaining: Math.max(
                  0,
                  active.end
                    ? Math.ceil((active.end - Date.now()) / 1000)
                    : active.remaining,
                ),
                end: 0,
              },
            },
          },
        ],
        'Paused focus timer from Apple Watch',
      );
    } else {
      return Response.json(
        { error: 'Invalid watch action' },
        { status: 400, headers: noStore },
      );
    }
    return Response.json(await snapshot(owner), { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expected =
      /Invalid|not found|dependencies|active timer|title|date|time|priority/i.test(
        message,
      );
    return Response.json(
      { error: expected ? message : 'Watch sync is temporarily unavailable.' },
      { status: expected ? 400 : 503, headers: noStore },
    );
  }
}
