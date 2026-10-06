'use client';
import { hasUnsavedNoteDrafts } from './note-drafts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { currentRelease } from './generated-release';
import {
  activationBlockMessage,
  updateStatus,
  validReleaseManifest,
  type DeployedRelease,
  type UpdateStatus,
} from './update-model';
interface UpdateState {
  status: UpdateStatus;
  deployed: DeployedRelease | null;
  waiting: boolean;
  message: string;
  check: () => Promise<void>;
  activate: () => Promise<void>;
}
const Context = createContext<UpdateState | null>(null);
export function useUpdates() {
  const value = useContext(Context);
  if (!value) throw new Error('Update provider missing');
  return value;
}
function hasDraft() {
  return (
    hasUnsavedNoteDrafts() ||
    !!document.querySelector('[data-stride-note-dirty="true"]') ||
    !!document.querySelector('.stride-modal form[data-stride-dirty="true"]') ||
    !!(
      document.activeElement instanceof HTMLElement &&
      document.activeElement.isContentEditable
    )
  );
}
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [deployed, setDeployed] = useState<DeployedRelease | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState('');
  const check = useCallback(async () => {
    setStatus('checking');
    setMessage('');
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    try {
      const response = await fetch(`/version.json?check=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error('The deployed version could not be read.');
      const manifest: unknown = await response.json();
      if (!validReleaseManifest(manifest))
        throw new Error('Invalid update manifest.');
      setDeployed(manifest);
      const registration =
        (await navigator.serviceWorker?.getRegistration('/')) ||
        (process.env.NODE_ENV === 'production'
          ? await navigator.serviceWorker?.register('/sw.js')
          : undefined);
      await registration?.update();
      const installing = registration?.installing;
      installing?.addEventListener('statechange', () => {
        if (
          installing.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          setWaiting(true);
          setStatus('waiting');
        }
      });
      const isWaiting = !!registration?.waiting;
      setWaiting(isWaiting);
      setStatus(updateStatus(manifest, currentRelease.build, isWaiting));
      sessionStorage.setItem('stride-last-update-check', String(Date.now()));
    } catch (error) {
      setStatus(navigator.onLine ? 'error' : 'offline');
      setMessage(String(error));
    }
  }, []);
  useEffect(() => {
    const changed = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement)
        target.closest('form')?.setAttribute('data-stride-dirty', 'true');
    };
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    return () => {
      document.removeEventListener('input', changed, true);
      document.removeEventListener('change', changed, true);
    };
  }, []);
  useEffect(() => {
    const startup = setTimeout(() => void check(), 0);
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() -
          Number(sessionStorage.getItem('stride-last-update-check') || 0) >=
          6 * 3600000
      )
        void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const registrationChanged = () => {
      void navigator.serviceWorker
        ?.getRegistration('/')
        .then((registration) => {
          if (registration?.waiting) {
            setWaiting(true);
            setStatus('waiting');
          }
        });
    };
    navigator.serviceWorker?.addEventListener(
      'controllerchange',
      registrationChanged,
    );
    return () => {
      clearTimeout(startup);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener(
        'controllerchange',
        registrationChanged,
      );
    };
  }, [check]);
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('stride-workspace');
    channel.onmessage = (event) => {
      if (event.data?.type === 'update-draft-check')
        channel.postMessage({
          type: 'update-draft-reply',
          nonce: event.data.nonce,
          busy: hasDraft(),
        });
    };
    return () => channel.close();
  }, []);
  const activate = useCallback(async () => {
    setMessage('');
    const localBlock = activationBlockMessage(hasDraft(), false);
    if (localBlock) {
      setMessage(localBlock);
      return;
    }
    const registration = await navigator.serviceWorker?.getRegistration('/');
    if (!registration?.waiting) {
      setMessage('No installed update is waiting. Check again.');
      return;
    }
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('stride-workspace');
      const nonce = crypto.randomUUID();
      let busy = false;
      channel.onmessage = (event) => {
        if (
          event.data?.type === 'update-draft-reply' &&
          event.data.nonce === nonce &&
          event.data.busy
        )
          busy = true;
      };
      channel.postMessage({ type: 'update-draft-check', nonce });
      await new Promise((resolve) => setTimeout(resolve, 700));
      channel.close();
      const peerBlock = activationBlockMessage(false, busy);
      if (peerBlock) {
        setMessage(peerBlock);
        return;
      }
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => location.reload(),
      { once: true },
    );
    registration.waiting.postMessage({ type: 'STRIDE_ACTIVATE_UPDATE' });
    setMessage('Activating update…');
  }, []);
  return (
    <Context.Provider
      value={{ status, deployed, waiting, message, check, activate }}
    >
      {children}
    </Context.Provider>
  );
}
export { currentRelease };
export type { DeployedRelease, UpdateStatus } from './update-model';
