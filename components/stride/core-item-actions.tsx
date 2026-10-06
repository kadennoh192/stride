'use client';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useStride } from '@/lib/stride/store';
import {
  dateKey,
  stringValue,
  type Entity,
  type EntityPatch,
  type Kind,
} from '@/lib/stride/types';
import { noteTitle, folderDescendants } from '@/lib/stride/notes';
import { flushNoteDraft } from '@/lib/stride/note-drafts';
import { load } from '@/lib/stride/storage';
import { entityFromFields } from '@/lib/stride/field-index';
import { habitLogId } from '@/lib/stride/habits';
import { nextAlarmOccurrence } from '@/lib/stride/alarms';
import { ActionSurface, type ItemAction } from './item-actions';
import { Modal } from './primitives';
import { Field, Select } from './forms';
export function CoreItemActionSurface({
  entity,
  onOpen,
  onDuplicate,
  onRemoved,
  day,
  children,
}: {
  entity: Entity;
  onOpen?: () => void;
  onDuplicate?: (id: string) => void;
  onRemoved?: () => void;
  day?: string;
  children: (menu: ReactNode) => ReactElement;
}) {
  const store = useStride();
  const [editing, setEditing] = useState<'rename' | 'date' | 'move' | null>(
    null,
  );
  const [value, setValue] = useState('');
  const label =
    entity.kind === 'note'
      ? noteTitle(entity)
      : stringValue(entity.data.title || entity.data.label || entity.kind);
  const open =
    onOpen ||
    (() => {
      location.hash =
        entity.kind === 'countdown'
          ? 'countdowns'
          : entity.kind === 'folder'
            ? `notes/${entity.id}`
            : `${entity.kind}/${entity.id}`;
    });
  const patch = (data: EntityPatch<Kind>) => store.update(entity, data);
  const begin = (mode: 'rename' | 'date' | 'move', initial: string) => {
    setValue(initial);
    setEditing(mode);
  };
  const folders = store.entities.filter((item) => item.kind === 'folder');
  const actions: ItemAction[] =
    entity.kind === 'folder'
      ? []
      : [
          {
            id: 'open',
            label:
              entity.kind === 'habit' || entity.kind === 'alarm'
                ? 'Edit'
                : entity.kind === 'note'
                  ? 'Open'
                  : 'Open / edit',
            run: open,
          },
        ];
  if (entity.kind === 'project')
    actions.push(
      {
        id: 'rename',
        label: 'Edit / rename',
        run: () => {
          location.hash = `project-settings/${entity.id}`;
        },
      },
      {
        id: 'add-task',
        label: 'Add task',
        run: () => {
          window.dispatchEvent(
            new CustomEvent('stride-add-task', {
              detail: { project: entity.id },
            }),
          );
        },
      },
      {
        id: 'layout',
        label: 'Task layout settings',
        run: () => {
          location.hash = `project-settings/${entity.id}`;
        },
      },
    );
  if (entity.kind === 'note')
    actions.push(
      {
        id: 'rename',
        label: 'Rename',
        run: () => begin('rename', entity.data.title),
      },
      {
        id: 'move',
        label: 'Move to folder…',
        run: () => begin('move', entity.data.folder),
      },
      {
        id: 'pin',
        label: entity.data.pinned ? 'Unpin' : 'Pin',
        run: () =>
          patch({
            pinned: !entity.data.pinned,
            updatedAt: new Date().toISOString(),
          }),
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        run: async () => {
          await flushNoteDraft(store.owner, entity.id);
          const now = new Date().toISOString();
          const latest = entityFromFields(
            (await load(store.owner)).fields,
            entity.id,
          );
          if (latest?.kind !== 'note' || latest.deleted)
            throw new Error('This note was removed.');
          const id = await store.add('note', {
            ...latest.data,
            title: `${noteTitle(latest)} copy`,
            createdAt: now,
            updatedAt: now,
          });
          if (onDuplicate) onDuplicate(id);
          else location.hash = `note/${id}`;
        },
      },
    );
  if (entity.kind === 'folder')
    actions.push(
      {
        id: 'rename',
        label: 'Rename',
        run: () => begin('rename', entity.data.title),
      },
      {
        id: 'move',
        label: 'Move folder…',
        run: () => begin('move', entity.data.parent),
      },
    );
  if (entity.kind === 'assignment')
    actions.push(
      {
        id: 'status',
        label: 'Workflow status',
        children: (['To do', 'In progress', 'Done'] as const).map((status) => ({
          id: status,
          label: status,
          run: () =>
            patch({
              status,
              completedAt: status === 'Done' ? new Date().toISOString() : '',
            }),
        })),
      },
      {
        id: 'date',
        label: 'Change due date…',
        run: () => begin('date', entity.data.due),
      },
    );
  if (entity.kind === 'habit') {
    const selectedDay =
      day || dateKey(new Date(), store.settings.timezone || undefined);
    const log = store.entities.find(
      (item) =>
        item.kind === 'habitLog' &&
        item.data.habit === entity.id &&
        item.data.date === selectedDay,
    );
    const setLog = async (value: number) =>
      store.edit(
        [
          {
            id: await habitLogId(entity.id, selectedDay),
            kind: 'habitLog',
            data: {
              habit: entity.id,
              date: selectedDay,
              value,
              goal: entity.data.goal,
              _deleted: false,
            },
          },
        ],
        'Logged habit',
      );
    actions.push(
      {
        id: 'log',
        label: `Log ${selectedDay}`,
        run: () => setLog(Number(log?.data.value || 0) + 1),
      },
      { id: 'reset', label: `Reset ${selectedDay}`, run: () => setLog(0) },
    );
  }
  if (entity.kind === 'alarm')
    actions.push({
      id: 'toggle',
      label: entity.data.enabled ? 'Disable' : 'Enable',
      run: () => {
        const next = nextAlarmOccurrence(
          entity.data.schedule,
          entity.data.timezone,
          Date.now() - 1000,
        );
        return patch({
          enabled: !entity.data.enabled,
          ...(!entity.data.enabled
            ? { nextOccurrence: next ? new Date(next).toISOString() : '' }
            : {}),
        });
      },
    });
  if (entity.kind === 'countdown')
    actions.push(
      {
        id: 'rename',
        label: 'Edit title',
        run: () => begin('rename', entity.data.title),
      },
      {
        id: 'date',
        label: 'Edit date…',
        run: () =>
          begin(
            'date',
            new Date(
              Date.parse(entity.data.date) -
                new Date(entity.data.date).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16),
          ),
      },
    );
  actions.push({
    id: 'delete',
    label: 'Delete',
    danger: true,
    run: async () => {
      if (entity.kind === 'note') await flushNoteDraft(store.owner, entity.id);
      await store.remove(entity);
      onRemoved?.();
    },
  });
  return (
    <>
      <ActionSurface actions={actions} label={label}>
        {children}
      </ActionSurface>
      {editing && (
        <Modal
          open
          title={`${editing === 'rename' ? 'Rename' : editing === 'move' ? 'Move' : 'Change date'} ${label}`}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (entity.kind === 'note')
                await flushNoteDraft(store.owner, entity.id);
              if (editing === 'rename')
                await patch({
                  title: value,
                  ...(entity.kind === 'note'
                    ? { updatedAt: new Date().toISOString() }
                    : {}),
                });
              else if (editing === 'move')
                await patch(
                  entity.kind === 'note'
                    ? { folder: value, updatedAt: new Date().toISOString() }
                    : { parent: value },
                );
              else if (entity.kind === 'countdown')
                await patch({ date: new Date(value).toISOString() });
              else await patch({ due: value, ...(!value ? { time: '' } : {}) });
              setEditing(null);
            }}
          >
            <Field
              label={
                editing === 'rename'
                  ? 'Title'
                  : editing === 'move'
                    ? 'Destination folder'
                    : 'Date'
              }
            >
              {editing === 'move' ? (
                <Select
                  value={value}
                  onChange={setValue}
                  options={[
                    {
                      value: '',
                      label: entity.kind === 'note' ? 'All Notes' : 'Top level',
                    },
                    ...folders
                      .filter(
                        (folder) =>
                          entity.kind !== 'folder' ||
                          !folderDescendants(entity.id, folders).has(folder.id),
                      )
                      .map((folder) => ({
                        value: folder.id,
                        label: folder.data.title,
                      })),
                  ]}
                />
              ) : (
                <input
                  type={
                    editing === 'date'
                      ? entity.kind === 'countdown'
                        ? 'datetime-local'
                        : 'date'
                      : 'text'
                  }
                  maxLength={1000}
                  value={value}
                  required={
                    (entity.kind !== 'note' && editing === 'rename') ||
                    (entity.kind === 'countdown' && editing === 'date')
                  }
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </Field>
            <button className="primary-button">Save</button>
          </form>
        </Modal>
      )}
    </>
  );
}
