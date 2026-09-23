import { dateKey, shiftDate } from './types';
import { validDate, validZone, zonedInstant } from './domain';
import type { Alarm } from './types';

export interface AlarmSchedule {
  rule:
    | 'once'
    | 'daily'
    | 'weekdays'
    | 'selectedWeekdays'
    | 'interval'
    | 'weekly'
    | 'monthlyDay'
    | 'monthlyWeekday';
  date?: string;
  time?: string;
  weekdays?: number[];
  intervalMinutes?: number;
  startAt?: string;
  dayOfMonth?: number;
  weekOfMonth?: number;
  weekday?: number;
  activeFrom?: string;
  activeUntil?: string;
  excludedDates?: string[];
}
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validAlarmSchedule(value: unknown): value is AlarmSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as AlarmSchedule;
  if (
    ![
      'once',
      'daily',
      'weekdays',
      'selectedWeekdays',
      'interval',
      'weekly',
      'monthlyDay',
      'monthlyWeekday',
    ].includes(s.rule)
  )
    return false;
  if (s.rule !== 'interval' && (!s.time || !clock.test(s.time))) return false;
  if (s.date !== undefined && !validDate(s.date)) return false;
  if (s.activeFrom !== undefined && !validDate(s.activeFrom)) return false;
  if (s.activeUntil !== undefined && !validDate(s.activeUntil)) return false;
  if (s.activeFrom && s.activeUntil && s.activeFrom > s.activeUntil)
    return false;
  if (
    s.excludedDates !== undefined &&
    (!Array.isArray(s.excludedDates) ||
      s.excludedDates.length > 366 ||
      !s.excludedDates.every(validDate))
  )
    return false;
  if (s.rule === 'once' && !s.date) return false;
  if (
    ['selectedWeekdays', 'weekly'].includes(s.rule) &&
    (!Array.isArray(s.weekdays) ||
      !s.weekdays.length ||
      !s.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  )
    return false;
  if (
    s.rule === 'interval' &&
    (!Number.isInteger(s.intervalMinutes) ||
      !s.intervalMinutes ||
      s.intervalMinutes < 5 ||
      s.intervalMinutes > 525600 ||
      !s.startAt ||
      !Number.isFinite(Date.parse(s.startAt)))
  )
    return false;
  if (
    s.rule === 'monthlyDay' &&
    (!Number.isInteger(s.dayOfMonth) ||
      !s.dayOfMonth ||
      s.dayOfMonth < 1 ||
      s.dayOfMonth > 31)
  )
    return false;
  if (
    s.rule === 'monthlyWeekday' &&
    (!Number.isInteger(s.weekOfMonth) ||
      !s.weekOfMonth ||
      s.weekOfMonth < 1 ||
      s.weekOfMonth > 5 ||
      !Number.isInteger(s.weekday) ||
      s.weekday! < 0 ||
      s.weekday! > 6)
  )
    return false;
  return true;
}
function matches(date: string, schedule: AlarmSchedule) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (schedule.activeFrom && date < schedule.activeFrom) return false;
  if (schedule.activeUntil && date > schedule.activeUntil) return false;
  if (schedule.excludedDates?.includes(date)) return false;
  if (schedule.rule === 'daily') return true;
  if (schedule.rule === 'weekdays') return day >= 1 && day <= 5;
  if (schedule.rule === 'selectedWeekdays' || schedule.rule === 'weekly')
    return schedule.weekdays?.includes(day) || false;
  const dayOfMonth = Number(date.slice(-2));
  if (schedule.rule === 'monthlyDay') {
    const monthEnd = new Date(
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0),
    ).getUTCDate();
    return dayOfMonth === Math.min(schedule.dayOfMonth || 1, monthEnd);
  }
  if (schedule.rule === 'monthlyWeekday') {
    const week = Math.floor((dayOfMonth - 1) / 7) + 1;
    const nextWeek = shiftDate(date, 7);
    return (
      day === schedule.weekday &&
      (week === schedule.weekOfMonth ||
        (schedule.weekOfMonth === 5 &&
          nextWeek.slice(0, 7) !== date.slice(0, 7)))
    );
  }
  return schedule.rule === 'once' && date === schedule.date;
}
/** Finds the first occurrence strictly after `after`; DST gaps and overlaps use zonedInstant's policy. */
export function nextAlarmOccurrence(
  schedule: AlarmSchedule,
  zone: string,
  after: number,
): number | null {
  if (!validAlarmSchedule(schedule) || !validZone(zone)) return null;
  if (schedule.rule === 'interval') {
    const start = Date.parse(schedule.startAt!);
    const step = schedule.intervalMinutes! * 60000;
    let candidate =
      start > after
        ? start
        : start + (Math.floor((after - start) / step) + 1) * step;
    for (
      let attempts = 0;
      attempts < 525600 / schedule.intervalMinutes! + 1;
      attempts++, candidate += step
    ) {
      const date = dateKey(new Date(candidate), zone);
      if (
        (!schedule.activeFrom || date >= schedule.activeFrom) &&
        (!schedule.activeUntil || date <= schedule.activeUntil) &&
        !schedule.excludedDates?.includes(date)
      )
        return candidate;
      if (schedule.activeUntil && date > schedule.activeUntil) break;
    }
    return null;
  }
  const startDay =
    schedule.rule === 'once' ? schedule.date! : dateKey(new Date(after), zone);
  for (let i = 0; i <= (schedule.rule === 'once' ? 0 : 366 * 5); i++) {
    const date = shiftDate(startDay, i);
    if (schedule.activeUntil && date > schedule.activeUntil) break;
    if (!matches(date, schedule)) continue;
    const instant = zonedInstant(date, schedule.time!, zone);
    if (Number.isFinite(instant) && instant > after) return instant;
  }
  return null;
}

export function inQuietHours(wall: string, start: string, end: string) {
  if (start === end) return false;
  return start < end
    ? wall >= start && wall < end
    : wall >= start || wall < end;
}

export function alarmActionPatch(
  alarm: Alarm,
  action: 'snooze' | 'dismiss',
  now: number,
): Partial<Alarm['data']> {
  const occurrence = alarm.data.nextOccurrence;
  if (action === 'snooze') {
    const snoozedUntil = new Date(
      now + alarm.data.snoozeMinutes * 60000,
    ).toISOString();
    return {
      nextOccurrence: snoozedUntil,
      snoozedUntil,
      acknowledgedOccurrence: occurrence,
    };
  }
  const next = nextAlarmOccurrence(
    alarm.data.schedule,
    alarm.data.timezone,
    now,
  );
  return {
    enabled: alarm.data.schedule.rule !== 'once' && !!next,
    nextOccurrence: next ? new Date(next).toISOString() : '',
    snoozedUntil: '',
    acknowledgedOccurrence: occurrence,
  };
}
