'use client';
import { useEffect, useState } from 'react';
import { useStride } from '@/lib/stride/store';
import {
  alarmActionPatch,
  nextAlarmOccurrence,
  type AlarmSchedule,
} from '@/lib/stride/alarms';
import type { Alarm, Assignment, Task } from '@/lib/stride/types';
import { Modal } from '../primitives';

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const initial = (): AlarmSchedule => ({
  rule: 'once',
  date: new Date().toISOString().slice(0, 10),
  time: '09:00',
});
function AlarmEditor({ alarm, close }: { alarm?: Alarm; close: () => void }) {
  const store = useStride();
  const [data, setData] = useState<Alarm['data']>(
    alarm?.data || {
      label: '',
      timezone: store.settings.timezone || 'UTC',
      enabled: true,
      sound: store.settings.alarmSound,
      volume: store.settings.alarmVolume,
      vibration: store.settings.alarmVibration,
      snoozeMinutes: store.settings.alarmSnoozeMinutes,
      nextOccurrence: '',
      linkedKind: '',
      linkedId: '',
      acknowledgedOccurrence: '',
      respectQuietHours: false,
      schedule: initial(),
    },
  );
  const [error, setError] = useState('');
  const schedule = data.schedule as unknown as AlarmSchedule;
  const advanced =
    ['interval', 'weekly', 'monthlyDay', 'monthlyWeekday'].includes(
      schedule.rule,
    ) ||
    schedule.activeFrom ||
    schedule.activeUntil ||
    schedule.excludedDates?.length;
  const basicReadOnly = store.settings.alarmEditorMode === 'basic' && advanced;
  const set = <K extends keyof Alarm['data']>(
    key: K,
    value: Alarm['data'][K],
  ) => setData((previous) => ({ ...previous, [key]: value }));
  const setSchedule = (patch: Partial<AlarmSchedule>) =>
    set('schedule', { ...schedule, ...patch });
  const linked = store.entities.filter(
    (entity): entity is Task | Assignment =>
      entity.kind === 'task' || entity.kind === 'assignment',
  );
  const save = async () => {
    try {
      const next = nextAlarmOccurrence(
        schedule,
        data.timezone,
        Date.now() - 1000,
      );
      if (!next)
        throw new Error('Choose an upcoming occurrence for this alarm.');
      const updated = { ...data, nextOccurrence: new Date(next).toISOString() };
      if (alarm) await store.update(alarm, updated, 'Updated alarm');
      else await store.add('alarm', updated, 'Added alarm');
      close();
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <Modal open title={alarm ? 'Edit alarm' : 'New alarm'} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <label>
            Label{' '}
            <input
              required
              value={data.label}
              onChange={(event) => set('label', event.target.value)}
            />
          </label>
          <label>
            Timezone{' '}
            <input
              list="timezones"
              value={data.timezone}
              onChange={(event) => set('timezone', event.target.value)}
            />
          </label>
          <label>
            Linked item{' '}
            <select
              value={`${data.linkedKind}:${data.linkedId}`}
              onChange={(event) => {
                const [kind, id] = event.target.value.split(':');
                setData({
                  ...data,
                  linkedKind: kind as Alarm['data']['linkedKind'],
                  linkedId: id || '',
                });
              }}
            >
              <option value=":">Standalone</option>
              {linked.map((item) => (
                <option key={item.id} value={`${item.kind}:${item.id}`}>
                  {item.data.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sound{' '}
            <select
              value={data.sound}
              onChange={(event) => set('sound', event.target.value)}
            >
              <option value="chime">Chime</option>
              <option value="bell">Bell</option>
              <option value="silent">Silent</option>
            </select>
          </label>
          <label>
            Volume{' '}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={data.volume}
              onChange={(event) => set('volume', Number(event.target.value))}
            />{' '}
            {Math.round(data.volume * 100)}%
          </label>
          <label>
            Snooze minutes{' '}
            <input
              type="number"
              min="1"
              max="120"
              value={data.snoozeMinutes}
              onChange={(event) =>
                set('snoozeMinutes', Number(event.target.value))
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(event) => set('enabled', event.target.checked)}
            />{' '}
            Enabled
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.vibration}
              onChange={(event) => set('vibration', event.target.checked)}
            />{' '}
            Vibrate when available
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.respectQuietHours}
              onChange={(event) =>
                set('respectQuietHours', event.target.checked)
              }
            />{' '}
            Respect quiet hours
          </label>
        </div>
        {basicReadOnly ? (
          <p>
            This alarm uses an advanced schedule. Switch to Advanced in Settings
            to edit its timing. Other fields can still be saved.
          </p>
        ) : (
          <>
            <h3>Schedule</h3>
            <div className="form-grid">
              <label>
                Repeat{' '}
                <select
                  value={schedule.rule}
                  onChange={(event) =>
                    set('schedule', {
                      ...schedule,
                      rule: event.target.value as AlarmSchedule['rule'],
                    })
                  }
                >
                  <option value="once">One time</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="selectedWeekdays">Selected weekdays</option>
                  {store.settings.alarmEditorMode === 'advanced' && (
                    <>
                      <option value="interval">Fixed interval</option>
                      <option value="weekly">Weekly rule</option>
                      <option value="monthlyDay">Monthly day</option>
                      <option value="monthlyWeekday">
                        Monthly nth weekday
                      </option>
                    </>
                  )}
                </select>
              </label>
              {schedule.rule !== 'interval' && (
                <label>
                  Time{' '}
                  <input
                    required
                    type="time"
                    value={schedule.time || ''}
                    onChange={(event) =>
                      setSchedule({ time: event.target.value })
                    }
                  />
                </label>
              )}
              {schedule.rule === 'once' && (
                <label>
                  Date{' '}
                  <input
                    required
                    type="date"
                    value={schedule.date || ''}
                    onChange={(event) =>
                      setSchedule({ date: event.target.value })
                    }
                  />
                </label>
              )}
              {schedule.rule === 'interval' && (
                <>
                  <label>
                    Starting at{' '}
                    <input
                      type="datetime-local"
                      value={schedule.startAt?.slice(0, 16) || ''}
                      onChange={(event) =>
                        setSchedule({
                          startAt: new Date(event.target.value).toISOString(),
                        })
                      }
                    />
                  </label>
                  <label>
                    Every minutes{' '}
                    <input
                      type="number"
                      min="5"
                      value={schedule.intervalMinutes || 30}
                      onChange={(event) =>
                        setSchedule({
                          intervalMinutes: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </>
              )}
              {schedule.rule === 'monthlyDay' && (
                <label>
                  Day of month{' '}
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={schedule.dayOfMonth || 1}
                    onChange={(event) =>
                      setSchedule({ dayOfMonth: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              {schedule.rule === 'monthlyWeekday' && (
                <>
                  <label>
                    Week of month{' '}
                    <select
                      value={schedule.weekOfMonth || 1}
                      onChange={(event) =>
                        setSchedule({ weekOfMonth: Number(event.target.value) })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value === 5 ? 'Last' : value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Weekday{' '}
                    <select
                      value={schedule.weekday || 0}
                      onChange={(event) =>
                        setSchedule({ weekday: Number(event.target.value) })
                      }
                    >
                      {dayNames.map((name, index) => (
                        <option key={name} value={index}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {store.settings.alarmEditorMode === 'advanced' && (
                <>
                  <label>
                    Active from{' '}
                    <input
                      type="date"
                      value={schedule.activeFrom || ''}
                      onChange={(event) =>
                        setSchedule({
                          activeFrom: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    Active until{' '}
                    <input
                      type="date"
                      value={schedule.activeUntil || ''}
                      onChange={(event) =>
                        setSchedule({
                          activeUntil: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    Excluded dates, comma separated{' '}
                    <input
                      value={(schedule.excludedDates || []).join(', ')}
                      onChange={(event) =>
                        setSchedule({
                          excludedDates: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
            {['selectedWeekdays', 'weekly'].includes(schedule.rule) && (
              <div className="weekday-picker">
                {dayNames.map((name, index) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      checked={schedule.weekdays?.includes(index) || false}
                      onChange={(event) =>
                        setSchedule({
                          weekdays: event.target.checked
                            ? [...(schedule.weekdays || []), index]
                            : (schedule.weekdays || []).filter(
                                (day) => day !== index,
                              ),
                        })
                      }
                    />{' '}
                    {name}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          {alarm && (
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => void store.remove(alarm).then(close)}
            >
              Delete alarm
            </button>
          )}
          <button className="primary-button">Save alarm</button>
        </div>
      </form>
    </Modal>
  );
}
export function Alarms() {
  const store = useStride();
  const [editing, setEditing] = useState<Alarm | 'new' | null>(null);
  const alarms = store.entities.filter(
    (entity): entity is Alarm => entity.kind === 'alarm',
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR REMINDERS</div>
          <h1>Alarms</h1>
          <p>
            In-app alarms ring while Stride is open. Background alerts need
            sign-in and push permission.
          </p>
        </div>
        <button className="primary-button" onClick={() => setEditing('new')}>
          New alarm
        </button>
      </div>
      <div className="search-results">
        {alarms.map((alarm) => (
          <button
            className="search-result"
            key={alarm.id}
            onClick={() => setEditing(alarm)}
          >
            <span>
              <strong>{alarm.data.label}</strong> ·{' '}
              {alarm.data.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <small>
              {alarm.data.nextOccurrence
                ? new Date(alarm.data.nextOccurrence).toLocaleString()
                : 'No next occurrence'}{' '}
              · {String((alarm.data.schedule as AlarmSchedule).rule)}
            </small>
          </button>
        ))}
        {!alarms.length && <p>No alarms yet.</p>}
      </div>
      {editing && (
        <AlarmEditor
          alarm={editing === 'new' ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
export function AlarmOverlay() {
  const store = useStride();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const alarm = store.entities
    .filter((entity): entity is Alarm => entity.kind === 'alarm')
    .find(
      (item) =>
        item.data.enabled &&
        item.data.nextOccurrence &&
        Date.parse(item.data.nextOccurrence) <= now &&
        Date.parse(item.data.nextOccurrence) > now - 3600000 &&
        !(
          item.data.linkedKind &&
          store.entities.some(
            (target) =>
              target.id === item.data.linkedId &&
              (target.deleted ||
                !!target.data.completedAt ||
                target.data.status === 'Done'),
          )
        ),
    );
  useEffect(() => {
    if (!alarm) return;
    if (alarm.data.vibration && 'vibrate' in navigator)
      navigator.vibrate([200, 100, 200]);
    if (alarm.data.sound === 'silent' || alarm.data.volume <= 0) return;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = alarm.data.sound === 'bell' ? 'sine' : 'triangle';
      oscillator.frequency.value = alarm.data.sound === 'bell' ? 880 : 660;
      gain.gain.value = Math.min(0.2, alarm.data.volume * 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.4);
    } catch {
      /* Visual overlay remains available when audio is blocked. */
    }
    return () => {
      if (context) void context.close();
      if ('vibrate' in navigator) navigator.vibrate(0);
    };
  }, [alarm]);
  if (!alarm) return null;
  const snooze = () =>
    void store.update(
      alarm,
      alarmActionPatch(alarm, 'snooze', now),
      'Snoozed alarm',
    );
  const dismiss = () => {
    void store.update(
      alarm,
      alarmActionPatch(alarm, 'dismiss', now),
      'Dismissed alarm',
    );
  };
  return (
    <div
      className="alarm-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ringing-title"
    >
      <div className="school-column">
        <h2 id="ringing-title">Alarm: {alarm.data.label}</h2>
        <p>It is time for your alarm.</p>
        <div className="form-actions">
          <button className="secondary-button" onClick={snooze}>
            Snooze {alarm.data.snoozeMinutes} minutes
          </button>
          <button className="primary-button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
