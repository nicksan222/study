import type { Locator } from 'playwright';
import { expect as base } from 'playwright/test';

/** A substring of a prewrapped paragraph needs its own rendered range, not the paragraph's box. */
export const expect = base.extend({
  async toHaveVisibleText(locator: Locator, text: string, options: { timeout?: number } = {}) {
    let pass = !this.isNot;

    try {
      await base
        .poll(
          () =>
            locator.evaluate((element, exact) => {
              if (
                !exact ||
                !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
              )
                return false;

              const content = element.textContent ?? '';
              const start = content.indexOf(exact);

              // Ambiguous matches cannot prove which occurrence the reader can see.
              if (start < 0 || content.indexOf(exact, start + 1) >= 0) return false;

              function textRange() {
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                const range = document.createRange();
                let offset = 0;
                let node: Node | null;

                while ((node = walker.nextNode())) {
                  const end = offset + (node.textContent?.length ?? 0);

                  if (start >= offset && start < end) range.setStart(node, start - offset);

                  if (start + exact.length > offset && start + exact.length <= end) {
                    range.setEnd(node, start + exact.length - offset);
                    break;
                  }

                  offset = end;
                }

                return range;
              }

              const range = textRange();

              function unclipped(rect: DOMRect) {
                for (let parent: Element | null = element; parent; parent = parent.parentElement) {
                  const style = getComputedStyle(parent);
                  const clip = parent.getBoundingClientRect();

                  if (
                    style.overflowX !== 'visible' &&
                    (rect.left < clip.left || rect.right > clip.right)
                  )
                    return false;

                  if (
                    style.overflowY !== 'visible' &&
                    (rect.top < clip.top || rect.bottom > clip.bottom)
                  )
                    return false;
                }

                return true;
              }

              const rects = [...range.getClientRects()].filter(
                (rect) => rect.width > 0 && rect.height > 0
              );

              return (
                rects.length > 0 &&
                rects.every((rect) => {
                  if (
                    rect.left < 0 ||
                    rect.top < 0 ||
                    rect.right > innerWidth ||
                    rect.bottom > innerHeight
                  )
                    return false;

                  if (!unclipped(rect)) return false;

                  for (const fraction of [0.1, 0.5, 0.9]) {
                    const hit = document.elementFromPoint(
                      rect.left + rect.width * fraction,
                      rect.top + rect.height / 2
                    );

                    if (hit === null || !element.contains(hit)) return false;
                  }

                  return true;
                })
              );
            }, text),
          { timeout: options.timeout ?? 5000 }
        )
        .toBe(!this.isNot);
    } catch {
      pass = this.isNot;
    }

    return {
      pass,
      message: () =>
        `Expected unique substring ${JSON.stringify(text)} ${this.isNot ? 'not ' : ''}to be fully visible, unclipped and unobscured in ${locator}`
    };
  }
});
