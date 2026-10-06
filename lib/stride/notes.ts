import type {
  Entity,
  Folder,
  Note,
  NoteDocument,
  NoteNode,
  Settings,
  TaskLayout,
} from './types';
import type { Edit } from './storage';
export const taskLayouts = ['list', 'board', 'table', 'timeline'] as const;
export function resolveTaskLayout(
  settings: Pick<Settings, 'taskLayout' | 'taskViews'>,
  route: string,
): TaskLayout {
  const override = settings.taskViews[route];
  return taskLayouts.includes(override as TaskLayout)
    ? (override as TaskLayout)
    : settings.taskLayout;
}
export const emptyDocument = (): NoteDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});
export function noteText(document: NoteNode): string {
  if (document.type === 'text') return document.text || '';
  if (document.type === 'hardBreak') return '\n';
  if (document.type === 'attachment')
    return typeof document.attrs?.name === 'string' ? document.attrs.name : '';
  const separator = [
    'doc',
    'bulletList',
    'orderedList',
    'taskList',
    'table',
    'tableRow',
  ].includes(document.type)
    ? '\n'
    : '';
  return (document.content || []).map(noteText).join(separator);
}
export function noteData(folder = '', title = ''): Note['data'] {
  const now = new Date().toISOString();
  return {
    title,
    document: emptyDocument(),
    text: '',
    folder,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}
export const noteTitle = (note: Note) =>
  note.data.title.trim() || 'Untitled note';
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.data.pinned) - Number(a.data.pinned) ||
      b.data.updatedAt.localeCompare(a.data.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}
export function folderDescendants(id: string, folders: Folder[]): Set<string> {
  const descendants = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders)
      if (descendants.has(folder.data.parent) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
  }
  return descendants;
}
export function folderDeletionEdits(
  folder: Folder,
  entities: Entity[],
): Edit[] {
  return [
    ...entities
      .filter(
        (entity): entity is Note =>
          entity.kind === 'note' && entity.data.folder === folder.id,
      )
      .map((note) => ({
        id: note.id,
        kind: 'note' as const,
        data: { folder: '', updatedAt: new Date().toISOString() },
      })),
    ...entities
      .filter(
        (entity): entity is Folder =>
          entity.kind === 'folder' && entity.data.parent === folder.id,
      )
      .map((child) => ({
        id: child.id,
        kind: 'folder' as const,
        data: { parent: folder.data.parent },
      })),
    { id: folder.id, kind: 'folder', data: { _deleted: true } },
  ];
}
export function documentAttachments(document: NoteNode): Set<string> {
  const ids = new Set<string>();
  const visit = (node: NoteNode) => {
    if (node.type === 'attachment' && typeof node.attrs?.id === 'string')
      ids.add(node.attrs.id);
    node.content?.forEach(visit);
  };
  visit(document);
  return ids;
}
