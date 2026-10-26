import { useEffect, useRef } from "react";
import { Menu, type SubmenuOptions } from "@tauri-apps/api/menu";
import { isTauri, invoke } from "@tauri-apps/api/core";
import type { MessageKey } from "../i18n";
type MenuAction =
  | "settings"
  | "search"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "sidebar"
  | "fullscreen";
export function useNativeMenu(
  t: (key: MessageKey) => string,
  locale: string,
  onAction: (action: MenuAction) => void,
) {
  const handler = useRef(onAction);
  handler.current = onAction;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let current: Menu | undefined;
    const item = (id: MenuAction, label: MessageKey) => ({
      id,
      text: t(label),
      action: () => handler.current(id),
    });
    Menu.new({
      items: [
        {
          text: t("AppName"),
          items: [
            item("settings", "Settings"),
            { item: "Separator" },
            {
              id: "closeWindow",
              text: t("CloseWindow"),
              accelerator: "CmdOrCtrl+W",
              action: () => void invoke("close_window"),
            },
            {
              id: "quitApp",
              text: t("Quit"),
              accelerator: "CmdOrCtrl+Q",
              action: () => void invoke("quit_app"),
            },
          ],
        },
        // AppKit requires these native commands for standard editing shortcuts.
        // GTK/Wayland's predefined clipboard actions are unimplemented; its WebView
        // handles editing keys directly instead.
        ...(navigator.platform.startsWith("Mac")
          ? [
              {
                text: t("EditMenu"),
                items: [
                  { item: "Undo", text: t("Undo") },
                  { item: "Redo", text: t("Redo") },
                  { item: "Separator" },
                  { item: "Cut", text: t("Cut") },
                  { item: "Copy", text: t("Copy") },
                  { item: "Paste", text: t("Paste") },
                  { item: "SelectAll", text: t("SelectAll") },
                ],
              } satisfies SubmenuOptions,
            ]
          : []),
        {
          text: t("ViewMenu"),
          items: [
            item("search", "Search"),
            { item: "Separator" },
            item("zoomIn", "ZoomIn"),
            item("zoomOut", "ZoomOut"),
            item("resetZoom", "ResetZoom"),
            { item: "Separator" },
            item("sidebar", "ToggleSidebar"),
            item("fullscreen", "ToggleFullscreen"),
          ],
        },
      ],
    })
      .then(async (menu) => {
        if (disposed) {
          await menu.close();
          return;
        }
        current = menu;
        await menu.setAsAppMenu();
      })
      .catch(() => {
        /* The in-window menu keeps every action available if native menus are unavailable. */
      });
    return () => {
      disposed = true;
      void current?.close();
    };
  }, [locale]);
}
export const zoomLevels = [75, 90, 100, 110, 125, 150, 175, 200];
export function nextZoom(current: number, direction: "in" | "out" | "reset") {
  if (direction === "reset") return 100;
  return direction === "in"
    ? (zoomLevels.find((value) => value > current) ?? 200)
    : ([...zoomLevels].reverse().find((value) => value < current) ?? 75);
}
