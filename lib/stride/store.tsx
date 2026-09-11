'use client';
import { finishElapsedTimer, type ActiveTimer } from './timer';
import { entityFromFields } from './field-index';
import { stringValue } from './types';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  type Entity,
  type Kind,
  type Data,
  type Settings,
  type Task,
  type Change,
  defaults,
  uid,
} from './types';
import {
  load,
  transact,
  applyEdits,
  materialize,
  mergeFields,
  type Snapshot,
  type Edit,
  addStarter,
  allFiles,
  hashBlob,
  saveFile,
} from './storage';
import { nextOccurrence } from './domain';
interface Account {
  configured: boolean;
  user: { id: string; email: string } | null;
}
interface Store {
  entities: Entity[];
  settings: Settings;
  ready: boolean;
  error: string;
  syncStatus: string;
  history: Change[];
  snapshot: Snapshot | null;
  account: Account;
  owner: string;
  notice: (s: string) => void;
  edit: (edits: Edit[], label?: string) => Promise<void>;
  add: (kind: Kind, data: Data, label?: string) => Promise<string>;
  update: (e: Entity, data: Data, label?: string) => Promise<void>;
  remove: (e: Entity) => Promise<void>;
  complete: (task: Task) => Promise<void>;
  undo: () => Promise<void>;
  canUndo: boolean;
  sync: () => Promise<void>;
  reload: () => Promise<void>;
  refreshAccount: () => Promise<void>;
  starter: () => Promise<void>;
  setSettings: (data: Partial<Settings>) => Promise<void>;
}
const Context = createContext<Store | null>(null);
export function useStride() {
  const s = useContext(Context);
  if (!s) throw new Error('Stride provider missing');
  return s;
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [owner, setOwner] = useState('');
  const [account, setAccount] = useState<Account>({
    configured: false,
    user: null,
  });
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('Opening device storage');
  const [message, setMessage] = useState('');
  const [undoEdits, setUndoEdits] = useState<Edit[]>([]);
  const working = useRef(false);
  const currentOwner = useRef(owner);
  useEffect(() => {
    currentOwner.current = owner;
  }, [owner]);
  const broadcast = useRef<BroadcastChannel | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const failures = useRef(0);
  const retryAt = useRef(0);
  const notice = useCallback((s: string) => {
    setMessage(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(''), 7000);
  }, []);
  const refreshAccount = useCallback(async () => {
    try {
      const response = await fetch('/api/auth', {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Account unavailable');
      const data = (await response.json()) as Account;
      setAccount(data);
      const next = data.user?.id || 'guest';
      setOwner(next);
      localStorage.setItem('stride-last-account', next);
    } catch {
      setOwner(
        (previous) =>
          previous || localStorage.getItem('stride-last-account') || 'guest',
      );
    }
  }, []);
  const reload = useCallback(async () => {
    if (!owner) return;
    try {
      const state = await load(owner);
      if (currentOwner.current === owner) {
        setSnapshot(state);
        setError('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : stringValue(e));
    }
  }, [owner]);
  const edit = useCallback(
    async (edits: Edit[], label = 'Updated workspace') => {
      if (!owner) throw new Error('Storage is still opening');
      try {
        let reverse: Edit[] = [];
        const state = await transact((s) => {
          reverse = edits.map((e) => {
            const before = entityFromFields(s.fields, e.id);
            return {
              id: e.id,
              kind: e.kind,
              data: before
                ? Object.fromEntries(
                    Object.keys(e.data).map((key) => [
                      key,
                      key === '_deleted'
                        ? !!before.deleted
                        : (before.data[key] ?? null),
                    ]),
                  )
                : { _deleted: true },
            };
          });
          applyEdits(s, edits, label);
        }, owner);
        if (currentOwner.current === owner) {
          setSnapshot(state);
          setUndoEdits(reverse);
          setError('');
        }
        broadcast.current?.postMessage({ owner });
      } catch (e) {
        setError(e instanceof Error ? e.message : stringValue(e));
        throw e;
      }
    },
    [owner],
  );
  const sync = useCallback(async () => {
    if (!owner || working.current) return;
    if (owner === 'guest') {
      setSyncStatus('Saved on this device');
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus('Offline · saved on this device');
      return;
    }
    working.current = true;
    setSyncStatus('Syncing…');
    try {
      await fetch('/api/auth', { cache: 'no-store' });
      let state = await load(owner);
      let again = true;
      let rounds = 0;
      while (again && rounds++ < 100) {
        const batch = state.outbox.slice(0, 10);
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: 2,
            owner,
            cursor: state.cursor,
            changes: batch,
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (response.status === 401) {
          setSyncStatus('Sign in again to sync');
          return;
        }
        const data = (await response.json()) as {
          error?: string;
          version: number;
          owner: string;
          fields: import('./types').Field[];
          acknowledged: string[];
          cursor: number;
          history: Change[];
          more: boolean;
        };
        if (!response.ok) throw new Error(data.error || 'Sync unavailable');
        if (
          data.version !== 2 ||
          data.owner !== owner ||
          !Array.isArray(data.fields) ||
          !Array.isArray(data.acknowledged) ||
          !Number.isSafeInteger(data.cursor)
        )
          throw new Error('Invalid sync response');
        const ids = new Set<string>(data.acknowledged);
        state = await transact((s) => {
          const receivedKnown = new Set(s.history.map((c) => c.id));
          mergeFields(
            s,
            data.history
              .filter((c) => !receivedKnown.has(c.id))
              .flatMap((c) => c.fields),
          );
          s.outbox = s.outbox.filter((c) => !ids.has(c.id));
          s.cursor = data.cursor;
          s.lastSync = new Date().toISOString();
          const known = new Set(s.history.map((c) => c.id));
          for (const c of data.history ?? [])
            if (!known.has(c.id)) s.history.push(c);
        }, owner);
        if (currentOwner.current === owner) setSnapshot(state);
        again = state.outbox.length > 0 || data.more === true;
      }
      for (const f of (await allFiles(owner)).filter((f) => !f.uploaded)) {
        const response = await fetch(`/api/files/${f.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': f.blob.type || 'application/octet-stream',
            'X-Content-SHA256': f.hash || (await hashBlob(f.blob)),
          },
          body: f.blob,
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error('Attachment upload will retry');
        await saveFile(f.id, f.blob, owner, f.name, true);
      }
      failures.current = 0;
      retryAt.current = 0;
      if (currentOwner.current === owner)
        setSyncStatus(again ? 'Sync continuing…' : 'All changes synced');
      broadcast.current?.postMessage({ owner });
    } catch (e) {
      failures.current++;
      retryAt.current =
        Date.now() +
        Math.min(300000, 2000 * 2 ** Math.min(8, failures.current));
      setSyncStatus('Saved on device · waiting to retry');
      if (stringValue(e).includes('account')) setError(stringValue(e));
    } finally {
      working.current = false;
    }
  }, [owner]);
  useEffect(() => {
    // Remote session initialization updates state after its asynchronous response.
    // eslint-disable-next-line react/react-compiler
    void refreshAccount();
    const params = new URLSearchParams(location.search);
    const token = params.get('token_hash'),
      type = params.get('type');
    if (token && type) {
      history.replaceState(null, '', location.pathname + location.hash);
      void fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', token_hash: token, type }),
      })
        .then(async (r) => {
          const data = (await r.json()) as { error?: string };
          if (!r.ok) throw new Error(data.error);
          location.hash = type === 'recovery' ? 'settings' : 'today';
          notice(
            type === 'recovery'
              ? 'Email verified. Set a new password in Settings.'
              : 'Email verified. You can now sync your workspace.',
          );
          await refreshAccount();
        })
        .catch((e) => notice(stringValue(e)));
    }
  }, [refreshAccount, notice]);
  useEffect(() => {
    if (owner)
      // Loading the account snapshot synchronizes React with IndexedDB.
      // eslint-disable-next-line react/react-compiler
      void reload().then(() => {
        setUndoEdits([]);
        return sync();
      });
  }, [owner, reload, sync]);
  useEffect(() => {
    if ('BroadcastChannel' in window) {
      broadcast.current = new BroadcastChannel('stride-workspace');
      broadcast.current.onmessage = (e) => {
        if (e.data.owner === owner) void reload();
      };
    }
    const onOnline = () => {
      retryAt.current = 0;
      void sync();
    };
    const onOffline = () => setSyncStatus('Offline · saved on this device');
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void reload().then(() => sync());
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => {
      if (
        Date.now() >= retryAt.current &&
        document.visibilityState === 'visible'
      )
        void sync();
    }, 30000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      broadcast.current?.close();
    };
  }, [owner, reload, sync]);
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'production') {
      // A dev server has unstable module URLs. Removing only its app cache avoids stale HMR code; IndexedDB is untouched.
      void navigator.serviceWorker
        .getRegistration('/')
        .then(async (registration) => {
          if (registration?.active?.scriptURL.endsWith('/sw.js'))
            await registration.unregister();
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((key) => key.startsWith('stride-shell-'))
              .map((key) => caches.delete(key)),
          );
        });
    }
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      void navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => {
              if (
                worker.state === 'installed' &&
                navigator.serviceWorker.controller
              )
                notice(
                  'An update is ready. Close all Stride tabs to apply it safely.',
                );
            });
          });
        })
        .catch(() =>
          notice('Offline app loading is unavailable in this browser.'),
        );
    const rejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      setError(
        event.reason instanceof Error
          ? event.reason.message
          : 'That change could not be completed. Please retry.',
      );
    };
    window.addEventListener('unhandledrejection', rejection);
    return () => {
      window.removeEventListener('unhandledrejection', rejection);
      clearTimeout(toastTimer.current);
    };
  }, [notice]);
  useEffect(() => {
    if (snapshot?.outbox.length) {
      const timer = setTimeout(() => {
        if (Date.now() >= retryAt.current) void sync();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [snapshot?.outbox.length, sync]);
  const entities = useMemo(
    () => (snapshot ? materialize(snapshot.fields) : []),
    [snapshot],
  );
  const settings = useMemo(
    () =>
      ({
        ...defaults,
        ...entities.find((e) => e.id === 'settings')?.data,
      }) as Settings,
    [entities],
  );
  const activeTimer = settings.activeTimer as ActiveTimer | null;
  useEffect(() => {
    if (!owner || !activeTimer?.running) return;
    let pending = false,
      disposed = false;
    const tick = async () => {
      if (pending || Date.now() < activeTimer.end) return;
      pending = true;
      try {
        let finished = false;
        const state = await transact((s) => {
          finished = finishElapsedTimer(s);
        }, owner);
        if (!disposed && currentOwner.current === owner) {
          setSnapshot(state);
          if (finished)
            notice('Interval complete. Your next interval is ready in Focus.');
        }
        if (finished) broadcast.current?.postMessage({ owner });
      } catch (error) {
        if (!disposed)
          setError(
            error instanceof Error
              ? error.message
              : 'Could not save the completed interval.',
          );
      } finally {
        pending = false;
      }
    };
    const initial = setTimeout(() => void tick(), 0);
    const interval = setInterval(() => void tick(), 1000);
    const foreground = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', foreground);
    return () => {
      disposed = true;
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [owner, activeTimer, notice]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.classList.toggle(
        'dark',
        settings.theme === 'dark' ||
          (settings.theme === 'system' && media.matches),
      );
      document.documentElement.classList.toggle('no-motion', !settings.motion);
      document.documentElement.style.setProperty('--primary', settings.accent);
      document.documentElement.dataset.density = settings.density;
      document.documentElement.dataset.font = settings.font;
      document.documentElement.style.setProperty(
        '--task-pane-width',
        `${Number(settings.taskPaneWidth || 460)}px`,
      );
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [
    settings.theme,
    settings.accent,
    settings.motion,
    settings.density,
    settings.font,
    settings.taskPaneWidth,
  ]);
  const complete = async (task: Task) => {
    const next = nextOccurrence(task);
    const occurrence = stringValue(
      task.data.occurrence || task.data.due || 'once',
    );
    const id = `completion-${task.id}-${occurrence.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    if (task.data.completedAt) {
      await edit(
        [
          {
            id: task.id,
            kind: 'task',
            data: { completedAt: '', status: 'To do' },
          },
          { id, kind: 'completion', data: { _deleted: true } },
        ],
        'Reopened task',
      );
      return;
    }
    const unmet = entities.filter(
      (e) =>
        task.data.dependencies.includes(e.id) &&
        e.kind === 'task' &&
        !e.data.completedAt,
    );
    if (unmet.length)
      throw new Error(
        `Complete dependencies first: ${unmet.map((e) => e.data.title).join(', ')}`,
      );
    await edit(
      [
        {
          id,
          kind: 'completion',
          data: {
            task: task.id,
            title: task.data.title,
            at: new Date().toISOString(),
            due: task.data.due,
            _deleted: false,
          },
        },
        {
          id: task.id,
          kind: 'task',
          data: next
            ? {
                due: next,
                recurrenceAnchor: task.data.recurrenceAnchor || task.data.due,
                time: task.data.time,
                occurrence: next,
                completedAt: '',
                status: 'To do',
                checklist: (task.data.checklist || []).map((c) => ({
                  ...c,
                  done: false,
                })),
                subtasks: task.data.subtasks.map((c) => ({
                  ...c,
                  done: false,
                })),
              }
            : { completedAt: new Date().toISOString(), status: 'Done' },
        },
      ],
      next ? 'Completed occurrence and scheduled next task' : 'Completed task',
    );
    notice(next ? `Completed. Next: ${next}` : 'Task completed');
  };
  return (
    <Context.Provider
      value={{
        entities,
        settings,
        ready: !!snapshot && snapshot.owner === owner,
        error,
        syncStatus,
        history: snapshot?.history ?? [],
        snapshot,
        account,
        owner,
        notice,
        edit,
        add: async (kind, data, label) => {
          const id = uid();
          await edit([{ id, kind, data }], label || `Created ${kind}`);
          return id;
        },
        update: async (e, data, label) =>
          edit(
            [{ id: e.id, kind: e.kind, data }],
            label || `Updated ${stringValue(e.data.title || e.kind)}`,
          ),
        remove: async (e) => {
          await edit(
            [{ id: e.id, kind: e.kind, data: { _deleted: true } }],
            `Deleted ${stringValue(e.data.title || e.kind)}`,
          );
          notice('Moved to trash. Undo is available.');
        },
        complete,
        undo: async () => {
          const edits = undoEdits;
          await edit(edits, 'Undo');
          setUndoEdits([]);
          notice('Change undone');
        },
        canUndo: undoEdits.length > 0,
        sync,
        reload,
        refreshAccount,
        starter: async () => {
          setSnapshot(await addStarter(owner));
          notice('Starter tasks added.');
        },
        setSettings: async (data) =>
          edit(
            [{ id: 'settings', kind: 'settings', data }],
            'Updated settings',
          ),
      }}
    >
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {children}
      {message && (
        <output className="toast">
          {message}
          <button onClick={() => setMessage('')} aria-label="Dismiss message">
            ×
          </button>
        </output>
      )}
    </Context.Provider>
  );
}
