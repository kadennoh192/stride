'use client';
import { useState, type ReactNode } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { ChecklistItem } from '@/lib/stride/types';
import { uid } from '@/lib/stride/types';
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'span-all' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: (string | { value: string; label: string })[];
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => {
        const item = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        );
      })}
    </select>
  );
}
export function CheckList({
  value,
  onChange,
  label = 'Checklist',
}: {
  value: ChecklistItem[];
  onChange: (v: ChecklistItem[]) => void;
  label?: string;
}) {
  const [title, setTitle] = useState('');
  return (
    <div className="checklist">
      <div className="section-heading">
        <h3>{label}</h3>
        <span>
          {value.filter((c) => c.done).length}/{value.length}
        </span>
      </div>
      {value.map((c) => (
        <div className="checkline" key={c.id}>
          <input
            type="checkbox"
            checked={c.done}
            aria-label={`Complete ${c.title}`}
            onChange={(e) =>
              onChange(
                value.map((x) =>
                  x.id === c.id ? { ...x, done: e.target.checked } : x,
                ),
              )
            }
          />
          <input
            aria-label="Checklist item"
            value={c.title}
            onChange={(e) =>
              onChange(
                value.map((x) =>
                  x.id === c.id ? { ...x, title: e.target.value } : x,
                ),
              )
            }
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${c.title}`}
            onClick={() => onChange(value.filter((x) => x.id !== c.id))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div className="inline-add">
        <Plus size={17} />
        <input
          aria-label={`New ${label.toLowerCase()} item`}
          placeholder="Add an item"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (title.trim()) {
                onChange([
                  ...value,
                  { id: uid(), title: title.trim(), done: false },
                ]);
                setTitle('');
              }
            }
          }}
        />
        <button
          className="subtle-button"
          type="button"
          disabled={!title.trim()}
          onClick={() => {
            onChange([
              ...value,
              { id: uid(), title: title.trim(), done: false },
            ]);
            setTitle('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
export function ReorderButtons({
  up,
  down,
}: {
  up?: () => void;
  down?: () => void;
}) {
  return (
    <span className="reorder-buttons">
      <button
        type="button"
        className="icon-button"
        disabled={!up}
        aria-label="Move up"
        onClick={up}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={!down}
        aria-label="Move down"
        onClick={down}
      >
        <ChevronDown size={15} />
      </button>
    </span>
  );
}
export function Loading() {
  return <output className="empty-state">Opening your workspace…</output>;
}
