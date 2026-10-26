import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Menu, type SubmenuOptions } from "@tauri-apps/api/menu";
import { isTauri } from "@tauri-apps/api/core";
import { catalogs } from "../generated/catalog";
import { useNativeMenu } from "./menu";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal(
    "navigator",
    Object.defineProperty(Object.create(navigator), "platform", {
      value: "MacIntel",
    }),
  );
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(Menu.new)
    .mockClear()
    .mockImplementation(
      async () =>
        ({
          setAsAppMenu: vi.fn().mockResolvedValue(null),
          close: vi.fn().mockResolvedValue(undefined),
        }) as unknown as Menu,
    );
});
for (const [locale, title, labels] of [
  ["english", "Edit", ["Undo", "Redo", "Cut", "Copy", "Paste", "Select all"]],
  [
    "italian",
    "Modifica",
    ["Annulla", "Ripristina", "Taglia", "Copia", "Incolla", "Seleziona tutto"],
  ],
] as const) {
  it(`installs native focused-input editing commands in ${locale} alongside app actions`, async () => {
    const catalog = catalogs[locale];
    renderHook(() => useNativeMenu((key) => catalog[key], locale, vi.fn()));
    await waitFor(() => expect(Menu.new).toHaveBeenCalledTimes(1));
    const menus = vi.mocked(Menu.new).mock.calls[0][0]!
      .items! as SubmenuOptions[];
    const edit = menus.find((menu) => menu.text === title);
    expect(edit).toBeDefined();
    const commands = edit!.items!.filter(
      (item) => "item" in item && item.item !== "Separator",
    );
    expect(commands.map((item) => "item" in item && item.item)).toEqual([
      "Undo",
      "Redo",
      "Cut",
      "Copy",
      "Paste",
      "SelectAll",
    ]);
    expect(commands.map((item) => "text" in item && item.text)).toEqual(labels);
    expect(commands.every((item) => !("action" in item))).toBe(true);
    expect(menus.some((menu) => menu.text === catalog.AppName)).toBe(true);
    expect(menus.some((menu) => menu.text === catalog.ViewMenu)).toBe(true);
  });
}
it("keeps installed app menu callbacks current across same-locale renders", async () => {
  const first = vi.fn(),
    second = vi.fn();
  const { rerender } = renderHook(
    ({ onAction }) =>
      useNativeMenu((key) => catalogs.english[key], "english", onAction),
    { initialProps: { onAction: first } },
  );
  await waitFor(() => expect(Menu.new).toHaveBeenCalledTimes(1));
  const menus = vi.mocked(Menu.new).mock.calls[0][0]!
    .items! as SubmenuOptions[];
  const view = menus.find((menu) => menu.text === catalogs.english.ViewMenu)!;
  const zoom = view.items!.find(
    (item) => "id" in item && item.id === "zoomIn",
  )!;
  rerender({ onAction: second });
  if ("action" in zoom) zoom.action!("zoomIn");
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("zoomIn");
});

for (const platform of ["Linux x86_64", "Win32"]) {
  it(`preserves WebView editing on ${platform} without unsupported native edit items`, async () => {
    vi.stubGlobal(
      "navigator",
      Object.defineProperty(Object.create(navigator), "platform", {
        value: platform,
      }),
    );
    renderHook(() =>
      useNativeMenu((key) => catalogs.english[key], "english", vi.fn()),
    );
    await waitFor(() => expect(Menu.new).toHaveBeenCalledTimes(1));
    const menus = vi.mocked(Menu.new).mock.calls[0][0]!
      .items! as SubmenuOptions[];
    expect(menus.map((menu) => menu.text)).toEqual([
      catalogs.english.AppName,
      catalogs.english.ViewMenu,
    ]);
  });
}
