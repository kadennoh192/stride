import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
export const fields = sqliteTable(
  'fields',
  {
    owner: text('owner').notNull(),
    entity: text('entity').notNull(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    stamp: text('stamp').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.entity, t.key] })],
);
export const changes = sqliteTable(
  'changes',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    owner: text('owner').notNull(),
    id: text('id').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [index('changes_owner_seq').on(t.owner, t.seq)],
);
export const dedup = sqliteTable(
  'dedup',
  { owner: text('owner').notNull(), id: text('id').notNull() },
  (t) => [primaryKey({ columns: [t.owner, t.id] })],
);
export const watchTokens = sqliteTable('watch_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  owner: text('owner').notNull(),
  created: text('created').notNull(),
  expires: text('expires').notNull(),
});
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    owner: text('owner').notNull(),
    endpoint: text('endpoint').notNull(),
    payload: text('payload').notNull(),
    created: integer('created').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.endpoint] })],
);
export const reminderJobs = sqliteTable(
  'reminder_jobs',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    entity: text('entity').notNull(),
    due: integer('due').notNull(),
    originalDue: integer('original_due').notNull(),
    attempts: integer('attempts').notNull().default(0),
    round: integer('round').notNull().default(0),
    repeatMinutes: integer('repeat_minutes').notNull().default(0),
    state: text('state').notNull().default('pending'),
    lease: integer('lease').notNull().default(0),
    lastError: text('last_error').notNull().default(''),
  },
  (t) => [index('reminder_due').on(t.state, t.due)],
);
export const dispatchNonces = sqliteTable('dispatch_nonces', {
  nonce: text('nonce').primaryKey(),
  created: integer('created').notNull(),
});

export const reminderScheduleQueue = sqliteTable(
  'reminder_schedule_queue',
  {
    owner: text('owner').notNull(),
    entity: text('entity').notNull(),
    revision: text('revision').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.entity] })],
);
export const reminderDeliveries = sqliteTable(
  'reminder_deliveries',
  {
    job: text('job').notNull(),
    endpoint: text('endpoint').notNull(),
    round: integer('round').notNull(),
    delivered: integer('delivered').notNull(),
  },
  (t) => [primaryKey({ columns: [t.job, t.endpoint, t.round] })],
);

export const workspaceResets = sqliteTable('workspace_resets', {
  owner: text('owner').notNull().primaryKey(),
  generation: text('generation').notNull(),
  phase: text('phase').notNull().default('d1'),
  lease: text('lease').notNull().default(''),
  leaseUntil: integer('lease_until').notNull().default(0),
  completedAt: text('completed_at').notNull().default(''),
});
