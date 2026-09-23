import { shiftDate, type Habit, type HabitLog, type StreakDay } from './types';

export interface StreakSummary {
  days: StreakDay[];
  current: number;
  longest: number;
  freezes: number;
  used: number;
  milestones: number[];
}

/** Rebuild the same date-keyed ledger from the same habit history on every device. */
export function calculateStreak(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
  requirement = 1,
): StreakSummary {
  const relevant = logs.filter(
    (log) =>
      !log.deleted &&
      habits.some((habit) => habit.id === log.data.habit) &&
      log.data.date <= today,
  );
  const first = relevant.map((log) => log.data.date).sort()[0] || today;
  const byHabitDay = new Map(
    relevant.map((log) => [`${log.data.habit}\n${log.data.date}`, log]),
  );
  const days: StreakDay[] = [];
  const milestones: number[] = [];
  let current = 0,
    longest = 0,
    freezes = 0,
    used = 0;
  for (
    let date = first, limit = 0;
    date <= today && limit < 36525;
    date = shiftDate(date, 1), limit++
  ) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const scheduled = habits.filter(
      (habit) => !habit.deleted && habit.data.days.includes(weekday),
    );
    const completed = scheduled.filter((habit) => {
      const log = byHabitDay.get(`${habit.id}\n${date}`);
      return (
        Number(log?.data.value || 0) >=
        Number(log?.data.goal || habit.data.goal)
      );
    }).length;
    const needed = Math.min(requirement, scheduled.length);
    if (date === today && completed < needed && needed > 0) break;
    let outcome: StreakDay['data']['outcome'];
    if (!scheduled.length) outcome = 'neutral';
    else if (completed >= needed) {
      outcome = 'complete';
      current++;
      longest = Math.max(longest, current);
      if (current % 7 === 0) {
        freezes = Math.min(2, freezes + 1);
        milestones.push(current);
      }
    } else if (freezes > 0) {
      outcome = 'freeze';
      freezes--;
      used++;
    } else {
      outcome = 'missed';
      current = 0;
    }
    days.push({
      id: `streak-${date}`,
      kind: 'streakDay',
      data: {
        date,
        scheduled: scheduled.length,
        completed,
        requirement: needed,
        outcome,
        streak: current,
        freezes,
      },
    });
  }
  return { days, current, longest, freezes, used, milestones };
}
