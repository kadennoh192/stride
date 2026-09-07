import type { Entity, EntityCandidate, Field } from './types';
interface Index {
  groups: Map<string, Map<string, Field>>;
  entities: Map<string, Entity>;
  all?: Entity[];
  active?: Entity[];
}
const indices = new WeakMap<Record<string, Field>, Index>();
const drafts = new WeakMap<
  Record<string, Field>,
  {
    base: Record<string, Field>;
    changes: Map<string, Field>;
    groups: Map<string, Map<string, Field>>;
  }
>();
function index(fields: Record<string, Field>): Index {
  let result = indices.get(fields);
  if (result) return result;
  result = { groups: new Map(), entities: new Map() };
  for (const field of Object.values(fields)) {
    const group = result.groups.get(field.entity) || new Map();
    group.set(field.key, field);
    result.groups.set(field.entity, group);
  }
  indices.set(fields, result);
  return result;
}
export function putField(fields: Record<string, Field>, field: Field) {
  fields[`${field.entity}:${field.key}`] = field;
  const current = indices.get(fields);
  if (current) {
    const group = current.groups.get(field.entity) || new Map();
    group.set(field.key, field);
    current.groups.set(field.entity, group);
    current.entities.delete(field.entity);
    current.all = undefined;
    current.active = undefined;
  }
}
function build(fields: Iterable<Field>): Entity | undefined {
  let entity: EntityCandidate | undefined;
  for (const f of fields) {
    entity ??= { id: f.entity, kind: f.kind, data: {} };
    if (f.key === '_deleted') entity.deleted = f.value === true;
    else entity.data[f.key] = f.value;
  }
  return entity as Entity | undefined;
}
export function entityFromFields(
  fields: Record<string, Field>,
  id: string,
): Entity | undefined {
  const draft = drafts.get(fields);
  if (draft) {
    const base = entityFromFields(draft.base, id);
    let result = base;
    for (const f of draft.groups.get(id)?.values() || []) {
      if (result === base)
        result = (base
          ? { ...base, data: { ...base.data } }
          : { id, kind: f.kind, data: {} }) as Entity;
      if (f.key === '_deleted') result!.deleted = f.value === true;
      else result!.data[f.key] = f.value;
    }
    return result;
  }
  const current = index(fields);
  const cached = current.entities.get(id);
  if (cached) return cached;
  const group = current.groups.get(id);
  if (!group) return;
  const entity = build(group.values());
  if (entity) current.entities.set(id, entity);
  return entity;
}
export function entitiesFromFields(
  fields: Record<string, Field>,
  includeDeleted = false,
): Entity[] {
  const draft = drafts.get(fields);
  if (draft) {
    const ids = new Set([
      ...index(draft.base).groups.keys(),
      ...Array.from(draft.changes.values(), (f) => f.entity),
    ]);
    return [...ids]
      .map((id) => entityFromFields(fields, id)!)
      .filter((e) => includeDeleted || !e.deleted);
  }
  const current = index(fields);
  if (includeDeleted && current.all) return current.all;
  if (!includeDeleted && current.active) return current.active;
  current.all ??= [...current.groups.keys()].map((id) =>
    entityFromFields(fields, id)!,
  );
  current.active ??= current.all.filter((e) => !e.deleted);
  return includeDeleted ? current.all : current.active;
}
export function draftFields(base: Record<string, Field>) {
  const changes = new Map<string, Field>();
  const groups = new Map<string, Map<string, Field>>();
  const fields = new Proxy(base, {
    get(target, key) {
      return typeof key === 'string' && changes.has(key)
        ? changes.get(key)
        : Reflect.get(target, key);
    },
    set(_target, key, value) {
      if (typeof key !== 'string') throw new Error('Invalid field key');
      const field = value as Field;
      changes.set(key, field);
      const group = groups.get(field.entity) || new Map<string, Field>();
      group.set(field.key, field);
      groups.set(field.entity, group);
      return true;
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(target), ...changes.keys()])];
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string' && changes.has(key))
        return {
          value: changes.get(key),
          configurable: true,
          enumerable: true,
          writable: true,
        };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  drafts.set(fields, { base, changes, groups });
  return { fields, changes };
}

export function entityRevision(
  fields: Record<string, Field>,
  id: string,
): string {
  const draft = drafts.get(fields);
  let latest = draft ? entityRevision(draft.base, id) : '';
  for (const field of (draft
    ? draft.groups.get(id)
    : index(fields).groups.get(id)
  )?.values() || [])
    if (field.stamp > latest) latest = field.stamp;
  return latest;
}
