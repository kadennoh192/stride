import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alarmActionPatch,
  inQuietHours,
  nextAlarmOccurrence,
  validAlarmSchedule,
} from '../lib/stride/alarms';
import type { Alarm } from '../lib/stride/types';

void test('daily alarms cross Toronto spring DST gap and fall overlap deterministically', () => {
  const schedule = { rule: 'daily' as const, time: '02:30' };
  const spring = nextAlarmOccurrence(
    schedule,
    'America/Toronto',
    Date.parse('2026-03-08T05:00:00Z'),
  );
  assert.equal(new Date(spring!).toISOString(), '2026-03-08T07:00:00.000Z');
  const fall = nextAlarmOccurrence(
    { rule: 'daily', time: '01:30' },
    'America/Toronto',
    Date.parse('2026-11-01T03:00:00Z'),
  );
  assert.equal(new Date(fall!).toISOString(), '2026-11-01T05:30:00.000Z');
});
void test('selected weekdays, ranges, exclusions, and timezone travel use local calendar dates', () => {
  const schedule = {
    rule: 'selectedWeekdays' as const,
    time: '09:00',
    weekdays: [1],
    activeFrom: '2026-09-01',
    activeUntil: '2026-09-30',
    excludedDates: ['2026-09-07'],
  };
  assert.equal(
    new Date(
      nextAlarmOccurrence(
        schedule,
        'America/Toronto',
        Date.parse('2026-09-06T00:00:00Z'),
      )!,
    ).toISOString(),
    '2026-09-14T13:00:00.000Z',
  );
  assert.equal(
    nextAlarmOccurrence(
      schedule,
      'America/Toronto',
      Date.parse('2026-10-01T00:00:00Z'),
    ),
    null,
  );
  const tokyo = nextAlarmOccurrence(
    { rule: 'once', date: '2026-09-21', time: '09:00' },
    'Asia/Tokyo',
    0,
  );
  assert.equal(new Date(tokyo!).toISOString(), '2026-09-21T00:00:00.000Z');
});
void test('interval and monthly nth-weekday rules validate and advance', () => {
  const interval = {
    rule: 'interval' as const,
    startAt: '2026-09-01T00:00:00.000Z',
    intervalMinutes: 30,
  };
  assert.equal(
    nextAlarmOccurrence(interval, 'UTC', Date.parse('2026-09-01T00:00:00Z')),
    Date.parse('2026-09-01T00:30:00Z'),
  );
  const monthly = {
    rule: 'monthlyWeekday' as const,
    time: '08:00',
    weekday: 1,
    weekOfMonth: 2,
  };
  assert.equal(
    new Date(
      nextAlarmOccurrence(monthly, 'UTC', Date.parse('2026-09-01T00:00:00Z'))!,
    ).toISOString(),
    '2026-09-14T08:00:00.000Z',
  );
  assert.equal(validAlarmSchedule({ ...monthly, weekOfMonth: 6 }), false);
  assert.equal(
    validAlarmSchedule({ rule: 'once', date: '2026-02-30', time: '08:00' }),
    false,
  );
});
void test('quiet hours support overnight and daytime windows', () => {
  assert.equal(inQuietHours('23:15', '22:00', '07:00'), true);
  assert.equal(inQuietHours('06:59', '22:00', '07:00'), true);
  assert.equal(inQuietHours('12:00', '22:00', '07:00'), false);
  assert.equal(inQuietHours('12:00', '08:00', '17:00'), true);
  assert.equal(inQuietHours('12:00', '08:00', '08:00'), false);
});
void test('snooze and dismiss patches are deterministic and one-time dismissal disables', () => {
  const alarm: Alarm = {
    id: 'alarm-1',
    kind: 'alarm',
    data: {
      label: 'Wake up',
      timezone: 'UTC',
      enabled: true,
      sound: 'chime',
      volume: 0.5,
      vibration: true,
      snoozeMinutes: 10,
      schedule: { rule: 'once', date: '2026-09-22', time: '08:00' },
      nextOccurrence: '2026-09-22T08:00:00.000Z',
      snoozedUntil: '',
      linkedKind: '',
      linkedId: '',
      acknowledgedOccurrence: '',
      respectQuietHours: false,
    },
  };
  assert.deepEqual(
    alarmActionPatch(alarm, 'snooze', Date.parse('2026-09-22T08:00:00Z')),
    {
      nextOccurrence: '2026-09-22T08:10:00.000Z',
      snoozedUntil: '2026-09-22T08:10:00.000Z',
      acknowledgedOccurrence: '2026-09-22T08:00:00.000Z',
    },
  );
  assert.deepEqual(
    alarmActionPatch(alarm, 'dismiss', Date.parse('2026-09-22T08:00:00Z')),
    {
      enabled: false,
      nextOccurrence: '',
      snoozedUntil: '',
      acknowledgedOccurrence: '2026-09-22T08:00:00.000Z',
    },
  );
});
