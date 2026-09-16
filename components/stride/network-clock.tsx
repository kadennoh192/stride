'use client';

import { Clock3 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  anchorFromSample,
  bestTimeSample,
  makeClockFormatter,
  resolveClockZone,
  timeFromAnchor,
  type ClockTimezone,
  type TimeAnchor,
  type TimeSample,
} from '@/lib/stride/network-time';

const SYNC_INTERVAL = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 5000;

type ClockStatus = 'checking' | 'synced' | 'stale' | 'device';

function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function subscribeDeviceZone() {
  return () => {};
}

async function sampleTime(): Promise<TimeSample> {
  const started = performance.now();
  const response = await fetch('/api/time', {
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new Error('Time service unavailable');
  const data = (await response.json()) as {
    epochMs?: unknown;
    source?: unknown;
  };
  const receivedAt = performance.now();
  if (
    data.source !== 'stride-edge' ||
    typeof data.epochMs !== 'number' ||
    !Number.isFinite(data.epochMs) ||
    data.epochMs < 946684800000 ||
    data.epochMs > 4102444800000
  )
    throw new Error('Invalid time response');
  return {
    epochMs: data.epochMs,
    receivedAt,
    roundTripMs: receivedAt - started,
  };
}

export function NetworkClock({
  mode,
  workspaceZone,
}: {
  mode: ClockTimezone;
  workspaceZone: string;
}) {
  const [shownTime, setShownTime] = useState<number | null>(null);
  const [status, setStatus] = useState<ClockStatus>('checking');
  const anchor = useRef<TimeAnchor | null>(null);
  const lastSuccess = useRef(0);
  const syncing = useRef(false);
  const mounted = useRef(false);
  const localZone = useSyncExternalStore(
    subscribeDeviceZone,
    deviceZone,
    () => 'UTC',
  );
  const zone = resolveClockZone(mode, workspaceZone, localZone);
  const formatter = useMemo(() => makeClockFormatter(zone), [zone]);
  const currentTime = useCallback(
    () =>
      anchor.current
        ? timeFromAnchor(anchor.current, performance.now())
        : Date.now(),
    [],
  );
  const sync = useCallback(
    async (sampleCount = 1) => {
      if (syncing.current || document.visibilityState === 'hidden') return;
      if (!navigator.onLine) {
        if (mounted.current) setStatus(anchor.current ? 'stale' : 'device');
        return;
      }
      syncing.current = true;
      if (!anchor.current && mounted.current) setStatus('checking');
      try {
        const attempts = await Promise.allSettled(
          Array.from({ length: sampleCount }, () => sampleTime()),
        );
        const best = bestTimeSample(
          attempts.flatMap((attempt) =>
            attempt.status === 'fulfilled' ? [attempt.value] : [],
          ),
        );
        if (!best) throw new Error('Time service unavailable');
        anchor.current = anchorFromSample(best);
        lastSuccess.current = performance.now();
        if (mounted.current) {
          setShownTime(currentTime());
          setStatus('synced');
        }
      } catch {
        if (mounted.current) setStatus(anchor.current ? 'stale' : 'device');
      } finally {
        syncing.current = false;
      }
    },
    [currentTime],
  );

  useEffect(() => {
    mounted.current = true;
    const initialSync = window.setTimeout(() => void sync(3), 0);
    const refreshIfStale = () => {
      setShownTime(currentTime());
      if (!navigator.onLine) {
        setStatus(anchor.current ? 'stale' : 'device');
        return;
      }
      if (
        !lastSuccess.current ||
        performance.now() - lastSuccess.current >= SYNC_INTERVAL
      )
        void sync();
      else if (anchor.current) setStatus('synced');
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    const offline = () => setStatus(anchor.current ? 'stale' : 'device');
    const interval = window.setInterval(refreshIfStale, SYNC_INTERVAL);
    window.addEventListener('online', refreshIfStale);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
      window.removeEventListener('online', refreshIfStale);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [currentTime, sync]);

  useEffect(() => {
    let timeout = 0;
    const tick = () => {
      const now = currentTime();
      setShownTime(now);
      timeout = window.setTimeout(tick, Math.max(25, 1000 - (now % 1000)));
    };
    timeout = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timeout);
  }, [currentTime]);

  const text = shownTime === null ? '—:—:—' : formatter.format(shownTime);
  const zoneLabel = zone === 'UTC' ? 'UTC' : zone.replaceAll('_', ' ');
  const statusLabel =
    status === 'synced'
      ? 'Network-synced time'
      : status === 'checking'
        ? 'Checking network time'
        : status === 'stale'
          ? 'Last-synced time; currently offline'
          : 'Device time; network time unavailable';
  const label = `${text}. ${statusLabel}. ${zoneLabel}.`;

  return (
    <time
      className="stride-clock"
      dateTime={
        shownTime === null ? undefined : new Date(shownTime).toISOString()
      }
      aria-label={label}
      title={`${statusLabel} · ${zoneLabel}`}
    >
      <Clock3 aria-hidden="true" />
      <span>{text}</span>
      <i className={`clock-status ${status}`} aria-hidden="true" />
    </time>
  );
}
