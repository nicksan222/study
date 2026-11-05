import { useEffect, useRef } from 'react';

/** Resolves numbered navigation from the current rendered list, independent of page data. */
export function useSidebarShortcuts() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    let showing = false;
    let hinted: HTMLAnchorElement[] = [];
    const observer = new MutationObserver(updateHints);

    function destinations() {
      return Array.from(
        root.current?.querySelectorAll<HTMLAnchorElement>(
          '.study-sidebar-scroll a.study-session-row[href]'
        ) ?? []
      )
        .filter(available)
        .slice(0, 9);
    }

    function clearHints() {
      for (const element of hinted) element.removeAttribute('data-sidebar-shortcut');
      hinted = [];
      root.current?.removeAttribute('data-shortcuts-visible');
    }

    function updateHints() {
      clearHints();

      if (!showing || modalTask()) return;

      hinted = destinations();
      hinted.forEach((element, index) => {
        element.setAttribute('data-sidebar-shortcut', String(index + 1));
      });
      root.current?.setAttribute('data-shortcuts-visible', '');
    }

    function hideHints() {
      showing = false;
      observer.disconnect();
      clearHints();
    }

    function syncModifier(event: KeyboardEvent) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      ) {
        hideHints();
        return;
      }

      showing = true;
      updateHints();
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'inert', 'aria-hidden', 'aria-disabled', 'aria-modal']
      });
    }

    function navigate(event: KeyboardEvent) {
      syncModifier(event);

      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      )
        return;

      const digit = /^[1-9]$/.test(event.key)
        ? Number(event.key)
        : /^Digit[1-9]$/.test(event.code)
          ? Number(event.code.slice(-1))
          : undefined;

      if (digit === undefined) return;

      if (modalTask()) return;

      const destination = destinations()[digit - 1];

      if (!destination) return;

      event.preventDefault();
      destination.focus();
      destination.click();
    }

    function visibilityChanged() {
      if (document.hidden) hideHints();
    }

    window.addEventListener('keydown', navigate);
    window.addEventListener('keyup', syncModifier);
    window.addEventListener('blur', hideHints);
    document.addEventListener('visibilitychange', visibilityChanged);

    return () => {
      window.removeEventListener('keydown', navigate);
      window.removeEventListener('keyup', syncModifier);
      window.removeEventListener('blur', hideHints);
      document.removeEventListener('visibilitychange', visibilityChanged);
      hideHints();
    };
  }, []);

  return root;
}

function available(element: HTMLElement) {
  return (
    !element.closest(
      'details:not([open]), [hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]'
    ) && element.checkVisibility?.({ visibilityProperty: true }) !== false
  );
}

function modalTask() {
  return document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"]') !== null;
}
