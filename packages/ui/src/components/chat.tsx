import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../utils';
import { Button } from './button';
import { Tooltip, TooltipTrigger, TooltipPopup } from './tooltip';

function readingViewport(node: HTMLDivElement | null) {
  return node?.closest<HTMLDivElement>('[data-notebook-scroll-host]') ?? node;
}

/** Adapted from coss Chat UI's conversation contract: follow only while the reader is at the end. */

function useChatScroll({ itemCount, firstItemKey }: { itemCount: number; firstItemKey?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previous = useRef({ count: itemCount, first: firstItemKey, height: 0 });
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const viewport = readingViewport(viewportRef.current);

    if (!viewport) return;

    const before = previous.current;

    if (atBottom.current) viewport.scrollTop = viewport.scrollHeight;
    else if (itemCount > before.count && firstItemKey !== before.first)
      viewport.scrollTop += viewport.scrollHeight - before.height;

    previous.current = { count: itemCount, first: firstItemKey, height: viewport.scrollHeight };
  }, [itemCount, firstItemKey]);

  useEffect(() => {
    const viewport = readingViewport(viewportRef.current);
    const content = contentRef.current;

    if (!viewport || !content) return;

    function onScroll() {
      const viewport = readingViewport(viewportRef.current);

      if (!viewport) return;

      atBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 64;
      previous.current.height = viewport.scrollHeight;
      setShowJump(!atBottom.current);
    }

    const observer = new ResizeObserver(() => {
      if (atBottom.current) viewport.scrollTop = viewport.scrollHeight;

      previous.current.height = viewport.scrollHeight;
    });

    viewport.addEventListener('scroll', onScroll);
    observer.observe(viewport);
    observer.observe(content);

    return () => {
      viewport.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  function scrollToLatest() {
    const viewport = readingViewport(viewportRef.current);

    atBottom.current = true;
    setShowJump(false);
    viewport?.scrollTo({
      top: viewport.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  return { viewportRef, contentRef, scrollToLatest, showJump };
}

/** The data owner supplies paging keys; the viewport owns only reading position and end following. */

export function ChatConversation({
  children,
  label,
  jumpLabel,
  itemCount,
  firstItemKey,
  navigation
}: {
  children: ReactNode;
  label: string;
  jumpLabel: string;
  itemCount: number;
  firstItemKey?: string;
  navigation?: ReactNode;
}) {
  const scroll = useChatScroll({ itemCount, firstItemKey });
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);

  const viewportRef = scroll.viewportRef;
  const attachViewport = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      setOverlay(
        node
          ?.closest('.session-desk-notebook')
          ?.querySelector<HTMLElement>('[data-notebook-navigation-host]') ?? null
      );
    },
    [viewportRef]
  );

  const controls = (
    <>
      {navigation}
      {scroll.showJump && (
        <div className="chat-jump">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={jumpLabel}
                  onClick={scroll.scrollToLatest}
                />
              }
            >
              <ArrowDown size={16} aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup>{jumpLabel}</TooltipPopup>
          </Tooltip>
        </div>
      )}
    </>
  );

  return (
    <div
      className="chat-conversation"
      data-slot="chat-conversation"
      data-navigation={!!navigation || undefined}
    >
      {overlay ? createPortal(controls, overlay) : controls}
      <div
        ref={attachViewport}
        className="chat-viewport"
        role="log"
        aria-label={label}
        aria-live="off"
        aria-relevant="additions text"
      >
        <div ref={scroll.contentRef} className="chat-content">
          {children}
        </div>
      </div>
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

/** A quiet content-type label keeps notebook entries distinct without sender chrome. */
export function ChatEntryLabel({ children }: { children: ReactNode }) {
  return <span className="chat-entry-label">{children}</span>;
}

export function ChatMessageContent({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div {...props} className={cn('chat-message-content', className)} />;
}

export function ChatMessageText({
  text,
  renderText
}: {
  text: string;
  renderText?: (text: string) => ReactNode;
}) {
  return (
    <p data-slot="chat-message-text" className="session-desk-quick-text chat-message-text">
      {renderText ? renderText(text) : text}
    </p>
  );
}

export function ChatQuestionAnswer({
  question,
  answer,
  label
}: {
  question: ReactNode;
  answer: ReactNode;
  label: string;
}) {
  return (
    <div className="chat-question-answer">
      {question}
      <div className="chat-answer-label">{label}</div>
      {answer}
    </div>
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
