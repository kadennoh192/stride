'use client';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useStride } from '@/lib/stride/store';
import { dateKey, shiftDate, taskData, type Task } from '@/lib/stride/types';
import { ActionSurface, type ItemAction } from './item-actions';
import { Modal } from './primitives';
import { Field } from './forms';
export function TaskActionSurface({
  task,
  onEdit,
  children,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  children: (menu: ReactNode) => ReactElement;
}) {
  const store = useStride();
  const [date, setDate] = useState<string | null>(null);
  const update = (data: Partial<Task['data']>) => store.update(task, data);
  const today = dateKey(new Date(), task.data.timezone);
  const moveActions: ItemAction[] = [
    {
      id: 'inbox',
      label: 'Inbox',
      run: () => update({ project: 'inbox', section: '' }),
    },
    ...store.entities
      .filter((entity) => entity.kind === 'project')
      .map((project) => ({
        id: project.id,
        label: project.data.title,
        children: [
          {
            id: `${project.id}-none`,
            label: 'No section',
            run: () => update({ project: project.id, section: '' }),
          },
          ...project.data.sections.map((section) => ({
            id: `${project.id}-${section}`,
            label: section,
            run: () => update({ project: project.id, section }),
          })),
        ],
      })),
  ];
  const actions: ItemAction[] = [
    { id: 'open', label: 'Open / edit', run: () => onEdit(task) },
    {
      id: 'complete',
      label: task.data.completedAt ? 'Reopen' : 'Complete',
      run: () => store.complete(task),
    },
    {
      id: 'date',
      label: 'Change date',
      children: [
        { id: 'today', label: 'Today', run: () => update({ due: today }) },
        {
          id: 'tomorrow',
          label: 'Tomorrow',
          run: () => update({ due: shiftDate(today, 1) }),
        },
        {
          id: 'choose',
          label: 'Choose date…',
          run: () => setDate(task.data.due),
        },
        {
          id: 'clear',
          label: 'No date',
          run: () => update({ due: '', time: '' }),
        },
      ],
    },
    {
      id: 'priority',
      label: 'Change priority',
      children: [1, 2, 3, 4].map((priority) => ({
        id: `p${priority}`,
        label: `P${priority} · ${['Urgent', 'High', 'Medium', 'Normal'][priority - 1]}`,
        run: () => update({ priority }),
      })),
    },
    { id: 'move', label: 'Move to project / section', children: moveActions },
    {
      id: 'duplicate',
      label: 'Duplicate',
      run: () =>
        store.add(
          'task',
          taskData(`${task.data.title} copy`, {
            ...task.data,
            title: `${task.data.title} copy`,
            completedAt: '',
            status: 'To do',
            reminderAcknowledgedAt: 0,
          }),
        ),
    },
    {
      id: 'delete',
      label: 'Delete',
      danger: true,
      run: () => store.remove(task),
    },
  ];
  return (
    <>
      <ActionSurface actions={actions} label={task.data.title}>
        {children}
      </ActionSurface>
      {date !== null && (
        <Modal open title="Change task date" onClose={() => setDate(null)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await update({ due: date, ...(!date ? { time: '' } : {}) });
              setDate(null);
            }}
          >
            <Field label="Due date">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <button className="primary-button">Save date</button>
          </form>
        </Modal>
      )}
    </>
  );
}
