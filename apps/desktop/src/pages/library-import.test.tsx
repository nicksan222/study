import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  ImportResultsSchema,
  SourceSchema,
  ErrorKind,
} from "../generated/study_pb";
import { Library } from "./library";
import { rpc } from "../rpc/client";
import { pickFiles } from "../rpc/native";
import { releaseFiles } from "../rpc/files";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: { projects: vi.fn(), sources: vi.fn(), importFiles: vi.fn() },
}));
vi.mock("../rpc/native", () => ({ pickFiles: vi.fn() }));
vi.mock("../rpc/files", () => ({
  releaseFiles: vi.fn(),
  stageFiles: vi.fn(),
  useNativeDrop: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(releaseFiles).mockReset().mockResolvedValue();
  vi.mocked(pickFiles)
    .mockReset()
    .mockResolvedValue(["/stage/good", "/stage/bad"]);
  vi.mocked(rpc.importFiles).mockReset();
  vi.mocked(rpc.projects).mockResolvedValue({ items: [] } as never);
  vi.mocked(rpc.sources).mockResolvedValue({ items: [] } as never);
});
it("releases successful bulk imports and retries only retained failures", async () => {
  const good = create(SourceSchema, { id: { value: 1n }, name: "good" });
  const bad = create(SourceSchema, { id: { value: 2n }, name: "bad" });
  vi.mocked(rpc.importFiles)
    .mockResolvedValueOnce(
      create(ImportResultsSchema, {
        items: [
          { path: "/stage/good", result: { case: "source", value: good } },
          {
            path: "/stage/bad",
            result: {
              case: "error",
              value: {
                kind: ErrorKind.INVALID_INPUT,
                message: "Import rejected",
              },
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      create(ImportResultsSchema, {
        items: [{ path: "/stage/bad", result: { case: "source", value: bad } }],
      }),
    );
  const user = userEvent.setup();
  renderPage(<Library onSelect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Add files" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Import rejected");
  expect(releaseFiles).toHaveBeenCalledWith(["/stage/good"]);
  expect(releaseFiles).not.toHaveBeenCalledWith(["/stage/bad"]);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(rpc.importFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ paths: ["/stage/bad"] }),
    ),
  );
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/bad"]),
  );
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
});
it("retains all paths when import RPC fails and releases them on explicit discard", async () => {
  vi.mocked(rpc.importFiles).mockRejectedValue(new Error("Import unavailable"));
  const user = userEvent.setup();
  renderPage(<Library onSelect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Add files" }));
  await screen.findByRole("alert");
  expect(releaseFiles).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/good", "/stage/bad"]),
  );
});

it("does not import staging returned after library unmount and releases it instead", async () => {
  let finish!: (paths: string[]) => void;
  vi.mocked(pickFiles).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  const { unmount } = renderPage(<Library onSelect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Add files" }));
  unmount();
  finish(["/late/import"]);
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/late/import"]),
  );
  expect(rpc.importFiles).not.toHaveBeenCalled();
});
