'use client';
import { stringValue } from '@/lib/stride/types';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Plus } from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import {
  dateKey,
  shiftDate,
  type Task,
  type Assignment,
} from '@/lib/stride/types';
import { Select } from '../forms';
import { Empty } from '../primitives';
const modes = [
  'year',
  'month',
  'week',
  'multi-week',
  'multi-day',
  'agenda',
  'upcoming',
  'today',
  'list',
  'board',
  'table',
  'timeline',
];
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
function startWeek(date: string) {
  const day = new Date(date + 'T12:00Z').getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}
export function CalendarView({
  tasks,
  mode: fixed,
  onEdit,
  onReschedule,
  assignments = [],
}: {
  tasks: Task[];
  assignments?: Assignment[];
  mode?: string;
  onEdit: (task: Task) => void;
  onReschedule?: (id: string, date: string) => void;
}) {
  const store = useStride();
  const [mode, setMode] = useState(fixed || store.settings.calendarView);
  const active = fixed || mode;
  const [anchor, setAnchor] = useState(dateKey());
  const [span, setSpan] = useState(store.settings.calendarSpan);
  const [showCompleted, setShowCompleted] = useState(
    store.settings.calendarShowCompleted,
  );
  const [limit, setLimit] = useState(100);
  const visible = tasks.filter((t) => showCompleted || !t.data.completedAt);
  const date = new Date(anchor + 'T12:00Z');
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const start =
    active === 'month'
      ? startWeek(monthStart)
      : active === 'week' || active === 'multi-week'
        ? startWeek(anchor)
        : anchor;
  const count =
    active === 'month'
      ? 42
      : active === 'week'
        ? 7
        : active === 'multi-week'
          ? span * 7
          : active === 'multi-day'
            ? span
            : active === 'timeline'
              ? 14
              : 1;
  const dates = Array.from({ length: count }, (_, i) => shiftDate(start, i));
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of visible) {
      if (task.data.due) {
        const list = map.get(task.data.due) || [];
        list.push(task);
        map.set(task.data.due, list);
      }
    }
    return map;
  }, [visible]);
  const assignmentByDate = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of assignments)
      if (
        assignment.data.due &&
        (showCompleted || assignment.data.status !== 'Done')
      )
        map.set(assignment.data.due, [
          ...(map.get(assignment.data.due) || []),
          assignment,
        ]);
    return map;
  }, [assignments, showCompleted]);
  const plannedByDate = useMemo(() => {
    const map = new Map<string, (Task | Assignment)[]>();
    for (const item of [
      ...visible,
      ...assignments.filter(
        (assignment) => showCompleted || assignment.data.status !== 'Done',
      ),
    ]) {
      if (!item.data.plannedStart) continue;
      const date = dateKey(
        new Date(item.data.plannedStart),
        store.settings.timezone || undefined,
      );
      map.set(date, [...(map.get(date) || []), item]);
    }
    return map;
  }, [visible, assignments, showCompleted, store.settings.timezone]);
  const plannedEvent = (item: Task | Assignment) => (
    <button
      className="calendar-task planned-event"
      key={`planned-${item.id}`}
      onClick={() =>
        item.kind === 'task'
          ? onEdit(item)
          : location.assign(`#assignment/${item.id}`)
      }
    >
      ◷{' '}
      {new Date(item.data.plannedStart!).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}{' '}
      {item.data.title} · planned
    </button>
  );
  const assignmentEvent = (assignment: Assignment) => (
    <button
      key={assignment.id}
      className="calendar-task"
      aria-label={`Open assignment ${assignment.data.title}`}
      onClick={() => location.assign(`#assignment/${assignment.id}`)}
    >
      <span>{assignment.data.time}</span>📚 {assignment.data.title}
    </button>
  );
  const move = (direction: number) => {
    if (active === 'month' || active === 'year') {
      date.setUTCDate(1);
      date.setUTCMonth(
        date.getUTCMonth() + direction * (active === 'year' ? 12 : 1),
      );
      setAnchor(date.toISOString().slice(0, 10));
    } else
      setAnchor(
        shiftDate(
          anchor,
          direction *
            (active === 'week'
              ? 7
              : active === 'multi-week'
                ? span * 7
                : active === 'multi-day'
                  ? span
                  : 14),
        ),
      );
  };
  const drop = (event: React.DragEvent, due: string, status?: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/stride-task');
    const task = tasks.find((t) => t.id === id);
    if (task) {
      if (onReschedule && !status) {
        onReschedule(task.id, due);
        return;
      }
      if (status === 'Done') void store.complete(task);
      else
        void store.update(
          task,
          status ? { status } : { due },
          status ? 'Moved task' : 'Rescheduled task',
        );
    }
  };
  const event = (task: Task) => (
    <button
      className={`calendar-task priority-border-${task.data.priority}`}
      key={task.id}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/stride-task', task.id)}
      onClick={() => onEdit(task)}
    >
      <span>{task.data.time}</span>
      {task.data.title}
    </button>
  );
  return (
    <div className="calendar-view">
      {!fixed && (
        <div className="filterbar">
          <Select
            label="Calendar view"
            value={active}
            onChange={(next) => {
              setMode(next);
              void store.setSettings({ calendarView: next });
            }}
            options={modes}
          />
          <label className="checkline">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => {
                setShowCompleted(e.target.checked);
                void store.setSettings({
                  calendarShowCompleted: e.target.checked,
                });
              }}
            />
            Show completed
          </label>
        </div>
      )}
      {!['board', 'table', 'list'].includes(active) && (
        <div className="calendar-toolbar">
          <div>
            <button
              className="icon-button"
              aria-label="Previous period"
              onClick={() => move(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="secondary-button"
              onClick={() => setAnchor(dateKey())}
            >
              Today
            </button>
            <button
              className="icon-button"
              aria-label="Next period"
              onClick={() => move(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <h2>
            {date.toLocaleDateString(undefined, {
              month: active === 'year' ? undefined : 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </h2>
          <input
            aria-label="Calendar date"
            type="date"
            value={anchor}
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
          />
          {['multi-day', 'multi-week'].includes(active) && (
            <Select
              label="Visible days or weeks"
              value={stringValue(span)}
              onChange={(v) => {
                const next = Number(v);
                setSpan(next);
                void store.setSettings({ calendarSpan: next });
              }}
              options={['2', '3', '4', '5', '6']}
            />
          )}
        </div>
      )}
      {active === 'year' ? (
        <div className="year-grid">
          {Array.from({ length: 12 }, (_, month) => {
            const first = `${date.getUTCFullYear()}-${stringValue(month + 1).padStart(2, '0')}-01`;
            const begin = startWeek(first);
            return (
              <button
                key={month}
                className="mini-month"
                onClick={() => {
                  setAnchor(first);
                  setMode('month');
                }}
              >
                <h3>
                  {new Date(first + 'T12:00Z').toLocaleDateString(undefined, {
                    month: 'long',
                    timeZone: 'UTC',
                  })}
                </h3>
                <div className="mini-days">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                    <span key={`h${i}`} className="muted">
                      {d}
                    </span>
                  ))}
                  {Array.from({ length: 42 }, (_, i) => {
                    const d = shiftDate(begin, i);
                    return (
                      <span
                        key={d}
                        className={`${d.slice(0, 7) !== first.slice(0, 7) ? 'muted' : ''} ${byDate.has(d) || assignmentByDate.has(d) || plannedByDate.has(d) ? 'has-tasks' : ''} ${d === dateKey() ? 'today-cell' : ''}`}
                      >
                        {Number(d.slice(-2))}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      ) : active === 'month' || active === 'multi-week' ? (
        <div className="calendar-scroll">
          <div className="month-grid">
            {[
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
              'Sunday',
            ].map((d) => (
              <div className="day-label" key={d}>
                {d.slice(0, 3)}
              </div>
            ))}
            {dates.map((d) => (
              <div
                className={`month-cell ${d === dateKey() ? 'today-cell' : ''} ${active === 'month' && d.slice(0, 7) !== anchor.slice(0, 7) ? 'outside' : ''}`}
                key={d}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, d)}
              >
                <button
                  className="day-number"
                  aria-label={`Open ${d}`}
                  onClick={() => {
                    setAnchor(d);
                    setMode('today');
                  }}
                >
                  {Number(d.slice(-2))}
                </button>
                {(byDate.get(d) || []).slice(0, 5).map(event)}
                {(assignmentByDate.get(d) || [])
                  .slice(0, 5)
                  .map(assignmentEvent)}
                {(plannedByDate.get(d) || []).slice(0, 5).map(plannedEvent)}
                {(byDate.get(d)?.length || 0) > 5 && (
                  <button
                    className="subtle-button"
                    onClick={() => {
                      setAnchor(d);
                      setMode('today');
                    }}
                  >
                    +{byDate.get(d)!.length - 5} more
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : active === 'week' || active === 'multi-day' ? (
        <div className="calendar-scroll">
          <div
            className="week-grid"
            style={{
              gridTemplateColumns: `repeat(${count}, minmax(145px,1fr))`,
            }}
          >
            {dates.map((d) => (
              <div
                className="week-day"
                key={d}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, d)}
              >
                <h3 className={d === dateKey() ? 'today-cell' : ''}>
                  {new Date(d + 'T12:00Z').toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </h3>
                <div className="all-day">
                  {(byDate.get(d) || []).filter((t) => !t.data.time).map(event)}
                  {(assignmentByDate.get(d) || [])
                    .filter((item) => !item.data.time)
                    .map(assignmentEvent)}
                </div>
                {(plannedByDate.get(d) || []).map(plannedEvent)}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div className="hour-slot" key={hour}>
                    <span>{stringValue(hour).padStart(2, '0')}:00</span>
                    {(byDate.get(d) || [])
                      .filter(
                        (t) =>
                          Number(t.data.time.split(':')[0]) === hour &&
                          t.data.time,
                      )
                      .map(event)}
                    {(assignmentByDate.get(d) || [])
                      .filter(
                        (item) =>
                          Number(item.data.time.split(':')[0]) === hour &&
                          item.data.time,
                      )
                      .map(assignmentEvent)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : active === 'board' ? (
        <div className="board-grid">
          {['To do', 'In progress', 'Waiting', 'Done'].map((status) => (
            <section
              className="board-column"
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, '', status)}
            >
              <h3>
                {status}
                <span>
                  {
                    tasks.filter((t) =>
                      status === 'Done'
                        ? !!t.data.completedAt
                        : !t.data.completedAt && t.data.status === status,
                    ).length
                  }
                </span>
              </h3>
              {tasks
                .filter((t) =>
                  status === 'Done'
                    ? !!t.data.completedAt
                    : !t.data.completedAt && t.data.status === status,
                )
                .slice(0, 100)
                .map((t) => (
                  <div className="board-card" key={t.id}>
                    {event(t)}
                    <p className="muted">
                      {t.data.due || 'No date'} · P{t.data.priority}
                    </p>
                    <Select
                      label={`Move ${t.data.title}`}
                      value={t.data.completedAt ? 'Done' : t.data.status}
                      onChange={(v) => {
                        if (v === 'Done') void store.complete(t);
                        else
                          void store.update(t, { status: v, completedAt: '' });
                      }}
                      options={['To do', 'In progress', 'Waiting', 'Done']}
                    />
                  </div>
                ))}
            </section>
          ))}
        </div>
      ) : active === 'table' ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Due date</th>
                <th>Priority</th>
                <th>Duration</th>
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, limit).map((t) => (
                <tr key={t.id}>
                  <td>
                    <button className="task-title" onClick={() => onEdit(t)}>
                      {t.data.title}
                    </button>
                  </td>
                  <td>
                    <Select
                      label={`Status of ${t.data.title}`}
                      value={t.data.status}
                      onChange={(status) => void store.update(t, { status })}
                      options={['To do', 'In progress', 'Waiting']}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Due date of ${t.data.title}`}
                      type="date"
                      value={t.data.due}
                      onChange={(e) =>
                        void store.update(t, {
                          due: e.target.value,
                          ...(!e.target.value ? { time: '' } : {}),
                        })
                      }
                    />
                  </td>
                  <td>P{t.data.priority}</td>
                  <td>{t.data.duration}m</td>
                  <td>{t.data.tags.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length > limit && (
            <button
              className="secondary-button"
              onClick={() => setLimit(limit + 100)}
            >
              Show 100 more
            </button>
          )}
        </div>
      ) : active === 'timeline' ? (
        <div className="calendar-scroll">
          <div className="timeline">
            <div className="timeline-header">
              <span>Task</span>
              <div>
                {dates.map((d) => (
                  <span key={d}>{Number(d.slice(-2))}</span>
                ))}
              </div>
            </div>
            {visible
              .filter(
                (t) =>
                  t.data.due &&
                  t.data.due >= start &&
                  t.data.due <= dates.at(-1)!,
              )
              .slice(0, limit)
              .map((t) => (
                <div className="timeline-row" key={t.id}>
                  <button className="task-title" onClick={() => onEdit(t)}>
                    {t.data.title}
                  </button>
                  <div className="timeline-track">
                    <button
                      className="timeline-bar"
                      aria-label={`Edit ${t.data.title}, ${t.data.due}`}
                      onClick={() => onEdit(t)}
                      style={{
                        left: `${(daysBetween(t.data.due, start) / count) * 100}%`,
                        width: `${(Math.min(count - daysBetween(t.data.due, start), Math.max(1, t.data.duration / 1440)) / count) * 100}%`,
                      }}
                    >
                      {t.data.time || '•'}
                    </button>
                  </div>
                </div>
              ))}
            <p className="muted">
              Tasks use their due date and estimated duration. Open a task to
              adjust its schedule.
            </p>
          </div>
        </div>
      ) : (
        <div>
          {(active === 'today'
            ? [anchor]
            : [
                ...new Set([
                  ...[...visible, ...assignments]
                    .filter(
                      (t) => active !== 'upcoming' || t.data.due >= anchor,
                    )
                    .map((t) => t.data.due),
                  ...plannedByDate.keys(),
                ]),
              ].sort()
          ).map((d) => (
            <section key={d}>
              <h3 className="agenda-date">{d || 'No date'}</h3>
              {(d ? byDate.get(d) || [] : visible.filter((t) => !t.data.due))
                .slice(0, limit)
                .map((t) => (
                  <div className="agenda-task" key={t.id}>
                    <input
                      aria-label={`Complete ${t.data.title}`}
                      type="checkbox"
                      checked={!!t.data.completedAt}
                      onChange={() => void store.complete(t)}
                    />
                    {event(t)}
                    <span className="muted">{t.data.duration}m</span>
                  </div>
                ))}
              {(assignmentByDate.get(d) || []).map(assignmentEvent)}
              {(plannedByDate.get(d) || []).map(plannedEvent)}
            </section>
          ))}
          {visible.length === 0 && assignments.length === 0 && (
            <Empty icon={<CalendarDays />} title="A clear calendar">
              Scheduled tasks appear here.
            </Empty>
          )}
        </div>
      )}
    </div>
  );
}
export function Calendar({
  onEdit,
  onAdd,
}: {
  onEdit: (task: Task) => void;
  onAdd: () => void;
}) {
  const store = useStride();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE ROOM FOR WHAT MATTERS</div>
          <h1>Calendar</h1>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Plus size={18} />
          Add task
        </button>
      </div>
      <CalendarView
        tasks={store.entities.filter((e) => e.kind === 'task') as Task[]}
        assignments={
          store.entities.filter((e) => e.kind === 'assignment') as Assignment[]
        }
        onEdit={onEdit}
      />
    </>
  );
}
