import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, blank, materialize } from '../lib/stride/storage';
import {
  instantiatePageTemplate,
  instantiateRowTemplate,
} from '../lib/stride/templates';
import type { BlockType, Template } from '../lib/stride/types';

const blockTypes: BlockType[] = [
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

void test('page templates instantiate every block type as one atomic edit set', () => {
  const template: Template = {
    id: 'page-template',
    kind: 'template',
    data: {
      type: 'page',
      title: 'Project brief',
      blocks: blockTypes.map((type) => ({
        type,
        text: type,
        ...(type === 'link' ? { url: 'https://example.com' } : {}),
        ...(type === 'embed'
          ? { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
          : {}),
        ...(['image', 'file'].includes(type)
          ? { file: `attachment-${type}`, name: `${type}.txt` }
          : {}),
      })),
    },
  };
  const edits = instantiatePageTemplate(
    template,
    'created-page',
    (index) => `created-block-${index}`,
  );
  const state = blank();
  applyEdits(state, edits, 'Created page from template');
  const records = materialize(state.fields);
  assert.equal(records.length, blockTypes.length + 1);
  assert.deepEqual(
    records
      .filter((entity) => entity.kind === 'block')
      .sort((left, right) => left.data.order - right.data.order)
      .map((entity) => [entity.data.type, entity.data.page]),
    blockTypes.map((type) => [type, 'created-page']),
  );
  assert.equal(
    records.find((entity) => entity.kind === 'page')?.data.title,
    'Project brief',
  );

  assert.throws(() =>
    instantiatePageTemplate(
      {
        ...template,
        data: {
          ...template.data,
          blocks: [{ type: 'link', url: 'javascript:alert(1)' }],
        },
      },
      'unsafe-page',
      () => 'unsafe-block',
    ),
  );
  assert.equal(materialize(state.fields).length, blockTypes.length + 1);
});

void test('row templates normalize legacy cells before schema validation', () => {
  const state = blank();
  applyEdits(
    state,
    [
      {
        id: 'database',
        kind: 'database',
        data: {
          title: 'Database',
          dateProperty: '',
          properties: [
            { id: 'score', name: 'Score', type: 'number', options: [] },
            {
              id: 'status',
              name: 'Status',
              type: 'status',
              options: ['Ready'],
            },
          ],
        },
      },
    ],
    'Database',
  );
  const template: Template = {
    id: 'row-template',
    kind: 'template',
    data: {
      type: 'row',
      title: 'Reusable entry',
      row: {
        title: 'Prepared entry',
        database: 'old-database',
        values: { status: 'Ready' },
        cell_score: 7,
        _deleted: true,
      },
    },
  };
  const data = instantiateRowTemplate(template, 'database');
  assert.equal(data.database, 'database');
  assert.equal(data._deleted, undefined);
  applyEdits(
    state,
    [{ id: 'created-row', kind: 'row', data }],
    'Created row from template',
  );
  const row = materialize(state.fields).find(
    (entity) => entity.id === 'created-row',
  );
  assert.equal(row?.kind, 'row');
  assert.equal(row?.data.cell_score, 7);
  assert.deepEqual(row?.data.values, { status: 'Ready' });
});
