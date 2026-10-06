import type { AlarmSchedule } from './alarms';
export type Kind =
  | 'task'
  | 'project'
  | 'note'
  | 'folder'
  | 'habit'
  | 'habitLog'
  | 'session'
  | 'countdown'
  | 'settings'
  | 'completion'
  | 'fileTombstone'
  | 'course'
  | 'assignment'
  | 'alarm'
  | 'showerSession'
  | 'checkIn'
  | 'streakDay';
export interface Data {
  [key: string]: unknown;
  title?: string;
  text?: string;
  description?: string;
  parent?: string;
  at?: string;
  date?: string;
  color?: string;
  url?: string;
  target?: string;
  phase?: string;
  model?: string;
  timezone?: string;
  quietStart?: string;
  quietEnd?: string;
  completedAt?: string;
}
export function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  return JSON.stringify(value) ?? '';
}

export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export interface BaseEntity<K extends Kind, D extends Data> {
  id: string;
  kind: K;
  data: D;
  deleted?: boolean;
}
/** Untrusted or partially materialized records are validated before becoming Entity values. */
export type EntityCandidate = BaseEntity<Kind, Data>;
export interface Field {
  entity: string;
  kind: Kind;
  key: string;
  value: unknown;
  stamp: string;
  base?: string;
  entityBase?: string;
}
export interface Change {
  id: string;
  fields: Field[];
  label: string;
  at: string;
}
export interface Conflict {
  id: string;
  entity: string;
  key: string;
  local: Field;
  remote: Field;
  at: string;
}
export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
}
export type Task = BaseEntity<
  'task',
  {
    title: string;
    description: string;
    project: string;
    section: string;
    due: string;
    time: string;
    plannedStart?: string;
    priority: number;
    tags: string[];
    status: string;
    completedAt: string;
    recurrence: string;
    duration: number;
    subtasks: ChecklistItem[];
    checklist: ChecklistItem[];
    parent: string;
    dependencies: string[];
    reminders: string[];
    repeatMinutes: number;
    timezone: string;
    important: boolean;
    [key: string]: unknown;
  }
>;
export type Project = BaseEntity<
  'project',
  {
    title: string;
    color: string;
    sections: string[];
    background: string;
    deadline?: string;
    startedAt?: string;
    [key: string]: unknown;
  }
>;
export interface NoteNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: NoteNode[];
}
export interface NoteDocument extends NoteNode {
  type: 'doc';
  content: NoteNode[];
}
export type Note = BaseEntity<
  'note',
  {
    title: string;
    document: NoteDocument;
    text: string;
    folder: string;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    [key: string]: unknown;
  }
>;
export type Folder = BaseEntity<
  'folder',
  {
    title: string;
    parent: string;
    [key: string]: unknown;
  }
>;
export type TaskLayout = 'list' | 'board' | 'table' | 'timeline';
export type Habit = BaseEntity<
  'habit',
  {
    title: string;
    icon: string;
    goal: number;
    unit: string;
    color: string;
    reminder: string;
    days: number[];
    [key: string]: unknown;
  }
>;
export type HabitLog = BaseEntity<
  'habitLog',
  {
    habit: string;
    date: string;
    value: number;
    goal?: number;
    [key: string]: unknown;
  }
>;
export type FocusSession = BaseEntity<
  'session',
  {
    at: string;
    duration: number;
    phase: 'focus' | 'break' | 'longBreak';
    task?: string;
    [key: string]: unknown;
  }
>;
export type Countdown = BaseEntity<
  'countdown',
  {
    title: string;
    date: string;
    timezone?: string;
    [key: string]: unknown;
  }
>;
export type SettingsEntity = BaseEntity<'settings', Settings>;
export type Completion = BaseEntity<
  'completion',
  {
    task: string;
    at: string;
    title?: string;
    due?: string;
    [key: string]: unknown;
  }
>;
export type FileTombstone = BaseEntity<
  'fileTombstone',
  { attachment: string; [key: string]: unknown }
>;
export type GradingMode = 'none' | 'points' | 'percent' | 'weighted';
export interface GradeCategory {
  id: string;
  title: string;
  weight: number;
}
export interface GradeThreshold {
  letter: string;
  minimum: number;
}
export type Course = BaseEntity<
  'course',
  {
    title: string;
    instructor: string;
    color: string;
    term: string;
    targetGrade: number | null;
    gradingMode: GradingMode;
    categories: GradeCategory[];
    thresholds: GradeThreshold[];
    [key: string]: unknown;
  }
>;
export type Assignment = BaseEntity<
  'assignment',
  {
    title: string;
    course: string;
    type: string;
    description: string;
    priority: number;
    status: 'To do' | 'In progress' | 'Done';
    due: string;
    time: string;
    plannedStart?: string;
    duration?: number;
    timezone: string;
    attachments: { id: string; name: string }[];
    category: string;
    score: number | null;
    possible: number;
    expectedScore: number | null;
    reminders: string[];
    alarms: string[];
    completedAt: string;
    [key: string]: unknown;
  }
>;
export type Alarm = BaseEntity<
  'alarm',
  {
    label: string;
    timezone: string;
    enabled: boolean;
    sound: string;
    volume: number;
    vibration: boolean;
    snoozeMinutes: number;
    nextOccurrence: string;
    linkedKind: '' | 'task' | 'assignment';
    linkedId: string;
    acknowledgedOccurrence: string;
    respectQuietHours: boolean;
    schedule: AlarmSchedule;
    [key: string]: unknown;
  }
