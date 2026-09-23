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
  type EntityData,
  type EntityOf,
  type EntityPatch,
  type Kind,
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
  acknowledgeFileDelete,
  pendingFileDeletes,
  startupProjection,
  searchRecords,
} from './storage';
import { uploadFile } from './upload';
import { deleteRemoteFile } from './files';
import { currentAttachmentReferences } from './attachment-references';
import { completionEdits } from './completion';
interface Account {
  configured: boolean;
  signupAllowed: boolean;
  user: { id: string; email: string } | null;
}
interface Store {
  entities: Entity[];
  settings: Settings;
  ready: boolean;
  hydrating: boolean;
  startupProject: string;
  error: string;
  syncStatus: string;
  history: Change[];
  snapshot: Snapshot | null;
  account: Account;
  owner: string;
  search: (query: string, limit?: number) => Promise<Entity[]>;
  notice: (s: string) => void;
  edit: (edits: Edit[], label?: string) => Promise<void>;
  add: <K extends Kind>(
    kind: K,
    data: EntityData<K>,
    label?: string,
  ) => Promise<string>;
  update: <K extends Kind>(
    e: EntityOf<K>,
    data: EntityPatch<K>,
    label?: string,
  ) => Promise<void>;
  remove: (e: Entity) => Promise<void>;
  removeAttachment: (e: EntityOf<'block'>) => Promise<void>;
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
  const [startup, setStartup] = useState<{
    owner: string;
    project: string;
    entities: Entity[];
  } | null>(null);
  const [owner, setOwner] = useState('');
  const [account, setAccount] = useState<Account>({
    configured: false,
    signupAllowed: false,
    user: null,
  });
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('Opening device storage');
  const [message, setMessage] = useState('');
  const [undoEdits, setUndoEdits] = useState<Edit[]>([]);
  const working = useRef(false);
  const currentOwner = useRef(owner);
  const loadedOwner = useRef('');
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
        loadedOwner.current = owner;
        setSnapshot(state);
        setStartup(null);
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
          loadedOwner.current = owner;
          setSnapshot(state);
          setStartup(null);
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
      try {
        for (const deletion of await pendingFileDeletes(owner))
          await acknowledgeFileDelete(deletion);
        setSyncStatus('Saved on this device');
      } catch (e) {
        setSyncStatus('Saved on device · cleanup needs another try');
        setError(stringValue(e));
      }
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
            version: 3,
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
          data.version !== 3 ||
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
        if (currentOwner.current === owner) {
          loadedOwner.current = owner;
          setSnapshot(state);
          setStartup(null);
        }
        again = state.outbox.length > 0 || data.more === true;
      }
      if (!state.outbox.length)
        for (const deletion of await pendingFileDeletes(owner)) {
          if (currentOwner.current !== owner) return;
          setSyncStatus('Removing attachment from cloud…');
          await deleteRemoteFile(deletion);
        }
      for (const file of (await allFiles(owner)).filter(
        (file) => !file.uploaded,
      )) {
        if (currentOwner.current !== owner) return;
        await uploadFile(file, (confirmed, total) => {
          if (currentOwner.current === owner)
            setSyncStatus(
              `Uploading attachment · ${Math.round(total ? (confirmed / total) * 100 : 100)}%`,
            );
        });
      }
      const pendingAttachments = (await allFiles(owner)).some(
        (file) => !file.uploaded,
      );
      failures.current = 0;
      retryAt.current = 0;
      if (currentOwner.current === owner)
        setSyncStatus(
          again || pendingAttachments
            ? 'Sync continuing…'
            : 'All changes synced',
        );
      broadcast.current?.postMessage({ owner });
    } catch (e) {
      failures.current++;
      retryAt.current =
        Date.now() +
        Math.min(300000, 2000 * 2 ** Math.min(8, failures.current));
      setSyncStatus('Saved on device · waiting to retry');
      if (stringValue(e).toLowerCase().includes('account'))
        setError(stringValue(e));
    } finally {
      working.current = false;
    }
  }, [owner]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const clearAuthParams = () => {
      const url = new URL(location.href);
      for (const key of [
        'code',
        'error',
        'error_code',
        'error_description',
        'token_hash',
        'type',
      ])
        url.searchParams.delete(key);
      history.replaceState(null, '', url.pathname + url.search + location.hash);
    };
    const code = params.get('code');
    const authError = params.get('error_description') || params.get('error');
    if (authError) {
      clearAuthParams();
      setTimeout(() => notice(authError), 0);
      // Remote session initialization updates state after its asynchronous response.
      // eslint-disable-next-line react/react-compiler
      void refreshAccount();
      return;
    }
    if (code) {
      clearAuthParams();
      void fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exchange', code }),
      })
        .then(async (r) => {
          const data = (await r.json()) as {
            error?: string;
            recovery?: boolean;
          };
          if (!r.ok) throw new Error(data.error);
          location.hash = data.recovery ? 'settings' : 'today';
          notice(
            data.recovery
              ? 'Email verified. Set a new password in Settings.'
              : 'Email verified. You can now sync your workspace.',
          );
          await refreshAccount();
        })
        .catch((e) => notice(stringValue(e)));
      return;
    }
    const token = params.get('token_hash'),
      type = params.get('type');
    if (token && type) {
      clearAuthParams();
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
      return;
    }
    // Remote session initialization updates state after its asynchronous response.
    // eslint-disable-next-line react/react-compiler
    void refreshAccount();
  }, [refreshAccount, notice]);
  useEffect(() => {
    if (owner) {
      let project = '';
      try {
        const route = decodeURIComponent(location.hash.slice(1));
        if (route.startsWith('project/')) project = route.split('/')[1] || '';
        if (route.startsWith('project-settings/'))
          project = route.split('/')[1] || '';
      } catch {
        // A malformed hash falls back to the general startup projection.
      }
      void startupProjection(owner, project)
        .then((entities) => {
          if (currentOwner.current === owner && loadedOwner.current !== owner) {
            setStartup({ owner, project, entities });
            setSyncStatus('Opening full workspace…');
          }
        })
        .catch(() => {
          // The full snapshot path reports storage failures and remains authoritative.
        });
      // Loading the account snapshot synchronizes React with IndexedDB.
      // eslint-disable-next-line react/react-compiler
      void reload().then(() => {
        setUndoEdits([]);
        return sync();
      });
    }
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
  const fullSnapshot = snapshot?.owner === owner ? snapshot : null;
  const startupEntities = startup?.owner === owner ? startup.entities : null;
  const entities = useMemo(
    () =>
      fullSnapshot ? materialize(fullSnapshot.fields) : (startupEntities ?? []),
    [fullSnapshot, startupEntities],
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
          loadedOwner.current = owner;
          setSnapshot(state);
          setStartup(null);
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
      const custom = settings.theme === 'custom';
      document.documentElement.classList.toggle(
        'dark',
        !custom &&
          (settings.theme === 'dark' ||
            (settings.theme === 'system' && media.matches)),
      );
      document.documentElement.classList.toggle('no-motion', !settings.motion);
      document.documentElement.style.setProperty('--primary', settings.accent);
      const colors: Record<string, string> = {
        '--background': settings.workspaceBackground,
        '--card': settings.surfaceColor,
        '--foreground': settings.textColor,
        '--muted': settings.mutedColor,
        '--muted-foreground': settings.mutedTextColor,
        '--border': settings.borderColor,
        '--sidebar': settings.sidebarColor,
        '--accent': settings.accentSurfaceColor,
      };
      for (const [property, value] of Object.entries(colors))
        if (custom) document.documentElement.style.setProperty(property, value);
        else document.documentElement.style.removeProperty(property);
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
    settings.workspaceBackground,
    settings.surfaceColor,
    settings.textColor,
    settings.mutedColor,
    settings.mutedTextColor,
    settings.borderColor,
    settings.sidebarColor,
    settings.accentSurfaceColor,
    settings.motion,
    settings.density,
    settings.font,
    settings.taskPaneWidth,
  ]);
  const complete = async (task: Task) => {
    const transition = await completionEdits(task);
    const unmet = entities.filter(
      (e) =>
        !transition.reopened &&
        task.data.dependencies.includes(e.id) &&
        e.kind === 'task' &&
        !e.data.completedAt,
    );
    if (unmet.length)
      throw new Error(
        `Complete dependencies first: ${unmet.map((e) => e.data.title).join(', ')}`,
      );
    await edit(
      transition.edits,
      transition.reopened
        ? 'Reopened task'
        : transition.next
          ? 'Completed occurrence and scheduled next task'
          : 'Completed task',
    );
    if (!transition.reopened)
      notice(
        transition.next
          ? `Completed. Next: ${transition.next}`
          : 'Task completed',
      );
  };
  const search = useCallback(
    (query: string, limit = 50) =>
      owner ? searchRecords(owner, query, limit) : Promise.resolve([]),
    [owner],
  );
  return (
    <Context.Provider
      value={{
        entities,
        settings,
        ready: !!fullSnapshot || !!startupEntities,
        hydrating: !fullSnapshot,
        startupProject:
          startup?.owner === owner && !fullSnapshot ? startup.project : '',
        error,
        syncStatus,
        history: fullSnapshot?.history ?? [],
        snapshot: fullSnapshot,
        account,
        owner,
        search,
        notice,
        edit,
        add: async (kind, data, label) => {
          const id = uid();
          await edit([{ id, kind, data } as Edit], label || `Created ${kind}`);
          return id;
        },
        update: async (e, data, label) =>
          edit(
            [{ id: e.id, kind: e.kind, data } as Edit],
            label || `Updated ${stringValue(e.data.title || e.kind)}`,
          ),
        remove: async (e) => {
          await edit(
            [
              {
                id: e.id,
                kind: e.kind,
                data: { _deleted: true },
              } as Edit,
            ],
            `Deleted ${stringValue(e.data.title || e.kind)}`,
          );
          notice('Moved to trash. Undo is available.');
        },
        removeAttachment: async (block) => {
          const id = stringValue(block.data.file);
          if (!id || !fullSnapshot) return;
          if (
            currentAttachmentReferences(fullSnapshot, `${block.id}:file`).has(
              id,
            )
          )
            throw new Error(
              'This attachment is also used elsewhere. Remove those references first.',
            );
          const state = await transact(
            (snapshot) =>
              applyEdits(
                snapshot,
                [
                  {
                    id: block.id,
                    kind: 'block',
                    data: { file: '', name: '' },
                  },
                  {
                    id: `filePurge_${id}`,
                    kind: 'fileTombstone',
                    data: { attachment: id, _deleted: true },
                  },
                ],
                'Permanently removed attachment',
              ),
            owner,
            false,
            undefined,
            [id],
          );
          if (currentOwner.current === owner) {
            loadedOwner.current = owner;
            setSnapshot(state);
            setStartup(null);
            setUndoEdits([]);
            setError('');
            notice(
              owner === 'guest'
                ? 'Attachment removed from this device and future backups.'
                : 'Removal saved on this device. Secure cleanup will finish after cloud sync.',
            );
            void sync();
          }
          broadcast.current?.postMessage({ owner });
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
          const state = await addStarter(owner);
          if (currentOwner.current === owner) {
            loadedOwner.current = owner;
            setSnapshot(state);
            setStartup(null);
            notice('Starter tasks added.');
          }
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
