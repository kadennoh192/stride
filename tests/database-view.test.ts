import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDatabaseView,
  orderDatabaseProperties,
} from '../lib/stride/database-view';
import { applyEdits, blank, materialize } from '../lib/stride/storage';
import type { Property } from '../lib/stride/types';
import { validateEntity } from '../lib/stride/validation';

const properties: Property[] = [
  { id: 'alpha', name: 'Alpha', type: 'text', options: [] },
  { id: 'beta', name: 'Beta', type: 'number', options: [] },
];

void test('saved database views round-trip order and recover across schema changes', () => {
  const state = blank();
  applyEdits(
    state,
    [
      {
        id: 'database',
        kind: 'database',
        data: { title: 'Database', properties, dateProperty: '' },
      },
      {
        id: 'view',
        kind: 'view',
        data: {
          database: 'database',
          title: 'Review',
          layout: 'board',
          query: 'open',
          filterProp: 'alpha',
          filterValue: 'ready',
          sort: 'beta',
          descending: true,
          group: 'alpha',
          hidden: ['alpha'],
          propertyOrder: ['beta', 'alpha'],
        },
      },
    ],
    'Saved view',
  );
  const view = materialize(state.fields).find((entity) => entity.id === 'view');
  assert.equal(view?.kind, 'view');
  if (view?.kind !== 'view') throw new Error('Saved view not found');
  const restored = normalizeDatabaseView(view.data, properties);
  assert.deepEqual(restored, {
    layout: 'board',
    query: 'open',
    filterProp: 'alpha',
    filterValue: 'ready',
    sort: 'beta',
    descending: true,
    group: 'alpha',
    hidden: ['alpha'],
    propertyOrder: ['beta', 'alpha'],
  });
  assert.deepEqual(
    orderDatabaseProperties(properties, restored.propertyOrder).map(
      (property) => property.id,
    ),
    ['beta', 'alpha'],
  );

  const changedProperties: Property[] = [
    properties[1],
    { id: 'gamma', name: 'Gamma', type: 'date', options: [] },
  ];
  const migrated = normalizeDatabaseView(view.data, changedProperties);
  assert.deepEqual(migrated.propertyOrder, ['beta', 'gamma']);
  assert.deepEqual(migrated.hidden, []);
  assert.equal(migrated.filterProp, '');
  assert.equal(migrated.group, '');
  assert.equal(migrated.sort, 'beta');
});

void test('saved database view validation rejects unsafe configuration', () => {
  for (const data of [
    { layout: 'spreadsheet' },
    { propertyOrder: ['alpha', 'alpha'] },
    { hidden: ['../alpha'] },
    { sort: '../alpha' },
    { descending: 'yes' },
  ])
    assert.throws(() =>
      validateEntity({
        id: 'view',
        kind: 'view',
        data: { title: 'Invalid view', ...data },
      }),
    );
});
