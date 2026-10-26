import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  ProcessingSettingsSchema,
  SourceKind,
  ExtractorKind,
} from "../generated/study_pb";
import { rpc } from "../rpc/client";
import { Processing } from "./settings";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: {
    processing: vi.fn(),
    getReviewSettings: vi.fn(),
    getMaterialSettings: vi.fn(),
    switchProcessor: vi.fn(),
  },
}));
function setup() {
  const settings = create(ProcessingSettingsSchema, {
    switches: [
      {
        source: SourceKind.TEXT,
        processor: { kind: { case: "extractor", value: ExtractorKind.TEXT } },
        on: true,
      },
    ],
  });
  vi.mocked(rpc.processing).mockImplementation(async () => settings);
  vi.mocked(rpc.getReviewSettings).mockResolvedValue({
    newCardsPerDay: 20,
  } as never);
  vi.mocked(rpc.getMaterialSettings).mockResolvedValue({ sift: true } as never);
  return settings;
}
it("keeps checked state optimistic while the real save is pending, then reconciles committed value", async () => {
  const state = setup();
  let finish!: (value: never) => void;
  vi.mocked(rpc.switchProcessor).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  renderPage(<Processing />);
  const checkbox = await screen.findByRole("checkbox", {
    name: "Plain text reader",
  });
  expect(checkbox).toBeChecked();
  await user.click(checkbox);
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeDisabled();
  expect(rpc.switchProcessor).toHaveBeenCalledWith(
    expect.objectContaining({ on: false }),
  );
  state.switches[0].on = false;
  finish({} as never);
  await waitFor(() => expect(checkbox).toBeEnabled());
  expect(checkbox).not.toBeChecked();
});
it("rolls back pending checkbox state and exposes a rejected save", async () => {
  setup();
  let fail!: (reason: Error) => void;
  vi.mocked(rpc.switchProcessor).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const user = userEvent.setup();
  renderPage(<Processing />);
  const checkbox = await screen.findByRole("checkbox", {
    name: "Plain text reader",
  });
  await user.click(checkbox);
  expect(checkbox).not.toBeChecked();
  fail(new Error("Save rejected"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save rejected");
  await waitFor(() => expect(checkbox).toBeChecked());
  expect(checkbox).toBeEnabled();
});
