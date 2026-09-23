'use client';
import { useEffect, useMemo, useState } from 'react';
import { useStride } from '@/lib/stride/store';
import {
  elapsedShowerSeconds,
  estimatedWaterLitres,
  estimatedSavingsLitres,
  type ActiveShowerTimer,
} from '@/lib/stride/shower';
import {
  dateKey,
  shiftDate,
  type CheckIn,
  type ShowerSession,
} from '@/lib/stride/types';

export function Shower() {
  const store = useStride();
  const timer = (store.settings.activeShowerTimer ||
    null) as ActiveShowerTimer | null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = elapsedShowerSeconds(timer, now);
  const over = !!timer && elapsed >= timer.targetMinutes * 60;
  const sessions = store.entities.filter(
    (entity): entity is ShowerSession => entity.kind === 'showerSession',
  );
  const average = sessions.length
    ? sessions.reduce((sum, session) => sum + session.data.duration, 0) /
      sessions.length
    : 0;
  const goalRate = sessions.length
    ? sessions.filter(
        (session) => session.data.duration <= session.data.targetMinutes * 60,
      ).length / sessions.length
    : 0;
  const totalWater = sessions.reduce(
    (sum, session) => sum + estimatedWaterLitres(session.data),
    0,
  );
  const savings = sessions.reduce(
    (sum, session) => sum + estimatedSavingsLitres(session.data),
    0,
  );
  const start = () =>
    void store.setSettings({
      activeShowerTimer: {
        startedAt: Date.now(),
        elapsedSeconds: 0,
        running: true,
        targetMinutes: store.settings.showerTargetMinutes,
        flowLitresPerMinute: store.settings.showerFlowLitresPerMinute,
      },
    });
  const pause = () =>
    timer &&
    void store.setSettings({
      activeShowerTimer: {
        ...timer,
        elapsedSeconds: elapsedShowerSeconds(timer, Date.now()),
        running: false,
      },
    });
  const resume = () =>
    timer &&
    void store.setSettings({
      activeShowerTimer: { ...timer, startedAt: Date.now(), running: true },
    });
  const finish = async () => {
    if (!timer) return;
    const seconds = elapsedShowerSeconds(timer, Date.now());
    await store.add(
      'showerSession',
      {
        at: new Date().toISOString(),
        duration: seconds,
        targetMinutes: timer.targetMinutes,
        flowLitresPerMinute: timer.flowLitresPerMinute,
      },
      'Recorded shower',
    );
    await store.setSettings({ activeShowerTimer: null });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPTIONAL TRACKING</div>
          <h1>Shower</h1>
          <p>
            Water figures are estimates from your configured flow rate, not
            sensor measurements.
          </p>
        </div>
      </div>
      <section className="school-column">
        <h2>Timer</h2>
        <p
          className="shower-clock"
          role="timer"
          aria-label="Elapsed shower time"
        >
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
        </p>
        <p>
          Target: {timer?.targetMinutes || store.settings.showerTargetMinutes}{' '}
          minutes
        </p>
        {over && (
          <p role="alert">
            Target reached. You can finish whenever you are ready.
          </p>
        )}
        <div className="form-actions">
          {!timer ? (
            <button className="primary-button" onClick={start}>
              Start shower
            </button>
          ) : (
            <>
              <button
                className="secondary-button"
                onClick={timer.running ? pause : resume}
              >
                {timer.running ? 'Pause' : 'Resume'}
              </button>
              <button className="primary-button" onClick={() => void finish()}>
                Finish and save
              </button>
            </>
          )}
        </div>
      </section>
      <div className="school-board">
        <section className="school-column">
          <h2>Average duration</h2>
          <p>
            {sessions.length
              ? `${(average / 60).toFixed(1)} minutes`
              : 'No sessions yet'}
          </p>
        </section>
        <section className="school-column">
          <h2>Within target</h2>
          <p>
            {sessions.length
              ? `${Math.round(goalRate * 100)}%`
              : 'No sessions yet'}
          </p>
        </section>
        <section className="school-column">
          <h2>Estimated water use</h2>
          <p>{totalWater.toFixed(1)} litres</p>
        </section>
        <section className="school-column">
          <h2>Estimated savings versus target</h2>
          <p>{savings.toFixed(1)} litres</p>
        </section>
      </div>
      <details>
        <summary>Session history</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Duration</th>
              <th>Target</th>
              <th>Estimated litres</th>
            </tr>
          </thead>
          <tbody>
            {sessions
              .sort((a, b) => b.data.at.localeCompare(a.data.at))
              .map((session) => (
                <tr key={session.id}>
                  <td>{new Date(session.data.at).toLocaleString()}</td>
                  <td>{(session.data.duration / 60).toFixed(1)} min</td>
                  <td>{session.data.targetMinutes} min</td>
                  <td>
                    {(
                      (session.data.duration / 60) *
                      session.data.flowLitresPerMinute
                    ).toFixed(1)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

export function CheckIns() {
  const store = useStride();
  const today = dateKey(new Date(), store.settings.timezone || undefined);
  const [date, setDate] = useState(today);
  const entries = store.entities.filter(
    (entity): entity is CheckIn => entity.kind === 'checkIn',
  );
  const existing = entries.find((entry) => entry.data.date === date);
  const [draft, setDraft] = useState<CheckIn['data']>(
    () =>
      existing?.data || {
        date,
        mood: 3,
        energy: 3,
        stress: 3,
        sleepHours: 8,
        note: '',
      },
  );
  const recent = useMemo(
    () => entries.filter((entry) => entry.data.date >= shiftDate(today, -29)),
    [entries, today],
  );
  const average = (key: 'mood' | 'energy' | 'stress' | 'sleepHours') =>
    recent.length >= 3
      ? (
          recent.reduce((sum, entry) => sum + entry.data[key], 0) /
          recent.length
        ).toFixed(1)
      : 'More check-ins needed';
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPTIONAL DAILY REFLECTION</div>
          <h1>Check-ins</h1>
          <p>
            Private notes and simple descriptive trends from your workspace.
          </p>
        </div>
      </div>
      <form
        className="school-column"
        onSubmit={(event) => {
          event.preventDefault();
          void (existing
            ? store.update(existing, draft, 'Updated check-in')
            : store.edit(
                [
                  {
                    id: `checkin-${date}`,
                    kind: 'checkIn',
                    data: { ...draft, _deleted: false },
                  },
                ],
                'Saved check-in',
              ));
        }}
      >
        <label>
          Date{' '}
          <input
            type="date"
            max={today}
            value={date}
            onChange={(event) => {
              const selected = event.target.value;
              setDate(selected);
              setDraft(
                entries.find((entry) => entry.data.date === selected)?.data || {
                  date: selected,
                  mood: 3,
                  energy: 3,
                  stress: 3,
                  sleepHours: 8,
                  note: '',
                },
              );
            }}
          />
        </label>
        <div className="form-grid">
          {(['mood', 'energy', 'stress'] as const).map((key) => (
            <label key={key}>
              {key[0].toUpperCase() + key.slice(1)} (1–5)
              <input
                type="range"
                min="1"
                max="5"
                value={draft[key]}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: Number(event.target.value) })
                }
              />{' '}
              <output>{draft[key]}</output>
            </label>
          ))}
          <label>
            Sleep (hours){' '}
            <input
              type="number"
              min="0"
              max="24"
              step="0.25"
              value={draft.sleepHours}
              onChange={(event) =>
                setDraft({ ...draft, sleepHours: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Private note{' '}
            <textarea
              value={draft.note}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value })
              }
            />
          </label>
        </div>
        <button className="primary-button">Save check-in</button>
      </form>
      <section className="school-column">
        <h2>Last 30 days</h2>
        <p>{recent.length} check-ins</p>
        <p>
          Average mood: {average('mood')} · Energy: {average('energy')} ·
          Stress: {average('stress')} · Sleep: {average('sleepHours')}
        </p>
        <details>
          <summary>Check-in data</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Mood</th>
                <th>Energy</th>
                <th>Stress</th>
                <th>Sleep hours</th>
              </tr>
            </thead>
            <tbody>
              {recent
                .sort((a, b) => b.data.date.localeCompare(a.data.date))
                .map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.data.date}</td>
                    <td>{entry.data.mood}</td>
                    <td>{entry.data.energy}</td>
                    <td>{entry.data.stress}</td>
                    <td>{entry.data.sleepHours}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}

export function CheckInReminder() {
  const store = useStride();
  useEffect(() => {
    if (!store.settings.checkInsEnabled || !store.settings.checkInReminder)
      return;
    const tick = () => {
      const zone = store.settings.timezone || 'UTC';
      const instant = new Date();
      const day = dateKey(instant, zone);
      const wall = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(instant);
      if (wall < store.settings.checkInReminder) return;
      const start = store.settings.quietStart,
        end = store.settings.quietEnd;
      const quiet =
        start !== end &&
        (start < end
          ? wall >= start && wall < end
          : wall >= start || wall < end);
      if (
        quiet ||
        store.entities.some(
          (entity) => entity.kind === 'checkIn' && entity.data.date === day,
        )
      )
        return;
      const key = `stride-checkin-reminder:${store.owner}:${day}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, 'shown');
      store.notice(
        'Your daily check-in is ready. Open Check-ins when you have a moment.',
      );
    };
    const start = setTimeout(tick, 0);
    const interval = setInterval(tick, 30000);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [store]);
  return null;
}
