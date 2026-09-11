import { defaults, type Settings, uid } from './types';
import { entityFromFields } from './field-index';
import { applyEdits, type Snapshot } from './storage';
export interface ActiveTimer {
  id: string;
  phase: 'focus' | 'break' | 'longBreak';
  duration: number;
  remaining: number;
  end: number;
  running: boolean;
  cycle: number;
  task: string;
}
/** Finalize the current interval inside the same transaction as its session record. */
export function finishElapsedTimer(state: Snapshot, now = Date.now()): boolean {
  const settings = {
    ...defaults,
    ...entityFromFields(state.fields, 'settings')?.data,
  } as Settings;
  const timer = settings.activeTimer as ActiveTimer | null;
  if (!timer?.running || timer.end > now) return false;
  const phase =
    timer.phase === 'focus'
      ? timer.cycle % settings.cycles === 0
        ? 'longBreak'
        : 'break'
      : 'focus';
  const duration =
    (phase === 'focus'
      ? settings.focusMinutes
      : phase === 'break'
        ? settings.breakMinutes
        : settings.longBreakMinutes) * 60;
  applyEdits(
    state,
    [
      {
        id: `session-${timer.id}`,
        kind: 'session',
        data: {
          at: new Date(timer.end).toISOString(),
          duration: timer.duration,
          phase: timer.phase,
          task: timer.task,
          _deleted: false,
        },
      },
      {
        id: 'settings',
        kind: 'settings',
        data: {
          activeTimer: {
            ...timer,
            id: uid(),
            phase,
            duration,
            remaining: duration,
            running: false,
            end: 0,
            cycle: timer.phase === 'focus' ? timer.cycle : timer.cycle + 1,
          },
        },
      },
    ],
    'Finished focus timer',
  );
  return true;
}
