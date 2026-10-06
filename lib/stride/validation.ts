import { noteText } from './notes';
import { attachmentId } from './attachment-model';
import { stringValue } from './types';
import type {
  Change,
  Field,
  Kind,
  Entity,
  EntityCandidate,
  Conflict,
} from './types';
import { validZone, validDate, safeURL } from './domain';
import { validAlarmSchedule } from './alarms';
export const kinds: Kind[] = [
  'task',
  'project',
  'note',
  'folder',
  'habit',
  'habitLog',
  'session',
  'countdown',
  'settings',
  'completion',
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
    ['project', 'habit', 'countdown'].includes(e.kind) &&
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
const navigation = [
  'inbox',
  'today',
  'weekly-review',
  'upcoming',
  'tasks',
  'calendar',
  'notes',
  'habits',
  'focus',
  'matrix',
  'countdowns',
  'insights',
  'archive',
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
    case 'note':
      if (
        typeof d.title !== 'string' ||
        d.title.length > 1000 ||
        !validNoteDocument(d.document) ||
        typeof d.text !== 'string' ||
        d.text !== noteText(d.document) ||
        typeof d.folder !== 'string' ||
        (d.folder !== '' && !id.test(d.folder)) ||
        typeof d.pinned !== 'boolean' ||
        !instant(d.createdAt) ||
        !instant(d.updatedAt) ||
        String(d.updatedAt) < String(d.createdAt)
      )
        invalid('Invalid note document, folder, or timestamps');
      break;
    case 'folder':
      if (
        typeof d.parent !== 'string' ||
        (d.parent !== '' && !id.test(d.parent))
      )
        invalid('Invalid folder parent');
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
    case 'fileTombstone':
      if (typeof d.attachment !== 'string' || !id.test(d.attachment))
        invalid('Invalid attachment removal marker');
      break;
    case 'settings':
      optional(d, 'taskLayout', (v) =>
        ['list', 'board', 'table', 'timeline'].includes(String(v)),
      );
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
    if (!entity.deleted && entity.kind === 'note' && entity.data.folder) {
      const folder = lookup(entity.data.folder);
      if (!folder || folder.deleted || folder.kind !== 'folder')
        invalid('Choose an existing note folder.');
    }
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
  for (const edge of ['parent', 'dependencies'] as const) {
    const done = new Set<string>();
    for (const root of edited) {
      if (
        root.deleted ||
        !['task', 'folder'].includes(root.kind) ||
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

/** Only the continuous editor's schema is accepted. Image/file nodes contain
 * durable IDs; pasted blob URLs and arbitrary HTML attributes cannot persist. */
export function validNoteDocument(
  value: unknown,
): value is import('./types').NoteDocument {
  let count = 0;
  const blocks = [
    'paragraph',
    'heading',
    'bulletList',
    'orderedList',
    'taskList',
    'horizontalRule',
    'blockquote',
    'codeBlock',
    'table',
    'attachment',
  ];
  const attrs: Record<string, string[]> = {
    heading: ['level'],
    orderedList: ['start'],
    taskItem: ['checked'],
    tableCell: ['colspan', 'rowspan', 'colwidth', 'align'],
    tableHeader: ['colspan', 'rowspan', 'colwidth', 'align'],
    codeBlock: ['language'],
    attachment: ['id', 'name', 'image'],
  };
  const visit = (node: unknown, depth: number): boolean => {
    if (
      !object(node) ||
      depth > 20 ||
      ++count > 10000 ||
      typeof node.type !== 'string' ||
      !safeValue(node)
    )
      return false;
    if (
      Object.keys(node).some(
        (key) => !['type', 'attrs', 'content', 'marks', 'text'].includes(key),
      )
    )
      return false;
    const type = node.type;
    if (
      ![
        'doc',
        'text',
        'hardBreak',
        'listItem',
        'taskItem',
        'tableRow',
        'tableHeader',
        'tableCell',
        ...blocks,
      ].includes(type)
    )
      return false;
    if (
      type === 'text'
        ? typeof node.text !== 'string' || !node.text
        : node.text !== undefined
    )
      return false;
    if (
      node.attrs !== undefined &&
      (!object(node.attrs) ||
        Object.keys(node.attrs).some(
          (key) => !(attrs[type] || []).includes(key),
        ))
    )
      return false;
    const attributes = object(node.attrs) ? node.attrs : {};
    if (type === 'heading' && ![1, 2, 3].includes(Number(attributes.level)))
      return false;
    if (
      type === 'orderedList' &&
      attributes.start !== undefined &&
      (!Number.isInteger(attributes.start) ||
        !finite(attributes.start, 1, 100000))
    )
      return false;
    if (type === 'taskItem' && typeof attributes.checked !== 'boolean')
      return false;
    if (
      type === 'codeBlock' &&
      attributes.language !== undefined &&
      attributes.language !== null &&
      typeof attributes.language !== 'string'
    )
      return false;
    if (
      type === 'attachment' &&
      (typeof attributes.id !== 'string' ||
        !attachmentId.test(attributes.id) ||
        typeof attributes.name !== 'string' ||
        attributes.name.length > 1024 ||
        typeof attributes.image !== 'boolean')
    )
      return false;
    if (type === 'tableCell' || type === 'tableHeader') {
      if (
        attributes.align !== undefined &&
        attributes.align !== null &&
        (typeof attributes.align !== 'string' ||
          !['left', 'right', 'center', 'justify'].includes(attributes.align))
      )
        return false;
      for (const key of ['colspan', 'rowspan'])
        if (
          attributes[key] !== undefined &&
          (!Number.isInteger(attributes[key]) ||
            !finite(attributes[key], 1, 1000))
        )
          return false;
      if (
        attributes.colwidth !== undefined &&
        attributes.colwidth !== null &&
        (!Array.isArray(attributes.colwidth) ||
          !attributes.colwidth.every(
            (width) => Number.isInteger(width) && finite(width, 1, 10000),
          ))
      )
        return false;
    }
    if (
      node.marks !== undefined &&
      (!['text', 'hardBreak'].includes(type) ||
        !Array.isArray(node.marks) ||
        !node.marks.every((mark) => {
          if (
            !object(mark) ||
            Object.keys(mark).some((key) => !['type', 'attrs'].includes(key)) ||
            !['bold', 'italic', 'strike', 'underline', 'code', 'link'].includes(
              String(mark.type),
            )
          )
            return false;
          if (mark.type !== 'link')
            return (
              mark.attrs === undefined ||
              (object(mark.attrs) && Object.keys(mark.attrs).length === 0)
            );
          return (
            object(mark.attrs) &&
            Object.keys(mark.attrs).every((key) =>
              ['href', 'target', 'rel', 'class'].includes(key),
            ) &&
            typeof mark.attrs.href === 'string' &&
            !!safeURL(mark.attrs.href)
          );
        }))
    )
      return false;
    if (node.content !== undefined && !Array.isArray(node.content))
      return false;
    const content = (node.content || []) as Record<string, unknown>[];
    if (['text', 'hardBreak', 'horizontalRule', 'attachment'].includes(type))
      return node.content === undefined;
    const allowed =
      type === 'doc' ||
      type === 'blockquote' ||
      type === 'tableHeader' ||
      type === 'tableCell'
        ? blocks
        : ['paragraph', 'heading'].includes(type)
          ? ['text', 'hardBreak']
          : type === 'codeBlock'
            ? ['text']
            : type === 'bulletList' || type === 'orderedList'
              ? ['listItem']
              : type === 'taskList'
                ? ['taskItem']
                : type === 'table'
                  ? ['tableRow']
                  : type === 'tableRow'
                    ? ['tableCell', 'tableHeader']
                    : blocks;
    if (
      !['paragraph', 'heading', 'codeBlock'].includes(type) &&
      !content.length
    )
      return false;
    if (
      ['listItem', 'taskItem'].includes(type) &&
      content[0]?.type !== 'paragraph'
    )
      return false;
    return content.every(
      (child) =>
        object(child) &&
        allowed.includes(String(child.type)) &&
        visit(child, depth + 1),
    );
  };
  return (
    object(value) &&
    value.type === 'doc' &&
    Array.isArray(value.content) &&
    visit(value, 0)
  );
}
