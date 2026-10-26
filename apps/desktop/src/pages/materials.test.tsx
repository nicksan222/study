import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema, DueCardSchema, Rating } from "../generated/study_pb";
import { rpc } from "../rpc/client";
import { Reviews, exportedArtifact } from "./materials";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: { dueCards: vi.fn(), review: vi.fn() },
}));
it("requires reveal before rating and writes the canonical FSRS rating", async () => {
  const card = create(DueCardSchema, {
    card: { id: { value: 5n }, front: "Question", back: "Answer" },
    artifactTitle: "Biology",
  });
  vi.mocked(rpc.dueCards).mockResolvedValue({ items: [card] } as never);
  const user = userEvent.setup();
  renderPage(<Reviews onDone={vi.fn()} />);
  expect(await screen.findByText("Question")).toBeInTheDocument();
  expect(screen.queryByText("Answer")).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "3" });
  expect(rpc.review).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText("Answer")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "3" });
  await waitFor(() =>
    expect(rpc.review).toHaveBeenCalledWith({
      card: card.card?.id,
      rating: Rating.GOOD,
    }),
  );
  expect(
    await screen.findByText(/Review complete|All done|done|reviewed/i),
  ).toBeInTheDocument();
});
it("exports Anki-safe TSV and exact Mermaid source", () => {
  const cards = create(ArtifactSchema, {
    body: {
      kind: {
        case: "flashcards",
        value: { cards: [{ front: "A\nB\tC", back: " Answer\nline " }] },
      },
    },
  });
  expect(exportedArtifact(cards)).toBe("A B C\tAnswer line");
  const diagram = create(ArtifactSchema, {
    body: { kind: { case: "mermaid", value: "flowchart LR\n A-->B" } },
  });
  expect(exportedArtifact(diagram)).toBe("flowchart LR\n A-->B");
});

const dueCard = (value: bigint, name: string) =>
  create(DueCardSchema, {
    card: { id: { value }, front: `${name} question`, back: `${name} answer` },
  });
for (const input of ["button", "keyboard"] as const) {
  it(`keeps the revealed subject through a newly due card insertion and rates it via ${input}`, async () => {
    const user = userEvent.setup();
    const a = dueCard(1n, "Original"),
      b = dueCard(2n, "Newly due");
    let items = [a];
    vi.mocked(rpc.dueCards).mockImplementation(
      async () => ({ items }) as never,
    );
    vi.mocked(rpc.review)
      .mockClear()
      .mockResolvedValue({} as never);
    const view = renderPage(<Reviews onDone={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Show answer" }),
    );
    expect(screen.getByText("Original answer")).toBeVisible();
    items = [b, a];
    await act(async () => {
      await view.client.refetchQueries({ queryKey: ["due-cards", ""] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("Original question")).toBeVisible();
    expect(screen.getByText("Original answer")).toBeVisible();
    expect(screen.queryByText("Newly due question")).not.toBeInTheDocument();
    if (input === "button")
      await user.click(screen.getByRole("button", { name: "3 · Good" }));
    else fireEvent.keyDown(document, { key: "3" });
    await waitFor(() =>
      expect(rpc.review).toHaveBeenCalledWith({
        card: a.card!.id,
        rating: Rating.GOOD,
      }),
    );
    await screen.findByText("Newly due question");
    expect(screen.queryByText("Newly due answer")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "3" });
    expect(rpc.review).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "3 · Good" }));
    await waitFor(() =>
      expect(rpc.review).toHaveBeenLastCalledWith({
        card: b.card!.id,
        rating: Rating.GOOD,
      }),
    );
  });
}
it("a removed revealed card cannot transfer answer or rating permission to its replacement", async () => {
  const user = userEvent.setup();
  const a = dueCard(1n, "Removed"),
    b = dueCard(2n, "Replacement");
  let items = [a];
  vi.mocked(rpc.dueCards).mockImplementation(async () => ({ items }) as never);
  vi.mocked(rpc.review)
    .mockClear()
    .mockResolvedValue({} as never);
  const view = renderPage(<Reviews onDone={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Show answer" }));
  items = [b];
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ["due-cards", ""] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByText("Replacement question")).toBeVisible();
  expect(screen.queryByText("Replacement answer")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "3 · Good" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "3" });
  expect(rpc.review).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Enter", code: "Enter" });
  await screen.findByText("Replacement answer");
  await user.click(screen.getByRole("button", { name: "3 · Good" }));
  await waitFor(() =>
    expect(rpc.review).toHaveBeenCalledWith({
      card: b.card!.id,
      rating: Rating.GOOD,
    }),
  );
});

it("an in-flight rating stays bound to its removed subject and fences duplicate shortcuts", async () => {
  const user = userEvent.setup();
  const a = dueCard(1n, "Pending"),
    b = dueCard(2n, "Next");
  let items = [a];
  let finish!: (value: never) => void;
  vi.mocked(rpc.dueCards).mockImplementation(async () => ({ items }) as never);
  vi.mocked(rpc.review)
    .mockReset()
    .mockResolvedValue({} as never)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const view = renderPage(<Reviews onDone={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Show answer" }));
  act(() => {
    fireEvent.keyDown(document, { key: "3" });
    fireEvent.keyDown(document, { key: "3" });
  });
  await waitFor(() => expect(rpc.review).toHaveBeenCalledTimes(1));
  expect(rpc.review).toHaveBeenCalledWith({
    card: a.card!.id,
    rating: Rating.GOOD,
  });
  items = [b];
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ["due-cards", ""] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByText("Next question")).toBeVisible();
  expect(screen.getByRole("button", { name: "Show answer" })).toBeDisabled();
  fireEvent.keyDown(document, { key: " ", code: "Space" });
  fireEvent.keyDown(document, { key: "Enter", code: "Enter" });
  expect(screen.queryByText("Next answer")).not.toBeInTheDocument();
  await act(async () => finish({} as never));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Show answer" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  await user.click(screen.getByRole("button", { name: "3 · Good" }));
  await waitFor(() =>
    expect(rpc.review).toHaveBeenLastCalledWith({
      card: b.card!.id,
      rating: Rating.GOOD,
    }),
  );
});

it("Enter reveals only the focused review card and modifiers cannot reveal it", async () => {
  const card = dueCard(7n, "Enter");
  vi.mocked(rpc.dueCards).mockResolvedValue({ items: [card] } as never);
  vi.mocked(rpc.review)
    .mockClear()
    .mockResolvedValue({} as never);
  renderPage(<Reviews onDone={vi.fn()} />);
  await screen.findByText("Enter question");
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"])
    fireEvent.keyDown(document, { key: "Enter", [modifier]: true });
  expect(screen.queryByText("Enter answer")).not.toBeInTheDocument();
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(enter);
  await screen.findByText("Enter answer");
  expect(enter.defaultPrevented).toBe(true);
  expect(rpc.review).not.toHaveBeenCalled();
});
it("Enter on a focused review navigation button keeps its native action without revealing", async () => {
  const user = userEvent.setup();
  vi.mocked(rpc.dueCards).mockResolvedValue({
    items: [dueCard(8n, "Navigation")],
  } as never);
  const done = vi.fn();
  renderPage(<Reviews onDone={done} />);
  await screen.findByText("Navigation question");
  screen.getByRole("button", { name: "Back to flashcards" }).focus();
  await user.keyboard("{Enter}");
  expect(done).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Navigation answer")).not.toBeInTheDocument();
});
