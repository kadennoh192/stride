'use client';
import { useMemo, useState } from 'react';
import { useStride } from '@/lib/stride/store';
import {
  dateKey,
  shiftDate,
  uid,
  stringValue,
  type Assignment,
  type Countdown,
  type Habit,
  type HabitLog,
  type Project,
  type Task,
} from '@/lib/stride/types';
import { geminiPlan } from '@/lib/stride/ai';
import {
  nextTask,
  planWorkspace,
  projectHealth,
  type PlanProposal,
} from '@/lib/stride/planner';
import { TaskRow } from './tasks';
import { WeatherCard } from './weather';
import { Modal } from '../primitives';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const asClock = (instant: string) =>
  new Date(instant).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

export function PlannerSetup() {
  const store = useStride();
  const [days, setDays] = useState(store.settings.workingDays);
  const [start, setStart] = useState(store.settings.workStart);
  const [end, setEnd] = useState(store.settings.workEnd);
  const [gemini, setGemini] = useState(store.settings.geminiPlanning);
  const [weather, setWeather] = useState(store.settings.weatherEnabled);
  const [locationMode, setLocationMode] = useState(
    store.settings.weatherLocation,
  );
  const [error, setError] = useState('');
  if (store.settings.plannerSetup) return null;
  return (
    <Modal title="Set up your day" open onClose={() => {}}>
      <p>Choose when you usually work. You can change this in Settings.</p>
      <div className="planner-days">
        {weekdays.map((name, day) => (
          <label key={day} className="checkline">
            <input
              type="checkbox"
              checked={days.includes(day)}
              onChange={(event) =>
                setDays(
                  event.target.checked
                    ? [...days, day].sort((a, b) => a - b)
                    : days.filter((value) => value !== day),
                )
              }
            />
            {name}
          </label>
        ))}
      </div>
      <div className="form-grid">
        <label>
          Start{' '}
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          End{' '}
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <label className="checkline">
        <input
          type="checkbox"
          checked={gemini}
          onChange={(e) => setGemini(e.target.checked)}
        />
        Offer Gemini planning proposals on request
      </label>
      <label className="checkline">
        <input
          type="checkbox"
          checked={weather}
          onChange={(e) => setWeather(e.target.checked)}
        />
        Show weather on Today
      </label>
      {weather && (
        <fieldset>
          <legend>Weather location</legend>
          <label className="checkline">
            <input
              type="radio"
              name="setup-weather-location"
              checked={locationMode === 'ip'}
              onChange={() => setLocationMode('ip')}
            />
            Approximate IP location
          </label>
          <label className="checkline">
            <input
              type="radio"
              name="setup-weather-location"
              checked={locationMode === 'gps'}
              onChange={() => setLocationMode('gps')}
            />
            GPS location (asks permission when weather loads)
          </label>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button
          className="primary-button"
          onClick={() => {
            if (!days.length || start >= end) {
              setError(
                'Choose at least one working day and valid working hours.',
              );
              return;
            }
            void store.setSettings({
              plannerSetup: true,
              workingDays: days,
              workStart: start,
              workEnd: end,
              geminiPlanning: gemini,
              weatherEnabled: weather,
              weatherLocation: locationMode,
            });
          }}
        >
          Save day setup
        </button>
      </div>
    </Modal>
  );
}

function PlanPreview({
  proposal,
  close,
  title,
}: {
  proposal: PlanProposal;
  close: () => void;
  title: string;
}) {
  const store = useStride();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} open onClose={close}>
      <p>
        {proposal.changes.length} planned slots to update. Due dates and fixed
        times stay unchanged.
      </p>
      <div className="plan-preview-list">
        {proposal.changes.map((change) => {
          const entity = store.entities.find((item) => item.id === change.id);
          return (
            <div key={change.id} className="dashboard-line">
              <strong>{stringValue(entity?.data.title)}</strong>
              <span>
                {change.before ? `${asClock(change.before)} → ` : ''}
                {new Date(change.plannedStart).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      {!!proposal.issues.length && (
        <>
          <h3>Could not fit</h3>
          <ul>
            {proposal.issues.map((issue) => (
              <li key={issue.id}>
                {issue.title}: {issue.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="form-actions">
        <button className="secondary-button" onClick={close}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={!proposal.changes.length || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await store.edit(
                proposal.changes.map((change) => ({
                  id: change.id,
                  kind: change.kind,
                  data: { plannedStart: change.plannedStart },
                })),
                title,
              );
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply as one undoable edit
        </button>
      </div>
    </Modal>
  );
}

export function DayDashboard({
  onEdit,
  onAdd,
}: {
  onEdit: (task: Task) => void;
  onAdd: (data?: Record<string, unknown>) => void;
}) {
  const store = useStride();
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [proposalTitle, setProposalTitle] = useState('');
  const [error, setError] = useState('');
  const today = dateKey(new Date(), store.settings.timezone || undefined);
  const plan = useMemo(
    () => planWorkspace(store.entities, store.settings),
    [store.entities, store.settings],
  );
  const recommendation = useMemo(
    () => nextTask(store.entities, store.settings),
    [store.entities, store.settings],
  );
  const cards = store.settings.dashboardCards || [];
  const planned = plan.blocks.filter(
    (block) =>
      dateKey(new Date(block.start), store.settings.timezone || undefined) ===
      today,
  );
  const day = plan.days[0];
  const tasks = store.entities.filter(
    (item): item is Task => item.kind === 'task',
  );
  const habits = store.entities.filter(
    (item): item is Habit => item.kind === 'habit',
  );
  const logs = store.entities.filter(
    (item): item is HabitLog => item.kind === 'habitLog',
  );
  const countdowns = store.entities
    .filter(
      (item): item is Countdown =>
        item.kind === 'countdown' && item.data.date >= today,
    )
    .sort((a, b) => a.data.date.localeCompare(b.data.date))
    .slice(0, 3);
  const completed = tasks.filter(
    (task) =>
      !!task.data.completedAt &&
      dateKey(
        new Date(task.data.completedAt),
        store.settings.timezone || undefined,
      ) === today,
  ).length;
  const focus = store.entities
    .filter(
      (item) =>
        item.kind === 'session' &&
        item.data.phase === 'focus' &&
        dateKey(
          new Date(item.data.at),
          store.settings.timezone || undefined,
        ) === today,
    )
    .reduce((sum, item) => sum + Number(item.data.duration) / 60, 0);
  const show = (name: string) => cards.includes(name);
  const openProposal = (value: PlanProposal, title: string) => {
    setProposal(value);
    setProposalTitle(title);
    setError('');
  };
  const runGemini = async () => {
    try {
      setError('');
      const value = await geminiPlan(
        store.entities,
        store.settings,
        localStorage.getItem('stride-gemini-key') || '',
      );
      openProposal(value, 'Gemini planning proposal');
    } catch (reason) {
      setError(String(reason));
    }
  };
  const startFocus = async (task: Task) => {
    const duration = store.settings.focusMinutes * 60;
    await store.setSettings({
      activeTimer: {
        id: uid(),
        phase: 'focus',
        duration,
        remaining: duration,
        end: Date.now() + duration * 1000,
        running: true,
        cycle: 1,
        task: task.id,
      },
    });
    location.assign('#focus');
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR DAILY DASHBOARD</div>
          <h1>Today</h1>
          <p>
            {new Date().toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => onAdd({ due: today })}
        >
          Add task
        </button>
      </div>
      <div className="dashboard-actions">
        <button
          className="secondary-button"
          onClick={() =>
            openProposal(
              planWorkspace(store.entities, store.settings),
              'Smart day plan',
            )
          }
        >
          Build plan
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            openProposal(
              planWorkspace(
                store.entities,
                store.settings,
                new Date(),
                14,
                true,
              ),
              'Reschedule missed work',
            )
          }
        >
          Reschedule missed
        </button>
        {store.settings.geminiPlanning && (
          <button className="secondary-button" onClick={() => void runGemini()}>
            Request Gemini proposal
          </button>
        )}
        <a className="secondary-button" href="#weekly-review">
          Weekly review
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="dashboard-grid">
        {cards.map((card) => {
          if (
            !show(card) ||
            (card === 'weather' && !store.settings.weatherEnabled)
          )
            return null;
          if (card === 'plan')
            return (
              <section className="dashboard-card" key={card}>
                <h2>Day plan</h2>
                <p>
                  {Math.round(day?.available || 0)}m available ·{' '}
                  {Math.round(day?.planned || 0)}m planned ·{' '}
                  {Math.round(day?.fixed || 0)}m fixed
                </p>
                {planned.map((block) => (
                  <div className="dashboard-line" key={block.id}>
                    <span>
                      {asClock(block.start)}–{asClock(block.end)}{' '}
                      {block.fixed ? '• fixed' : ''}
                    </span>
                    <button
                      className="subtle-button"
                      onClick={() => {
                        const item = store.entities.find(
                          (value) => value.id === block.id,
                        );
                        if (item?.kind === 'task') onEdit(item);
                        else location.assign(`#assignment/${block.id}`);
                      }}
                    >
                      {block.title}
                    </button>
                  </div>
                ))}
                {!!plan.issues.length && (
                  <details>
                    <summary>
                      {plan.issues.length} tasks cannot fit or are blocked
                    </summary>
                    <ul>
                      {plan.issues.map((issue) => (
                        <li key={issue.id}>
                          {issue.title}: {issue.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          if (card === 'next')
            return (
              <section className="dashboard-card" key={card}>
                <h2>What should I do next?</h2>
                {recommendation.task ? (
                  <>
                    <strong>{recommendation.task.data.title}</strong>
                    <p>{recommendation.reason}</p>
                    <div className="dashboard-actions">
                      <button
                        className="secondary-button"
                        onClick={() => onEdit(recommendation.task!)}
                      >
                        Open task
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => void startFocus(recommendation.task!)}
                      >
                        Start linked focus
                      </button>
                    </div>
                  </>
                ) : (
                  <p>{recommendation.reason}</p>
                )}
              </section>
            );
          if (card === 'habits')
            return (
              <section className="dashboard-card" key={card}>
                <h2>Habits</h2>
                <p>
                  {
                    habits.filter((habit) =>
                      logs.some(
                        (log) =>
                          log.data.habit === habit.id &&
                          log.data.date === today &&
                          log.data.value >= habit.data.goal,
                      ),
                    ).length
                  }{' '}
                  of {habits.length} complete
                </p>
                <a href="#habits">Open habits</a>
              </section>
            );
          if (card === 'focus')
            return (
              <section className="dashboard-card" key={card}>
                <h2>Focus goal</h2>
                <p>
                  {Math.round(focus)} of{' '}
                  {store.settings.cycles * store.settings.focusMinutes} minutes
                </p>
                <a href="#focus">Open focus</a>
              </section>
            );
          if (card === 'countdowns')
            return (
              <section className="dashboard-card" key={card}>
                <h2>Countdowns</h2>
                {countdowns.map((item) => (
                  <p key={item.id}>
                    {item.data.title} ·{' '}
                    {Math.ceil(
                      (Date.parse(item.data.date) - Date.now()) / 86400000,
                    )}{' '}
                    days
                  </p>
                ))}
                <a href="#countdowns">Open countdowns</a>
              </section>
            );
          if (card === 'progress')
            return (
              <section className="dashboard-card" key={card}>
                <h2>Progress</h2>
                <p>
                  {completed} task{completed === 1 ? '' : 's'} completed today
                </p>
                <p>
                  {
                    tasks.filter(
                      (task) =>
                        !task.data.completedAt &&
                        task.data.due &&
                        task.data.due < today,
                    ).length
                  }{' '}
                  overdue
                </p>
              </section>
            );
          if (card === 'weather') return <WeatherCard key={card} />;
          if (card === 'tasks')
            return (
              <section className="dashboard-card dashboard-wide" key={card}>
                <div className="dashboard-actions">
                  <h2>Tasks</h2>
                  <button
                    className="secondary-button"
                    onClick={() => onAdd({ due: today })}
                  >
                    Add task
                  </button>
                </div>
                {tasks
                  .filter(
                    (task) =>
                      !task.data.completedAt &&
                      ((task.data.due && task.data.due <= today) ||
                        (task.data.plannedStart &&
                          dateKey(
                            new Date(task.data.plannedStart),
                            store.settings.timezone || undefined,
                          ) === today)),
                  )
                  .map((task) => (
                    <TaskRow key={task.id} task={task} onEdit={onEdit} />
                  ))}
                <a href="#tasks">See all tasks</a>
              </section>
            );
          return null;
        })}
      </div>
      {proposal && (
        <PlanPreview
          proposal={proposal}
          title={proposalTitle}
          close={() => setProposal(null)}
        />
      )}
    </>
  );
}

export function WeeklyReview({ onEdit }: { onEdit: (task: Task) => void }) {
  const store = useStride();
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const today = dateKey(new Date(), store.settings.timezone || undefined),
    nextWeek = shiftDate(today, 7);
  const tasks = store.entities.filter(
    (item): item is Task => item.kind === 'task' && !item.data.completedAt,
  );
  const assignments = store.entities.filter(
    (item): item is Assignment =>
      item.kind === 'assignment' && item.data.status !== 'Done',
  );
  const projects = store.entities.filter(
    (item): item is Project => item.kind === 'project',
  );
  const habits = store.entities.filter(
    (item): item is Habit => item.kind === 'habit',
  );
  const missed = planWorkspace(
    store.entities,
    store.settings,
    new Date(),
    14,
    true,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESET AND REFLECT</div>
          <h1>Weekly Review</h1>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="dashboard-card">
          <h2>1. Overdue work</h2>
          {tasks
            .filter((task) => task.data.due && task.data.due < today)
            .map((task) => (
              <button
                className="dashboard-line"
                key={task.id}
                onClick={() => onEdit(task)}
              >
                {task.data.title} · due {task.data.due}
              </button>
            ))}
          {assignments
            .filter((item) => item.data.due && item.data.due < today)
            .map((item) => (
              <a key={item.id} href={`#assignment/${item.id}`}>
                {item.data.title} · due {item.data.due}
              </a>
            ))}
        </section>
        <section className="dashboard-card">
          <h2>2. Project health</h2>
          {projects.map((project) => {
            const issues = projectHealth(
              project,
              store.entities,
              store.settings,
            );
            return (
              <p key={project.id}>
                <a href={`#project/${project.id}`}>{project.data.title}</a>:{' '}
                {issues.length ? issues.join(' · ') : 'On track'}
              </p>
            );
          })}
        </section>
        <section className="dashboard-card">
          <h2>3. Habits</h2>
          {habits.map((habit) => (
            <p key={habit.id}>{habit.data.title}</p>
          ))}
          <a href="#habits">Review habits</a>
        </section>
        <section className="dashboard-card">
          <h2>4. Upcoming deadlines</h2>
          {tasks
            .filter(
              (task) => task.data.due >= today && task.data.due <= nextWeek,
            )
            .map((task) => (
              <button
                className="dashboard-line"
                key={task.id}
                onClick={() => onEdit(task)}
              >
                {task.data.title} · {task.data.due}
              </button>
            ))}
        </section>
        <section className="dashboard-card dashboard-wide">
          <h2>5. Reschedule missed work</h2>
          <p>
            {missed.changes.length} suggested moves · {missed.issues.length}{' '}
            cannot fit
          </p>
          <button
            className="primary-button"
            onClick={() => setProposal(missed)}
          >
            Preview rescheduling
          </button>
        </section>
      </div>
      {proposal && (
        <PlanPreview
          proposal={proposal}
          title="Weekly rescheduling"
          close={() => setProposal(null)}
        />
      )}
    </>
  );
}
