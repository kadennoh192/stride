'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  Check,
  ListTodo,
  Plus,
  RefreshCw,
  Repeat2,
  Timer,
  Wifi,
  WifiOff,
} from 'lucide-react';

const TOKEN_KEY = 'stride-watch-link-token';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

interface WatchTask {
  id: string;
  title: string;
  due: string;
  time: string;
  priority: number;
  tags: string[];
  project: string;
}

interface WatchHabit {
  id: string;
  title: string;
  icon: string;
  goal: number;
  unit: string;
  value: number;
}

interface WatchTimer {
  duration: number;
  end: number;
  remaining: number;
  running: boolean;
}

interface WatchSnapshot {
  version: number;
  serverTime: string;
  today: string;
  timezone: string;
  tasks: WatchTask[];
  habits: WatchHabit[];
  timer: WatchTimer | null;
}

type WatchTab = 'tasks' | 'habits' | 'focus';

function tokenFromFragment() {
  const fragment = location.hash.slice(1);
  const candidate = fragment.startsWith('token=')
    ? new URLSearchParams(fragment).get('token') || ''
    : fragment;
  return tokenPattern.test(candidate) ? candidate : '';
}

function subscribeOnline(notify: () => void) {
  addEventListener('online', notify);
  addEventListener('offline', notify);
  return () => {
    removeEventListener('online', notify);
    removeEventListener('offline', notify);
  };
}

function readOnline() {
  return navigator.onLine;
}

