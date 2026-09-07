'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
const tabletQuery = '(min-width: 768px)';
function subscribeTablet(notify: () => void) {
  const media = window.matchMedia(tabletQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}
function isTablet() {
  return window.matchMedia(tabletQuery).matches;
}
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export function Picker({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger aria-label={label} className="picker">
        <SelectValue>
          {options
            .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
            .find((o) => o.value === value)?.label || value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => {
          const item = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  wide = false,
  detail = false,
  quickAdd = false,
  paneWidth = 460,
  onPaneWidthChange,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  detail?: boolean;
  quickAdd?: boolean;
  paneWidth?: number;
  onPaneWidthChange?: (width: number) => void;
}) {
  const roomy = useSyncExternalStore(subscribeTablet, isTablet, () => false);
  const pane = detail && roomy;
  return (
    <Dialog
      open={open}
      modal={!pane}
      disablePointerDismissal={pane}
      onOpenChange={(v) => !v && onClose()}
    >
      <DialogContent
        showOverlay={!pane}
        className={`stride-modal ${wide ? 'wide' : ''} ${pane ? 'task-detail-pane' : ''} ${quickAdd ? 'quick-add-sheet' : ''}`}
      >
        <DialogTitle className="modal-title">{title}</DialogTitle>
        <DialogDescription className={description ? 'muted' : 'sr-only'}>
          {description || title}
        </DialogDescription>
        {pane && onPaneWidthChange && (
          <details className="pane-size-control">
            <summary>Pane width</summary>
            <label>
              Adjust task pane
              <input
                aria-label="Task pane width"
                type="range"
                min="340"
                max="740"
                step="20"
                value={paneWidth}
                onChange={(e) => onPaneWidthChange(Number(e.target.value))}
              />
            </label>
          </details>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
