'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useEditor,
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
  type JSONContent,
} from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  ArrowLeft,
  Bold,
  Italic,
  List,
  ListOrdered,
  ListChecks,
  Link2,
  Paperclip,
  Plus,
  Search,
  Folder as FolderIcon,
  StickyNote,
  Pin,
  Download,
  Table2,
} from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import {
  uid,
  type Folder,
  type Note,
  type NoteDocument,
} from '@/lib/stride/types';
import { noteData, noteText, noteTitle, sortNotes } from '@/lib/stride/notes';
import {
  recoverDraftAsNewNote,
  recoverableNoteDrafts,
  type NoteDraft,
  peekNoteDraft,
  trackNoteAttachment,
  readNoteDraft,
  stageNoteDraft,
  flushNoteDraft,
} from '@/lib/stride/note-drafts';
import { fileURL, downloadBlob } from '@/lib/stride/files';
import { getLocalFile, saveFile } from '@/lib/stride/storage';
import { safeURL } from '@/lib/stride/domain';
import { ActionSurface, ItemMenu, type ItemAction } from '../item-actions';
import { CoreItemActionSurface } from '../core-item-actions';
import { Modal, Empty } from '../primitives';
import { Field, Select } from '../forms';

// Local blob URLs need no network image optimizer.
/* eslint-disable next/no-img-element */
function AttachmentView({ node, deleteNode }: NodeViewProps) {
  const store = useStride();
  const { id, name, image } = node.attrs as {
    id: string;
    name: string;
    image: boolean;
  };
  const [url, setURL] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let disposed = false,
      objectURL = '';
    void fileURL(id, store.owner)
      .then((result) => {
        objectURL = result;
        if (!disposed) {
          setURL(result);
          setError('');
        } else URL.revokeObjectURL(result);
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    return () => {
      disposed = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [id, store.owner, retry]);
  const actions: ItemAction[] = [
    ...(image
      ? [
          {
            id: 'preview',
            label: 'Preview image',
            run: () => setPreview(true),
            disabled: !url,
          },
        ]
      : []),
    {
      id: 'download',
      label: 'Download',
      run: async () => {
        const result = await fileURL(id, store.owner);
        URL.revokeObjectURL(result);
        const local = await getLocalFile(id, store.owner);
        if (local) downloadBlob(local.blob, name);
      },
    },
    { id: 'remove', label: 'Remove from note', run: deleteNode },
    {
      id: 'purge',
      label: 'Permanently remove file…',
      danger: true,
      run: () => {
        window.dispatchEvent(
          new CustomEvent('stride-cleanup-note-file', { detail: { id, name } }),
        );
      },
    },
  ];
  return (
    <NodeViewWrapper contentEditable={false} className="note-attachment">
      <ActionSurface actions={actions} label={name}>
        {(menu) => (
          <figure>
            {image && url ? (
              <button
                className="note-image-preview"
                aria-label={`Preview ${name}`}
                onClick={() => setPreview(true)}
              >
                <img src={url} alt={name} />
              </button>
            ) : (
              <span className="attachment-label">
                <Paperclip size={18} />
                {name}
              </span>
            )}
            <figcaption>
              <span>{name}</span>
              {menu}
            </figcaption>
            {error ? (
              <div role="alert">
                {error}
                <button
                  className="subtle-button"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry download
                </button>
              </div>
            ) : !url ? (
              <span className="muted">Loading attachment…</span>
            ) : null}
          </figure>
        )}
      </ActionSurface>
      {preview && (
        <Modal open title={name} onClose={() => setPreview(false)} wide>
          <img className="attachment-preview" src={url} alt={name} />
          <button
            className="secondary-button"
            onClick={() =>
              void actions.find((action) => action.id === 'download')?.run?.()
            }
          >
            <Download size={16} />
            Download
          </button>
        </Modal>
      )}
    </NodeViewWrapper>
  );
}
const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: '' },
      name: { default: 'Attachment' },
      image: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-stride-attachment]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-stride-attachment': '' }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

