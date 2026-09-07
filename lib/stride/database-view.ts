import {
  databaseLayouts,
  type Data,
  type DatabaseLayout,
  type Property,
} from './types';

export interface DatabaseViewConfig {
  layout: DatabaseLayout;
  query: string;
  filterProp: string;
  filterValue: string;
  sort: string;
  descending: boolean;
  group: string;
  hidden: string[];
  propertyOrder: string[];
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function orderedIds(value: unknown, valid: Set<string>) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && valid.has(candidate),
  );
}

/** Restore a saved view without letting removed properties break its controls. */
export function normalizeDatabaseView(
  data: Data,
  properties: Property[],
): DatabaseViewConfig {
  const ids = properties.map((property) => property.id);
  const valid = new Set(ids);
  const order = orderedIds(data.propertyOrder, valid);
  const layout = databaseLayouts.includes(data.layout as DatabaseLayout)
    ? (data.layout as DatabaseLayout)
    : 'table';
  const filterProp = text(data.filterProp);
  const sort = text(data.sort, 'title');
  const group = text(data.group);
  return {
    layout,
    query: text(data.query),
    filterProp: valid.has(filterProp) ? filterProp : '',
    filterValue: text(data.filterValue),
    sort: sort === 'title' || valid.has(sort) ? sort : 'title',
    descending: data.descending === true,
    group: valid.has(group) ? group : '',
    hidden: orderedIds(data.hidden, valid),
    propertyOrder: [...order, ...ids.filter((id) => !order.includes(id))],
  };
}

export function orderDatabaseProperties(
  properties: Property[],
  order: string[],
) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...properties].sort(
    (left, right) =>
      (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
