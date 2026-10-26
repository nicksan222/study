import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AppSettingsSchema, Appearance, Language } from "./generated/study_pb";
import { App } from "./app";
import { catalogs } from "./generated/catalog";
import { rpc } from "./rpc/client";
import { nextZoom } from "./rpc/menu";
import { renderPage } from "./test/helpers";
vi.mock("./rpc/client", () => ({
  rpc: {
    getAppSettings: vi.fn(),
    saveAppSettings: vi.fn(),
    dueCount: vi.fn(),
    sources: vi.fn(),
    allSessions: vi.fn(),
    jobOverviews: vi.fn(),
    practices: vi.fn(),
    machineReport: vi.fn(),
  },
}));
vi.mock("./rpc/refresh", () => ({ subscribeRefresh: vi.fn() }));
beforeEach(() => {
  history.replaceState(null, "", "/");
  let settings = create(AppSettingsSchema, {
    appearance: Appearance.LIGHT,
    language: Language.ENGLISH,
    zoomPercent: 100,
    onboarded: true,
  });
  vi.mocked(rpc.getAppSettings).mockImplementation(async () => settings);
  vi.mocked(rpc.saveAppSettings).mockImplementation(async (value) => {
    settings = create(AppSettingsSchema, value);
    return {} as never;
  });
  for (const method of [
    "sources",
    "allSessions",
    "jobOverviews",
    "practices",
  ] as const)
    vi.mocked(rpc[method]).mockResolvedValue({ items: [] } as never);
  vi.mocked(rpc.dueCount).mockResolvedValue({ value: 0n } as never);
  vi.mocked(rpc.machineReport).mockResolvedValue({} as never);
});
it("zooms every CSS pixel and persists Ctrl/Cmd +/-/0 without changing rem scale", async () => {
  renderPage(<App />);
  await screen.findByRole("heading", { name: "Home" });
  fireEvent.keyDown(document, { key: "+", ctrlKey: true });
  await waitFor(() =>
    expect(rpc.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ zoomPercent: 110 }),
    ),
  );
  await waitFor(() => expect(document.documentElement.style.zoom).toBe("1.1"));
  expect(document.documentElement.style.fontSize).toBe("16px");
  fireEvent.keyDown(document, { key: "-", metaKey: true });
  await waitFor(() => expect(document.documentElement.style.zoom).toBe("1"));
  fireEvent.keyDown(document, { key: "+", metaKey: true });
  await waitFor(() => expect(document.documentElement.style.zoom).toBe("1.1"));
  fireEvent.keyDown(document, { key: "0", ctrlKey: true });
  await waitFor(() => expect(document.documentElement.style.zoom).toBe("1"));
});
it("sidebar is keyboard operable and the view menu provides zoom controls", async () => {
  const { container } = renderPage(<App />);
  await screen.findByRole("heading", { name: "Home" });
  fireEvent.keyDown(document, { key: "\\", ctrlKey: true });
  expect(container.querySelector(".study-shell")).toHaveAttribute(
    "data-sidebar",
    "closed",
  );
  fireEvent.keyDown(document, { key: "\\", metaKey: true });
  expect(container.querySelector(".study-shell")).toHaveAttribute(
    "data-sidebar",
    "open",
  );
  expect(screen.getByText("View")).toBeInTheDocument();
});
it("zoom steps clamp and reset arbitrary stored zoom values", () => {
  expect(nextZoom(200, "in")).toBe(200);
  expect(nextZoom(75, "out")).toBe(75);
  expect(nextZoom(112, "in")).toBe(125);
  expect(nextZoom(112, "out")).toBe(110);
  expect(nextZoom(180, "reset")).toBe(100);
});

