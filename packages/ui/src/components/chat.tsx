import { ArrowDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../utils';
import { Button } from './button';

/** Adapted from coss Chat UI's conversation contract: follow only while the reader is at the end. */
function useChatScroll({ itemCount, firstItemKey }: { itemCount: number; firstItemKey?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previous = useRef({ count: itemCount, first: firstItemKey, height: 0 });
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) return;

    const before = previous.current;

    if (atBottom.current) viewport.scrollTop = viewport.scrollHeight;
    else if (itemCount > before.count && firstItemKey !== before.first)
      viewport.scrollTop += viewport.scrollHeight - before.height;

    previous.current = { count: itemCount, first: firstItemKey, height: viewport.scrollHeight };
  }, [itemCount, firstItemKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;

    if (!viewport || !content) return;

    const observer = new ResizeObserver(() => {
      if (atBottom.current) viewport.scrollTop = viewport.scrollHeight;

      previous.current.height = viewport.scrollHeight;
    });

    observer.observe(viewport);
    observer.observe(content);

    return () => observer.disconnect();
  }, []);

  function onScroll() {
    const viewport = viewportRef.current;

    if (!viewport) return;

    atBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 64;
    previous.current.height = viewport.scrollHeight;
    setShowJump(!atBottom.current);
  }

  function scrollToLatest() {
    const viewport = viewportRef.current;

    atBottom.current = true;
    setShowJump(false);
    viewport?.scrollTo({
      top: viewport.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  return { viewportRef, contentRef, onScroll, scrollToLatest, showJump };
}

/** The data owner supplies paging keys; the viewport owns only reading position and end following. */
export function ChatConversation({
  children,
  label,
  jumpLabel,
  itemCount,
  firstItemKey
}: {
  children: ReactNode;
  label: string;
  jumpLabel: string;
  itemCount: number;
  firstItemKey?: string;
}) {
  const scroll = useChatScroll({ itemCount, firstItemKey });

  return (
    <div className="chat-conversation" data-slot="chat-conversation">
      <div
        ref={scroll.viewportRef}
        className="chat-viewport"
        role="log"
        aria-label={label}
        aria-live="off"
        aria-relevant="additions text"
        onScroll={scroll.onScroll}
      >
        <div ref={scroll.contentRef} className="chat-content">
          {children}
        </div>
      </div>
      {scroll.showJump && (
        <div className="chat-jump">
          <Button size="sm" variant="outline" onClick={scroll.scrollToLatest}>
            <ArrowDown size={14} aria-hidden="true" />
            {jumpLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shared timeline entry; session notes and generated material use the same reading direction. */
export function ChatMessage({ className, ...props }: ComponentPropsWithRef<'article'>) {
  return (
    <article
      {...props}
      data-slot="chat-message"
      className={cn('session-entry chat-message', className)}
    />
  );
}

export function ChatMessageText({ text }: { text: string }) {
  return (
    <p data-slot="chat-message-text" className="session-desk-quick-text chat-message-text">
      {text}
    </p>
  );
}

export function ChatMessageActionToolbar({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      {...props}
      role="group"
      data-slot="chat-message-actions"
      className={cn('session-row-tools chat-message-actions', className)}
    />
  );
}

/** A dated event in a single-direction session timeline. */
export function ChatTimelineEvent({ time, children }: { time: ReactNode; children: ReactNode }) {
  return (
    <div className="chat-timeline-event" data-slot="timeline-event">
      <header className="chat-timeline-time">
        <time>{time}</time>
      </header>
      <div className="chat-timeline-body">{children}</div>
    </div>
  );
}
