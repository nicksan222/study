import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  ChatMessageSchema,
  MessageRole,
  MessageStatus,
  VersionOrigin,
} from "../generated/study_pb";
import { rpc } from "../rpc/client";
import { MessageView, activeText } from "./sessions";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: {
    editMessage: vi.fn(),
    setActiveVersion: vi.fn(),
    reanswer: vi.fn(),
    rewriteMessage: vi.fn(),
  },
}));
const message = () =>
  create(ChatMessageSchema, {
    id: { value: 1n },
    role: MessageRole.USER,
    status: MessageStatus.COMPLETE,
    activeVersion: { value: 3n },
    versions: [
      {
        id: { value: 2n },
        number: 1,
        text: "Original",
        origin: VersionOrigin.TYPED,
        status: MessageStatus.COMPLETE,
      },
      {
        id: { value: 3n },
        number: 2,
        text: "Current",
        origin: VersionOrigin.EDITED,
        status: MessageStatus.COMPLETE,
      },
    ],
    parts: [
      {
        id: { value: 7n },
        content: { name: "Lecture.pdf", sourceId: { value: 9n } },
      },
    ],
  });
it("shows active version and changes versions through RPC", async () => {
  const user = userEvent.setup();
  const m = message();
  expect(activeText(m)).toBe("Current");
  renderPage(<MessageView message={m} onThread={vi.fn()} navigate={vi.fn()} />);
  expect(screen.getByText("Current")).toBeInTheDocument();
  expect(screen.queryByText("Original")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox"), "2");
  await waitFor(() =>
    expect(rpc.setActiveVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: m.versions[0].id }),
    ),
  );
});
it("opens an attachment thread and saves edits as new versions", async () => {
  const user = userEvent.setup();
  const thread = vi.fn();
  const m = message();
  renderPage(<MessageView message={m} onThread={thread} navigate={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /Reply in thread/i }));
  expect(thread).toHaveBeenCalledWith(m.parts[0].id);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const edit = screen.getByRole("textbox", { name: "Edit" });
  await user.clear(edit);
  await user.type(edit, "Edited again");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(rpc.editMessage).toHaveBeenCalledWith({
      id: m.id,
      text: "Edited again",
    }),
  );
});
