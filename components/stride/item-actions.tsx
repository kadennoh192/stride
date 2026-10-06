'use client';
import type { ReactElement, ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
export interface ItemAction {
  id: string;
  label: string;
  run?: () => unknown;
  children?: ItemAction[];
  danger?: boolean;
  disabled?: boolean;
}
function ContextActions({ actions }: { actions: ItemAction[] }) {
  return actions.map((action) =>
    action.children ? (
      <ContextMenuSub key={action.id}>
        <ContextMenuSubTrigger>{action.label}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextActions actions={action.children} />
        </ContextMenuSubContent>
      </ContextMenuSub>
    ) : (
      <ContextMenuItem
        key={action.id}
        disabled={action.disabled}
        variant={action.danger ? 'destructive' : 'default'}
        onClick={() => void action.run?.()}
      >
        {action.label}
      </ContextMenuItem>
    ),
  );
}
function DropdownActions({ actions }: { actions: ItemAction[] }) {
  return actions.map((action) =>
    action.children ? (
      <DropdownMenuSub key={action.id}>
        <DropdownMenuSubTrigger>{action.label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownActions actions={action.children} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem
        key={action.id}
        disabled={action.disabled}
        variant={action.danger ? 'destructive' : 'default'}
        onClick={() => void action.run?.()}
      >
        {action.label}
      </DropdownMenuItem>
    ),
  );
}
export function ItemMenu({
  actions,
  label,
  icon,
}: {
  actions: ItemAction[];
  label: string;
  icon?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="icon-button item-menu"
        aria-label={`Actions for ${label}`}
        onClick={(event) => event.stopPropagation()}
      >
        {icon || <Ellipsis size={18} />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="item-action-menu">
        <DropdownActions actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function ActionSurface({
  actions,
  label,
  children,
}: {
  actions: ItemAction[];
  label: string;
  children: (menu: ReactNode) => ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={children(<ItemMenu actions={actions} label={label} />)}
        onContextMenuCapture={(event) => {
          if (
            (event.target as HTMLElement).closest(
              'input,textarea,[contenteditable="true"]',
            )
          )
            event.stopPropagation();
        }}
      />
      <ContextMenuContent className="item-action-menu">
        <ContextActions actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
