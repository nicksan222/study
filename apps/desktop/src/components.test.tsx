import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { Markdown } from "./components";
import { openExternal } from "./rpc/native";
import { renderPage } from "./test/helpers";
vi.mock("./rpc/native", () => ({ openExternal: vi.fn() }));
beforeEach(() => {
  vi.mocked(openExternal).mockReset().mockResolvedValue();
});
it("prevents Markdown anchors navigating the app and requests the native external helper", async () => {
  renderPage(
    <Markdown text="[Reference](https://example.org/reference?q=study)" />,
  );
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  fireEvent(screen.getByRole("link", { name: "Reference" }), event);
  expect(event.defaultPrevented).toBe(true);
  await waitFor(() =>
    expect(openExternal).toHaveBeenCalledWith(
      "https://example.org/reference?q=study",
    ),
  );
});
it("shows a classified external opener failure", async () => {
  vi.mocked(openExternal).mockRejectedValue(
    new ConnectError("Open rejected", Code.PermissionDenied),
  );
  renderPage(<Markdown text="[Reference](https://example.org/)" />);
  fireEvent.click(screen.getByRole("link"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /permission_denied.*Open rejected/,
  );
});
it("rejects other protocols without requesting native navigation", async () => {
  renderPage(<Markdown text="[Contact](mailto:person@example.org)" />);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  fireEvent(screen.getByRole("link"), event);
  expect(event.defaultPrevented).toBe(true);
  expect(openExternal).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});
it("scrolls local fragments without changing the app hash route", () => {
  const scroll = vi.fn();
  renderPage(
    <>
      <div id="citation-target" />
      <Markdown text="[Passage](#citation-target)" />
    </>,
  );
  document.getElementById("citation-target")!.scrollIntoView = scroll;
  const previous = location.hash;
  fireEvent.click(screen.getByRole("link"));
  expect(scroll).toHaveBeenCalledWith({ block: "center" });
  expect(location.hash).toBe(previous);
  expect(openExternal).not.toHaveBeenCalled();
});