>;
export type ShowerSession = BaseEntity<
  'showerSession',
  {
    at: string;
    duration: number;
    targetMinutes: number;
    flowLitresPerMinute: number;
    [key: string]: unknown;
  }
>;
export type CheckIn = BaseEntity<
  'checkIn',
  {
    date: string;
    mood: number;
    energy: number;
    stress: number;
    sleepHours: number;
    note: string;
    [key: string]: unknown;
  }
>;
export type StreakDay = BaseEntity<
  'streakDay',
  {
    date: string;
    scheduled: number;
    completed: number;
    requirement: number;
    outcome: 'neutral' | 'complete' | 'freeze' | 'missed';
    streak: number;
    freezes: number;
    [key: string]: unknown;
  }
>;
export type Entity =
  | Task
  | Project
  | Note
  | Folder
  | Habit
  | HabitLog
  | FocusSession
  | Countdown
  | SettingsEntity
  | Completion
  | FileTombstone
  | Course
  | Assignment
  | Alarm
  | ShowerSession
  | CheckIn
  | StreakDay;
export type EntityOf<K extends Kind> = Extract<Entity, { kind: K }>;
export type EntityData<K extends Kind> = EntityOf<K>['data'];
export type EntityPatch<K extends Kind> = Partial<EntityData<K>> & Data;
export type EntityEdit = {
  [K in Kind]: { id: string; kind: K; data: EntityPatch<K> };
}[Kind];
export interface Settings {
  name: string;
  theme: string;
  accent: string;
  workspaceBackground: string;
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
  mutedTextColor: string;
  borderColor: string;
  sidebarColor: string;
  accentSurfaceColor: string;
  density: string;
  motion: boolean;
  rightPanel: boolean;
  font: string;
  hidden: string[];
  navOrder: string[];
  timezone: string;
  clockTimezone: 'workspace' | 'device' | 'utc';
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cycles: number;
  dailyGoal: number;
  model: string;
  plannerSetup: boolean;
  workingDays: number[];
  workStart: string;
  workEnd: string;
  geminiPlanning: boolean;
  weatherEnabled: boolean;
  weatherLocation: 'gps' | 'ip';
  dashboardCards: string[];
  quietStart: string;
  quietEnd: string;
  taskLayout: TaskLayout;
  taskViews: Record<string, TaskLayout>;
  calendarView: string;
  calendarSpan: number;
  calendarShowCompleted: boolean;
  educationLevel: 'gradeSchool' | 'highSchool' | 'university' | 'custom';
  schoolSetup: boolean;
  alarmEditorMode: 'basic' | 'advanced';
  alarmSound: string;
  alarmVolume: number;
  alarmVibration: boolean;
  alarmSnoozeMinutes: number;
  streakDailyRequirement: number;
  optionalModulesOnboarded: boolean;
  showerEnabled: boolean;
  checkInsEnabled: boolean;
  showerTargetMinutes: number;
  showerFlowLitresPerMinute: number;
  checkInReminder: string;
  [key: string]: unknown;
}
export const defaults: Settings = {
  name: '',
  theme: 'system',
  accent: '#5268e8',
  workspaceBackground: '#ffffff',
  surfaceColor: '#ffffff',
  textColor: '#282c3b',
  mutedColor: '#f6f7fa',
  mutedTextColor: '#737888',
  borderColor: '#e9ebf0',
  sidebarColor: '#f8f9fc',
  accentSurfaceColor: '#edf0ff',
  density: 'comfortable',
  motion: true,
  rightPanel: true,
  font: 'sans',
  hidden: [],
  navOrder: [],
  timezone: '',
  clockTimezone: 'workspace',
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cycles: 4,
  dailyGoal: 5,
  model: 'gemini-2.5-flash',
  plannerSetup: false,
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '17:00',
  geminiPlanning: false,
  weatherEnabled: false,
  weatherLocation: 'ip',
  dashboardCards: [
    'plan',
    'next',
    'tasks',
    'habits',
    'focus',
    'countdowns',
    'progress',
    'weather',
  ],
  quietStart: '22:00',
  quietEnd: '07:00',
  taskLayout: 'list',
  taskViews: {},
  calendarView: 'month',
  calendarSpan: 4,
  calendarShowCompleted: false,
  educationLevel: 'highSchool',
  schoolSetup: false,
  alarmEditorMode: 'basic',
  alarmSound: 'chime',
  alarmVolume: 0.7,
  alarmVibration: true,
  alarmSnoozeMinutes: 10,
  streakDailyRequirement: 1,
  optionalModulesOnboarded: false,
  showerEnabled: false,
  checkInsEnabled: false,
  showerTargetMinutes: 10,
  showerFlowLitresPerMinute: 9,
  checkInReminder: '',
};
export function uid() {
  return crypto.randomUUID();
}
export function dateKey(date = new Date(), zone?: string) {
  if (zone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    return ['year', 'month', 'day']
      .map((k) => parts.find((p) => p.type === k)?.value)
      .join('-');
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function taskData(title: string, extra: Data = {}): Task['data'] {
  return {
    title,
    description: '',
    project: 'inbox',
    section: '',
    due: '',
    time: '',
    plannedStart: '',
    priority: 4,
    tags: [],
    status: 'To do',
    completedAt: '',
    recurrence: 'none',
    duration: 30,
    subtasks: [],
    checklist: [],
    parent: '',
    dependencies: [],
    reminders: [],
    repeatMinutes: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    important: false,
    ...extra,
  } as Task['data'];
}
export function isKind<K extends Kind>(kind: K) {
  return (entity: Entity): entity is Extract<Entity, { kind: K }> =>
    entity.kind === kind;
}
