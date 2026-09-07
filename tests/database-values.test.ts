import test from 'node:test';
import assert from 'node:assert/strict';
import { databasePropertyValue } from '../lib/stride/database-values';
import type {
  Database,
  DatabaseRow,
  Entity,
  Property,
} from '../lib/stride/types';

const targetProperties: Property[] = [
  { id: 'score', name: 'Score', type: 'number', options: [] },
  {
    id: 'doubled',
    name: 'Doubled',
    type: 'formula',
    options: [],
    expression: 'prop("Score") * 2',
  },
];
const sourceProperties: Property[] = [
  {
    id: 'related',
    name: 'Related',
    type: 'relation',
    options: [],
    target: 'target-database',
  },
  {
    id: 'total',
    name: 'Total',
    type: 'rollup',
    options: [],
    relation: 'related',
    property: 'doubled',
    aggregate: 'sum',
  },
  {
    id: 'count',
    name: 'Count',
    type: 'rollup',
    options: [],
    relation: 'related',
    aggregate: 'count',
  },
  {
    id: 'average',
    name: 'Average',
    type: 'formula',
    options: [],
    expression: 'prop("Total") / prop("Count")',
  },
];

function database(id: string, properties: Property[]): Database {
  return {
    id,
    kind: 'database',
    data: { title: id, properties, dateProperty: '' },
  };
}

function row(id: string, database: string, values: Record<string, unknown>) {
  return {
    id,
    kind: 'row' as const,
    data: { title: id, database, values },
  } satisfies DatabaseRow;
}

void test('database formulas consume cross-database rollups consistently', () => {
  const source = row('source-row', 'source-database', {
    related: ['target-one', 'target-two'],
  });
  const entities: Entity[] = [
    database('source-database', sourceProperties),
    database('target-database', targetProperties),
    source,
    row('target-one', 'target-database', { score: 2 }),
    row('target-two', 'target-database', { score: 4 }),
  ];
  const value = (id: string) =>
    databasePropertyValue(
      source,
      sourceProperties.find((property) => property.id === id)!,
      sourceProperties,
      entities,
    );
  assert.equal(value('total'), 12);
  assert.equal(value('count'), 2);
  assert.equal(value('average'), 6);
});

void test('database expression cycles become visible cell errors', () => {
  const properties: Property[] = [
    {
      id: 'first',
      name: 'First',
      type: 'formula',
      options: [],
      expression: 'prop("Second")',
    },
    {
      id: 'second',
      name: 'Second',
      type: 'formula',
      options: [],
      expression: 'prop("First")',
    },
  ];
  const current = row('cyclic-row', 'cyclic-database', {});
  assert.match(
    String(
      databasePropertyValue(current, properties[0], properties, [current]),
    ),
    /^#ERROR: Circular database expression$/,
  );
});