export default function WatchLink() {
  const [token, setToken] = useState('');
  const [snapshot, setSnapshot] = useState<WatchSnapshot | null>(null);
  const [tab, setTab] = useState<WatchTab>('tasks');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connecting…');
  const [now, setNow] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);

  useEffect(() => {
    const fragmentToken = tokenFromFragment();
    let saved = '';
    try {
      saved = localStorage.getItem(TOKEN_KEY) || '';
      if (fragmentToken) localStorage.setItem(TOKEN_KEY, fragmentToken);
    } catch {
      // The original link remains usable when this web view blocks storage.
    }
    if (fragmentToken) history.replaceState(null, '', location.pathname);
    const next = fragmentToken || (tokenPattern.test(saved) ? saved : '');
    queueMicrotask(() => setToken(next));
  }, []);

  useEffect(() => {
    if (!snapshot?.timer?.running) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [snapshot?.timer?.running]);

  const request = useCallback(
    async (body?: Record<string, unknown>) => {
      if (!token) throw new Error('Open a fresh Watch Link from Stride.');
      if (!navigator.onLine)
        throw new Error('Watch Link needs internet. Nothing was changed.');
      const response = await fetch('/api/watch', {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      const responseText = await response.text();
      let data: (Partial<WatchSnapshot> & { error?: string }) | null = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText) as Partial<WatchSnapshot> & {
            error?: string;
          };
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        if (response.status === 401) {
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            // The current view can still disconnect in memory.
          }
          setToken('');
          setSnapshot(null);
        }
        throw new Error(
          data?.error ||
            (response.status === 401
              ? 'This Watch Link is no longer valid. Create a new one in Stride.'
              : 'Stride is temporarily unavailable.'),
        );
      }
      if (
        !data ||
        !Array.isArray(data.tasks) ||
        !Array.isArray(data.habits) ||
        typeof data.timezone !== 'string'
      )
        throw new Error(
          'Stride sent an incomplete update. Refresh to try again.',
        );
      const next = data as WatchSnapshot;
      setSnapshot(next);
      setMessage('Up to date');
      setNow(Date.now());
      return next;
    },
    [token],
  );

  const run = useCallback(
    async (body?: Record<string, unknown>) => {
      if (busy) return false;
      setBusy(true);
      setMessage(body ? 'Saving…' : 'Refreshing…');
      try {
        await request(body);
        return true;
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : 'Please try again.',
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, request],
  );

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => {
      void request()
        .catch((error) =>
          setMessage(
            error instanceof Error ? error.message : 'Please try again.',
          ),
        )
        .finally(() => setBusy(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [token, request]);

  const addTask = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    const id = `watch-${crypto.randomUUID()}`;
    void run({ action: 'createTask', id, title: value }).then((saved) => {
      if (saved) setTitle('');
    });
  };

  const disconnect = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Clearing the in-memory credential is still sufficient for this view.
    }
    setToken('');
    setSnapshot(null);
    setMessage('Disconnected on this browser.');
  };

  const timer = snapshot?.timer;
  const timerSeconds = timer
    ? timer.running
      ? Math.max(0, Math.ceil((timer.end - now) / 1000))
      : Math.max(0, timer.remaining)
    : 0;
  const timerLabel = `${Math.floor(timerSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(timerSeconds % 60).toString().padStart(2, '0')}`;

  if (!token) {
    return (
      <main className="watch-link-shell watch-link-empty">
        <div className="watch-link-mark">S</div>
        <h1>Open your Watch Link</h1>
        <p>
          In Stride, open Settings → Apple Watch, create a link, then send it to
          yourself by Mail or Messages.
        </p>
        <p className="watch-link-note">
          This small companion works only while connected to the internet.
        </p>
      </main>
    );
  }

  return (
    <main className="watch-link-shell">
      <header className="watch-link-header">
        <div>
          <strong>Stride</strong>
          <span className={online ? 'online' : 'offline'}>
            {online ? <Wifi /> : <WifiOff />}
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
        <button
          type="button"
          className="watch-link-icon"
          aria-label="Refresh Stride"
          disabled={busy || !online}
          onClick={() => void run()}
        >
          <RefreshCw />
        </button>
      </header>

      <nav className="watch-link-tabs" aria-label="Watch Link sections">
        <button
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => setTab('tasks')}
        >
          <ListTodo /> Tasks
        </button>
        <button
          className={tab === 'habits' ? 'active' : ''}
          onClick={() => setTab('habits')}
        >
          <Repeat2 /> Habits
        </button>
        <button
          className={tab === 'focus' ? 'active' : ''}
          onClick={() => setTab('focus')}
        >
          <Timer /> Focus
        </button>
      </nav>

      <output
        className={`watch-link-status ${!online || message.includes('needs') ? 'warning' : ''}`}
        aria-live="polite"
      >
        {message}
      </output>

      {tab === 'tasks' && (
        <section className="watch-link-content" aria-labelledby="watch-tasks">
          <h1 id="watch-tasks">Upcoming</h1>
          <form className="watch-link-add" onSubmit={addTask}>
            <input
              aria-label="New task title"
              placeholder="Quick add"
              maxLength={500}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              aria-label="Add task"
              disabled={busy || !online || !title.trim()}
            >
              <Plus />
            </button>
          </form>
          <div className="watch-link-list">
            {snapshot?.tasks.map((task) => (
              <article className="watch-link-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  {(task.due || task.time) && (
                    <small>
                      {[task.due, task.time].filter(Boolean).join(' · ')}
                    </small>
                  )}
                </div>
                <button
                  aria-label={`Complete ${task.title}`}
                  disabled={busy || !online}
                  onClick={() =>
                    void run({ action: 'completeTask', taskId: task.id })
                  }
                >
                  <Check />
                </button>
              </article>
            ))}
            {snapshot && snapshot.tasks.length === 0 && (
              <p className="watch-link-empty-copy">Nothing due soon.</p>
            )}
          </div>
        </section>
      )}

      {tab === 'habits' && (
        <section className="watch-link-content" aria-labelledby="watch-habits">
          <h1 id="watch-habits">Today’s habits</h1>
          <div className="watch-link-list">
            {snapshot?.habits.map((habit) => (
              <article
                className="watch-link-row watch-link-habit"
                key={habit.id}
              >
                <span className="watch-link-emoji">{habit.icon || '✓'}</span>
                <div>
                  <strong>{habit.title}</strong>
                  <small>
                    {habit.value.toLocaleString()} /{' '}
                    {habit.goal.toLocaleString()} {habit.unit}
                  </small>
                </div>
                <button
                  aria-label={`Add progress to ${habit.title}`}
                  disabled={busy || !online || habit.value >= habit.goal}
                  onClick={() =>
                    void run({
                      action: 'logHabit',
                      habitId: habit.id,
                      date: snapshot?.today,
                      value: habit.value + 1,
                    })
                  }
                >
                  <Plus />
                </button>
              </article>
            ))}
            {snapshot && snapshot.habits.length === 0 && (
              <p className="watch-link-empty-copy">
                No habits scheduled today.
              </p>
            )}
          </div>
        </section>
      )}

      {tab === 'focus' && (
        <section
          className="watch-link-content watch-link-focus"
          aria-labelledby="watch-focus"
        >
          <Timer />
          <h1 id="watch-focus">Focus</h1>
          {timer ? (
            <>
              <strong className="watch-link-time">{timerLabel}</strong>
              <button
                className="watch-link-primary"
                disabled={busy || !online}
                onClick={() =>
                  void run(
                    timer.running
                      ? { action: 'pauseTimer', remaining: timerSeconds }
                      : {
                          action: 'startTimer',
                          minutes: Math.max(
                            1,
                            Math.ceil(timerSeconds / 60) || 25,
                          ),
                          startedAt: Date.now(),
                        },
                  )
                }
              >
                {timer.running ? 'Pause' : 'Resume'}
              </button>
            </>
          ) : (
            <button
              className="watch-link-primary"
              disabled={busy || !online}
              onClick={() =>
                void run({
                  action: 'startTimer',
                  minutes: 25,
                  startedAt: Date.now(),
                })
              }
            >
              Start 25 minutes
            </button>
          )}
        </section>
      )}

      <footer className="watch-link-footer">
        <span>{snapshot?.timezone || 'Connecting'}</span>
        <button type="button" onClick={disconnect}>
          Disconnect here
        </button>
      </footer>
    </main>
  );
}
