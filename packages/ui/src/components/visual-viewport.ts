/** Recalculate fit after keyboard, pinch and layout changes. */
export function observeVisualViewport(
  boundary: HTMLElement,
  update: (viewport: VisualViewport, zoom: number) => void
) {
  const viewport = boundary.ownerDocument.defaultView?.visualViewport;

  if (!viewport) return;

  const measure = () => {
    const zoom =
      Number.parseFloat(getComputedStyle(boundary.ownerDocument.documentElement).zoom) || 1;

    update(viewport, zoom);
  };
  const observer = new ResizeObserver(measure);

  measure();
  observer.observe(boundary);
  viewport.addEventListener('resize', measure);
  viewport.addEventListener('scroll', measure);

  return () => {
    observer.disconnect();
    viewport.removeEventListener('resize', measure);
    viewport.removeEventListener('scroll', measure);
  };
}
