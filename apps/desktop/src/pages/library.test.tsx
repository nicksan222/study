import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { rpc } from "../rpc/client";
import {
  SourceSchema,
  SourceKind,
  ProjectSchema,
  DocumentSchema,
  PreviewSchema,
} from "../generated/study_pb";
import { Library, SourceDetail } from "./library";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: {
    projects: vi.fn(),
    sources: vi.fn(),
    createNote: vi.fn(),
    sourceDocument: vi.fn(),
    preview: vi.fn(),
    correctBlock: vi.fn(),
  },
}));
const source = create(SourceSchema, {
  id: { value: 2n },
  name: "Lecture",
  kind: SourceKind.NOTE,
});
beforeEach(() => {
  vi.mocked(rpc.projects).mockResolvedValue({
    items: [create(ProjectSchema, { id: { value: 1n }, name: "Biology" })],
  } as never);
  vi.mocked(rpc.sources).mockResolvedValue({ items: [] } as never);
});
it("creates a note with chosen project and opens the persisted source", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  vi.mocked(rpc.createNote).mockResolvedValue(source);
  renderPage(<Library onSelect={selected} />);
  await user.click(await screen.findByRole("button", { name: "New note" }));
  await user.type(screen.getByLabelText("Title"), "Lecture");
  await user.type(
    screen.getByPlaceholderText("Write your note…"),
    "Cell respiration",
  );
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() =>
    expect(rpc.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Lecture", text: "Cell respiration" }),
    ),
  );
  expect(selected).toHaveBeenCalledWith("2");
});
it("corrects a block with original value and keeps stale conflicts visible", async () => {
  const user = userEvent.setup();
  vi.mocked(rpc.sourceDocument).mockResolvedValue({
    value: create(DocumentSchema, { blocks: [{ text: "Before" }] }),
  } as never);
  vi.mocked(rpc.preview).mockResolvedValue(
    create(PreviewSchema, { kind: { case: "unavailable", value: {} } }),
  );
  vi.mocked(rpc.correctBlock).mockResolvedValue({ value: false } as never);
  renderPage(<SourceDetail source={source} projects={[]} />);
  await user.click(
    await screen.findByRole("button", { name: "Correct this text" }),
  );
  const input = screen.getByRole("textbox", { name: "Correct this text" });
  await user.clear(input);
  await user.type(input, "After");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(rpc.correctBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        ordinal: 0n,
        before: "Before",
        after: "After",
      }),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /changed|again|work/i,
  );
  expect(input).toHaveValue("After");
});
