import { validateEntity } from './validation';
import type { BlockType, EntityData, EntityEdit, Template } from './types';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function activeData(value: unknown) {
  const data = record(value);
  delete data._deleted;
  return data;
}

/** Build a complete atomic edit set from current or legacy page templates. */
export function instantiatePageTemplate(
  template: Template,
  pageId: string,
  blockId: (index: number) => string,
): EntityEdit[] {
  validateEntity(template);
  if (template.data.type !== 'page') throw new Error('Choose a page template.');
  const source = activeData(template.data.pageTemplate || template.data.page);
  const page: EntityEdit = {
    id: pageId,
    kind: 'page',
    data: {
      ...source,
      title: template.data.title,
      icon: typeof source.icon === 'string' ? source.icon : '',
      cover: typeof source.cover === 'string' ? source.cover : '',
      parent: '',
    },
  };
  validateEntity(page);
  const blocks = Array.isArray(template.data.blocks)
    ? template.data.blocks
    : [];
  const edits = blocks.map((value, index): EntityEdit => {
    const source = activeData(value);
    const block: EntityEdit = {
      id: blockId(index),
      kind: 'block',
      data: {
        ...source,
        page: pageId,
        type:
          typeof source.type === 'string'
            ? (source.type as BlockType)
            : 'paragraph',
        text: typeof source.text === 'string' ? source.text : '',
        order: index * 100,
        checked: source.checked === true,
      },
    };
    validateEntity(block);
    return block;
  });
  return [page, ...edits];
}

/** Normalize a saved row into a fresh row for the selected database. */
export function instantiateRowTemplate(
  template: Template,
  database: string,
): EntityData<'row'> {
  validateEntity(template);
  if (template.data.type !== 'row')
    throw new Error('Choose a database entry template.');
  const source = activeData(template.data.row);
  const data = {
    ...source,
    database,
    title:
      typeof source.title === 'string' && source.title.trim()
        ? source.title
        : template.data.title,
    values: record(source.values),
  } as EntityData<'row'>;
  validateEntity({ id: 'template-row-preview', kind: 'row', data });
  return data;
}