function NoteEditor({ note, onBack }: { note: Note; onBack: () => void }) {
  const store = useStride();
  const latest = useRef(store);
  useEffect(() => {
    latest.current = store;
  }, [store]);
  const current = useRef(note);
  useEffect(() => {
    current.current = note;
  }, [note]);
  const owner = store.owner;
  const [title, setTitle] = useState(note.data.title);
  const titleRef = useRef(title);
  const [status, setStatus] = useState('Saved');
  const [error, setError] = useState('');
  const [attachmentFailure, setAttachmentFailure] = useState<{
    message: string;
    files: File[];
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [purge, setPurge] = useState<{ id: string; name: string } | null>(null);
  const [purgeConfirmed, setPurgeConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const uploadInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const flush = useCallback(
    async (overwrite = false) => {
      clearTimeout(timer.current);
      setStatus('Saving…');
      try {
        await flushNoteDraft(owner, note.id, overwrite);
        await latest.current.reload();
        setStatus('Saved');
        setError('');
      } catch (error) {
        setStatus('Save failed');
        setError(String(error));
        throw error;
      }
    },
    [owner, note.id],
  );
  const schedule = (document: NoteDocument) => {
    setStatus('Saving…');
    void stageNoteDraft(
      owner,
      current.current,
      titleRef.current,
      document,
    ).catch((error) => {
      setStatus('Save failed');
      setError(String(error));
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 500);
  };
  const upload = (files: File[]) =>
    trackNoteAttachment(owner, note.id, async () => {
      const targetEditor = editorRef.current;
      if (!targetEditor) return;
      const nodes: JSONContent[] = [],
        failed: File[] = [];
      let message = '';
      for (const file of files) {
        try {
          const id = uid();
          await saveFile(id, file, owner, file.name);
          nodes.push({
            type: 'attachment',
            attrs: {
              id,
              name: file.name,
              image: file.type.startsWith('image/'),
            },
          });
        } catch (error) {
          failed.push(file);
          message = String(error);
        }
      }
      if (nodes.length) {
        // Insert together, ending in a text cursor. Sequential atom insertion can
        // replace the preceding NodeSelection and silently lose earlier files.
        if (!targetEditor.isDestroyed)
          targetEditor
            .chain()
            .focus()
            .insertContent([...nodes, { type: 'paragraph' }])
            .run();
        else {
          const draft = await readNoteDraft(owner, note.id);
          const document = structuredClone(
            draft?.document || current.current.data.document,
          );
          document.content.push(...(nodes as NoteDocument['content']));
          await stageNoteDraft(
            owner,
            current.current,
            draft?.title ?? titleRef.current,
            document,
          );
        }
      }
      setAttachmentFailure(failed.length ? { message, files: failed } : null);
    }).catch((error) => {
      setAttachmentFailure({ message: String(error), files });
      throw error;
    });
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: { rel: 'noopener noreferrer' },
        },
      }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      AttachmentNode,
    ],
    immediatelyRender: false,
    content: note.data.document as JSONContent,
    editorProps: {
      attributes: {
        class: 'note-rich-text',
        'aria-label': 'Note content',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        void upload(files).catch(() => {});
        return true;
      },
      handleDrop(_view, event, _slice, moved) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (moved || !files.length) return false;
        event.preventDefault();
        void upload(files).catch(() => {});
        return true;
      },
    },
    onUpdate: ({ editor }) => schedule(editor.getJSON() as NoteDocument),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    editor.setEditable(false, false);
    void readNoteDraft(owner, note.id)
      .then((draft) => {
        if (disposed) return;
        if (draft) {
          titleRef.current = draft.title;
          setTitle(draft.title);
          editor.commands.setContent(draft.document as JSONContent, {
            emitUpdate: false,
          });
          setStatus('Unsaved draft');
          timer.current = setTimeout(() => {
            void flush().catch(() => {});
          }, 500);
        }
        editor.setEditable(true, false);
        setLoaded(true);
      })
      .catch((error) => setError(String(error)));
    return () => {
      disposed = true;
      clearTimeout(timer.current);
      void flushNoteDraft(owner, note.id).catch(() => {});
    };
  }, [editor, owner, note.id, flush]);
  useEffect(() => {
    if (!editor || !loaded) return;
    void readNoteDraft(owner, note.id).then((draft) => {
      if (draft || peekNoteDraft(owner, note.id) || editor.isDestroyed) return;
      if (
        JSON.stringify(editor.getJSON()) !== JSON.stringify(note.data.document)
      )
        editor.commands.setContent(note.data.document as JSONContent, {
          emitUpdate: false,
        });
      titleRef.current = note.data.title;
      setTitle(note.data.title);
    });
  }, [editor, loaded, owner, note.id, note.data.document, note.data.title]);
  useEffect(() => {
    const cleanup = (event: Event) => {
      setPurge((event as CustomEvent).detail);
      setPurgeConfirmed(false);
    };
    window.addEventListener('stride-cleanup-note-file', cleanup);
    return () =>
      window.removeEventListener('stride-cleanup-note-file', cleanup);
  }, []);
  const tool = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active?: boolean,
  ) => (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );
  return (
    <section
      className="notes-editor"
      aria-label="Note editor"
      data-stride-note-dirty={status !== 'Saved'}
    >
      <header className="notes-editor-header">
        <button
          className="icon-button notes-mobile-back"
          aria-label="Back to notes"
          onClick={() =>
            void flush()
              .then(onBack)
              .catch(() => {})
          }
        >
          <ArrowLeft size={18} />
        </button>
        <output className="muted">{status}</output>
        <time dateTime={note.data.updatedAt}>
          {new Date(note.data.updatedAt).toLocaleDateString()}
        </time>
      </header>
      {error && (
        <div className="note-save-error" role="alert">
          {error}
          <button
            className="subtle-button"
            onClick={() => void flush().catch(() => {})}
          >
            Retry save
          </button>
          {error.includes('removed elsewhere') && (
            <button
              className="secondary-button"
              onClick={async () => {
                const draft = await readNoteDraft(owner, note.id);
                if (draft) {
                  const id = await recoverDraftAsNewNote(owner, draft);
                  location.hash = `note/${id}`;
                }
              }}
            >
              Recover as new note
            </button>
          )}
          {error.includes('changed in another') && (
            <button
              className="secondary-button"
              onClick={() => void flush(true).catch(() => {})}
            >
              Keep my draft
            </button>
          )}
        </div>
      )}
      {attachmentFailure && (
        <div className="note-save-error" role="alert">
          {attachmentFailure.message}
          <button
            className="subtle-button"
            onClick={() => void upload(attachmentFailure.files).catch(() => {})}
          >
            Retry attachment
          </button>
          <button
            className="subtle-button"
            onClick={() => setAttachmentFailure(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <input
        className="note-title-input"
        aria-label="Note title"
        placeholder="Untitled note"
        maxLength={1000}
        disabled={!loaded}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          titleRef.current = event.target.value;
          if (editor) schedule(editor.getJSON() as NoteDocument);
        }}
      />
      {editor && (
        <div
          className="notes-toolbar"
          role="toolbar"
          aria-label="Note formatting"
        >
          <Select
            label="Text style"
            value={
              editor.isActive('heading')
                ? String(editor.getAttributes('heading').level)
                : 'paragraph'
            }
            onChange={(value) => {
              if (value === 'paragraph')
                editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(value) as 1 | 2 | 3 })
                  .run();
            }}
            options={[
              { value: 'paragraph', label: 'Body' },
              { value: '1', label: 'Heading' },
              { value: '2', label: 'Subheading' },
              { value: '3', label: 'Small heading' },
            ]}
          />
          {tool(
            'Bold',
            <Bold size={16} />,
            () => editor.chain().focus().toggleBold().run(),
            editor.isActive('bold'),
          )}
          {tool(
            'Italic',
            <Italic size={16} />,
            () => editor.chain().focus().toggleItalic().run(),
            editor.isActive('italic'),
          )}
          {tool(
            'Bulleted list',
            <List size={17} />,
            () => editor.chain().focus().toggleBulletList().run(),
            editor.isActive('bulletList'),
          )}
          {tool(
            'Numbered list',
            <ListOrdered size={17} />,
            () => editor.chain().focus().toggleOrderedList().run(),
            editor.isActive('orderedList'),
          )}
          {tool(
            'Checklist',
            <ListChecks size={17} />,
            () => editor.chain().focus().toggleTaskList().run(),
            editor.isActive('taskList'),
          )}
          {tool('Add link', <Link2 size={17} />, () =>
            setLink(editor.getAttributes('link').href || ''),
          )}
          <ItemMenu
            label="Table"
            icon={<Table2 size={17} />}
            actions={[
              {
                id: 'insert',
                label: 'Insert table',
                run: () =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run(),
              },
              ...(
                [
                  'addRowAfter',
                  'addColumnAfter',
                  'deleteRow',
                  'deleteColumn',
                  'deleteTable',
                ] as const
              ).map((command, index) => ({
                id: command,
                label: [
                  'Add row',
                  'Add column',
                  'Delete row',
                  'Delete column',
                  'Delete table',
                ][index],
                disabled: !editor.isActive('table'),
                run: () => editor.chain().focus()[command]().run(),
              })),
            ]}
          />
          <button
            className="icon-button"
            aria-label="Attach image or file"
            title="Attach image or file"
            onClick={() => uploadInput.current?.click()}
          >
            <Paperclip size={17} />
          </button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void upload(Array.from(event.target.files || [])).catch(() => {});
              event.target.value = '';
            }}
          />
        </div>
      )}
      <div className="notes-editor-scroll">
        <EditorContent editor={editor} />
      </div>
      {link !== null && (
        <Modal open title="Link" onClose={() => setLink(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editor && safeURL(link))
                editor
                  .chain()
                  .focus()
                  .extendMarkRange('link')
                  .setLink({ href: safeURL(link) })
                  .run();
              setLink(null);
            }}
          >
            <Field label="URL">
              <input
                type="url"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://…"
              />
            </Field>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  editor?.chain().focus().unsetLink().run();
                  setLink(null);
                }}
              >
                Remove link
              </button>
              <button className="primary-button" disabled={!safeURL(link)}>
                Apply link
              </button>
            </div>
          </form>
        </Modal>
      )}
      {purge && (
        <Modal
          open
          title="Permanently remove attachment"
          onClose={() => setPurge(null)}
        >
          <p>
            Delete {purge.name} from this device, cloud storage, and future
            backups. A file shared by another note or assignment cannot be
            removed.
          </p>
          <label className="checkline">
            <input
              type="checkbox"
              checked={purgeConfirmed}
              onChange={(event) => setPurgeConfirmed(event.target.checked)}
            />
            I understand this file cannot be recovered.
          </label>
          <button
            className="primary-button"
            disabled={!purgeConfirmed}
            onClick={async () => {
              try {
                await flush();
                await latest.current.purgeNoteAttachment(
                  current.current,
                  purge.id,
                );
                setPurge(null);
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            Permanently remove
          </button>
        </Modal>
      )}
    </section>
  );
}

export default function Notes({
  noteId,
  folderId,
}: {
  noteId?: string;
  folderId?: string;
}) {
  const store = useStride();
  const folders = store.entities.filter(
    (entity): entity is Folder => entity.kind === 'folder',
  );
  const notes = store.entities.filter(
    (entity): entity is Note => entity.kind === 'note',
  );
  const [folder, setFolder] = useState(folderId || '');
  const [selected, setSelected] = useState(noteId || '');
  const [screen, setScreen] = useState<'folders' | 'list' | 'editor'>(
    noteId ? 'editor' : 'list',
  );
  const [query, setQuery] = useState('');
  const [recovery, setRecovery] = useState<NoteDraft[] | null>(null);
  const [edit, setEdit] = useState<{
    kind: 'newFolder';
    id: string;
    title: string;
    parent: string;
  } | null>(null);
  const active = notes.find((note) => note.id === selected);
  const shown = sortNotes(
    notes.filter(
      (note) =>
        (!folder || note.data.folder === folder) &&
        `${noteTitle(note)} ${note.data.text}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    ),
  );
  const switchNote = async (id: string) => {
    if (active) await flushNoteDraft(store.owner, active.id);
    await store.reload();
    setSelected(id);
    setScreen('editor');
  };
  const createNote = async () => {
    if (active) await flushNoteDraft(store.owner, active.id);
    const id = await store.add('note', noteData(folder));
    setSelected(id);
    setScreen('editor');
  };
  const folderRows = (parent = '', depth = 0): React.ReactNode =>
    folders
      .filter((item) => item.data.parent === parent)
      .sort((a, b) => a.data.title.localeCompare(b.data.title))
      .map((item) => (
        <div key={item.id}>
          <CoreItemActionSurface
            entity={item}
            onRemoved={() => {
              if (folder === item.id) setFolder('');
            }}
          >
            {(menu) => (
              <div
                className={`notes-folder-row ${folder === item.id ? 'active' : ''}`}
                style={{ paddingLeft: 10 + depth * 14 }}
              >
                <button
                  onClick={async () => {
                    if (active) await flushNoteDraft(store.owner, active.id);
                    setFolder(item.id);
                    setSelected('');
                    setScreen('list');
                  }}
                >
                  <FolderIcon size={16} />
                  <span>{item.data.title}</span>
                  <small>
                    {
                      notes.filter((note) => note.data.folder === item.id)
                        .length
                    }
                  </small>
                </button>
                {menu}
              </div>
            )}
          </CoreItemActionSurface>
          {folderRows(item.id, depth + 1)}
        </div>
      ));
  return (
    <div className={`notes-workspace notes-screen-${screen}`}>
      <aside className="notes-folders" aria-label="Note folders">
        <header>
          <h1>Notes</h1>
          <ItemMenu
            label="Notes"
            actions={[
              {
                id: 'recover',
                label: 'Recover drafts…',
                run: async () =>
                  setRecovery(await recoverableNoteDrafts(store.owner)),
              },
            ]}
          />
          <button
            className="icon-button"
            aria-label="New folder"
            onClick={() =>
              setEdit({ kind: 'newFolder', id: '', title: '', parent: folder })
            }
          >
            <Plus size={18} />
          </button>
        </header>
        <button
          className={`notes-all ${!folder ? 'active' : ''}`}
          onClick={async () => {
            if (active) await flushNoteDraft(store.owner, active.id);
            setFolder('');
            setScreen('list');
          }}
        >
          <StickyNote size={17} />
          All Notes <small>{notes.length}</small>
        </button>
        <div className="notes-folder-scroll">{folderRows()}</div>
        <button
          className="subtle-button"
          onClick={() =>
            setEdit({ kind: 'newFolder', id: '', title: '', parent: folder })
          }
        >
          <Plus size={16} />
          New folder
        </button>
      </aside>
      <section className="notes-list" aria-label="Notes list">
        <header>
          <button
            className="icon-button notes-mobile-back"
            aria-label="Back to folders"
            onClick={() => setScreen('folders')}
          >
            <ArrowLeft size={18} />
          </button>
          <h2>
            {folders.find((item) => item.id === folder)?.data.title ||
              'All Notes'}
          </h2>
          <button
            className="icon-button"
            aria-label="New note"
            onClick={() => void createNote()}
          >
            <Plus size={18} />
          </button>
        </header>
        <label className="notes-search">
          <Search size={16} />
          <input
            aria-label="Search notes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
          />
        </label>
        <div className="notes-list-scroll">
          {shown.map((note) => (
            <CoreItemActionSurface
              key={note.id}
              entity={note}
              onOpen={() => void switchNote(note.id)}
              onDuplicate={(id) => void switchNote(id)}
              onRemoved={() => {
                if (selected === note.id) {
                  setSelected('');
                  setScreen('list');
                }
              }}
            >
              {(menu) => (
                <article
                  className={`notes-list-row ${selected === note.id ? 'active' : ''}`}
                >
                  <button
                    className="notes-list-open"
                    onClick={() => void switchNote(note.id)}
                  >
                    <strong>
                      {note.data.pinned && <Pin size={13} />}
                      {noteTitle(note)}
                    </strong>
                    <span>{note.data.text.trim() || 'No additional text'}</span>
                    <time dateTime={note.data.updatedAt}>
                      {new Date(note.data.updatedAt).toLocaleDateString(
                        undefined,
                        { month: 'short', day: 'numeric' },
                      )}
                    </time>
                  </button>
                  {menu}
                </article>
              )}
            </CoreItemActionSurface>
          ))}
          {!shown.length && (
            <Empty
              icon={<StickyNote />}
              title={query ? 'No matching notes' : 'A place for your thoughts'}
            >
              {query ? (
                'Try another search.'
              ) : (
                <button
                  className="secondary-button"
                  onClick={() => void createNote()}
                >
                  <Plus size={16} />
                  Create a note
                </button>
              )}
            </Empty>
          )}
        </div>
      </section>
      {active ? (
        <NoteEditor
          key={`${store.owner}:${active.id}`}
          note={active}
          onBack={() => setScreen('list')}
        />
      ) : (
        <section className="notes-editor notes-empty-editor">
          <Empty icon={<StickyNote />} title="Make a little space">
            <p>Capture an idea, a list, or anything you want to keep.</p>
            <button
              className="primary-button"
              onClick={() => void createNote()}
            >
              <Plus size={16} />
              New note
            </button>
          </Empty>
        </section>
      )}
      {recovery && (
        <Modal
          open
          title="Recover note drafts"
          onClose={() => setRecovery(null)}
        >
          <p>
            These versions were retained after an interrupted save or
            conflicting edit. Recovering one creates a new note.
          </p>
          {recovery.length ? (
            recovery.map((draft) => (
              <div className="recovery-note-row" key={draft.slot}>
                <strong>{draft.title || 'Untitled note'}</strong>
                <p>{noteText(draft.document).slice(0, 200)}</p>
                <time>{new Date(draft.savedAt).toLocaleString()}</time>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const id = await recoverDraftAsNewNote(store.owner, draft);
                    await store.reload();
                    setSelected(id);
                    setScreen('editor');
                    setRecovery(null);
                  }}
                >
                  Recover as new note
                </button>
              </div>
            ))
          ) : (
            <p>No unsaved recovery drafts.</p>
          )}
        </Modal>
      )}
      {edit && (
        <Modal open title="New folder" onClose={() => setEdit(null)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await store.add('folder', {
                title: edit.title.trim(),
                parent: edit.parent,
              });
              setEdit(null);
            }}
          >
            <Field label="Folder name">
              <input
                value={edit.title}
                maxLength={1000}
                required
                onChange={(event) =>
                  setEdit({ ...edit, title: event.target.value })
                }
              />
            </Field>
            <button className="primary-button">Create folder</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
