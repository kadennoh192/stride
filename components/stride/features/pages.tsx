'use client';
import { stringValue } from '@/lib/stride/types';

import { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  FileText,
  Plus,
  Trash2,
  Copy,
  GripVertical,
  Bold,
  Italic,
  Code,
  Link2,
  MessageSquare,
  ArrowLeft,
  Settings,
} from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import { uid, type Page, type Block, type BlockType } from '@/lib/stride/types';
import { safeURL, embedURL } from '@/lib/stride/domain';
import { saveFile } from '@/lib/stride/storage';
import { fileURL, downloadBlob } from '@/lib/stride/files';
import { Modal, Empty } from '../primitives';
import { Field, Select, ReorderButtons } from '../forms';
import { DatabaseSurface } from './databases';
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
function RichText({ block }: { block: Block }) {
  const store = useStride();
  const latest = useRef(store);
  const currentBlock = useRef(block);
  useEffect(() => {
    latest.current = store;
    currentBlock.current = block;
  }, [store, block]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        link: {
          openOnClick: false,
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: { rel: 'noopener noreferrer' },
        },
      }),
      Placeholder.configure({ placeholder: 'Write something…' }),
    ],
    immediatelyRender: false,
    content: (block.data.rich as JSONContent) || {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: block.data.text
            ? [{ type: 'text', text: block.data.text }]
            : [],
        },
      ],
    },
    editorProps: {
      attributes: { 'aria-label': 'Block content', class: 'rich-text' },
    },
    onUpdate: ({ editor }) => {
      void latest.current.update(
        currentBlock.current,
        { rich: editor.getJSON(), text: editor.getText() },
        'Edited page block',
      );
    },
  });
  useEffect(() => {
    if (
      editor &&
      !editor.isFocused &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(block.data.rich) &&
      block.data.rich
    )
      editor.commands.setContent(block.data.rich as JSONContent, {
        emitUpdate: false,
      });
  }, [editor, block.data.rich]);
  const [link, setLink] = useState('');
  if (!editor) return <div className="muted">Opening editor…</div>;
  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button
          className="icon-button"
          aria-label="Bold"
          aria-pressed={editor.isActive('bold')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Inline code"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code size={15} />
        </button>
        <input
          aria-label="Link URL"
          placeholder="https://…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button
          className="icon-button"
          aria-label="Apply link to selection"
          disabled={!safeURL(link)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editor
              .chain()
              .focus()
              .setLink({ href: safeURL(link) })
              .run();
            setLink('');
          }}
        >
          <Link2 size={15} />
        </button>
        <Select
          label="Mention page or task"
          value=""
          onChange={(id) => {
            const e = store.entities.find((e) => e.id === id);
            if (e)
              editor
                .chain()
                .focus()
                .insertContent([
                  {
                    type: 'text',
                    text: `@${stringValue(e.data.title)}`,
                    marks: [
                      { type: 'link', attrs: { href: `#${e.kind}/${e.id}` } },
                    ],
                  },
                  { type: 'text', text: ' ' },
                ])
                .run();
          }}
          options={[
            { value: '', label: '@ Mention' },
            ...store.entities
              .filter((e) =>
                ['page', 'task', 'project', 'database'].includes(e.kind),
              )
              .slice(0, 200)
              .map((e) => ({ value: e.id, label: stringValue(e.data.title) })),
          ]}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
