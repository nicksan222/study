import { useSaveAppSettings } from "./app-settings";
import type { ReactNode } from "react";
import { rpc } from "../rpc/client";
import { useAction, Pending } from "../components";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { invoke } from "@tauri-apps/api/core";
import { InstallationProvider } from "./installation";
import { SettingsPage } from "../pages/settings";
import { RecordingProvider, RecordingController } from "./recording";
import { AppSettingsSchema, Appearance, Language } from "../generated/study_pb";
import { renderPage } from "../test/helpers";
import { catalogs } from "../generated/catalog";
const en = catalogs.english;
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));
vi.mock("../rpc/native", () => ({
  useRecordingStatus: () => ({ data: undefined }),
}));
const settings = create(AppSettingsSchema, {
  appearance: Appearance.LIGHT,
  language: Language.ENGLISH,
  zoomPercent: 100,
  onboarded: true,
});
beforeEach(() => {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "check_update"
      ? {
          configured: true,
          currentVersion: "1.0.0",
          version: "1.0.1",
          body: null,
        }
      : { installing: false },
  );
});
for (const phase of [
  "starting",
  "live",
  "stopping",
  "posting",
  "sending",
  "discarding",
] as const) {
  it(`refuses update installation while recording is ${phase}`, async () => {
    const user = userEvent.setup();
    const controller = new RecordingController();
    controller.observe({
      revision: "1",
      phase,
      recordingId: "30",
      sessionId: "10",
      projectId: "1",
      seconds: 3,
      level: 0,
      ended: false,
      events: [],
    });
    renderPage(
      <RecordingProvider controller={controller}>
        <InstallationProvider>
          <SettingsPage settings={settings} />
        </InstallationProvider>
      </RecordingProvider>,
    );
    await user.click(screen.getByRole("button", { name: en.Updates }));
    await user.click(screen.getByRole("button", { name: en.UpdateCheck }));
    expect(
      await screen.findByRole("button", {
        name: en.UpdateInstall,
      }),
    ).toBeDisabled();
    expect(screen.getByText(en.UpdateBusy)).toBeInTheDocument();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "install_update"),
    ).toBe(false);
  });
}

function wrap(children: ReactNode) {
  return (
    <RecordingProvider>
      <InstallationProvider>{children}</InstallationProvider>
    </RecordingProvider>
  );
}
async function openUpdate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: en.Updates }));
  await user.click(screen.getByRole("button", { name: en.UpdateCheck }));
  return screen.findByRole("button", { name: en.UpdateInstall });
}
it("waits for a deferred preference save even after General unmounts", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  vi.spyOn(rpc, "getAppSettings").mockResolvedValue(settings);
  vi.spyOn(rpc, "saveAppSettings").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({} as never);
      }),
  );
  renderPage(wrap(<SettingsPage settings={settings} />));
  await user.click(screen.getByRole("button", { name: en.ItalianOwnName }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const install = await openUpdate(user);
  expect(install).toBeDisabled();
  expect(screen.getByText(en.UpdateBusy)).toBeInTheDocument();
  await act(async () => finish());
  await waitFor(() => expect(install).toBeEnabled());
});
it("retains installation across route unmount, fences new edits, and recovers after failure", async () => {
  const user = userEvent.setup();
  let fail!: (reason: Error) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "install_update")
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    return command === "check_update"
      ? {
          configured: true,
          currentVersion: "1.0.0",
          version: "1.0.1",
          body: null,
        }
      : { installing: false };
  });
  const edited = vi.fn(async () => {});
  const preferenceRead = vi
    .spyOn(rpc, "getAppSettings")
    .mockResolvedValue(settings);
  function OtherPage() {
    const preferences = useSaveAppSettings();
    const action = useAction();
    return (
      <>
        <input aria-label="Retained draft" defaultValue="Unsaved text" />
        <button onClick={() => action.mutate(edited)}>Other page action</button>
        <button
          onClick={() => preferences.mutate({ language: Language.ITALIAN })}
        >
          Other preference action
        </button>
        <Pending error={preferences.error} />
        <Pending error={action.error} />
      </>
    );
  }
  const view = renderPage(wrap(<SettingsPage settings={settings} />));
  const install = await openUpdate(user);
  await waitFor(() => expect(install).toBeEnabled());
  await user.click(install);
  await screen.findByText(en.UpdateInstalling);
  view.rerender(wrap(<OtherPage />));
  const other = screen.getByText("Other page action");
  const draft = screen.getByLabelText("Retained draft");
  expect(other).not.toBeVisible();
  expect(other.closest("[inert]")).not.toBeNull();
  fireEvent.click(other);
  await screen.findByText(en.UpdateBusy);
  expect(edited).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Other preference action"));
  await waitFor(() =>
    expect(screen.getAllByText(en.UpdateBusy)).toHaveLength(2),
  );
  expect(preferenceRead).not.toHaveBeenCalled();
  await act(async () => fail(new Error("Installer launch refused")));
  await screen.findByText(en.UpdateFailed);
  await waitFor(() => expect(other.closest("[inert]")).toBeNull());
  expect(other).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Retained draft" })).toBe(draft);
  expect(draft).toHaveValue("Unsaved text");
  await user.click(other);
  await waitFor(() => expect(edited).toHaveBeenCalledTimes(1));
});
it("restores the native installation lock after a webview/provider remount", async () => {
  vi.mocked(invoke).mockResolvedValue({ installing: true });
  renderPage(wrap(<button>Editing after reload</button>));
  await screen.findByText(en.UpdateInstalling);
  expect(
    screen.getByText("Editing after reload").closest("[inert]"),
  ).not.toBeNull();
});

it("requires a fresh displayed release check after failed installation consumes native approval", async () => {
  const user = userEvent.setup();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "install_update") throw new Error("Download refused");
    return command === "check_update"
      ? {
          configured: true,
          currentVersion: "1.0.0",
          version: "1.0.1",
          body: null,
        }
      : { installing: false };
  });
  renderPage(wrap(<SettingsPage settings={settings} />));
  const install = await openUpdate(user);
  await waitFor(() => expect(install).toBeEnabled());
  await user.click(install);
  await screen.findByText(en.UpdateFailed);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: en.UpdateInstall }),
    ).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: en.UpdateCheck }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: en.UpdateInstall }),
    ).toBeEnabled(),
  );
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "install_update"),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: en.SettingsGeneral }));
  expect(screen.getByRole("button", { name: en.ItalianOwnName })).toBeEnabled();
});
