import { databaseLayouts, stringValue } from './types';
import type {
  Change,
  Field,
  Kind,
  Entity,
  EntityCandidate,
  Conflict,
  Property,
  DatabaseRow,
} from './types';
import { validZone, validDate, safeURL, embedURL } from './domain';
import { validAlarmSchedule } from './alarms';
export const kinds: Kind[] = [
  'task',
  'project',
  'page',
  'block',
  'database',
  'row',
  'habit',
  'habitLog',
  'session',
  'countdown',
  'settings',
  'view',
  'comment',
  'completion',
  'template',
  'favorite',
  'fileTombstone',
  'course',
  'assignment',
  'alarm',
  'showerSession',
  'checkIn',
  'streakDay',
];
const id = /^[a-zA-Z0-9_-]{1,150}$/;
const stamp = /^\d{15}-[a-zA-Z0-9-]{1,100}$/;
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const hexColor = (value: unknown) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
export class ValidationError extends Error {}
const invalid = (message: string): never => {
  throw new ValidationError(message);
};
function safeValue(value: unknown, depth = 0): boolean {
  if (depth > 30) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 100000;
  if (Array.isArray(value))
    return value.length <= 10000 && value.every((v) => safeValue(v, depth + 1));
  if (typeof value === 'object')
    return Object.entries(value).every(
      ([k, v]) =>
        !['__proto__', 'constructor', 'prototype'].includes(k) &&
        safeValue(v, depth + 1),
    );
  return false;
}
export function validField(v: unknown): v is Field {
  if (!v || typeof v !== 'object') return false;
  const f = v as Field;
  return (
    typeof f.entity === 'string' &&
    id.test(f.entity) &&
    kinds.includes(f.kind) &&
    typeof f.key === 'string' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(f.key) &&
    !['__proto__', 'constructor', 'prototype'].includes(f.key) &&
    typeof f.stamp === 'string' &&
    stamp.test(f.stamp) &&
    (f.base === undefined ||
      f.base === '' ||
      (typeof f.base === 'string' && stamp.test(f.base))) &&
    (f.entityBase === undefined ||
      f.entityBase === '' ||
      (typeof f.entityBase === 'string' && stamp.test(f.entityBase))) &&
    safeValue(f.value)
  );
}
export function validChange(v: unknown): v is Change {
  if (!v || typeof v !== 'object') return false;
  const c = v as Change;
  return (
    typeof c.id === 'string' &&
    id.test(c.id) &&
    typeof c.label === 'string' &&
    c.label.length < 500 &&
    typeof c.at === 'string' &&
    Number.isFinite(Date.parse(c.at)) &&
    Array.isArray(c.fields) &&
    c.fields.length > 0 &&
    c.fields.length <= 1000 &&
    c.fields.every(validField)
  );
}
export function validateEntity(e: EntityCandidate) {
  if (
    !id.test(e.id) ||
    !kinds.includes(e.kind) ||
    !e.data ||
    Array.isArray(e.data) ||
    typeof e.data !== 'object' ||
    !safeValue(e.data)
  )
    throw new ValidationError('Invalid workspace record');
  if (e.deleted) return;
  if (e.kind === 'task') {
    const d = e.data;
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 1000)
      throw new ValidationError(
        'Give the task a title (up to 1,000 characters).',
      );
    if (d.due && !validDate(stringValue(d.due)))
      throw new ValidationError('Invalid due date');
    if (d.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(stringValue(d.time)))
      throw new ValidationError('Invalid time');
    if (d.time && !d.due)
      throw new ValidationError('Choose a date for the task time.');
    optional(d, 'plannedStart', (v) => v === '' || instant(v));
    if (!validZone(stringValue(d.timezone)))
      throw new ValidationError('Choose a valid timezone');
    if (![1, 2, 3, 4].includes(Number(d.priority)))
      throw new ValidationError('Invalid priority');
    for (const key of ['tags', 'dependencies', 'reminders'])
      if (!strings(d[key])) invalid(`Invalid ${key}`);
    for (const key of ['subtasks', 'checklist']) {
      if (key === 'checklist' && d[key] === undefined) continue;
      if (!Array.isArray(d[key]) || !(d[key] as unknown[]).every(checkItem))
        invalid(`Invalid ${key}`);
    }
    if (!['To do', 'In progress', 'Done'].includes(String(d.status)))
      invalid('Invalid task status');
    for (const key of [
      'description',
      'project',
      'section',
      'parent',
      'completedAt',
    ])
      optional(d, key, (v) => typeof v === 'string');
    if (d.completedAt && !instant(d.completedAt))
      invalid('Invalid completion timestamp');
    for (const key of ['recurrenceAnchor', 'occurrence'])
      optional(
        d,
        key,
        (v) => typeof v === 'string' && (v === '' || validDate(v)),
      );
    if (
      !/^(none|weekdays|(?:daily|weekly|monthly|yearly|after-days)(?::[1-9]\d{0,2})?)$/.test(
        stringValue(d.recurrence),
      )
    )
      throw new ValidationError('Invalid recurrence');
    if (!finite(d.duration, 0, 10080))
      throw new ValidationError(
        'Duration must be between 0 and 10,080 minutes.',
      );
    if (d.repeatMinutes && !finite(d.repeatMinutes, 5, 1440))
      throw new ValidationError(
        'Repeating reminders must be at least 5 minutes apart.',
      );
  }
  if (
    [
      'project',
      'page',
      'database',
      'habit',
      'countdown',
      'view',
      'template',
      'favorite',
    ].includes(e.kind) &&
    (typeof e.data.title !== 'string' ||
      !e.data.title.trim() ||
      stringValue(e.data.title).length > 1000)
  )
    throw new ValidationError('A title is required');
  validateShape(e);
}
function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}
function finite(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
function instant(v: unknown) {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function checkItem(v: unknown) {
  return (
    object(v) &&
    typeof v.id === 'string' &&
    id.test(v.id) &&
    typeof v.title === 'string' &&
    typeof v.done === 'boolean'
  );
}
function optional(
  data: unknown,
  key: string,
  check: (value: unknown) => boolean,
) {
  if (!object(data)) throw new ValidationError(`Invalid ${key}`);
  if (data[key] !== undefined && data[key] !== null && !check(data[key]))
    invalid(`Invalid ${key}`);
}
const blocks = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'number',
  'check',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'table',
  'image',
  'file',
  'link',
  'embed',
  'database',
];
const properties = [
  'text',
  'number',
  'select',
  'multi-select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'files',
  'person',
  'relation',
  'rollup',
  'formula',
];
const navigation = [
  'inbox',
  'today',
  'weekly-review',
  'upcoming',
  'tasks',
  'calendar',
  'filters',
  'pages',
  'databases',
  'habits',
  'focus',
  'matrix',
  'countdowns',
  'insights',
  'explore',
  'archive',
  'history',
  'school',
  'alarms',
  'shower',
  'checkIns',
];
function validateShape(e: EntityCandidate) {
  const d = e.data;
  switch (e.kind) {
    case 'course': {
      if (
        typeof d.title !== 'string' ||
        !d.title.trim() ||
        d.title.length > 1000 ||
        typeof d.instructor !== 'string' ||
        typeof d.term !== 'string' ||
        !hexColor(d.color) ||
        !['none', 'points', 'percent', 'weighted'].includes(
          String(d.gradingMode),
        ) ||
        !(d.targetGrade === null || finite(d.targetGrade, 0, 100)) ||
        !Array.isArray(d.categories) ||
        !Array.isArray(d.thresholds)
      )
        invalid('Invalid course');
      const categories = d.categories as unknown[];
      if (
        categories.length > 30 ||
        categories.some(
          (category) =>
            !object(category) ||
            typeof category.id !== 'string' ||
            !id.test(category.id) ||
            typeof category.title !== 'string' ||
            !category.title.trim() ||
            !finite(category.weight, 0, 100),
        )
      )
        invalid('Invalid grade categories');
      if (
        new Set(categories.map((category) => (category as { id: string }).id))
          .size !== categories.length
      )
        invalid('Grade categories must be unique');
      if (
        d.gradingMode === 'weighted' &&
        Math.abs(
          categories.reduce<number>(
            (sum, category) =>
              sum + Number((category as { weight: number }).weight),
            0,
          ) - 100,
        ) > 0.000001
      )
        invalid('Weighted grade categories must total 100%.');
      const thresholds = d.thresholds as unknown[];
      if (
        !thresholds.length ||
        thresholds.length > 20 ||
        thresholds.some(
          (threshold) =>
            !object(threshold) ||
            typeof threshold.letter !== 'string' ||
            !threshold.letter.trim() ||
            threshold.letter.length > 20 ||
            !finite(threshold.minimum, 0, 100),
        ) ||
        new Set(
          thresholds.map(
            (threshold) => (threshold as { letter: string }).letter,
          ),
        ).size !== thresholds.length ||
        new Set(
          thresholds.map(
            (threshold) => (threshold as { minimum: number }).minimum,
          ),
        ).size !== thresholds.length
      )
        invalid('Invalid or duplicate letter-grade thresholds');
      break;
    }
    case 'assignment':
      optional(d, 'plannedStart', (v) => v === '' || instant(v));
      optional(d, 'duration', (v) => finite(v, 1, 10080));
      if (
        typeof d.title !== 'string' ||
        !d.title.trim() ||
        d.title.length > 1000 ||
        typeof d.course !== 'string' ||
        !id.test(d.course) ||
        typeof d.type !== 'string' ||
        d.type.length > 100 ||
        typeof d.description !== 'string' ||
        d.description.length > 100000 ||
        !Number.isInteger(d.priority) ||
        !finite(d.priority, 1, 4) ||
        !['To do', 'In progress', 'Done'].includes(String(d.status)) ||
        typeof d.due !== 'string' ||
        (d.due !== '' && !validDate(d.due)) ||
        typeof d.time !== 'string' ||
        (d.time !== '' && !time.test(d.time)) ||
        (d.time && !d.due) ||
        !validZone(String(d.timezone)) ||
        !Array.isArray(d.attachments) ||
        d.attachments.some(
          (item) =>
            !object(item) ||
            typeof item.id !== 'string' ||
            !id.test(item.id) ||
            typeof item.name !== 'string' ||
            item.name.length > 1024,
        ) ||
        typeof d.category !== 'string' ||
        !strings(d.reminders) ||
        !strings(d.alarms) ||
        !finite(d.possible, Number.MIN_VALUE, 1e9) ||
        !(d.score === null || finite(d.score, 0, 1e9)) ||
        !(d.expectedScore === null || finite(d.expectedScore, 0, 1e9)) ||
        typeof d.completedAt !== 'string' ||
        (d.completedAt && !instant(d.completedAt))
      )
        invalid('Invalid assignment');
      break;
    case 'alarm':
      if (
        typeof d.label !== 'string' ||
        !d.label.trim() ||
        d.label.length > 500 ||
        !validZone(String(d.timezone)) ||
        typeof d.enabled !== 'boolean' ||
        typeof d.sound !== 'string' ||
        !finite(d.volume, 0, 1) ||
        typeof d.vibration !== 'boolean' ||
        !Number.isInteger(d.snoozeMinutes) ||
        !finite(d.snoozeMinutes, 1, 120) ||
        typeof d.nextOccurrence !== 'string' ||
        (d.nextOccurrence && !instant(d.nextOccurrence)) ||
        !['', 'task', 'assignment'].includes(String(d.linkedKind)) ||
        typeof d.linkedId !== 'string' ||
        (d.linkedId && !id.test(d.linkedId)) ||
        (d.linkedKind && !d.linkedId) ||
        typeof d.acknowledgedOccurrence !== 'string' ||
        (d.acknowledgedOccurrence && !instant(d.acknowledgedOccurrence)) ||
        typeof d.respectQuietHours !== 'boolean' ||
        !validAlarmSchedule(d.schedule)
      )
        invalid('Invalid alarm');
      break;
    case 'showerSession':
      if (
        !instant(d.at) ||
        !finite(d.duration, 0, 86400) ||
        !finite(d.targetMinutes, 1, 240) ||
        !finite(d.flowLitresPerMinute, 0.1, 100)
      )
        invalid('Invalid shower session');
      break;
    case 'checkIn':
      if (
        !validDate(String(d.date)) ||
        ![d.mood, d.energy, d.stress].every(
          (v) => Number.isInteger(v) && finite(v, 1, 5),
        ) ||
        !finite(d.sleepHours, 0, 24) ||
        typeof d.note !== 'string' ||
        d.note.length > 10000
      )
        invalid('Invalid check-in');
      break;
    case 'streakDay':
      if (
        !validDate(String(d.date)) ||
        ![d.scheduled, d.completed, d.requirement, d.streak, d.freezes].every(
          (v) => Number.isInteger(v) && finite(v, 0, 100000),
        ) ||
        Number(d.completed) > Number(d.scheduled) ||
        !['neutral', 'complete', 'freeze', 'missed'].includes(
          String(d.outcome),
        ) ||
        Number(d.freezes) > 2
      )
        invalid('Invalid streak day');
      break;
    case 'project':
      optional(d, 'deadline', (v) => v === '' || validDate(String(v)));
      optional(d, 'startedAt', instant);
      optional(d, 'sections', strings);
      optional(d, 'color', hexColor);
      optional(d, 'background', (v) => v === '' || hexColor(v));
      break;
    case 'page':
      optional(d, 'parent', (v) => typeof v === 'string' && (!v || id.test(v)));
      optional(d, 'icon', (v) => typeof v === 'string' && v.length <= 16);
      optional(d, 'cover', (v) => v === '' || hexColor(v));
      break;
    case 'block':
      if (
        typeof d.page !== 'string' ||
        !id.test(d.page) ||
        !blocks.includes(String(d.type)) ||
        !finite(d.order, -1e12, 1e12)
      )
        invalid('Invalid page block');
      optional(d, 'text', (v) => typeof v === 'string');
      optional(d, 'rich', object);
      optional(d, 'checked', (v) => typeof v === 'boolean');
      optional(d, 'file', (v) => typeof v === 'string' && (!v || id.test(v)));
      optional(d, 'url', (v) => typeof v === 'string');
      if (
        d.url &&
        ((d.type === 'embed' && !embedURL(stringValue(d.url))) ||
          (d.type !== 'embed' && !safeURL(stringValue(d.url))))
      )
        invalid('Invalid or unsafe block URL');
      break;
    case 'database': {
      if (!Array.isArray(d.properties)) invalid('Invalid database properties');
      const seen = new Set<string>();
      const names = new Set<string>();
      for (const p of d.properties as unknown[]) {
        if (
          !object(p) ||
          typeof p.id !== 'string' ||
          !id.test(p.id) ||
          p.id.length > 95 ||
          seen.has(p.id) ||
          typeof p.name !== 'string' ||
          !p.name.trim() ||
          names.has(p.name) ||
          !properties.includes(String(p.type)) ||
          !strings(p.options) ||
          new Set(p.options).size !== p.options.length ||
          p.options.some((option) => !option.trim() || option.length > 500)
        )
          invalid('Invalid or duplicate database property');
        optional(
          p,
          'target',
          (v) => typeof v === 'string' && (!v || id.test(v)),
        );
        optional(
          p,
          'expression',
          (v) => typeof v === 'string' && v.length <= 10000,
        );
        for (const key of ['relation', 'property'])
          optional(p, key, (v) => typeof v === 'string' && (!v || id.test(v)));
        optional(p, 'aggregate', (v) =>
          ['count', 'sum', 'average', 'min', 'max'].includes(String(v)),
        );
        seen.add((p as { id: string }).id);
        names.add((p as { name: string }).name);
      }
      const byId = new Map(
        (d.properties as Property[]).map((property) => [property.id, property]),
      );
      for (const property of d.properties as Property[]) {
        if (
          property.type !== 'relation' &&
          property.target !== undefined &&
          property.target !== ''
        )
          invalid('Only relation properties can declare a target');
        if (
          property.type === 'rollup' &&
          property.relation &&
          byId.get(property.relation)?.type !== 'relation'
        )
          invalid('A rollup must use a relation property');
      }
      optional(
        d,
        'dateProperty',
        (v) =>
          typeof v === 'string' &&
          (!v || (seen.has(v) && byId.get(v)?.type === 'date')),
      );
      break;
    }
    case 'row':
      if (
        typeof d.database !== 'string' ||
        !id.test(d.database) ||
        typeof d.title !== 'string'
      )
        invalid('Invalid database row');
      optional(d, 'values', object);
      break;
    case 'habit':
      if (
        !finite(d.goal, Number.MIN_VALUE, 1e9) ||
        !Array.isArray(d.days) ||
        !d.days.length ||
        !d.days.every((v) => Number.isInteger(v) && v >= 0 && v <= 6)
      )
        invalid('Choose a positive habit goal and scheduled days');
      optional(
        d,
        'reminder',
        (v) => v === '' || (typeof v === 'string' && time.test(v)),
      );
      optional(d, 'color', hexColor);
      optional(d, 'icon', (v) => typeof v === 'string' && v.length <= 16);
      optional(
        d,
        'unit',
        (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100,
      );
      break;
    case 'habitLog':
      if (
        typeof d.habit !== 'string' ||
        !id.test(d.habit) ||
        typeof d.date !== 'string' ||
        !validDate(d.date) ||
        !finite(d.value, 0, 1e9)
      )
        invalid('Invalid habit history');
      break;
    case 'session':
      if (
        !instant(d.at) ||
        !finite(d.duration, 0, 86400) ||
        !['focus', 'break', 'longBreak'].includes(String(d.phase))
      )
        invalid('Invalid focus session');
      optional(d, 'task', (v) => typeof v === 'string' && (!v || id.test(v)));
      break;
    case 'completion':
      if (typeof d.task !== 'string' || !id.test(d.task) || !instant(d.at))
        invalid('Invalid completion history');
      break;
    case 'countdown':
      if (typeof d.date !== 'string' || !Number.isFinite(Date.parse(d.date)))
        invalid('Choose a valid countdown date');
      optional(
        d,
        'timezone',
        (v) => typeof v === 'string' && (!v || validZone(v)),
      );
      break;
    case 'comment':
      if (
        typeof d.target !== 'string' ||
        !id.test(d.target) ||
        typeof d.text !== 'string' ||
        !d.text.trim() ||
        !instant(d.at)
      )
        invalid('Invalid page comment');
      break;
    case 'view':
      optional(d, 'database', (v) => typeof v === 'string' && id.test(v));
      optional(d, 'layout', (v) =>
        databaseLayouts.includes(v as (typeof databaseLayouts)[number]),
      );
      for (const key of ['query', 'filterValue'])
        optional(d, key, (v) => typeof v === 'string' && v.length <= 10000);
      for (const key of ['filterProp', 'group'])
        optional(d, key, (v) => typeof v === 'string' && (!v || id.test(v)));
      optional(
        d,
        'sort',
        (v) => typeof v === 'string' && (v === 'title' || id.test(v)),
      );
      optional(d, 'descending', (v) => typeof v === 'boolean');
      for (const key of ['hidden', 'propertyOrder'])
        optional(
          d,
          key,
          (v) =>
            strings(v) &&
            new Set(v).size === v.length &&
            v.every((property) => id.test(property)),
        );
      optional(d, 'filter', object);
      break;
    case 'template':
      if (!['page', 'row'].includes(String(d.type)))
        invalid('Invalid template type');
      optional(d, 'database', (v) => typeof v === 'string' && id.test(v));
      optional(d, 'pageTemplate', object);
      optional(
        d,
        'blocks',
        (v) => Array.isArray(v) && v.every((block) => object(block)),
      );
      optional(d, 'row', object);
      break;
    case 'favorite':
      if (!finite(d.tip, 0, 10000) || !Number.isInteger(d.tip))
        invalid('Invalid favorite');
      break;
    case 'fileTombstone':
      if (typeof d.attachment !== 'string' || !id.test(d.attachment))
        invalid('Invalid attachment removal marker');
      break;
    case 'settings':
      optional(d, 'plannerSetup', (v) => typeof v === 'boolean');
      optional(
        d,
        'workingDays',
        (v) =>
          Array.isArray(v) &&
          v.length <= 7 &&
          new Set(v).size === v.length &&
          v.every((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      );
      for (const key of ['workStart', 'workEnd'])
        optional(d, key, (v) => typeof v === 'string' && time.test(v));
      if (
        typeof d.workStart === 'string' &&
        typeof d.workEnd === 'string' &&
        d.workStart >= d.workEnd
      )
        invalid('Working hours must end after they start');
      for (const key of ['geminiPlanning', 'weatherEnabled'])
        optional(d, key, (v) => typeof v === 'boolean');
      optional(d, 'weatherLocation', (v) => v === 'gps' || v === 'ip');
      optional(
        d,
        'dashboardCards',
        (v) =>
          strings(v) &&
          new Set(v).size === v.length &&
          v.every((card) =>
            [
              'plan',
              'next',
              'tasks',
              'habits',
              'focus',
              'countdowns',
              'progress',
              'weather',
            ].includes(card),
          ),
      );
      optional(d, 'educationLevel', (v) =>
        ['gradeSchool', 'highSchool', 'university', 'custom'].includes(
          String(v),
        ),
      );
      optional(d, 'schoolSetup', (v) => typeof v === 'boolean');
      optional(d, 'alarmEditorMode', (v) =>
        ['basic', 'advanced'].includes(String(v)),
      );
      optional(
        d,
        'alarmSound',
        (v) => typeof v === 'string' && v.length <= 100,
      );
      optional(d, 'alarmVolume', (v) => finite(v, 0, 1));
      optional(d, 'alarmVibration', (v) => typeof v === 'boolean');
      optional(
        d,
        'alarmSnoozeMinutes',
        (v) => Number.isInteger(v) && finite(v, 1, 120),
      );
      optional(
        d,
        'streakDailyRequirement',
        (v) => Number.isInteger(v) && finite(v, 1, 100),
      );
      for (const key of [
        'optionalModulesOnboarded',
        'showerEnabled',
        'checkInsEnabled',
      ])
        optional(d, key, (v) => typeof v === 'boolean');
      optional(d, 'showerTargetMinutes', (v) => finite(v, 1, 240));
      optional(d, 'showerFlowLitresPerMinute', (v) => finite(v, 0.1, 100));
      optional(
        d,
        'checkInReminder',
        (v) => v === '' || (typeof v === 'string' && time.test(v)),
      );
      optional(d, 'name', (v) => typeof v === 'string' && v.length <= 100);
      optional(d, 'theme', (v) =>
        ['light', 'dark', 'system', 'custom'].includes(String(v)),
      );
      for (const key of [
        'accent',
        'workspaceBackground',
        'surfaceColor',
        'textColor',
        'mutedColor',
        'mutedTextColor',
        'borderColor',
        'sidebarColor',
        'accentSurfaceColor',
      ])
        optional(d, key, hexColor);
      optional(d, 'density', (v) =>
        ['compact', 'comfortable', 'spacious'].includes(String(v)),
      );
      optional(d, 'font', (v) => ['sans', 'serif', 'mono'].includes(String(v)));
      for (const key of ['motion', 'rightPanel'])
        optional(d, key, (v) => typeof v === 'boolean');
      optional(
        d,
        'timezone',
        (v) => v === '' || (typeof v === 'string' && validZone(v)),
      );
      optional(d, 'clockTimezone', (v) =>
        ['workspace', 'device', 'utc'].includes(String(v)),
      );
      for (const key of ['hidden', 'navOrder'])
        optional(
          d,
          key,
          (v) =>
            strings(v) &&
            new Set(v).size === v.length &&
            v.every((item) => navigation.includes(item)),
        );
      for (const key of ['focusMinutes', 'breakMinutes', 'longBreakMinutes'])
        optional(d, key, (v) => finite(v, 1, 240));
      optional(d, 'cycles', (v) => finite(v, 1, 12) && Number.isInteger(v));
      optional(d, 'dailyGoal', (v) => finite(v, 1, 100) && Number.isInteger(v));
      optional(
        d,
        'model',
        (v) => typeof v === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(v),
      );
      optional(
        d,
        'taskPaneWidth',
        (v) => finite(v, 340, 740) && Number.isInteger(v),
      );
      for (const key of ['quietStart', 'quietEnd'])
        optional(d, key, (v) => typeof v === 'string' && time.test(v));
      optional(
        d,
        'taskViews',
        (v) =>
          object(v) &&
          Object.entries(v).length <= 250 &&
          Object.entries(v).every(
            ([route, view]) =>
              /^[a-zA-Z0-9/_-]{1,200}$/.test(route) &&
              ['list', 'board', 'table', 'timeline'].includes(String(view)),
          ),
      );
      optional(d, 'calendarView', (v) =>
        [
          'year',
          'month',
          'week',
          'multi-week',
          'multi-day',
          'agenda',
          'upcoming',
          'today',
          'list',
          'board',
          'table',
          'timeline',
        ].includes(String(v)),
      );
      optional(
        d,
        'calendarSpan',
        (v) => finite(v, 2, 6) && Number.isInteger(v),
      );
      optional(d, 'calendarShowCompleted', (v) => typeof v === 'boolean');
      optional(d, 'activeTimer', (v) => {
        if (!object(v)) return false;
        const duration = Number(v.duration);
        return (
          typeof v.id === 'string' &&
          id.test(v.id) &&
          finite(v.end) &&
          finite(v.duration, 1, 86400) &&
          finite(v.remaining, 0, duration) &&
          typeof v.running === 'boolean' &&
          (!v.running || Number(v.end) > 0) &&
          finite(v.cycle, 1, 10000) &&
          Number.isInteger(v.cycle) &&
          typeof v.task === 'string' &&
          (!v.task || id.test(v.task)) &&
          ['focus', 'break', 'longBreak'].includes(String(v.phase))
        );
      });
      optional(d, 'activeShowerTimer', (v) => {
        if (v === null) return true;
        if (!object(v)) return false;
        return (
          finite(v.startedAt, 0, Number.MAX_SAFE_INTEGER) &&
          finite(v.elapsedSeconds, 0, 86400) &&
          typeof v.running === 'boolean' &&
          finite(v.targetMinutes, 1, 240) &&
          finite(v.flowLitresPerMinute, 0.1, 100)
        );
      });
      break;
    default:
      break;
  }
}

function rowValues(row: DatabaseRow) {
  const values = { ...row.data.values };
  for (const [key, value] of Object.entries(row.data))
    if (key.startsWith('cell_')) values[key.slice(5)] = value;
  return values;
}

function validCell(
  property: Property,
  value: unknown,
  lookup: (id: string) => Entity | undefined,
) {
  if (value === undefined || value === null || value === '') return true;
  switch (property.type) {
    case 'text':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'select':
    case 'status':
      return typeof value === 'string' && property.options.includes(value);
    case 'multi-select':
      return (
        strings(value) &&
        new Set(value).size === value.length &&
        value.every((option) => property.options.includes(option))
      );
    case 'date':
      return typeof value === 'string' && validDate(value);
    case 'checkbox':
      return typeof value === 'boolean';
    case 'url':
      return typeof value === 'string' && !!safeURL(value);
    case 'email':
      return (
        typeof value === 'string' &&
        value.length <= 320 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      );
    case 'phone':
      return typeof value === 'string' && value.length <= 100;
    case 'files':
      return (
        Array.isArray(value) &&
        value.length <= 100 &&
        value.every(
          (file) =>
            object(file) &&
            typeof file.id === 'string' &&
            id.test(file.id) &&
            typeof file.name === 'string' &&
            file.name.length <= 1024,
        )
      );
    case 'person':
      return typeof value === 'string' && id.test(value);
    case 'relation':
      return (
        strings(value) &&
        new Set(value).size === value.length &&
        value.every((reference) => {
          if (!id.test(reference)) return false;
          const target = lookup(reference);
          if (!target) return false;
          if (!property.target) return true;
          if (['task', 'project', 'page'].includes(property.target))
            return target.kind === property.target;
          return (
            target.kind === 'row' && target.data.database === property.target
          );
        })
      );
    case 'rollup':
    case 'formula':
      return true;
  }
}

function validateRowSchema(
  row: DatabaseRow,
  lookup: (id: string) => Entity | undefined,
) {
  const database = lookup(row.data.database);
  if (!database || database.deleted) return;
  if (database.kind !== 'database')
    invalid('Database rows must reference a database');
  const values = rowValues(row);
  for (const property of database.data.properties as Property[])
    if (
      Object.hasOwn(values, property.id) &&
      !validCell(property, values[property.id], lookup)
    )
      invalid(`Invalid value for database property: ${property.name}`);
}
export function validConflict(v: unknown): v is Conflict {
  if (
    !object(v) ||
    typeof v.id !== 'string' ||
    v.id.length > 1000 ||
    !instant(v.at) ||
    !validField(v.local) ||
    !validField(v.remote)
  )
    return false;
  return (
    v.entity === v.local.entity &&
    v.entity === v.remote.entity &&
    v.key === v.local.key &&
    v.key === v.remote.key &&
    v.local.kind === v.remote.kind
  );
}

/** Check edited graph paths against the staged transaction, including indirect loops. */
export function validateGraph(
  edited: Entity[],
  lookup: (id: string) => Entity | undefined,
) {
  for (const entity of edited) {
    if (entity.deleted || entity.kind !== 'assignment') continue;
    const course = lookup(entity.data.course);
    if (course && course.kind !== 'course')
      invalid('Assignments must reference a course.');
    if (
      course?.kind === 'course' &&
      course.data.gradingMode === 'weighted' &&
      !course.data.categories.some(
        (category) => category.id === entity.data.category,
      )
    )
      invalid('Choose a category from this course.');
  }
  for (const entity of edited)
    if (entity.kind === 'row' && !entity.deleted)
      validateRowSchema(entity, lookup);
  for (const edge of ['parent', 'dependencies'] as const) {
    const done = new Set<string>();
    for (const root of edited) {
      if (
        root.deleted ||
        !['task', 'page'].includes(root.kind) ||
        done.has(root.id)
      )
        continue;
      const path = new Set<string>();
      const stack: { id: string; exit: boolean }[] = [
        { id: root.id, exit: false },
      ];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.exit) {
          path.delete(node.id);
          done.add(node.id);
          continue;
        }
        if (path.has(node.id))
          invalid(
            edge === 'parent'
              ? 'Nested items cannot contain a parent cycle.'
              : 'Dependencies cannot form a cycle.',
          );
        if (done.has(node.id)) continue;
        const entity = lookup(node.id);
        if (!entity || entity.deleted) continue;
        path.add(node.id);
        stack.push({ id: node.id, exit: true });
        const parent = entity.data.parent;
        const refs: string[] =
          edge === 'parent'
            ? typeof parent === 'string' && parent
              ? [parent]
              : []
            : entity.kind === 'task'
              ? entity.data.dependencies
              : [];
        for (const ref of refs) {
          const target = lookup(ref);
          if (target && target.kind !== entity.kind)
            invalid(
              'A parent or dependency must reference the same type of item.',
            );
          stack.push({ id: ref, exit: false });
        }
      }
    }
  }
}
