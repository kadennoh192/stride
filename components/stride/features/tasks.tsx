'use client';
import { stringValue } from '@/lib/stride/types';

import { useMemo, useState } from 'react';
import {
  Plus,
  Sun,
  Inbox,
  Check,
  Trash2,
  CalendarDays,
  Search,
  Link2,
  Sparkles,
  Archive,
  ArrowUpRight,
} from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import { taskData, dateKey, type Task, type Project } from '@/lib/stride/types';
import { dependencyCycle, filterTasks } from '@/lib/stride/domain';
import { parseTask } from '@/lib/stride/ai';
import { Modal, Empty } from '../primitives';
import { Field, Select, CheckList } from '../forms';
import { CalendarView } from './views';
export const priorityOptions = [
  { value: '1', label: 'P1 · Urgent' },
  { value: '2', label: 'P2 · High' },
  { value: '3', label: 'P3 · Medium' },
  { value: '4', label: 'P4 · Normal' },
];
export function TaskEditor({
  task,
  initial = {},
  onClose,
}: {
  task?: Task;
  initial?: Record<string, unknown>;
  onClose: () => void;
}) {
  const store = useStride();
  const [data, setData] = useState<Task['data']>(() =>
    taskData(task?.data.title || '', task ? task.data : initial),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiText, setAiText] = useState('');
  const [sendContext, setSendContext] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const projects = store.entities.filter(
    (e) => e.kind === 'project',
  ) as Project[];
  const tasks = useMemo(
    () => store.entities.filter((e) => e.kind === 'task') as Task[],
    [store.entities],
  );
  const id = task?.id || '';
  const update = (part: Partial<Task['data']>) =>
    setData((d) => ({ ...d, ...part }));
  const children = tasks.filter((t) => t.data.parent === id && id);
  const [childTitle, setChildTitle] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (dependencyCycle(id || 'new', data.dependencies, tasks))
        throw new Error('These dependencies would create a cycle.');
      if (
        data.parent &&
        (data.parent === id ||
          tasks.some((t) => t.id === data.parent && t.data.parent === id))
      )
        throw new Error('A task cannot be its own ancestor.');
      if (task) await store.update(task, data, 'Edited task');
      else await store.add('task', data, 'Added task');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : stringValue(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={task ? 'Task details' : 'Add a task'}
      detail={!!task}
      quickAdd={!task}
      paneWidth={Number(store.settings.taskPaneWidth || 460)}
      onPaneWidthChange={(width) =>
        void store.setSettings({ taskPaneWidth: width })
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="editor-toolbar">
          <button
            type="button"
            className={`subtle-button ${aiMode ? 'active' : ''}`}
            onClick={() => setAiMode(!aiMode)}
          >
            <Sparkles size={17} />
            Parse with Gemini
          </button>
          {task && (
            <button
              type="button"
              className="subtle-button"
              onClick={() => void store.complete(task).then(onClose)}
            >
              <Check size={17} />
              {task.data.completedAt ? 'Reopen' : 'Complete'}
            </button>
          )}
        </div>
        {aiMode && (
          <div className="inset-panel">
            <Field label="Describe your task">
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="Prepare the proposal next Friday at 10am, high priority…"
              />
            </Field>
            <label className="checkline">
              <input
                type="checkbox"
                checked={sendContext}
                onChange={(e) => setSendContext(e.target.checked)}
              />
              Include project names, sections and task titles for reference
              matching
            </label>
            <p className="muted">
              Only this text and your selected context are sent to Google.
              Review all fields before saving.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !aiText.trim()}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const parsed = await parseTask(
                    aiText,
                    localStorage.getItem('stride-gemini-key') || '',
                    store.settings.model,
                    sendContext ? store.entities : [],
                    store.settings.timezone ||
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                  );
                  setData(parsed);
                  store.notice(
                    'Parsed task ready. Review the fields before saving.',
                  );
                } catch (e) {
                  setError(stringValue(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Parsing…' : 'Preview parsed task'}
            </button>
          </div>
        )}
        <div className="form-grid">
          <Field label="Task" wide>
            <input
              required
              maxLength={1000}
              value={data.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="What’s your next step?"
            />
          </Field>
          <Field label="Description" wide>
            <textarea
              value={data.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
          <Field label="Project">
            <Select
              value={data.project}
              onChange={(project) => update({ project, section: '' })}
              options={[
                { value: 'inbox', label: 'Inbox' },
                ...projects.map((p) => ({ value: p.id, label: p.data.title })),
              ]}
            />
          </Field>
          <Field label="Section">
            <Select
              value={data.section}
              onChange={(section) => update({ section })}
              options={[
                { value: '', label: 'No section' },
                ...(projects.find((p) => p.id === data.project)?.data
                  .sections || []),
              ]}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={data.due}
              onChange={(e) =>
                update({
                  due: e.target.value,
                  ...(!e.target.value ? { time: '' } : {}),
                })
              }
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              value={data.time}
              onChange={(e) => update({ time: e.target.value })}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={stringValue(data.priority)}
              onChange={(priority) => update({ priority: Number(priority) })}
              options={priorityOptions}
            />
          </Field>
          <Field label="Status">
            <Select
              value={data.status}
              onChange={(status) => update({ status })}
              options={['To do', 'In progress', 'Waiting']}
            />
          </Field>
          <Field label="Tags (comma separated)">
            <input
              value={data.tags.join(', ')}
              onChange={(e) =>
                update({
                  tags: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              type="number"
              min={0}
              max={10080}
              value={data.duration}
              onChange={(e) => update({ duration: Number(e.target.value) })}
            />
          </Field>
          <Field label="Repeat">
            <Select
              value={data.recurrence.split(':')[0]}
              onChange={(recurrence) => update({ recurrence })}
              options={[
                { value: 'none', label: 'Does not repeat' },
                { value: 'daily', label: 'Daily' },
                { value: 'weekdays', label: 'Weekdays' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
                { value: 'after-days', label: 'Days after completion' },
              ]}
            />
          </Field>
          <Field label="Repeat interval">
            <input
              type="number"
              min={1}
              max={365}
              disabled={['none', 'weekdays'].includes(data.recurrence)}
              value={data.recurrence.split(':')[1] || 1}
              onChange={(e) =>
                update({
                  recurrence: `${data.recurrence.split(':')[0]}:${e.target.value}`,
                })
              }
            />
          </Field>
          <Field label="Timezone">
            <input
              list="timezones"
              value={data.timezone}
              onChange={(e) => update({ timezone: e.target.value })}
            />
          </Field>
          <Field label="Parent task">
            <Select
              value={data.parent}
              onChange={(parent) => update({ parent })}
              options={[
                { value: '', label: 'No parent' },
                ...tasks
                  .filter((t) => t.id !== id && !t.data.completedAt)
                  .map((t) => ({ value: t.id, label: t.data.title })),
              ]}
            />
          </Field>
          <Field label="Dependencies" wide>
            <select
              multiple
              value={data.dependencies}
              onChange={(e) =>
                update({
                  dependencies: Array.from(
                    e.target.selectedOptions,
                    (o) => o.value,
                  ),
                })
              }
            >
              {tasks
                .filter((t) => t.id !== id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.data.title}
                  </option>
                ))}
            </select>
            <small className="muted">
              Complete these tasks first. Use Ctrl/⌘ to select multiple on
              desktop.
            </small>
          </Field>
          <label className="checkline">
            <input
              type="checkbox"
              checked={data.important}
              onChange={(e) => update({ important: e.target.checked })}
            />
            Important in the Eisenhower Matrix
          </label>
        </div>
        <CheckList
          value={data.checklist || []}
          onChange={(checklist) => update({ checklist })}
        />
        <CheckList
          label="Quick subtasks"
          value={data.subtasks || []}
          onChange={(subtasks) => update({ subtasks })}
        />
        {task && (
          <div className="inset-panel">
            <h3>Nested tasks</h3>
            {children.map((t) => (
              <div className="checkline" key={t.id}>
                <input
                  type="checkbox"
                  checked={!!t.data.completedAt}
                  onChange={() => void store.complete(t)}
                />
                <a href={`#task/${t.id}`} onClick={onClose}>
                  {t.data.title}
                </a>
              </div>
            ))}
            <div className="inline-add">
              <input
                aria-label="New nested task"
                placeholder="Add a nested task"
                value={childTitle}
                onChange={(e) => setChildTitle(e.target.value)}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={!childTitle.trim()}
                onClick={async () => {
                  await store.add(
                    'task',
                    taskData(childTitle, {
                      parent: task.id,
                      project: data.project,
                    }),
                  );
                  setChildTitle('');
                }}
              >
                Add
              </button>
            </div>
          </div>
        )}
        <details className="inset-panel">
          <summary>Reminders</summary>
          <p className="muted">
            Background reminders need account sync and push setup in Settings.
          </p>
          <Field label="Reminder rules (one per line)">
            <textarea
              value={data.reminders.join('\n')}
              onChange={(e) =>
                update({
                  reminders: e.target.value.split('\n').filter(Boolean),
                })
              }
              placeholder="due&#10;before:10&#10;daily:09:00"
            />
          </Field>
          <p className="muted">
            Use due, before:10 (minutes before due), daily:09:00, or a full ISO
            timestamp.
          </p>
          {task && (
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void store
                    .update(task, { reminderAcknowledgedAt: Date.now() })
                    .then(() => store.notice('Current reminders acknowledged'))
                }
              >
                Acknowledge
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  update({
                    reminders: [
                      ...data.reminders,
                      new Date(Date.now() + 600000).toISOString(),
                    ],
                    reminderAcknowledgedAt: Date.now(),
                  });
                  store.notice('Snooze added. Save the task to apply.');
                }}
              >
                Snooze 10 minutes
              </button>
            </div>
          )}
          <Field label="Repeat until completed (minutes, 0 to disable)">
            <input
              type="number"
              min={0}
              step={5}
              max={1440}
              value={data.repeatMinutes}
              onChange={(e) =>
                update({ repeatMinutes: Number(e.target.value) })
              }
            />
          </Field>
          <p className="muted">
            Repeat delivery is limited to 12 attempts per occurrence, respects
            quiet hours, and stops on completion.
          </p>
        </details>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          {task && (
            <button
              type="button"
              className="subtle-button danger"
              onClick={() => void store.remove(task).then(onClose)}
            >
              <Trash2 size={17} />
              Delete
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Working…' : 'Save task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TaskRow({
  task,
  onEdit,
}: {
  task: Task;
  onEdit: (t: Task) => void;
}) {
  const store = useStride();
  const project = store.entities.find((e) => e.id === task.data.project);
  return (
    <div
      className={`task-row ${task.data.completedAt ? 'completed' : ''}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/stride-task', task.id)}
    >
      <input
        type="checkbox"
        className={`task-check priority-${task.data.priority}`}
        checked={!!task.data.completedAt}
        aria-label={`${task.data.completedAt ? 'Reopen' : 'Complete'} ${task.data.title}`}
        onChange={() => void store.complete(task)}
      />
      <div className="task-content">
        <button className="task-title" onClick={() => onEdit(task)}>
          {task.data.title}
        </button>
        <div className="task-meta">
          {task.data.due && (
            <span
              className={
                task.data.due < dateKey() && !task.data.completedAt
                  ? 'overdue'
                  : ''
              }
            >
              <CalendarDays size={12} />
              {task.data.due} {task.data.time}
            </span>
          )}
          {task.data.recurrence !== 'none' && (
            <span>↻ {task.data.recurrence}</span>
          )}
          {task.data.tags.map((tag) => (
            <span className="tag" key={tag}>
              #{tag}
            </span>
          ))}
          {task.data.dependencies.length > 0 && (
            <span>
              <Link2 size={12} />
              {task.data.dependencies.length}
            </span>
          )}
          {task.data.parent && <span>Subtask</span>}
        </div>
      </div>
      <span className="task-project">
        {stringValue(project?.data.title || 'Inbox')}
        <i
          className="project-dot"
          style={{ background: stringValue(project?.data.color || '#9198b0') }}
        />
      </span>
    </div>
  );
}
export function Tasks({
  route,
  onEdit,
  onAdd,
}: {
  route: string;
  onEdit: (t: Task) => void;
  onAdd: (initial?: Record<string, unknown>) => void;
}) {
  const store = useStride();
  const [query, setQuery] = useState('');
  const [view, setView] = useState('list');
  const [priority, setPriority] = useState('');
  const [tag, setTag] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(0);
  const [quick, setQuick] = useState('');
  const tasks = useMemo(
    () => store.entities.filter((e) => e.kind === 'task') as Task[],
    [store.entities],
  );
  const today = dateKey(new Date(), store.settings.timezone || undefined);
  const project = store.entities.find(
    (e) => e.id === route.split('/')[1] && e.kind === 'project',
  ) as Project | undefined;
  const saved = store.entities.find(
    (e) => e.id === route.split('/')[1] && e.kind === 'view',
  );
  const base = useMemo(
    () =>
      tasks.filter((t) => {
        if (route === 'archive') return !!t.data.completedAt;
        if (t.data.completedAt) return false;
        if (route === 'inbox') return t.data.project === 'inbox';
        if (route === 'today') return t.data.due !== '' && t.data.due <= today;
        if (route === 'upcoming') return !!t.data.due && t.data.due >= today;
        if (project) return t.data.project === project.id;
        return true;
      }),
    [tasks, route, today, project],
  );
  const shown = useMemo(
    () =>
      filterTasks(base, {
        query,
        priority,
        tag,
        project: projectFilter,
        ...(saved?.data.filter as Record<string, string>),
      }).sort(
        (a, b) =>
          a.data.due.localeCompare(b.data.due) ||
          a.data.priority - b.data.priority,
      ),
    [base, query, priority, tag, projectFilter, saved],
  );
  const title =
    project?.data.title ||
    (saved
      ? stringValue(saved.data.title)
      : (
          {
            today: 'Today',
            inbox: 'Inbox',
            upcoming: 'Upcoming',
            tasks: 'All tasks',
            archive: 'Completed tasks',
            filters: 'Filters & labels',
          } as Record<string, string>
        )[route] || 'Tasks');
  const completedToday = store.entities.filter(
    (e) => e.kind === 'completion' && stringValue(e.data.at).startsWith(today),
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>
            {title}
            {route === 'today' && <Sun className="sun-icon" />}
          </h1>
          <p>
            {route === 'today'
              ? new Date().toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })
              : `${shown.length} ${route === 'archive' ? 'completed' : 'active'} tasks`}
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() =>
            onAdd({
              ...(project ? { project: project.id } : {}),
              ...(route === 'today' ? { due: today } : {}),
            })
          }
        >
          <Plus size={18} />
          Add task
        </button>
      </div>
      <div
        className={
          route === 'today' && store.settings.rightPanel ? 'today-layout' : ''
        }
      >
        <section>
          <div className="viewbar">
            {['list', 'board', 'table', 'timeline'].map((v) => (
              <button
                className={`view-tab ${view === v ? 'active' : ''}`}
                key={v}
                onClick={() => setView(v)}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
            {project && (
              <button
                className="icon-button"
                onClick={() =>
                  (location.hash = `project-settings/${project.id}`)
                }
                aria-label="Project settings"
              >
                ⚙
              </button>
            )}
          </div>
          <div className="filterbar">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Filter tasks"
                placeholder="Filter tasks…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              label="Priority filter"
              value={priority}
              onChange={(v) => {
                setPriority(v);
                setPage(0);
              }}
              options={[
                { value: '', label: 'All priorities' },
                ...priorityOptions,
              ]}
            />
            <Select
              label="Label filter"
              value={tag}
              onChange={setTag}
              options={[
                { value: '', label: 'All labels' },
                ...new Set(tasks.flatMap((t) => t.data.tags)),
              ]}
            />
            {route === 'filters' && (
              <>
                <Select
                  label="Project filter"
                  value={projectFilter}
                  onChange={setProjectFilter}
                  options={[
                    { value: '', label: 'All projects' },
                    ...store.entities
                      .filter((e) => e.kind === 'project')
                      .map((e) => ({
                        value: e.id,
                        label: stringValue(e.data.title),
                      })),
                  ]}
                />
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const name = `${tag ? `#${tag} ` : ''}${priority ? `P${priority} ` : ''}${query || 'Saved filter'}`;
                    await store.add('view', {
                      title: name,
                      filter: { query, priority, tag, project: projectFilter },
                    });
                    store.notice('Filter saved in navigation');
                  }}
                >
                  Save filter
                </button>
              </>
            )}
          </div>
          {route === 'today' && (
            <div className="day-summary">
              <div className="progress-ring">
                <Check size={20} />
              </div>
              <div>
                <strong>One step at a time</strong>
                <p>
                  {completedToday} completed today · daily goal{' '}
                  {store.settings.dailyGoal}
                </p>
              </div>
              <span className="summary-percent">
                {Math.min(
                  100,
                  Math.round((completedToday / store.settings.dailyGoal) * 100),
                )}
                %
              </span>
            </div>
          )}
          {view === 'list' ? (
            <>
              {shown.length === 0 ? (
                <Empty
                  icon={route === 'archive' ? <Archive /> : <Inbox />}
                  title={
                    query || tag || priority
                      ? 'No matching tasks'
                      : route === 'today'
                        ? 'A little room in your day'
                        : 'Your list is clear'
                  }
                >
                  Add a task when you’re ready.
                </Empty>
              ) : (
                shown
                  .slice(page * 100, page * 100 + 100)
                  .map((t) => <TaskRow key={t.id} task={t} onEdit={onEdit} />)
              )}
              {shown.length > 100 && (
                <div className="pagination">
                  <button
                    className="secondary-button"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page + 1} of {Math.ceil(shown.length / 100)}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={(page + 1) * 100 >= shown.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          ) : (
            <CalendarView tasks={shown} mode={view} onEdit={onEdit} />
          )}
          {route !== 'archive' && (
            <form
              className="inline-add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (quick.trim()) {
                  await store.add(
                    'task',
                    taskData(quick, {
                      project: project?.id || 'inbox',
                      due: route === 'today' ? today : '',
                    }),
                  );
                  setQuick('');
                }
              }}
            >
              <Plus size={19} />
              <input
                aria-label="Quick add task"
                placeholder="Add a task"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
              />
              <button
                type="submit"
                className="subtle-button"
                disabled={!quick.trim()}
              >
                Add
              </button>
            </form>
          )}
        </section>
        {route === 'today' && store.settings.rightPanel && (
          <aside className="day-aside">
            <div className="focus-card">
              <span className="card-kicker">MAKE SOME SPACE</span>
              <h2>A moment to focus.</h2>
              <p>Choose one task and give it your attention.</p>
              <a className="focus-start" href="#focus">
                Start a focus session <ArrowUpRight size={16} />
              </a>
            </div>
            <div className="aside-section">
              <h3>Your daily rhythm</h3>
              <p className="muted">Build a routine that works for you.</p>
              <a className="secondary-button" href="#habits">
                Open habits
              </a>
            </div>
            <div className="aside-section">
              <h3>Your momentum</h3>
              <p className="muted">
                {store.entities.filter((e) => e.kind === 'completion').length *
                  10}{' '}
                XP earned from completed tasks
              </p>
              <a href="#insights">View insights →</a>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
export function ProjectEditor({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const store = useStride();
  const [title, setTitle] = useState(project?.data.title || '');
  const [sections, setSections] = useState(
    project?.data.sections.join('\n') || '',
  );
  const [color, setColor] = useState(project?.data.color || '#6179d9');
  const [background, setBackground] = useState(project?.data.background || '');
  return (
    <Modal
      title={project ? 'Project settings' : 'New project'}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = {
            title,
            color,
            background,
            sections: sections
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          };
          if (project) await store.update(project, data);
          else await store.add('project', data);
          onClose();
        }}
      >
        <Field label="Name">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </Field>
        <Field label="Sections (one per line)">
          <textarea
            value={sections}
            onChange={(e) => setSections(e.target.value)}
          />
        </Field>
        <Field label="Background color">
          <input
            type="color"
            value={background || '#ffffff'}
            onChange={(e) => setBackground(e.target.value)}
          />
        </Field>
        <div className="form-actions">
          {project && (
            <button
              className="secondary-button"
              type="button"
              onClick={async () => {
                const edits = store.entities
                  .filter(
                    (e) => e.kind === 'task' && e.data.project === project.id,
                  )
                  .map((e) => ({
                    id: e.id,
                    kind: e.kind,
                    data: { project: 'inbox', section: '' },
                  }));
                await store.edit(
                  [
                    ...edits,
                    {
                      id: project.id,
                      kind: 'project',
                      data: { _deleted: true },
                    },
                  ],
                  'Deleted project; moved tasks to Inbox',
                );
                onClose();
              }}
            >
              Delete project
            </button>
          )}
          <button className="primary-button">Save project</button>
        </div>
      </form>
    </Modal>
  );
}