function Attachment({ block }: { block: Block }) {
  const store = useStride();
  const [url, setURL] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    let objectURL = '';
    if (block.data.file && block.data.type === 'image')
      void fileURL(block.data.file, store.owner)
        .then((u) => {
          objectURL = u;
          if (active) setURL(u);
          else URL.revokeObjectURL(u);
        })
        .catch((e) => {
          if (active) setError(stringValue(e));
        });
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [block.data.file, block.data.type, store.owner]);
  return (
    <div className="attachment-block">
      {url &&
        block.data.type === 'image' && (
          // Local Blob attachments are already on device and cannot use a server image optimizer.
          // eslint-disable-next-line next/no-img-element
          <img
            src={url}
            alt={block.data.text || block.data.name || 'Page image'}
            loading="lazy"
          />
        )}
      {block.data.file ? (
        <>
          <button
            className="secondary-button"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              setError('');
              try {
                const u = await fileURL(block.data.file!, store.owner);
                const blob = await (await fetch(u)).blob();
                downloadBlob(blob, block.data.name || 'attachment');
                URL.revokeObjectURL(u);
              } catch (e) {
                setError(stringValue(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading
              ? 'Downloading…'
              : `Download ${block.data.name || 'attachment'}`}
          </button>
          <span className="muted">
            {url ? 'Available offline' : 'Download to make available offline'}
          </span>
        </>
      ) : (
        <Field
          label={
            block.data.type === 'image'
              ? 'Upload an image (up to 10 MB)'
              : 'Upload a file (up to 10 MB)'
          }
        >
          <input
            type="file"
            accept={
              block.data.type === 'image'
                ? 'image/png,image/jpeg,image/webp,image/gif'
                : undefined
            }
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const id = uid();
              await saveFile(id, f, store.owner, f.name);
              await store.update(block, {
                file: id,
                name: f.name,
                text: f.name,
              });
              void store.sync();
            }}
          />
        </Field>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
function BlockContent({ block }: { block: Block }) {
  const store = useStride();
  const type = block.data.type;
  const [open, setOpen] = useState(false);
  if (type === 'divider') return <hr />;
  if (type === 'image' || type === 'file') return <Attachment block={block} />;
  if (type === 'code')
    return (
      <textarea
        className="code-block"
        spellCheck={false}
        aria-label="Code block"
        value={block.data.text}
        onChange={(e) => void store.update(block, { text: e.target.value })}
      />
    );
  if (type === 'table') {
    const rows = (block.data.text || 'Column 1\tColumn 2\n\t')
      .split('\n')
      .map((r) => r.split('\t'));
    return (
      <div>
        <div className="table-scroll">
          <table>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <input
                        aria-label={`Row ${i + 1} column ${j + 1}`}
                        value={cell}
                        onChange={(e) => {
                          const copy = rows.map((r) => [...r]);
                          copy[i][j] = e.target.value;
                          void store.update(block, {
                            text: copy.map((r) => r.join('\t')).join('\n'),
                          });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="editor-toolbar">
          <button
            className="subtle-button"
            onClick={() =>
              void store.update(block, {
                text: [...rows, rows[0].map(() => '')]
                  .map((r) => r.join('\t'))
                  .join('\n'),
              })
            }
          >
            + Row
          </button>
          <button
            className="subtle-button"
            onClick={() =>
              void store.update(block, {
                text: rows.map((r) => [...r, ''].join('\t')).join('\n'),
              })
            }
          >
            + Column
          </button>
          <button
            className="subtle-button"
            disabled={rows.length < 2}
            onClick={() =>
              void store.update(block, {
                text: rows
                  .slice(0, -1)
                  .map((r) => r.join('\t'))
                  .join('\n'),
              })
            }
          >
            Remove last row
          </button>
          <button
            className="subtle-button"
            disabled={rows[0].length < 2}
            onClick={() =>
              void store.update(block, {
                text: rows.map((r) => r.slice(0, -1).join('\t')).join('\n'),
              })
            }
          >
            Remove last column
          </button>
        </div>
      </div>
    );
  }
  if (type === 'link' || type === 'embed') {
    const url =
      type === 'embed'
        ? embedURL(block.data.url || '')
        : safeURL(block.data.url || '');
    return (
      <div>
        <Field label={type === 'embed' ? 'YouTube or Vimeo URL' : 'Link URL'}>
          <input
            value={block.data.url || ''}
            onChange={(e) => void store.update(block, { url: e.target.value })}
          />
        </Field>
        {url ? (
          type === 'embed' ? (
            <iframe
              className="embed-frame"
              src={url}
              title={block.data.text || 'Embedded media'}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer"
              loading="lazy"
              allowFullScreen
            />
          ) : (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {block.data.text || url} ↗
            </a>
          )
        ) : (
          <p className="muted">
            {type === 'embed'
              ? 'Only YouTube and Vimeo embeds are supported. Other content can be added as a link.'
              : 'Enter a valid web, email, or phone link.'}
          </p>
        )}
      </div>
    );
  }
  if (type === 'database') {
    const database = store.entities.find(
      (e) => e.id === block.data.database && e.kind === 'database',
    );
    return (
      <div>
        <Select
          label="Linked database"
          value={stringValue(block.data.database || '')}
          onChange={(database) => void store.update(block, { database })}
          options={[
            { value: '', label: 'Choose a database' },
            ...store.entities
              .filter((e) => e.kind === 'database')
              .map((e) => ({ value: e.id, label: stringValue(e.data.title) })),
          ]}
        />
        {database && <DatabaseSurface databaseId={database.id} linked />}
      </div>
    );
  }
  return (
    <div className={`text-block block-${type}`}>
      {type === 'check' && (
        <input
          type="checkbox"
          checked={block.data.checked}
          aria-label="Check block"
          onChange={(e) =>
            void store.update(block, { checked: e.target.checked })
          }
        />
      )}
      <div className="block-text-area">
        {type === 'toggle' ? (
          <>
            <button className="toggle-summary" onClick={() => setOpen(!open)}>
              {open ? '▾' : '▸'} Toggle content
            </button>
            {open && <RichText block={block} />}
          </>
        ) : (
          <RichText block={block} />
        )}
      </div>
    </div>
  );
}
export default function Pages({ pageId }: { pageId?: string }) {
  const store = useStride();
  const pages = store.entities.filter((e) => e.kind === 'page') as Page[];
  const page = pages.find((p) => p.id === pageId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [comment, setComment] = useState('');
  const [newType, setNewType] = useState<BlockType>('paragraph');
  const blocks = (
    store.entities.filter(
      (e) => e.kind === 'block' && e.data.page === pageId,
    ) as Block[]
  ).sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
  const addPage = async (parent = '') => {
    const id = await store.add('page', {
      title: newTitle.trim() || 'Untitled page',
      icon: '📄',
      cover: '',
      parent,
    });
    setNewTitle('');
    location.assign('#' + `page/${id}`);
  };
  const move = async (from: number, to: number) => {
    const list = [...blocks];
    const [b] = list.splice(from, 1);
    list.splice(to, 0, b);
    await store.edit(
      list.map((block, i) => ({
        id: block.id,
        kind: 'block',
        data: { order: i * 100 },
      })),
      'Reordered page blocks',
    );
  };
  const addBlock = async () => {
    await store.add('block', {
      page: pageId,
      type: newType,
      text: '',
      order: (blocks.at(-1)?.data.order || 0) + 100,
      checked: false,
    });
  };
  const templates = store.entities.filter(
    (e) => e.kind === 'template' && e.data.type === 'page',
  );
  if (!page)
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">A PLACE FOR YOUR IDEAS</div>
            <h1>Pages</h1>
          </div>
          <button className="primary-button" onClick={() => void addPage()}>
            <Plus size={18} />
            New page
          </button>
        </div>
        {pages.length === 0 ? (
          <Empty icon={<FileText />} title="Make space for an idea">
            Create a page for notes, plans, or anything on your mind.
          </Empty>
        ) : (
          <div className="page-cards">
            {pages.map((p) => (
              <a className="page-card" href={`#page/${p.id}`} key={p.id}>
                <span>{p.data.icon}</span>
                <h3>{p.data.title}</h3>
                <p className="muted">
                  {pages.find((x) => x.id === p.data.parent)?.data.title ||
                    'Workspace'}
                </p>
              </a>
            ))}
          </div>
        )}
        {templates.length > 0 && (
          <section className="inset-panel">
            <h3>Your page templates</h3>
            {templates.map((t) => (
              <button
                key={t.id}
                className="secondary-button"
                onClick={async () => {
                  const id = uid();
                  const source = (t.data.pageTemplate ||
                    t.data.page) as unknown as Page['data'];
                  const list = t.data.blocks as Block['data'][];
                  await store.edit(
                    [
                      {
                        id,
                        kind: 'page',
                        data: {
                          ...source,
                          parent: '',
                          title: stringValue(t.data.title),
                        },
                      },
                      ...list.map((b, i) => ({
                        id: uid(),
                        kind: 'block' as const,
                        data: { ...b, page: id, order: i * 100 },
                      })),
                    ],
                    'Created page from template',
                  );
                  location.assign('#' + `page/${id}`);
                }}
              >
                {stringValue(t.data.title)}
              </button>
            ))}
          </section>
        )}
      </>
    );
  const backlinks = store.entities.filter(
    (e) =>
      e.kind === 'block' &&
      e.data.page !== page.id &&
      JSON.stringify(e.data.rich || e.data.text).includes(page.id),
  );
  const comments = store.entities.filter(
    (e) => e.kind === 'comment' && e.data.target === page.id,
  );
  return (
    <div className="page-workspace">
      <div className="editor-toolbar">
        <a className="subtle-button" href="#pages">
          <ArrowLeft size={16} />
          Pages
        </a>
        <div>
          <button
            className="subtle-button"
            onClick={() => void addPage(page.id)}
          >
            <Plus size={16} />
            Nested page
          </button>
          <button
            className="icon-button"
            aria-label="Page settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
      {page.data.cover && (
        <div className="page-cover" style={{ background: page.data.cover }} />
      )}
      <div className="page-icon">{page.data.icon}</div>
      <input
        className="page-title-input"
        aria-label="Page title"
        value={page.data.title}
        onChange={(e) => {
          if (e.target.value.trim())
            void store.update(page, { title: e.target.value });
        }}
      />
      {page.data.parent && (
        <a className="muted" href={`#page/${page.data.parent}`}>
          In{' '}
          {pages.find((p) => p.id === page.data.parent)?.data.title ||
            'parent page'}
        </a>
      )}
      <div className="nested-pages">
        {pages
          .filter((p) => p.data.parent === page.id)
          .map((p) => (
            <a href={`#page/${p.id}`} key={p.id}>
              {p.data.icon} {p.data.title}
            </a>
          ))}
      </div>
      <div className="page-blocks">
        {blocks.map((block, index) => (
          <div
            className="page-block"
            key={block.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = blocks.findIndex(
                (b) => b.id === e.dataTransfer.getData('text/stride-block'),
              );
              if (from >= 0) void move(from, index);
            }}
          >
            <div className="block-controls">
              <span
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData('text/stride-block', block.id)
                }
                aria-label="Drag block"
              >
                <GripVertical size={16} />
              </span>
              <Select
                label="Block type"
                value={block.data.type}
                onChange={(type) => void store.update(block, { type })}
                options={blockTypes}
              />
              <ReorderButtons
                up={index ? () => void move(index, index - 1) : undefined}
                down={
                  index < blocks.length - 1
                    ? () => void move(index, index + 1)
                    : undefined
                }
              />
              <button
                className="icon-button"
                aria-label="Duplicate block"
                onClick={() =>
                  void store.add('block', {
                    ...block.data,
                    order: block.data.order + 1,
                  })
                }
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Delete block"
                onClick={() => void store.remove(block)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <BlockContent block={block} />
          </div>
        ))}
      </div>
      <div className="block-add">
        <Select
          label="New block type"
          value={newType}
          onChange={(v) => setNewType(v as BlockType)}
          options={blockTypes}
        />
        <button className="secondary-button" onClick={() => void addBlock()}>
          <Plus size={16} />
          Add block
        </button>
      </div>
      <div className="page-bottom">
        <section>
          <h3>Backlinks</h3>
          {backlinks.length ? (
            backlinks.map((b) => (
              <a key={b.id} href={`#page/${b.data.page}`}>
                {pages.find((p) => p.id === b.data.page)?.data.title || 'Page'}
              </a>
            ))
          ) : (
            <p className="muted">
              Pages that mention this page will appear here.
            </p>
          )}
        </section>
        <section>
          <h3>
            <MessageSquare size={16} />
            Personal comments
          </h3>
          {comments.map((c) => (
            <div className="comment" key={c.id}>
              <p>{stringValue(c.data.text)}</p>
              <small>{new Date(stringValue(c.data.at)).toLocaleString()}</small>
              <button
                className="icon-button"
                aria-label="Delete comment"
                onClick={() => void store.remove(c)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <form
            className="inline-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (comment.trim()) {
                await store.add('comment', {
                  target: page.id,
                  text: comment,
                  at: new Date().toISOString(),
                });
                setComment('');
              }
            }}
          >
            <input
              aria-label="New personal comment"
              placeholder="Leave a note for yourself…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button className="secondary-button" disabled={!comment.trim()}>
              Add
            </button>
          </form>
        </section>
      </div>
      {settingsOpen && (
        <Modal
          title="Page settings"
          open
          onClose={() => setSettingsOpen(false)}
        >
          <Field label="Icon">
            <input
              value={page.data.icon}
              maxLength={8}
              onChange={(e) =>
                void store.update(page, { icon: e.target.value })
              }
            />
          </Field>
          <Field label="Cover color">
            <input
              type="color"
              value={page.data.cover || '#edf0ff'}
              onChange={(e) =>
                void store.update(page, { cover: e.target.value })
              }
            />
          </Field>
          <button
            className="subtle-button"
            onClick={() => void store.update(page, { cover: '' })}
          >
            Remove cover
          </button>
          <Field label="Parent page">
            <Select
              value={page.data.parent}
              onChange={async (parent) => {
                let cursor = parent;
                const seen = new Set([page.id]);
                while (cursor) {
                  if (seen.has(cursor))
                    throw new Error(
                      'Pages cannot contain their own ancestors.',
                    );
                  seen.add(cursor);
                  cursor =
                    pages.find((p) => p.id === cursor)?.data.parent || '';
                }
                await store.update(page, { parent });
              }}
              options={[
                { value: '', label: 'Workspace' },
                ...pages
                  .filter((p) => p.id !== page.id)
                  .map((p) => ({ value: p.id, label: p.data.title })),
              ]}
            />
          </Field>
          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={async () => {
                await store.add('template', {
                  title: page.data.title,
                  type: 'page',
                  pageTemplate: page.data,
                  blocks: blocks.map((b) => b.data),
                });
                store.notice('Page template saved');
              }}
            >
              Save as template
            </button>
            <button
              className="secondary-button danger"
              onClick={async () => {
                await store.edit(
                  [
                    { id: page.id, kind: 'page', data: { _deleted: true } },
                    ...pages
                      .filter((p) => p.data.parent === page.id)
                      .map((p) => ({
                        id: p.id,
                        kind: 'page' as const,
                        data: { parent: page.data.parent },
                      })),
                  ],
                  'Deleted page',
                );
                location.assign('#' + 'pages');
                setSettingsOpen(false);
              }}
            >
              Delete page
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