for (const first of ["language", "appearance", "zoom"] as const) {
  it(`composes ${first} with a concurrent app settings writer across deferred persistence and reload`, async () => {
    let committed = create(AppSettingsSchema, {
      appearance: Appearance.LIGHT,
      language: Language.ENGLISH,
      zoomPercent: 100,
      onboarded: true,
    });
    const pending: { value: typeof committed; finish: () => void }[] = [];
    vi.mocked(rpc.getAppSettings).mockImplementation(async () => committed);
    vi.mocked(rpc.saveAppSettings).mockImplementation(
      (value) =>
        new Promise((resolve) => {
          const snapshot = create(AppSettingsSchema, value);
          pending.push({
            value: snapshot,
            finish: () => {
              committed = snapshot;
              resolve({} as never);
            },
          });
        }),
    );
    history.replaceState(null, "", "/#Settings");
    const view = renderPage(<App />);
    await screen.findByRole("button", { name: "Italiano" });
    const zoom = () => fireEvent.keyDown(document, { key: "=", ctrlKey: true });
    if (first === "zoom") zoom();
    else
      fireEvent.click(
        screen.getByRole("button", {
          name: first === "language" ? "Italiano" : "Dark",
        }),
      );
    await waitFor(() => expect(pending).toHaveLength(1));
    if (first === "zoom")
      fireEvent.click(screen.getByRole("button", { name: "Italiano" }));
    else zoom();
    await act(async () => {
      await Promise.resolve();
    });
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].finish());
    await waitFor(() => expect(pending).toHaveLength(2));
    const expected = {
      language: first === "appearance" ? Language.ENGLISH : Language.ITALIAN,
      appearance: first === "appearance" ? Appearance.DARK : Appearance.LIGHT,
      zoomPercent: 110,
      onboarded: true,
    };
    expect(pending[1].value).toEqual(expect.objectContaining(expected));
    await act(async () => pending[1].finish());
    await waitFor(() =>
      expect(document.documentElement.style.zoom).toBe("1.1"),
    );
    expect(committed).toEqual(expect.objectContaining(expected));
    view.unmount();
    view.client.clear();
    const reloaded = renderPage(<App />);
    await screen.findByRole("button", { name: "Italiano" });
    await waitFor(() =>
      expect(document.documentElement.lang).toBe(
        first === "appearance" ? "en" : "it",
      ),
    );
    expect(document.documentElement.classList.contains("dark")).toBe(
      first === "appearance",
    );
    expect(document.documentElement.style.zoom).toBe("1.1");
    reloaded.unmount();
    reloaded.client.clear();
  });
}

it("a failed General save releases the shared queue without leaking its language into later zoom", async () => {
  let committed = create(AppSettingsSchema, {
    language: Language.ENGLISH,
    appearance: Appearance.LIGHT,
    zoomPercent: 100,
    onboarded: true,
  });
  let reject!: (error: Error) => void;
  vi.mocked(rpc.getAppSettings).mockImplementation(async () => committed);
  vi.mocked(rpc.saveAppSettings)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockImplementation(async (value) => {
      committed = create(AppSettingsSchema, value);
      return {} as never;
    });
  history.replaceState(null, "", "/#Settings");
  renderPage(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Italiano" }));
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  fireEvent.keyDown(document, { key: "=", ctrlKey: true });
  await act(async () => reject(new Error("Preference write refused")));
  await waitFor(() => expect(committed.zoomPercent).toBe(110));
  expect(committed.language).toBe(Language.ENGLISH);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Preference write refused",
  );
});
it("onboarding completion and zoom compose while completion is pending", async () => {
  let committed = create(AppSettingsSchema, {
    language: Language.ENGLISH,
    appearance: Appearance.LIGHT,
    zoomPercent: 100,
    onboarded: false,
  });
  let finish!: () => void;
  vi.mocked(rpc.getAppSettings).mockImplementation(async () => committed);
  vi.mocked(rpc.saveAppSettings)
    .mockImplementationOnce(
      (value) =>
        new Promise((resolve) => {
          finish = () => {
            committed = create(AppSettingsSchema, value);
            resolve({} as never);
          };
        }),
    )
    .mockImplementation(async (value) => {
      committed = create(AppSettingsSchema, value);
      return {} as never;
    });
  renderPage(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: catalogs.english.OnboardingSkip,
    }),
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.keyDown(document, { key: "=", ctrlKey: true });
  await act(async () => finish());
  await waitFor(() => expect(committed.zoomPercent).toBe(110));
  expect(committed.onboarded).toBe(true);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
