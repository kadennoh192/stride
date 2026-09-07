import { formula } from './formula';
import type { Database, DatabaseRow, Entity, Property } from './types';

export function databaseRowValues(row: DatabaseRow) {
  const values = { ...row.data.values };
  for (const [key, value] of Object.entries(row.data))
    if (key.startsWith('cell_')) values[key.slice(5)] = value;
  return values;
}

function aggregate(values: number[], operation: Property['aggregate']) {
  switch (operation) {
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0);
    case 'average':
      return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    case 'min':
      return values.length ? Math.min(...values) : 0;
    case 'max':
      return values.length ? Math.max(...values) : 0;
    default:
      return values.length;
  }
}

function evaluate(
  row: DatabaseRow,
  property: Property,
  properties: Property[],
  entities: Entity[],
  path: Set<string>,
): unknown {
  const key = `${row.id}:${property.id}`;
  if (path.has(key)) throw new Error('Circular database expression');
  const nextPath = new Set(path).add(key);
  const values = databaseRowValues(row);
  if (property.type === 'formula')
    return formula(property.expression || '', (name) => {
      const referenced = properties.find(
        (candidate) => candidate.name === name || candidate.id === name,
      );
      if (!referenced) throw new Error(`Unknown property: ${name}`);
      return evaluate(row, referenced, properties, entities, nextPath);
    });
  if (property.type !== 'rollup') return values[property.id];

  const relation = properties.find(
    (candidate) => candidate.id === property.relation,
  );
  const relationIds = relation ? values[relation.id] : undefined;
  const related = entities.filter(
    (entity) => Array.isArray(relationIds) && relationIds.includes(entity.id),
  );
  if (!property.property || property.aggregate === 'count')
    return related.length;
  const numbers = related
    .map((entity) => {
      if (entity.kind !== 'row') return Number(entity.data[property.property!]);
      const database = entities.find(
        (candidate): candidate is Database =>
          candidate.kind === 'database' &&
          candidate.id === entity.data.database,
      );
      const referenced = database?.data.properties.find(
        (candidate) => candidate.id === property.property,
      );
      return Number(
        referenced
          ? evaluate(
              entity,
              referenced,
              database!.data.properties,
              entities,
              nextPath,
            )
          : databaseRowValues(entity)[property.property!],
      );
    })
    .filter(Number.isFinite);
  return aggregate(numbers, property.aggregate);
}

export function databasePropertyValue(
  row: DatabaseRow,
  property: Property,
  properties: Property[],
  entities: Entity[],
): unknown {
  try {
    return evaluate(row, property, properties, entities, new Set());
  } catch (error) {
    return `#ERROR: ${error instanceof Error ? error.message : 'Invalid formula'}`;
  }
}
