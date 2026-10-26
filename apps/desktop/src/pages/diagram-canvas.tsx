import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Pending, useAction, useShortcut } from "../components";
import { useI18n } from "../i18n";
import { saveFile } from "../rpc/native";
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type View = Point & { scale: number };
const margin = 24,
  step = 1.25;
export function fittedView(natural: Size, viewport: Size): View {
  const scale = Math.min(
    1,
    Math.max(1, viewport.width - 2 * margin) / natural.width,
    Math.max(1, viewport.height - 2 * margin) / natural.height,
  );
  return {
    scale,
    x: (viewport.width - natural.width * scale) / 2,
    y: (viewport.height - natural.height * scale) / 2,
  };
}
export function zoomView(view: View, factor: number, at: Point): View {
  const scale = Math.max(
    Math.min(0.2, view.scale),
    Math.min(3, view.scale * factor),
  );
  const ratio = scale / view.scale;
  return {
    scale,
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
  };
}
export function DiagramCanvas({ svg }: { svg: string }) {
  const { t, number } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  const geometry = useRef({
    natural: { width: 1, height: 1 },
    viewport: { width: 1, height: 1 },
  });
  const drag = useRef<{ point: Point; view: View } | undefined>(undefined);
  const [view, setView] = useState<View>({ x: margin, y: margin, scale: 1 });
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [explored, setExplored] = useState(false);
  const action = useAction<unknown>();
  const fit = () =>
    setView(fittedView(geometry.current.natural, geometry.current.viewport));
  const center = () => ({
    x: geometry.current.viewport.width / 2,
    y: geometry.current.viewport.height / 2,
  });
  const zoom = (factor: number) =>
    setView((value) => zoomView(value, factor, center()));
  const actual = () =>
    setView((value) => zoomView(value, 1 / value.scale, center()));
  const point = (event: { clientX: number; clientY: number }) => {
    const element = viewport.current!;
    const bounds = element.getBoundingClientRect();
    return {
      x:
        ((event.clientX - bounds.left) *
          (element.clientWidth || bounds.width)) /
        Math.max(1, bounds.width),
      y:
        ((event.clientY - bounds.top) *
          (element.clientHeight || bounds.height)) /
        Math.max(1, bounds.height),
    };
  };
  useLayoutEffect(() => {
    const root = viewport.current,
      element = drawing.current?.querySelector("svg");
    if (!root || !element) return;
    const box = (element.getAttribute("viewBox") ?? "")
      .trim()
      .split(/[ ,]+/)
      .map(Number);
    const natural = {
      width:
        box[2] > 0
          ? box[2]
          : parseFloat(element.getAttribute("width") ?? "") || 800,
      height:
        box[3] > 0
          ? box[3]
          : parseFloat(element.getAttribute("height") ?? "") || 500,
    };
    element.setAttribute("width", String(natural.width));
    element.setAttribute("height", String(natural.height));
    element.style.maxWidth = "none";
    setSize(natural);
    let initialized = false;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const measured = {
        width: root.clientWidth || bounds.width,
        height: root.clientHeight || bounds.height,
      };
      if (!measured.width || !measured.height) return;
      geometry.current = { natural, viewport: measured };
      if (!initialized) {
        initialized = true;
        const scale = Math.max(
          0.75,
          Math.min(1, (measured.width - 48) / natural.width),
        );
        setView({
          scale,
          x: (measured.width - natural.width * scale) / 2,
          y: Math.max(margin, (measured.height - natural.height * scale) / 2),
        });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [svg]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const modal = [
        ...document.querySelectorAll("[data-shortcut-modal=true]"),
      ].at(-1);
      if (modal && !modal.contains(element)) return;
      event.preventDefault();
      drag.current = undefined;
      setExplored(true);
      if (event.ctrlKey || event.metaKey) {
        const at = point(event);
        setView((value) =>
          zoomView(value, Math.exp(-event.deltaY * 0.002), at),
        );
      } else
        setView((value) => ({
          ...value,
          x: value.x - event.deltaX,
          y: value.y - event.deltaY,
        }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  useShortcut(
    (event) => {
      const delta: Record<string, Point> = {
        ArrowLeft: { x: 48, y: 0 },
        ArrowRight: { x: -48, y: 0 },
        ArrowUp: { x: 0, y: 48 },
        ArrowDown: { x: 0, y: -48 },
      };
      if (delta[event.key])
        setView((value) => ({
          ...value,
          x: value.x + delta[event.key].x,
          y: value.y + delta[event.key].y,
        }));
      else if (["+", "="].includes(event.key)) zoom(step);
      else if (["-", "_"].includes(event.key)) zoom(1 / step);
      else if (event.key === "0") actual();
      else if (event.key.toLowerCase() === "f") fit();
      else return;
      event.preventDefault();
      setExplored(true);
    },
    viewport,
    true,
  );
  return (
    <div className="space-y-2">
      <div className="study-toolbar">
        <Button size="sm" variant="outline" onClick={() => zoom(step)}>
          {t("DiagramZoomIn")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => zoom(1 / step)}>
          {t("DiagramZoomOut")}
        </Button>
        <Button size="sm" variant="ghost" onClick={fit}>
          {t("DiagramFit")}
        </Button>
        <Button size="sm" variant="ghost" onClick={actual}>
          {t("DiagramActualSize")}
        </Button>
        <output className="study-muted">
          {number(Math.round(view.scale * 100))}%
        </output>
        <Button
          size="sm"
          variant="ghost"
          disabled={action.isPending}
          onClick={() =>
            action.mutate(async () => {
              const element = drawing.current?.querySelector("svg");
              if (element)
                await saveFile(
                  "Study.svg",
                  new TextEncoder().encode(
                    new XMLSerializer().serializeToString(element),
                  ),
                  "image/svg+xml",
                );
            })
          }
        >
          {t("SaveImage")}
        </Button>
      </div>
      <div
        ref={viewport}
        role="application"
        aria-label={t("Diagrams")}
        tabIndex={0}
        className="study-diagram study-diagram-canvas"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          viewport.current?.focus();
          setExplored(true);
          drag.current = { point: point(event), view };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const current = point(event);
          setView({
            ...drag.current.view,
            x: drag.current.view.x + current.x - drag.current.point.x,
            y: drag.current.view.y + current.y - drag.current.point.y,
          });
        }}
        onPointerUp={(event) => {
          drag.current = undefined;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
        onDoubleClick={() => {
          drag.current = undefined;
          fit();
        }}
        style={{
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
        }}
      >
        <div
          ref={drawing}
          data-diagram-stage
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: size.width,
            height: size.height,
            transformOrigin: "0 0",
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {!explored && <p className="study-muted">{t("DiagramHint")}</p>}
      <Pending error={action.error} />
    </div>
  );
}
