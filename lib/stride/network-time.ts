export type ClockTimezone = 'workspace' | 'device' | 'utc';

export interface TimeSample {
  epochMs: number;
  receivedAt: number;
  roundTripMs: number;
}

export interface TimeAnchor {
  epochMs: number;
  monotonicMs: number;
}

export function bestTimeSample(samples: TimeSample[]) {
  return (
    samples
      .filter(
        (sample) =>
          Number.isFinite(sample.epochMs) &&
          Number.isFinite(sample.receivedAt) &&
          Number.isFinite(sample.roundTripMs) &&
          sample.roundTripMs >= 0,
      )
      .sort((left, right) => left.roundTripMs - right.roundTripMs)[0] || null
  );
}

export function anchorFromSample(sample: TimeSample): TimeAnchor {
  return {
    epochMs: sample.epochMs + sample.roundTripMs / 2,
    monotonicMs: sample.receivedAt,
  };
}

export function timeFromAnchor(anchor: TimeAnchor, monotonicNow: number) {
  return anchor.epochMs + Math.max(0, monotonicNow - anchor.monotonicMs);
}

export function resolveClockZone(
  mode: ClockTimezone,
  workspaceZone: string,
  deviceZone: string,
) {
  if (mode === 'utc') return 'UTC';
  if (mode === 'device') return deviceZone;
  return workspaceZone || deviceZone;
}

export function makeClockFormatter(
  timeZone: string,
  locales?: Intl.LocalesArgument,
) {
  return new Intl.DateTimeFormat(locales, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timeZone || undefined,
  });
}
