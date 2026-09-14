export type Kind =
  | 'task'
  | 'project'
  | 'page'
  | 'block'
  | 'database'
  | 'row'
  | 'habit'
  | 'habitLog'
  | 'session'
  | 'countdown'
  | 'settings'
  | 'view'
  | 'comment'
  | 'completion'
  | 'template'
  | 'favorite';
export interface Data {
  [key: string]: unknown;
  title?: string;
  text?: string;
  description?: string;
  page?: string;
  parent?: string;
  database?: string;
  at?: string;
  date?: string;
  icon?: string;
  cover?: string;
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
    [key: string]: unknown;
  }
>;
export type Page = BaseEntity<
  'page',
  {
    title: string;
    icon: string;
    cover: string;
    parent: string;
    [key: string]: unknown;
  }
>;
export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet'
  | 'number'
  | 'check'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'table'
  | 'image'
  | 'file'
  | 'link'
  | 'embed'
  | 'database';
export type Block = BaseEntity<
  'block',
  {
    page: string;
    type: BlockType;
    text: string;
    order: number;
    checked: boolean;
    url?: string;
    file?: string;
    name?: string;
    [key: string]: unknown;
  }
>;
export type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'files'
  | 'person'
  | 'relation'
  | 'rollup'
  | 'formula';
export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  options: string[];
  target?: string;
  expression?: string;
  relation?: string;
  property?: string;
  aggregate?: 'count' | 'sum' | 'average' | 'min' | 'max';
}
export type Database = BaseEntity<
  'database',
  {
    title: string;
    properties: Property[];
    dateProperty: string;
    [key: string]: unknown;
  }
>;
export type DatabaseRow = BaseEntity<
  'row',
  {
    database: string;
    title: string;
    values: Record<string, unknown>;
    [key: string]: unknown;
  }
>;
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
export const databaseLayouts = [
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
] as const;
export type DatabaseLayout = (typeof databaseLayouts)[number];
export type SavedView = BaseEntity<
  'view',
  {
    title: string;
    database?: string;
    layout?: DatabaseLayout;
    query?: string;
    filterProp?: string;
    filterValue?: string;
    sort?: string;
    descending?: boolean;
    group?: string;
    hidden?: string[];
    propertyOrder?: string[];
    filter?: Record<string, unknown>;
    [key: string]: unknown;
  }
>;
export type Comment = BaseEntity<
  'comment',
  {
    target: string;
    text: string;
    at: string;
    [key: string]: unknown;
  }
>;
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
export type Template = BaseEntity<
  'template',
  {
    type: 'page' | 'row';
    title: string;
    database?: string;
    pageTemplate?: Page['data'];
    blocks?: Partial<Block['data']>[];
    row?: Partial<DatabaseRow['data']>;
    [key: string]: unknown;
  }
>;
export type Favorite = BaseEntity<
  'favorite',
  {
    title: string;
    tip: number;
    [key: string]: unknown;
  }
>;
export type Entity =
  | Task
  | Project
  | Page
  | Block
  | Database
  | DatabaseRow
  | Habit
  | HabitLog
  | FocusSession
  | Countdown
  | SettingsEntity
  | SavedView
  | Comment
  | Completion
  | Template
  | Favorite;
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
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cycles: number;
  dailyGoal: number;
  model: string;
  quietStart: string;
  quietEnd: string;
  taskViews: Record<string, string>;
  calendarView: string;
  calendarSpan: number;
  calendarShowCompleted: boolean;
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
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cycles: 4,
  dailyGoal: 5,
  model: 'gemini-2.5-flash',
  quietStart: '22:00',
  quietEnd: '07:00',
  taskViews: {},
  calendarView: 'month',
  calendarSpan: 4,
  calendarShowCompleted: false,
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
