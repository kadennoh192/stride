'use client';
import { stringValue } from '@/lib/stride/types';

import { useState, useMemo } from 'react';
import { Plus, Grid2X2, Settings, Trash2, ArrowLeft, Copy } from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import {
  type Database,
  type DatabaseRow,
  type Property,
  type PropertyType,
  type Entity,
  type Task,
  type Template,
  uid,
  taskData,
} from '@/lib/stride/types';
import { propertyValue } from '@/lib/stride/domain';
import { formula } from '@/lib/stride/formula';
import { saveFile } from '@/lib/stride/storage';
import { fileURL, downloadBlob } from '@/lib/stride/files';
import { Field, Select, ReorderButtons } from '../forms';
import { Modal, Empty } from '../primitives';
import { CalendarView } from './views';
const EMPTY_PROPERTIES: Property[] = [];
const propertyTypes: PropertyType[] = [
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
function rowValues(row: DatabaseRow) {
  const values = { ...row.data.values };
  for (const [k, v] of Object.entries(row.data))
    if (k.startsWith('cell_')) values[k.slice(5)] = v;
  return values;
}
function valueOf(
  row: DatabaseRow,
  p: Property,
  properties: Property[],
  entities: Entity[],
  path = new Set<string>(),
): unknown {
  if (path.has(p.id)) return '#ERROR: circular formula';
  const values = rowValues(row);
  if (p.type === 'formula') {
    try {
      return formula(p.expression || '', (name) => {
        const property = properties.find(
          (x) => x.name === name || x.id === name,
        );
        if (!property) throw new Error(`Unknown property: ${name}`);
        return valueOf(
          row,
          property,
          properties,
          entities,
          new Set(path).add(p.id),
        );
      });
    } catch (e) {
      return `#ERROR: ${e instanceof Error ? e.message : 'Invalid formula'}`;
    }
  }
  return propertyValue(
    { ...row, data: { ...row.data, values } },
    p,
    entities.map((e) =>
      e.kind === 'row'
        ? { ...e, data: { ...e.data, values: rowValues(e as DatabaseRow) } }
        : e,
    ),
  );
}
function display(value: unknown, entities: Entity[]) {
  if (Array.isArray(value))
    return value
      .map((v) =>
        stringValue(entities.find((e) => e.id === v)?.data.title || v),
      )
      .join(', ');
  return value === true
    ? '✓'
    : value === false
      ? '—'
      : stringValue(value ?? '');
}
function PropertyInput({
  property: p,
  value,
  onChange,
}: {
  property: Property;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const store = useStride();
  if (p.type === 'checkbox')
    return (
      <input
        aria-label={p.name}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (p.type === 'select' || p.type === 'status')
    return (
      <Select
        label={p.name}
        value={stringValue(value || '')}
        onChange={onChange}
        options={[{ value: '', label: 'Empty' }, ...p.options]}
      />
    );
  if (p.type === 'multi-select' || p.type === 'relation') {
    const options =
      p.type === 'multi-select'
        ? p.options.map((v) => ({ value: v, label: v }))
        : store.entities
            .filter((e) =>
              p.target
                ? e.kind === p.target ||
                  (e.kind === 'row' && e.data.database === p.target)
                : ['page', 'task', 'project', 'row'].includes(e.kind),
            )
            .map((e) => ({ value: e.id, label: stringValue(e.data.title) }));
    return (
      <select
        aria-label={p.name}
        multiple
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions, (o) => o.value))
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (p.type === 'person')
    return (
      <Select
        label={p.name}
        value={stringValue(value || '')}
        onChange={onChange}
        options={[
          { value: '', label: 'Unassigned' },
          { value: 'owner', label: store.settings.name || 'Me' },
        ]}
      />
    );
  if (p.type === 'files')
    return (
      <div>
        {(Array.isArray(value)
          ? (value as { id: string; name: string }[])
          : []
        ).map((f) => (
          <div className="checkline" key={f.id}>
            <button
              className="subtle-button"
              onClick={async () => {
                const u = await fileURL(f.id, store.owner);
                downloadBlob(await (await fetch(u)).blob(), f.name);
                URL.revokeObjectURL(u);
              }}
            >
              {f.name}
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${f.name}`}
              onClick={() =>
                onChange(
                  (value as { id: string }[]).filter((x) => x.id !== f.id),
                )
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <input
          aria-label={`Upload ${p.name}`}
          type="file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const id = uid();
            await saveFile(id, file, store.owner, file.name);
            onChange([
              ...(Array.isArray(value) ? value : []),
              { id, name: file.name },
            ]);
            void store.sync();
          }}
        />
      </div>
    );
  return (
    <input
      aria-label={p.name}
      type={
        p.type === 'number'
          ? 'number'
          : p.type === 'date'
            ? 'date'
            : p.type === 'url'
              ? 'url'
              : p.type === 'email'
                ? 'email'
                : 'text'
      }
      value={stringValue(value ?? '')}
      onChange={(e) =>
        onChange(
          p.type === 'number'
            ? e.target.value === ''
              ? null
              : Number(e.target.value)
            : e.target.value,
        )
      }
    />
  );
}
function RowEditor({
  row,
  database,
  onClose,
}: {
  row: DatabaseRow;
  database: Database;
  onClose: () => void;
}) {
  const store = useStride();
  const current =
    (store.entities.find((e) => e.id === row.id) as DatabaseRow) || row;
  const values = rowValues(current);
  return (
    <Modal title="Database entry" open onClose={onClose} wide>
      <Field label="Title">
        <input
          value={current.data.title}
          onChange={(e) =>
            void store.update(current, { title: e.target.value })
          }
        />
      </Field>
      <div className="form-grid">
        {database.data.properties.map((p) => (
          <Field key={p.id} label={p.name}>
            {['formula', 'rollup'].includes(p.type) ? (
              <output>
                {display(
                  valueOf(current, p, database.data.properties, store.entities),
                  store.entities,
                )}
              </output>
            ) : (
              <PropertyInput
                property={p}
                value={values[p.id]}
                onChange={(v) =>
                  void store.update(
                    current,
                    { [`cell_${p.id}`]: v },
                    `Updated ${p.name}`,
                  )
                }
              />
            )}
          </Field>
        ))}
      </div>
      <div className="form-actions">
        <button
          className="secondary-button"
          onClick={async () => {
            await store.add('template', {
              type: 'row',
              title: current.data.title,
              database: database.id,
              row: current.data,
            });
            store.notice('Entry template saved');
          }}
        >
          Save as template
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            void store
              .add('row', {
                ...current.data,
                title: `${current.data.title} copy`,
              })
              .then(() => store.notice('Entry duplicated'))
          }
        >
          <Copy size={15} />
          Duplicate
        </button>
        <button
          className="secondary-button danger"
          onClick={() => void store.remove(current).then(onClose)}
        >
          Delete
        </button>
        <button className="primary-button" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="muted">Changes save automatically.</p>
    </Modal>
  );
}
function SchemaEditor({
  database,
  onClose,
}: {
  database: Database;
  onClose: () => void;
}) {
  const store = useStride();
  const [title, setTitle] = useState(database.data.title);
  const [props, setProps] = useState<Property[]>(database.data.properties);
  const [date, setDate] = useState(database.data.dateProperty || '');
  const update = (id: string, patch: Partial<Property>) =>
    setProps(props.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const changeType = (property: Property, type: PropertyType) => {
    const next = { ...property, type };
    if (type !== 'relation') delete next.target;
    if (type !== 'formula') delete next.expression;
    if (type !== 'rollup') {
      delete next.relation;
      delete next.property;
      delete next.aggregate;
    }
    setProps(
      props.map((candidate) => (candidate.id === next.id ? next : candidate)),
    );
  };
  return (
    <Modal title="Database settings" open onClose={onClose} wide>
      <Field label="Database name">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Calendar / timeline date property">
        <Select
          value={date}
          onChange={setDate}
          options={[
            { value: '', label: 'Choose a date property' },
            ...props
              .filter((p) => p.type === 'date')
              .map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </Field>
      {props.map((p, index) => (
        <div className="property-settings" key={p.id}>
          <div className="form-grid">
            <Field label="Property name">
              <input
                value={p.name}
                onChange={(e) => update(p.id, { name: e.target.value })}
              />
            </Field>
            <Field label="Type">
              <Select
                value={p.type}
                onChange={(type) => changeType(p, type as PropertyType)}
                options={propertyTypes}
              />
            </Field>
            {['select', 'multi-select', 'status'].includes(p.type) && (
              <Field label="Options (comma separated)" wide>
                <input
                  value={p.options.join(', ')}
                  onChange={(e) =>
                    update(p.id, {
                      options: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            )}
            {p.type === 'relation' && (
              <Field label="Related records" wide>
                <Select
                  value={p.target || ''}
                  onChange={(target) => update(p.id, { target })}
                  options={[
                    { value: '', label: 'Any record' },
                    ...['task', 'project', 'page'].map((k) => ({
                      value: k,
                      label: k,
                    })),
                    ...store.entities
                      .filter((e) => e.kind === 'database')
                      .map((e) => ({
                        value: e.id,
                        label: stringValue(e.data.title),
                      })),
                  ]}
                />
              </Field>
            )}
            {p.type === 'formula' && (
              <Field label="Formula" wide>
                <textarea
                  value={p.expression || ''}
                  onChange={(e) => update(p.id, { expression: e.target.value })}
                  placeholder={'prop("Hours") * 60'}
                />
                <small className="muted">
                  Use prop(&quot;Name&quot;), arithmetic, comparisons, if,
                  round, abs, min, max, sum, average, concat, upper, lower,
                  length, contains, empty, dateDiff and dateAdd.
                </small>
              </Field>
            )}
            {p.type === 'rollup' && (
              <>
                <Field label="Relation property">
                  <Select
                    value={p.relation || ''}
                    onChange={(relation) => update(p.id, { relation })}
                    options={[
                      { value: '', label: 'Choose relation' },
                      ...props
                        .filter((x) => x.type === 'relation')
                        .map((x) => ({ value: x.id, label: x.name })),
                    ]}
                  />
                </Field>
                <Field label="Related numeric property">
                  <Select
                    value={p.property || ''}
                    onChange={(property) => update(p.id, { property })}
                    options={[
                      { value: '', label: 'None (count only)' },
                      ...(
                        (store.entities.find(
                          (e) =>
                            e.id ===
                            props.find((x) => x.id === p.relation)?.target,
                        )?.data.properties || []) as Property[]
                      ).map((x) => ({ value: x.id, label: x.name })),
                      { value: 'duration', label: 'Task duration' },
                      { value: 'priority', label: 'Task priority' },
                    ]}
                  />
                </Field>
                <Field label="Aggregation">
                  <Select
                    value={p.aggregate || 'count'}
                    onChange={(aggregate) =>
                      update(p.id, {
                        aggregate: aggregate as Property['aggregate'],
                      })
                    }
                    options={['count', 'sum', 'average', 'min', 'max']}
                  />
                </Field>
              </>
            )}
          </div>
          <div className="editor-toolbar">
            <ReorderButtons
              up={
                index
                  ? () => {
                      const n = [...props];
                      [n[index - 1], n[index]] = [n[index], n[index - 1]];
                      setProps(n);
                    }
                  : undefined
              }
              down={
                index < props.length - 1
                  ? () => {
                      const n = [...props];
                      [n[index + 1], n[index]] = [n[index], n[index + 1]];
                      setProps(n);
                    }
                  : undefined
              }
            />
            <button
              className="subtle-button danger"
              onClick={() => setProps(props.filter((x) => x.id !== p.id))}
            >
              <Trash2 size={14} />
              Remove property
            </button>
          </div>
        </div>
      ))}
      <button
        className="secondary-button"
        onClick={() =>
          setProps([
            ...props,
            { id: uid(), name: 'New property', type: 'text', options: [] },
          ])
        }
      >
        <Plus size={16} />
        Add property
      </button>
      <div className="form-actions">
        <button
          className="primary-button"
          onClick={async () => {
            if (!title.trim() || props.some((p) => !p.name.trim()))
              throw new Error('Database and property names are required.');
            if (new Set(props.map((p) => p.name)).size !== props.length)
              throw new Error('Property names must be unique.');
            await store.update(database, {
              title,
              properties: props,
              dateProperty: date,
            });
            onClose();
          }}
        >
          Save schema
        </button>
      </div>
      <p className="muted">
        Removing a property hides its values; restoring the previous schema with
        Undo recovers them.
      </p>
    </Modal>
  );
}
export function DatabaseSurface({
  databaseId,
  linked = false,
}: {
  databaseId: string;
  linked?: boolean;
}) {
  const store = useStride();
  const database = store.entities.find(
    (e) => e.id === databaseId && e.kind === 'database',
  ) as Database | undefined;
  const [editing, setEditing] = useState<DatabaseRow | null>(null);
  const [schema, setSchema] = useState(false);
  const [viewId, setViewId] = useState('');
  const [layout, setLayout] = useState('table');
  const [query, setQuery] = useState('');
  const [filterProp, setFilterProp] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sort, setSort] = useState('title');
  const [descending, setDescending] = useState(false);
  const [group, setGroup] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const [limit, setLimit] = useState(100);
  const [viewName, setViewName] = useState('');
  const [viewSettings, setViewSettings] = useState(false);
  const views = store.entities.filter(
    (e) => e.kind === 'view' && e.data.database === databaseId,
  );
  const properties = database?.data.properties || EMPTY_PROPERTIES;
  const visibleProps = properties.filter((p) => !hidden.includes(p.id));
  // Domain records are immutable snapshots; memoization also bounds repeated formula evaluation.
  // eslint-disable-next-line react/react-compiler
  const rows = useMemo(
    () =>
      (
        store.entities.filter(
          (e) => e.kind === 'row' && e.data.database === databaseId,
        ) as DatabaseRow[]
      )
        .filter((r) => {
          if (
            query &&
            !JSON.stringify(r.data).toLowerCase().includes(query.toLowerCase())
          )
            return false;
          if (filterProp && filterValue) {
            const p = properties.find((p) => p.id === filterProp);
            return p
              ? display(
                  valueOf(r, p, properties, store.entities),
                  store.entities,
                )
                  .toLowerCase()
                  .includes(filterValue.toLowerCase())
              : true;
          }
          return true;
        })
        .sort((a, b) => {
          const p = properties.find((p) => p.id === sort);
          const av = p
              ? valueOf(a, p, properties, store.entities)
              : a.data.title,
            bv = p ? valueOf(b, p, properties, store.entities) : b.data.title;
          const compare =
            typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : stringValue(av ?? '').localeCompare(
                  stringValue(bv ?? ''),
                  undefined,
                  { numeric: true },
                );
          return descending ? -compare : compare;
        }),
    [
      store.entities,
      databaseId,
      // eslint-disable-next-line react/react-compiler
      properties,
      query,
      filterProp,
      filterValue,
      sort,
      descending,
    ],
  );
  if (!database)
    return (
      <Empty title="Database not found">It may have been moved to trash.</Empty>
    );
  const config = () => ({
    layout,
    query,
    filterProp,
    filterValue,
    sort,
    descending,
    group,
    hidden,
  });
  const selectView = (id: string) => {
    setViewId(id);
    const view = views.find((v) => v.id === id);
    if (view) {
      setLayout(stringValue(view.data.layout || 'table'));
      setQuery(stringValue(view.data.query || ''));
      setFilterProp(stringValue(view.data.filterProp || ''));
      setFilterValue(stringValue(view.data.filterValue || ''));
      setSort(stringValue(view.data.sort || 'title'));
      setDescending(!!view.data.descending);
      setGroup(stringValue(view.data.group || ''));
      setHidden((view.data.hidden as string[]) || []);
    }
  };
  const createRow = async () => {
    const id = await store.add('row', {
      database: databaseId,
      title: 'Untitled entry',
      values: {},
    });
    setEditing({
      id,
      kind: 'row',
      data: { database: databaseId, title: 'Untitled entry', values: {} },
    });
  };
  const groups = group
    ? [
        ...new Set(
          rows.map(
            (r) =>
              display(
                valueOf(
                  r,
                  properties.find((p) => p.id === group)!,
                  properties,
                  store.entities,
                ),
                store.entities,
              ) || 'Empty',
          ),
        ),
      ]
    : ['All entries'];
  const cell = (r: DatabaseRow, p: Property) => {
    const value = valueOf(r, p, properties, store.entities);
    if (['url', 'email', 'phone'].includes(p.type)) {
      return display(value, store.entities);
    }
    if (p.type === 'files')
      return `${Array.isArray(value) ? value.length : 0} files`;
    return display(value, store.entities);
  };
  const renderList = (items: DatabaseRow[]) => (
    <div
      className={layout === 'gallery' ? 'database-gallery' : 'database-list'}
    >
      {items.slice(0, limit).map((r) => (
        <button
          className="database-card"
          key={r.id}
          onClick={() => setEditing(r)}
        >
          <h3>{r.data.title}</h3>
          {visibleProps.slice(0, layout === 'gallery' ? 4 : 2).map((p) => (
            <div key={p.id}>
              <span className="muted">{p.name}</span>
              <span>{cell(r, p)}</span>
            </div>
          ))}
        </button>
      ))}
    </div>
  );
  return (
    <div className="database-surface">
      {!linked && (
        <>
          <a href="#databases" className="subtle-button">
            <ArrowLeft size={16} />
            Databases
          </a>
          <div className="page-heading">
            <div>
              <div className="eyebrow">CONNECTED INFORMATION</div>
              <h1>{database.data.title}</h1>
              <p>{rows.length} entries</p>
            </div>
            <div className="editor-toolbar">
              <button
                className="icon-button"
                aria-label="Database settings"
                onClick={() => setSchema(true)}
              >
                <Settings size={18} />
              </button>
              <button
                className="primary-button"
                onClick={() => void createRow()}
              >
                <Plus size={17} />
                New entry
              </button>
            </div>
          </div>
        </>
      )}
      <div className="viewbar">
        {['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].map(
          (v) => (
            <button
              key={v}
              className={`view-tab ${layout === v ? 'active' : ''}`}
              onClick={() => setLayout(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ),
        )}
      </div>
      <div className="filterbar">
        <input
          className="text-input"
          style={{ maxWidth: 240 }}
          placeholder="Search entries…"
          aria-label="Search database"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          label="Saved database view"
          value={viewId}
          onChange={selectView}
          options={[
            { value: '', label: 'Current view' },
            ...views.map((v) => ({
              value: v.id,
              label: stringValue(v.data.title),
            })),
          ]}
        />
        <button
          className="secondary-button"
          onClick={() => setViewSettings(!viewSettings)}
        >
          View options
        </button>
        {linked && (
          <button className="secondary-button" onClick={() => void createRow()}>
            New entry
          </button>
        )}
      </div>
      {viewSettings && (
        <div className="inset-panel">
          <div className="form-grid">
            <Field label="Filter property">
              <Select
                value={filterProp}
                onChange={setFilterProp}
                options={[
                  { value: '', label: 'No property filter' },
                  ...properties.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            <Field label="Contains value">
              <input
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
              />
            </Field>
            <Field label="Sort by">
              <Select
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'title', label: 'Title' },
                  ...properties.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            <label className="checkline">
              <input
                type="checkbox"
                checked={descending}
                onChange={(e) => setDescending(e.target.checked)}
              />
              Descending
            </label>
            <Field label="Group / board columns">
              <Select
                value={group}
                onChange={setGroup}
                options={[
                  { value: '', label: 'No grouping' },
                  ...properties
                    .filter((p) =>
                      [
                        'text',
                        'select',
                        'status',
                        'checkbox',
                        'person',
                      ].includes(p.type),
                    )
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            <Field label="View name">
              <input
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
              />
            </Field>
          </div>
          <div className="property-visibility">
            {properties.map((p) => (
              <label className="checkline" key={p.id}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(p.id)}
                  onChange={(e) =>
                    setHidden(
                      e.target.checked
                        ? hidden.filter((id) => id !== p.id)
                        : [...hidden, p.id],
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button
              className="secondary-button"
              disabled={!viewName.trim()}
              onClick={async () => {
                const id = await store.add('view', {
                  database: databaseId,
                  title: viewName,
                  ...config(),
                });
                setViewId(id);
                setViewName('');
              }}
            >
              Save new view
            </button>
            {viewId && (
              <>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void store.update(
                      views.find((v) => v.id === viewId)!,
                      config(),
                    )
                  }
                >
                  Update view
                </button>
                <button
                  className="subtle-button danger"
                  onClick={async () => {
                    await store.remove(views.find((v) => v.id === viewId)!);
                    setViewId('');
                  }}
                >
                  Delete view
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {['calendar', 'timeline'].includes(layout) ? (
        database.data.dateProperty ? (
          <CalendarView
            mode={layout === 'calendar' ? 'month' : 'timeline'}
            tasks={
              rows.map((r) => ({
                id: r.id,
                kind: 'task',
                data: taskData(r.data.title, {
                  due: stringValue(
                    rowValues(r)[database.data.dateProperty] || '',
                  ),
                }),
              })) as Task[]
            }
            onEdit={(t) => setEditing(rows.find((r) => r.id === t.id)!)}
            onReschedule={(id, date) =>
              void store.update(
                rows.find((r) => r.id === id)!,
                { [`cell_${database.data.dateProperty}`]: date },
              )
            }
          />
        ) : (
          <Empty title="Choose a date property">
            Open database settings to select the date used by calendar and
            timeline.
            <button
              className="secondary-button"
              onClick={() => setSchema(true)}
            >
              Database settings
            </button>
          </Empty>
        )
      ) : layout === 'board' ? (
        <div className="board-grid">
          {(group
            ? [
                ...new Set([
                  ...(properties.find((p) => p.id === group)?.options || []),
                  ...groups,
                ]),
              ]
            : ['All entries']
          ).map((g) => (
            <section className="board-column" key={g}>
              <h3>{g}</h3>
              {renderList(
                rows.filter(
                  (r) =>
                    !group ||
                    (display(
                      valueOf(
                        r,
                        properties.find((p) => p.id === group)!,
                        properties,
                        store.entities,
                      ),
                      store.entities,
                    ) || 'Empty') === g,
                ),
              )}
            </section>
          ))}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g}>
            {group && <h3 className="agenda-date">{g}</h3>}
            {layout === 'table' ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      {visibleProps.map((p) => (
                        <th key={p.id}>{p.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter(
                        (r) =>
                          !group ||
                          (display(
                            valueOf(
                              r,
                              properties.find((p) => p.id === group)!,
                              properties,
                              store.entities,
                            ),
                            store.entities,
                          ) || 'Empty') === g,
                      )
                      .slice(0, limit)
                      .map((r) => (
                        <tr key={r.id}>
                          <td>
                            <button
                              className="task-title"
                              onClick={() => setEditing(r)}
                            >
                              {r.data.title}
                            </button>
                          </td>
                          {visibleProps.map((p) => (
                            <td key={p.id}>
                              {p.type === 'checkbox' ? (
                                <input
                                  type="checkbox"
                                  aria-label={`${r.data.title} ${p.name}`}
                                  checked={rowValues(r)[p.id] === true}
                                  onChange={(e) =>
                                    void store.update(r, {
                                      [`cell_${p.id}`]: e.target.checked,
                                    })
                                  }
                                />
                              ) : (
                                <button
                                  className="cell-button"
                                  onClick={() => setEditing(r)}
                                >
                                  {cell(r, p) || '—'}
                                </button>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              renderList(
                rows.filter(
                  (r) =>
                    !group ||
                    (display(
                      valueOf(
                        r,
                        properties.find((p) => p.id === group)!,
                        properties,
                        store.entities,
                      ),
                      store.entities,
                    ) || 'Empty') === g,
                ),
              )
            )}
          </section>
        ))
      )}
      {rows.length > limit && (
        <button
          className="secondary-button"
          onClick={() => setLimit(limit + 100)}
        >
          Show 100 more
        </button>
      )}
      {rows.length === 0 && (
        <Empty icon={<Grid2X2 />} title="Your database is ready">
          Add an entry or adjust your filters.
        </Empty>
      )}
      <div className="inset-panel">
        <h3>Entry templates</h3>
        {store.entities
          .filter(
            (e): e is Template =>
              e.kind === 'template' &&
              e.data.type === 'row' &&
              e.data.database === databaseId,
          )
          .map((t) => {
            const row = t.data.row;
            if (!row) return null;
            const title =
              typeof row.title === 'string' ? row.title : 'Untitled entry';
            const values =
              row.values && typeof row.values === 'object' ? row.values : {};
            return (
              <button
                className="secondary-button"
                key={t.id}
                onClick={() =>
                  void store.add('row', {
                    ...row,
                    database: databaseId,
                    title,
                    values,
                  })
                }
              >
                {stringValue(t.data.title)}
              </button>
            );
          })}
        <p className="muted">
          Open an entry and save it as a template to reuse its properties.
        </p>
      </div>
      {schema && (
        <SchemaEditor database={database} onClose={() => setSchema(false)} />
      )}{' '}
      {editing && (
        <RowEditor
          row={editing}
          database={database}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
export default function Databases({ databaseId }: { databaseId?: string }) {
  const store = useStride();
  if (databaseId)
    return <DatabaseSurface key={databaseId} databaseId={databaseId} />;
  const databases = store.entities.filter((e) => e.kind === 'database');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORGANIZE YOUR WAY</div>
          <h1>Databases</h1>
        </div>
        <button
          className="primary-button"
          onClick={async () => {
            const status = uid(),
              date = uid();
            const id = await store.add('database', {
              title: 'Untitled database',
              properties: [
                {
                  id: status,
                  name: 'Status',
                  type: 'status',
                  options: ['Not started', 'In progress', 'Done'],
                },
                { id: date, name: 'Date', type: 'date', options: [] },
              ],
              dateProperty: date,
            });
            location.assign('#' + `database/${id}`);
          }}
        >
          <Plus size={18} />
          New database
        </button>
      </div>
      {databases.length ? (
        <div className="page-cards">
          {databases.map((d) => (
            <a className="page-card" key={d.id} href={`#database/${d.id}`}>
              <Grid2X2 />
              <h3>{stringValue(d.data.title)}</h3>
              <p className="muted">
                {
                  store.entities.filter(
                    (e) => e.kind === 'row' && e.data.database === d.id,
                  ).length
                }{' '}
                entries
              </p>
            </a>
          ))}
        </div>
      ) : (
        <Empty icon={<Grid2X2 />} title="Build a useful collection">
          Track reading, projects, ideas, and everything in between.
        </Empty>
      )}
    </>
  );
}
