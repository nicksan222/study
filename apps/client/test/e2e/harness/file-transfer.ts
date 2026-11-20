import type { Locator } from 'playwright';

/** Supply a real browser File for gestures Playwright cannot synthesize from the OS. */
export async function transferFile(target: Locator, gesture: 'drop' | 'paste', name: string) {
  await target.evaluate(
    (element, { gesture, name }) => {
      const transfer = new DataTransfer();

      transfer.items.add(new File(['Sample counts'], name, { type: 'text/plain' }));
      const options = { bubbles: true, cancelable: true };

      element.dispatchEvent(
        gesture === 'drop'
          ? new DragEvent('drop', { ...options, dataTransfer: transfer })
          : new ClipboardEvent('paste', { ...options, clipboardData: transfer })
      );
    },
    { gesture, name }
  );
}
