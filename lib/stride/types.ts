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

export interface Entity {
  id: string;
  kind: Kind;
  data: Data;
  deleted?: boolean;
}
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
export interface Task extends Entity {
  kind: 'task';
  data: {
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
  };
}
export interface Project extends Entity {
  kind: 'project';
  data: {
    title: string;
    color: string;
    sections: string[];
    background: string;
    [key: string]: unknown;
  };
}
export interface Page extends Entity {
  kind: 'page';
  data: {
    title: string;
    icon: string;
    cover: string;
    parent: string;
    [key: string]: unknown;
  };
}
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
export interface Block extends Entity {
  kind: 'block';
  data: {
    page: string;
    type: BlockType;
    text: string;
    order: number;
    checked: boolean;
    url?: string;
    file?: string;
    name?: string;
    [key: string]: unknown;
  };
}
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
export interface Database extends Entity {
  kind: 'database';
  data: {
    title: string;
    properties: Property[];
    dateProperty: string;
    [key: string]: unknown;
  };
}
export interface DatabaseRow extends Entity {
  kind: 'row';
  data: {
    database: string;
    title: string;
    values: Record<string, unknown>;
    [key: string]: unknown;
  };
}
export interface Habit extends Entity {
  kind: 'habit';
  data: {
    title: string;
    icon: string;
    goal: number;
    unit: string;
    color: string;
    reminder: string;
    days: number[];
    [key: string]: unknown;
  };
}
export interface Settings {
  name: string;
  theme: string;
  accent: string;
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
  [key: string]: unknown;
}
export const defaults: Settings = {
  name: '',
  theme: 'system',
  accent: '#5268e8',
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
export function isKind<T extends Entity>(kind: T['kind']) {
  return (entity: Entity): entity is T => entity.kind === kind;
}
