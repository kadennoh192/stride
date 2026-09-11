'use client';
import type { ActiveTimer } from '@/lib/stride/timer';
import { stringValue } from '@/lib/stride/types';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Flame,
  Plus,
  Timer,
  Play,
  Pause,
  RotateCcw,
  Settings,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Zap,
  CalendarDays,
  Check,
  ArrowUpRight,
} from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import { habitLogId } from '@/lib/stride/habits';
import {
  type Habit,
  type Task,
  uid,
  dateKey,
  shiftDate,
  taskData,
} from '@/lib/stride/types';
import { Modal, Empty } from '../primitives';
import { Field, Select } from '../forms';
import { TaskRow } from './tasks';
function HabitEditor({
  habit,
  onClose,
}: {
  habit?: Habit;
  onClose: () => void;
}) {
  const store = useStride();
  const [data, setData] = useState(
    habit?.data || {
      title: '',
      icon: '🌱',
      goal: 1,
      unit: 'times',
      color: '#5268e8',
      reminder: '',
      days: [0, 1, 2, 3, 4, 5, 6],
    },
  );
  return (
    <Modal
      open
      title={habit ? 'Habit settings' : 'Build a habit'}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (data.goal <= 0 || !data.days.length)
            throw new Error('Choose a positive goal and at least one day.');
          if (habit) await store.update(habit, data);
          else await store.add('habit', data);
          onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Habit" wide>
            <input
              required
              value={data.title}
              onChange={(e) => setData({ ...data, title: e.target.value })}
            />
          </Field>
          <Field label="Icon">
            <input
              maxLength={8}
              value={data.icon}
              onChange={(e) => setData({ ...data, icon: e.target.value })}
            />
          </Field>
          <Field label="Color">
            <input
              type="color"
              value={data.color}
              onChange={(e) => setData({ ...data, color: e.target.value })}
            />
          </Field>
          <Field label="Daily goal">
            <input
              type="number"
              min={0.1}
              step="any"
              value={data.goal}
              onChange={(e) =>
                setData({ ...data, goal: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Unit">
            <input
              value={data.unit}
              onChange={(e) => setData({ ...data, unit: e.target.value })}
            />
          </Field>
          <Field label="Daily reminder">
            <input
              type="time"
              value={data.reminder}
              onChange={(e) => setData({ ...data, reminder: e.target.value })}
            />
          </Field>
        </div>
        <div className="weekday-picker">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={data.days.includes(i)}
                onChange={(e) =>
                  setData({
                    ...data,
                    days: e.target.checked
                      ? [...data.days, i]
                      : data.days.filter((n) => n !== i),
                  })
                }
              />
              {d}
            </label>
          ))}
        </div>
        <div className="form-actions">
          {habit && (
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => void store.remove(habit).then(onClose)}
            >
              Delete habit
            </button>
          )}
          <button className="primary-button">Save habit</button>
        </div>
      </form>
    </Modal>
  );
}
export function Habits() {
  const store = useStride();
  const today = dateKey(new Date(), store.settings.timezone || undefined);
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const habits = store.entities.filter((e) => e.kind === 'habit') as Habit[];
  const days = Array.from({ length: 28 }, (_, i) => shiftDate(date, i - 27));
  const logs = useMemo(
    () =>
      new Map(
        store.entities
          .filter((e) => e.kind === 'habitLog')
          .map((e) => [`${e.data.habit}\n${e.data.date}`, e]),
      ),
    [store.entities],
  );
  const log = (h: Habit, d: string) => logs.get(`${h.id}\n${d}`);
  const value = (h: Habit, d: string) => Number(log(h, d)?.data.value || 0);
  const scheduled = (h: Habit, d: string) =>
    (h.data.days || [0, 1, 2, 3, 4, 5, 6]).includes(
      new Date(d + 'T12:00Z').getUTCDay(),
    );
  const setValue = async (h: Habit, d: string, v: number) =>
    store.edit(
      [
        {
          id: await habitLogId(h.id, d),
          kind: 'habitLog',
          data: {
            habit: h.id,
            date: d,
            value: Math.max(0, v),
            goal: h.data.goal,
            _deleted: false,
          },
        },
      ],
      'Logged habit',
    );
  const streak = (h: Habit) => {
    let total = 0;
    for (let i = 0; i < 3650; i++) {
      const d = shiftDate(date, -i);
      if (!scheduled(h, d)) continue;
      if (value(h, d) < Number(log(h, d)?.data.goal || h.data.goal)) {
        if (i === 0) continue;
        break;
      }
      total++;
    }
    return total;
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SMALL ACTIONS, LASTING CHANGE</div>
          <h1>
            Habits <Flame className="sun-icon" />
          </h1>
          <p>Your routine, at your pace.</p>
        </div>
        <button className="primary-button" onClick={() => setEditing('new')}>
          <Plus size={18} />
          New habit
        </button>
      </div>
      <div className="calendar-toolbar">
        <button
          className="icon-button"
          aria-label="Previous day"
          onClick={() => setDate(shiftDate(date, -1))}
        >
          <ChevronLeft />
        </button>
        <input
          type="date"
          aria-label="Habit history date"
          value={date}
          max={today}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
        <button
          className="icon-button"
          aria-label="Next day"
          disabled={date >= today}
          onClick={() => setDate(shiftDate(date, 1))}
        >
          <ChevronRight />
        </button>
        <button className="secondary-button" onClick={() => setDate(today)}>
          Today
        </button>
      </div>
      {habits.length === 0 ? (
        <Empty icon={<Flame />} title="Start with one small habit">
          Choose something achievable and make it yours.
        </Empty>
      ) : (
        <div className="habit-grid">
          {habits.map((h) => {
            const done = value(h, date);
            const scheduledDays = days.filter((d) => scheduled(h, d));
            const percent = Math.round(
              (scheduledDays.filter((d) => value(h, d) >= h.data.goal).length /
                Math.max(1, scheduledDays.length)) *
                100,
            );
            return (
              <section className="habit-card" key={h.id}>
                <div className="habit-card-heading">
                  <span className="habit-icon" style={{ color: h.data.color }}>
                    {h.data.icon}
                  </span>
                  <div>
                    <h3>{h.data.title}</h3>
                    <p className="muted">
                      {streak(h)} day streak · {percent}% over 28 days
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`${h.data.title} settings`}
                    onClick={() => setEditing(h)}
                  >
                    <Settings size={16} />
                  </button>
                </div>
                <div className="habit-progress">
                  <progress max={h.data.goal} value={done} />
                  <span>
                    {done} / {h.data.goal} {h.data.unit}
                  </span>
                </div>
                <div className="habit-actions">
                  <button
                    className="secondary-button"
                    disabled={done <= 0}
                    onClick={() => void setValue(h, date, done - 1)}
                  >
                    −
                  </button>
                  <input
                    aria-label={`Progress for ${h.data.title}`}
                    type="number"
                    min={0}
                    step="any"
                    value={done}
                    onChange={(e) =>
                      void setValue(h, date, Number(e.target.value))
                    }
                  />
                  <button
                    className="primary-button"
                    onClick={() => void setValue(h, date, done + 1)}
                  >
                    <Plus size={16} />
                    Log
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Reach goal for ${h.data.title}`}
                    onClick={() => void setValue(h, date, h.data.goal)}
                  >
                    <Check size={18} />
                  </button>
                </div>
                {!scheduled(h, date) && (
                  <p className="muted">
                    Rest day — optional progress still saves.
                  </p>
                )}
                <div className="habit-heatmap">
                  {days.map((d) => (
                    <button
                      key={d}
                      className={
                        value(h, d) >= h.data.goal
                          ? 'done'
                          : value(h, d) > 0
                            ? 'partial'
                            : ''
                      }
                      style={
                        value(h, d) >= h.data.goal
                          ? { background: h.data.color }
                          : undefined
                      }
                      title={`${d}: ${value(h, d)} / ${h.data.goal}`}
                      aria-label={`Edit ${h.data.title} on ${d}`}
                      onClick={() => setDate(d)}
                    >
                      {Number(d.slice(-2))}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {editing && (
        <HabitEditor
          habit={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
export function Focus() {
  const store = useStride();
  const [now, setNow] = useState(() => Date.now());
  const [task, setTask] = useState('');
  const [config, setConfig] = useState(false);
  const active = store.settings.activeTimer as ActiveTimer | undefined;
  const minutes = useCallback(
    (phase: ActiveTimer['phase']) =>
      phase === 'focus'
        ? store.settings.focusMinutes
        : phase === 'break'
          ? store.settings.breakMinutes
          : store.settings.longBreakMinutes,
    [
      store.settings.focusMinutes,
      store.settings.breakMinutes,
      store.settings.longBreakMinutes,
    ],
  );
  const remaining = active
    ? active.running
      ? Math.max(0, Math.ceil((active.end - now) / 1000))
      : active.remaining
    : store.settings.focusMinutes * 60;
  const start = async (phase: ActiveTimer['phase'] = 'focus', cycle = 1) => {
    await store.setSettings({
      activeTimer: {
        id: uid(),
        phase,
        duration: minutes(phase) * 60,
        remaining: minutes(phase) * 60,
        end: Date.now() + minutes(phase) * 60000,
        running: true,
        cycle,
        task,
      },
    });
  };
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  const sessions = store.entities
    .filter((e) => e.kind === 'session')
    .sort((a, b) =>
      stringValue(b.data.at).localeCompare(stringValue(a.data.at)),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE THING AT A TIME</div>
          <h1>Focus</h1>
          <p>A little space for your best work.</p>
        </div>
        <button className="secondary-button" onClick={() => setConfig(true)}>
          <Settings size={16} />
          Timer settings
        </button>
      </div>
      <section className="focus-workspace">
        <div className="focus-mode-tabs">
          {[
            ['focus', 'Focus'],
            ['break', 'Short break'],
            ['longBreak', 'Long break'],
          ].map(([p, label]) => (
            <button
              className={`view-tab ${active?.phase === p || (!active && p === 'focus') ? 'active' : ''}`}
              key={p}
              onClick={() =>
                void store.setSettings({
                  activeTimer: {
                    id: uid(),
                    phase: p,
                    duration: minutes(p as ActiveTimer['phase']) * 60,
                    remaining: minutes(p as ActiveTimer['phase']) * 60,
                    end: 0,
                    running: false,
                    cycle: active?.cycle || 1,
                    task,
                  },
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className={`timer-face ${active?.running ? 'running' : ''}`}
          style={
            {
              '--progress': `${(remaining / (active?.duration || store.settings.focusMinutes * 60)) * 360}deg`,
            } as React.CSSProperties
          }
        >
          <div>
            <span
              className="timer-digits"
              role="timer"
              aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds`}
            >
              {stringValue(Math.floor(remaining / 60)).padStart(2, '0')}:
              {stringValue(remaining % 60).padStart(2, '0')}
            </span>
            <span className="muted">
              {active?.running
                ? 'Stay with this moment'
                : active
                  ? 'Ready when you are'
                  : 'Make a little progress'}
            </span>
          </div>
        </div>
        <Select
          label="Task to focus on"
          value={active?.task || task}
          onChange={(v) => {
            setTask(v);
            if (active)
              void store.setSettings({ activeTimer: { ...active, task: v } });
          }}
          options={[
            { value: '', label: 'An open focus session' },
            ...store.entities
              .filter((e) => e.kind === 'task' && !e.data.completedAt)
              .map((e) => ({ value: e.id, label: stringValue(e.data.title) })),
          ]}
        />
        <div className="timer-controls">
          <button
            className="primary-button"
            onClick={async () => {
              if (!active) await start();
              else if (active.running)
                await store.setSettings({
                  activeTimer: { ...active, remaining, end: 0, running: false },
                });
              else
                await store.setSettings({
                  activeTimer: {
                    ...active,
                    end: Date.now() + remaining * 1000,
                    running: true,
                  },
                });
            }}
          >
            {active?.running ? (
              <>
                <Pause size={19} />
                Pause
              </>
            ) : (
              <>
                <Play size={19} />
                Start
              </>
            )}
          </button>
          <button
            className="secondary-button"
            onClick={() => void store.setSettings({ activeTimer: null })}
          >
            <RotateCcw size={17} />
            Reset
          </button>
        </div>
        <p className="muted">
          Cycle {active?.cycle || 1} · long break every {store.settings.cycles}{' '}
          cycles
        </p>
        <p className="muted">
          The timer keeps its end time when closed. Background alerts require
          push setup.
        </p>
      </section>
      <h2 className="section-title">Session history</h2>
      <div className="session-list">
        {sessions.slice(0, 30).map((s) => (
          <div className="activity-row" key={s.id}>
            <Timer size={16} />
            <span>
              {s.data.phase === 'focus' ? 'Focus' : 'Break'} ·{' '}
              {Math.round(Number(s.data.duration) / 60)} minutes
            </span>
            <time>{new Date(stringValue(s.data.at)).toLocaleString()}</time>
          </div>
        ))}
        {!sessions.length && (
          <p className="muted">Your completed intervals will appear here.</p>
        )}
      </div>
      {config && (
        <Modal title="Focus settings" open onClose={() => setConfig(false)}>
          <div className="form-grid">
            {[
              ['focusMinutes', 'Focus minutes', 1, 180],
              ['breakMinutes', 'Short break minutes', 1, 60],
              ['longBreakMinutes', 'Long break minutes', 1, 120],
              ['cycles', 'Cycles before long break', 1, 12],
            ].map(([key, label, min, max]) => (
              <Field key={stringValue(key)} label={stringValue(label)}>
                <input
                  type="number"
                  min={Number(min)}
                  max={Number(max)}
                  value={Number(store.settings[stringValue(key)])}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= Number(min) && v <= Number(max))
                      void store.setSettings({ [key]: v });
                  }}
                />
              </Field>
            ))}
          </div>
          <p className="muted">
            New settings apply to the next interval. Breaks start when you
            choose Start.
          </p>
        </Modal>
      )}
    </>
  );
}
export function Matrix({ onEdit }: { onEdit: (t: Task) => void }) {
  const store = useStride();
  const tasks = store.entities.filter(
    (e) => e.kind === 'task' && !e.data.completedAt,
  ) as Task[];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CHOOSE WHAT DESERVES YOUR ATTENTION</div>
          <h1>Eisenhower Matrix</h1>
          <p>
            P1 or overdue tasks are urgent. Mark importance in task details.
          </p>
        </div>
      </div>
      <div className="matrix-grid">
        {[
          {
            title: 'Do first',
            hint: 'Urgent & important',
            urgent: true,
            important: true,
          },
          {
            title: 'Schedule',
            hint: 'Important, less urgent',
            urgent: false,
            important: true,
          },
          {
            title: 'Delegate or simplify',
            hint: 'Urgent, less important',
            urgent: true,
            important: false,
          },
          {
            title: 'Reconsider',
            hint: 'Neither urgent nor important',
            urgent: false,
            important: false,
          },
        ].map((q, i) => (
          <section
            className={`matrix-quadrant quadrant-${i}`}
            key={q.title}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const t = tasks.find(
                (t) => t.id === e.dataTransfer.getData('text/stride-task'),
              );
              if (t)
                void store.update(t, {
                  important: q.important,
                  priority: q.urgent ? 1 : 4,
                  ...(!q.urgent && t.data.due && t.data.due <= dateKey()
                    ? { due: shiftDate(dateKey(), 1) }
                    : {}),
                });
            }}
          >
            <h2>{q.title}</h2>
            <p className="muted">{q.hint}</p>
            {tasks
              .filter(
                (t) =>
                  (t.data.priority === 1 ||
                    (!!t.data.due && t.data.due <= dateKey())) === q.urgent &&
                  !!t.data.important === q.important,
              )
              .map((t) => (
                <TaskRow task={t} key={t.id} onEdit={onEdit} />
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
export function Countdowns() {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const store = useStride();
  const [newTitle, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(i);
  }, []);
  const events = store.entities.filter((e) => e.kind === 'countdown');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SOMETHING TO LOOK FORWARD TO</div>
          <h1>Countdowns</h1>
        </div>
      </div>
      <form
        className="inset-panel form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          await store.add('countdown', {
            title: newTitle,
            date: new Date(date).toISOString(),
            timezone: zone,
          });
          setTitle('');
          setDate('');
        }}
      >
        <Field label="Event">
          <input
            required
            value={newTitle}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={`Date and time · ${zone}`}>
          <input
            required
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <button className="primary-button">
          <Plus size={16} />
          Add countdown
        </button>
      </form>
      <div className="countdown-grid">
        {events.map((e) => {
          const left = new Date(stringValue(e.data.date)).getTime() - now;
          return (
            <section className="countdown-card" key={e.id}>
              <CalendarDays size={22} />
              <h2>{stringValue(e.data.title)}</h2>
              <strong>{Math.abs(Math.ceil(left / 86400000))}</strong>
              <span>{left >= 0 ? 'days to go' : 'days ago'}</span>
              <p className="muted">
                {new Date(stringValue(e.data.date)).toLocaleString()}
              </p>
              <button
                className="icon-button"
                aria-label={`Delete ${e.data.title}`}
                onClick={() => void store.remove(e)}
              >
                <Trash2 size={16} />
              </button>
            </section>
          );
        })}
      </div>
    </>
  );
}
export function Insights() {
  const store = useStride();
  const [span, setSpan] = useState(30);
  const today = dateKey(new Date(), store.settings.timezone || undefined);
  const days = Array.from({ length: span }, (_, i) =>
    shiftDate(today, i - span + 1),
  );
  const completions = store.entities.filter((e) => e.kind === 'completion');
  const sessions = store.entities.filter(
    (e) => e.kind === 'session' && e.data.phase === 'focus',
  );
  const daily = new Map<string, number>();
  const zone = store.settings.timezone || undefined;
  for (const event of completions) {
    const day = dateKey(new Date(stringValue(event.data.at)), zone);
    daily.set(day, (daily.get(day) || 0) + 1);
  }
  const counts = days.map((day) => daily.get(day) || 0);
  const completed = counts.reduce((a, b) => a + b, 0);
  const focus = Math.round(
    sessions
      .filter((e) => {
        const day = dateKey(new Date(stringValue(e.data.at)), zone);
        return day >= days[0] && day <= today;
      })
      .reduce((s, e) => s + Number(e.data.duration), 0) / 60,
  );
  const xp = completions.length * 10;
  const level = Math.floor(xp / 100) + 1;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">NOTICE YOUR PROGRESS</div>
          <h1>Insights</h1>
          <p>Your activity, without the pressure.</p>
        </div>
        <Select
          label="Statistics period"
          value={stringValue(span)}
          onChange={(s) => setSpan(Number(s))}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
          ]}
        />
      </div>
      <div className="stats-grid">
        <div>
          <Check size={20} />
          <strong>{completed}</strong>
          <span>Tasks completed</span>
        </div>
        <div>
          <Timer size={20} />
          <strong>{focus}</strong>
          <span>Focus minutes</span>
        </div>
        <div>
          <Flame size={20} />
          <strong>
            {
              store.entities.filter(
                (e) =>
                  e.kind === 'habitLog' &&
                  stringValue(e.data.date) >= days[0] &&
                  Number(e.data.value) >= Number(e.data.goal || 1),
              ).length
            }
          </strong>
          <span>Habit goals reached</span>
        </div>
        <div>
          <Zap size={20} />
          <strong>{xp}</strong>
          <span>XP · Level {level}</span>
        </div>
      </div>
      <section className="insight-chart">
        <h2>Daily progress</h2>
        <p className="muted">Completed tasks over the last {span} days</p>
        <div
          className="bar-chart"
          aria-label={`Daily task completions. ${completed} completed over ${span} days.`}
        >
          {days.map((d, i) => (
            <div key={d} title={`${d}: ${counts[i]} tasks`}>
              <span
                style={{
                  height: `${Math.max(2, (counts[i] / Math.max(1, ...counts)) * 180)}px`,
                }}
              />
              <small>
                {span <= 30 && i % (span > 7 ? 5 : 1) === 0 ? d.slice(5) : ''}
              </small>
            </div>
          ))}
        </div>
        <details>
          <summary>View chart data</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Completed tasks</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d}>
                  <td>{d}</td>
                  <td>{counts[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
      <section className="inset-panel">
        <h3>Level {level}</h3>
        <progress max={100} value={xp % 100} />
        <p className="muted">
          {100 - (xp % 100)} XP to the next level. Each completed task
          occurrence earns 10 XP. Undoing a completion removes its reward.
        </p>
      </section>
    </>
  );
}
const templates = [
  {
    id: 'weekly',
    title: 'Weekly reset',
    description: 'Clear your inbox, review priorities, and plan the week.',
    tasks: [
      'Review your inbox',
      'Choose three priorities for the week',
      'Schedule time for deep work',
      'Reflect on last week',
    ],
  },
  {
    id: 'project',
    title: 'Project launch',
    description: 'Turn an idea into a clear, achievable project.',
    tasks: [
      'Define the outcome',
      'List milestones and dependencies',
      'Choose the first action',
      'Schedule a progress review',
    ],
  },
  {
    id: 'routine',
    title: 'A gentler morning',
    description: 'A short routine to start with intention.',
    tasks: [
      'Choose your most important task',
      'Make room for a mindful pause',
      'Plan a realistic day',
    ],
  },
];
const tips = [
  {
    title: 'Make the next step smaller',
    body: 'Write a task you could begin in two minutes. A clear starting point makes a large project easier to approach.',
  },
  {
    title: 'Leave room in your calendar',
    body: 'Unscheduled time gives you space for surprises, transitions, and rest. A full calendar is not a requirement for a useful day.',
  },
  {
    title: 'Keep a shutdown ritual',
    body: 'Review what moved forward, capture loose ends, and choose tomorrow’s first step. Then let the workday end.',
  },
  {
    title: 'Review the system, not yourself',
    body: 'When a routine keeps slipping, adjust its time, size, or context. A useful system should fit your life.',
  },
];
export function Explore() {
  const store = useStride();
  const [answer, setAnswer] = useState('');
  const [energy, setEnergy] = useState('');
  const [result, setResult] = useState(false);
  const applyTemplate = async (template: (typeof templates)[number]) => {
    const project = uid();
    await store.edit(
      [
        {
          id: project,
          kind: 'project',
          data: {
            title: template.title,
            color: '#5268e8',
            sections: ['Next', 'Later'],
            background: '',
          },
        },
        ...template.tasks.map((title) => ({
          id: uid(),
          kind: 'task' as const,
          data: taskData(title, { project }),
        })),
      ],
      'Applied template',
    );
    store.notice(`${template.title} added to your projects`);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FIND YOUR OWN RHYTHM</div>
          <h1>Explore</h1>
          <p>Ideas and starting points you can make your own.</p>
        </div>
      </div>
      <h2 className="section-title">Template gallery</h2>
      <div className="page-cards">
        {templates.map((t) => (
          <section className="page-card" key={t.id}>
            <span>↗</span>
            <h3>{t.title}</h3>
            <p className="muted">{t.description}</p>
            <button
              className="secondary-button"
              onClick={() => void applyTemplate(t)}
            >
              Use template <ArrowUpRight size={15} />
            </button>
          </section>
        ))}
      </div>
      <section className="quiz-panel">
        <h2>Find a setup that fits</h2>
        <p className="muted">
          A practical preference quiz, not a personality assessment.
        </p>
        <Field label="What most often gets in your way?">
          <Select
            value={answer}
            onChange={(v) => {
              setAnswer(v);
              setResult(false);
            }}
            options={[
              { value: '', label: 'Choose an answer' },
              { value: 'start', label: 'Getting started' },
              { value: 'organize', label: 'Keeping track of everything' },
              { value: 'focus', label: 'Staying focused' },
            ]}
          />
        </Field>
        <Field label="How much focused time feels realistic?">
          <Select
            value={energy}
            onChange={(v) => {
              setEnergy(v);
              setResult(false);
            }}
            options={[
              { value: '', label: 'Choose an answer' },
              { value: '15', label: '15 minutes' },
              { value: '25', label: '25 minutes' },
              { value: '45', label: '45 minutes' },
            ]}
          />
        </Field>
        <button
          className="primary-button"
          disabled={!answer || !energy}
          onClick={() => setResult(true)}
        >
          Show my suggestion
        </button>
        {result && (
          <div className="inset-panel">
            <h3>
              {answer === 'start'
                ? 'Begin with one small action'
                : answer === 'organize'
                  ? 'Make space for a weekly reset'
                  : 'Protect one focus interval'}
            </h3>
            <p className="muted">
              {answer === 'start'
                ? 'A simple project template gives you a concrete first step.'
                : answer === 'organize'
                  ? 'A weekly review helps turn a scattered inbox into a manageable plan.'
                  : 'A timed session creates a clear boundary for one task.'}{' '}
              Try {energy}-minute focus sessions based on the time you chose.
            </p>
            <button
              className="secondary-button"
              onClick={async () => {
                await store.setSettings({ focusMinutes: Number(energy) });
                if (answer !== 'focus')
                  await applyTemplate(templates[answer === 'organize' ? 0 : 1]);
                store.notice('Your suggested setup has been applied');
              }}
            >
              Apply suggestion
            </button>
          </div>
        )}
      </section>
      <h2 className="section-title">Inspiration hub</h2>
      <div className="inspiration-grid">
        {tips.map((t, i) => {
          const favorite = store.entities.find(
            (e) => e.id === `favorite-tip-${i}`,
          );
          return (
            <article className="inspiration-card" key={t.title}>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              <button
                className="subtle-button"
                onClick={() =>
                  void store.edit(
                    [
                      {
                        id: `favorite-tip-${i}`,
                        kind: 'favorite',
                        data: { title: t.title, tip: i, _deleted: !!favorite },
                      },
                    ],
                    'Updated inspiration favorite',
                  )
                }
              >
                {favorite ? '★ Saved' : '☆ Save inspiration'}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}
export function Activity() {
  const store = useStride();
  const [limit, setLimit] = useState(100);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE HISTORY</div>
          <h1>Activity</h1>
        </div>
      </div>
      {[...store.history]
        .reverse()
        .slice(0, limit)
        .map((change) => (
          <div className="activity-row" key={change.id}>
            <span>{change.label}</span>
            <time>{new Date(change.at).toLocaleString()}</time>
            <span className="muted">
              {new Set(change.fields.map((f) => f.entity)).size} records
            </span>
          </div>
        ))}
      {store.history.length > limit && (
        <button
          className="secondary-button"
          onClick={() => setLimit(limit + 100)}
        >
          Show more
        </button>
      )}
    </>
  );
}
