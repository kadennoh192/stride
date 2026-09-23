import type { ShowerSession } from './types';

export interface ActiveShowerTimer {
  startedAt: number;
  elapsedSeconds: number;
  running: boolean;
  targetMinutes: number;
  flowLitresPerMinute: number;
}
export function elapsedShowerSeconds(
  timer: ActiveShowerTimer | null,
  now: number,
) {
  return timer
    ? timer.elapsedSeconds +
        (timer.running
          ? Math.max(0, Math.floor((now - timer.startedAt) / 1000))
          : 0)
    : 0;
}
export function estimatedWaterLitres(
  session: Pick<ShowerSession['data'], 'duration' | 'flowLitresPerMinute'>,
) {
  return (session.duration / 60) * session.flowLitresPerMinute;
}
export function estimatedSavingsLitres(
  session: Pick<
    ShowerSession['data'],
    'duration' | 'targetMinutes' | 'flowLitresPerMinute'
  >,
) {
  return (
    (session.targetMinutes - session.duration / 60) *
    session.flowLitresPerMinute
  );
}
