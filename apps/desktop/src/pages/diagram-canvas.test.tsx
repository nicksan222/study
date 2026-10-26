import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { DiagramCanvas } from "./diagram-canvas";
import { renderPage } from "../test/helpers";
import { catalogs } from "../generated/catalog";
const en = catalogs.english;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><text x="0" y="20">Large diagram</text></svg>';
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 320,
    height: 240,
    left: 0,
    top: 0,
    right: 320,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON() {},
  });
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function transform(canvas: HTMLElement) {
  const value = (canvas.querySelector("[data-diagram-stage]") as HTMLElement)
    .style.transform;
  const [x, y, scale] = [...value.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(
    (match) => Number(match[0]),
  );
  return { x, y, scale };
}
it("F11 fits real dimensions and provides pan, actual size, keyboard zoom and fit", async () => {
  const user = userEvent.setup();
  renderPage(<DiagramCanvas svg={svg} />);
  const canvas = screen.getByRole("application", { name: en.Diagrams });
  await user.click(screen.getByRole("button", { name: en.DiagramFit }));
  expect(transform(canvas).scale).toBeCloseTo(0.272);
  expect(transform(canvas).x).toBeCloseTo(24);
  canvas.focus();
  fireEvent.keyDown(canvas, { key: "0" });
  expect(transform(canvas).scale).toBe(1);
  const before = transform(canvas);
  fireEvent.keyDown(canvas, { key: "ArrowLeft" });
  expect(transform(canvas).x).toBeCloseTo(before.x + 48);
  fireEvent.keyDown(canvas, { key: "+" });
  expect(transform(canvas).scale).toBeGreaterThan(1);
  fireEvent.keyDown(canvas, { key: "-" });
  expect(transform(canvas).scale).toBeCloseTo(1);
  fireEvent.doubleClick(canvas);
  expect(transform(canvas).scale).toBeCloseTo(0.272);
  fireEvent.keyDown(canvas, { key: "0" });
  fireEvent.keyDown(canvas, { key: "F" });
  expect(transform(canvas).scale).toBeCloseTo(0.272);
});
it("F11 pointer drag pans and modifier-wheel preserves the drawing point beneath the pointer", async () => {
  renderPage(<DiagramCanvas svg={svg} />);
  const canvas = screen.getByRole("application");
  const start = transform(canvas);
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(canvas, { clientX: 140, clientY: 120 });
  fireEvent.pointerUp(canvas, { clientX: 140, clientY: 120 });
  expect(transform(canvas).x).toBeCloseTo(start.x + 40);
  expect(transform(canvas).y).toBeCloseTo(start.y + 20);
  const before = transform(canvas);
  fireEvent.wheel(canvas, {
    clientX: 70,
    clientY: 60,
    ctrlKey: true,
    deltaY: -100,
  });
  await waitFor(() =>
    expect(transform(canvas).scale).toBeGreaterThan(before.scale),
  );
  const after = transform(canvas);
  expect((70 - after.x) / after.scale).toBeCloseTo(
    (70 - before.x) / before.scale,
  );
  expect((60 - after.y) / after.scale).toBeCloseTo(
    (60 - before.y) / before.scale,
  );
});
