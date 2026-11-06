import { Drawer } from '@base-ui/react/drawer';
import { MessageCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { Sidebar } from './sidebar';

export const createChatDrawerHandle = Drawer.createHandle;
export type ChatDrawerHandle = ReturnType<typeof createChatDrawerHandle>;

export function ChatDrawerTrigger({ handle, label }: { handle: ChatDrawerHandle; label: string }) {
  return (
    <Drawer.Trigger handle={handle} render={<Sidebar.NavigationItem label={label} />}>
      <MessageCircle size={18} aria-hidden="true" />
    </Drawer.Trigger>
  );
}

export function ChatEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="ui-chat-empty">
      <MessageCircle size={28} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

/** Coss Chat UI drawer composition, using the shared chat and composer surfaces. */
export function ChatDrawer({
  title,
  handle,
  closeLabel,
  description,
  children,
  footer
}: {
  title: string;
  handle: ChatDrawerHandle;
  closeLabel: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Drawer.Root handle={handle} swipeDirection="right">
      <Drawer.Portal>
        <Drawer.Backdrop className="dialog-backdrop ui-chat-backdrop" />
        <Drawer.Viewport className="ui-chat-drawer-viewport">
          <Drawer.Popup className="ui-chat-drawer">
            <header className="ui-chat-drawer-header">
              <div>
                <Drawer.Title className="ui-chat-drawer-title">{title}</Drawer.Title>
                <Drawer.Description className="ui-chat-drawer-description">
                  {description}
                </Drawer.Description>
              </div>
              <Drawer.Close aria-label={closeLabel} render={<Button size="icon" variant="ghost" />}>
                <X size={18} aria-hidden="true" />
              </Drawer.Close>
            </header>
            {children}
            <div className="ui-chat-drawer-footer">{footer}</div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
