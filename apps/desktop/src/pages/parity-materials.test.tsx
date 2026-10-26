import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { rpc } from "../rpc/client";
import {
  ArtifactSchema,
  ProjectSchema,
  ArtifactKind,
  ArtifactStatus,
  JobStatus,
  JobOverviewSchema,
  DueCardSchema,
  ReportSchema,
  Placement,
  AppSettingsSchema,
} from "../generated/study_pb";
import { MaterialsPage, Reviews } from "./materials";
import { Home } from "./home";
import { JobsPage } from "./jobs";
import { SettingsPage } from "./settings";
import { Modal } from "../components";
import { renderPage } from "../test/helpers";
import { catalogs } from "../generated/catalog";
const en = catalogs.english;
const project = create(ProjectSchema, { id: { value: 1n }, name: "Biology" });
const artifact = (mistakes = false) =>
  create(ArtifactSchema, {
    id: { value: 5n },
    projectId: project.id,
    kind: ArtifactKind.FLASHCARDS,
    title: mistakes ? "Mistakes only" : "Regular cards",
    mistakes,
    status: ArtifactStatus.COMPLETE,
    body: {
      kind: {
        case: "flashcards",
        value: { cards: [{ front: "Question", back: "Answer" }] },
      },
    },
  });
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(rpc, "projects").mockResolvedValue({
    items: [
      project,
      create(ProjectSchema, { id: { value: 2n }, name: "Physics" }),
    ],
  } as never);
  vi.spyOn(rpc, "material").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "dueCount").mockResolvedValue({ value: 2n } as never);
  vi.spyOn(rpc, "reviewTimes").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "dueBy").mockResolvedValue({ value: 3n } as never);
  vi.spyOn(rpc, "canUpdateMaterial").mockResolvedValue({
    value: true,
  } as never);
  vi.spyOn(rpc, "materialChanges").mockResolvedValue({
    value: { files: 0n, notes: 0n },
  } as never);
});
it("F2 review shortcuts ignore modifiers, handled events and dialogs", async () => {
  const user = userEvent.setup();
  vi.spyOn(rpc, "dueCards").mockResolvedValue({
    items: [
      create(DueCardSchema, {
        card: { id: { value: 5n }, front: "Question", back: "Answer" },
      }),
    ],
  } as never);
  const review = vi.spyOn(rpc, "review").mockResolvedValue({} as never);
  const { rerender } = renderPage(<Reviews onDone={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: en.ShowAnswer }));
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"])
    fireEvent.keyDown(document, { key: "3", [modifier]: true });
  expect(review).not.toHaveBeenCalled();
  const handled = new KeyboardEvent("keydown", {
    key: "3",
    cancelable: true,
    bubbles: true,
  });
  handled.preventDefault();
  document.dispatchEvent(handled);
  expect(review).not.toHaveBeenCalled();
  rerender(
    <>
      <Reviews onDone={vi.fn()} />
      <Modal open onClose={vi.fn()} title="AlertDeleteCard">
        <button>Focused confirmation</button>
      </Modal>
    </>,
  );
  const button = await screen.findByRole("button", {
    name: "Focused confirmation",
  });
  button.focus();
  const event = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    bubbles: true,
    cancelable: true,
  });
  button.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  fireEvent.keyDown(button, { key: "3" });
  expect(review).not.toHaveBeenCalled();
});
it("F5 mistakes decks remain accessible without regular material", async () => {
  vi.mocked(rpc.material).mockResolvedValue({
    items: [{ current: artifact(true) }],
  } as never);
  renderPage(
    <MaterialsPage kind={ArtifactKind.FLASHCARDS} navigate={vi.fn()} />,
  );
  expect(
    await screen.findByRole("heading", { name: "Mistakes only" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Question")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: en.EditCard })).toBeEnabled();
});
it("F6 general review is global and project review retains its own scope", async () => {
  const user = userEvent.setup();
  const due = vi
    .spyOn(rpc, "dueCards")
    .mockResolvedValue({ items: [] } as never);
  renderPage(
    <MaterialsPage kind={ArtifactKind.FLASHCARDS} navigate={vi.fn()} />,
  );
  await user.click(
    await screen.findByRole("button", { name: new RegExp(en.ReviewDue) }),
  );
  await waitFor(() =>
    expect(due).toHaveBeenCalledWith({ project: undefined, limit: 100n }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
    "2",
  );
  await waitFor(() =>
    expect(due).toHaveBeenCalledWith({
      project: expect.objectContaining({ value: 2n }),
      limit: 100n,
    }),
  );
});
it("F6 Home global review action starts the review route", async () => {
  vi.spyOn(rpc, "sources").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "allSessions").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "jobOverviews").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "practices").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "machineReport").mockResolvedValue({} as never);
  const navigate = vi.fn(),
    user = userEvent.setup();
  renderPage(<Home navigate={navigate} />);
  await user.click(await screen.findByRole("button", { name: en.ReviewNow }));
  expect(navigate).toHaveBeenCalledWith("Flashcards", "review");
});
it.each([false, true])(
  "F7 stopped material has first/current=%s failure state and recovery",
  async (current) => {
    const user = userEvent.setup();
    const update = artifact();
    update.status = ArtifactStatus.WRITING;
    update.body = undefined;
    update.job = {
      id: { $typeName: "study.v1.JobId", value: 7n },
      status: JobStatus.FAILED,
    } as never;
    vi.mocked(rpc.material).mockResolvedValue({
      items: [{ current: current ? artifact() : undefined, update }],
    } as never);
    const retry = vi
      .spyOn(rpc, "retryJob")
      .mockResolvedValue({ value: true } as never);
    renderPage(
      <MaterialsPage kind={ArtifactKind.FLASHCARDS} navigate={vi.fn()} />,
    );
    expect(
      await screen.findByText(
        en[current ? "MaterialUpdateFailed" : "MaterialWriteFailed"],
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: en[current ? "UpdateMaterial" : "MakeMaterial"],
      }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: en.RetryJob }));
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ value: 7n }));
  },
);
it("F8 diagram activity resolves artifact identity and routes to its actual kind", async () => {
  const user = userEvent.setup(),
    navigate = vi.fn();
  const diagram = artifact();
  diagram.kind = ArtifactKind.DIAGRAM;
  vi.spyOn(rpc, "artifact").mockResolvedValue({ value: diagram } as never);
  vi.spyOn(rpc, "jobOverviews").mockResolvedValue({
    items: [
      create(JobOverviewSchema, {
        subject: "Diagram",
        job: {
          id: { value: 7n },
          status: JobStatus.FAILED,
          target: { kind: { case: "artifact", value: diagram.id! } },
        },
      }),
    ],
  } as never);
  renderPage(<JobsPage navigate={navigate} />);
  await user.click(
    await screen.findByRole("button", { name: en.OpenMaterial }),
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("Diagrams", "5", "1"),
  );
});
it("F13 hardware recommendations include placement reasons and recommended copies", async () => {
  const user = userEvent.setup();
  vi.spyOn(rpc, "machineReport").mockResolvedValue({
    value: create(ReportSchema, {
      plan: {
        transcription: Placement.NOT_ENOUGH_MEMORY,
        transcriptionInstances: 3,
      },
    }),
  } as never);
  vi.spyOn(rpc, "modelStatus").mockResolvedValue({
    installed: false,
    sizeBytes: 42n,
  } as never);
  renderPage(<SettingsPage settings={create(AppSettingsSchema, {})} />);
  await user.click(screen.getByRole("button", { name: en.System }));
  expect(
    await screen.findByText(en.PlacementNotEnoughMemory),
  ).toBeInTheDocument();
  expect(screen.getByText(en.NotRecommendedHere)).toBeInTheDocument();
  expect(screen.getByText(new RegExp(en.ModelCopies))).toHaveTextContent("3");
  expect(screen.getByText(en.RunsHere)).toBeInTheDocument();
});
it("F2 only the focused deck responds while other visible decks remain unchanged", async () => {
  const user = userEvent.setup();
  const regular = artifact(),
    mistakes = artifact(true);
  regular.body = {
    kind: {
      case: "flashcards",
      value: {
        cards: [
          { front: "Regular one", back: "Answer" },
          { front: "Regular two", back: "Answer" },
        ],
      },
    },
  } as never;
  mistakes.id = { value: 6n, $typeName: "study.v1.ArtifactId" };
  mistakes.body = {
    kind: {
      case: "flashcards",
      value: {
        cards: [
          { front: "Mistake one", back: "Answer" },
          { front: "Mistake two", back: "Answer" },
        ],
      },
    },
  } as never;
  vi.mocked(rpc.material).mockResolvedValue({
    items: [{ current: regular }, { current: mistakes }],
  } as never);
  renderPage(
    <MaterialsPage kind={ArtifactKind.FLASHCARDS} navigate={vi.fn()} />,
  );
  const deck = await screen.findByRole("region", { name: "Regular cards" });
  deck.focus();
  fireEvent.keyDown(deck, { key: "ArrowRight" });
  expect(screen.getByText("Regular two")).toBeInTheDocument();
  expect(screen.getByText("Mistake one")).toBeInTheDocument();
  fireEvent.keyDown(deck, { key: "ArrowLeft", ctrlKey: true });
  expect(screen.getByText("Regular two")).toBeInTheDocument();
  await user.click(
    screen.getAllByRole("button", { name: en.DeleteMaterial })[0],
  );
  const dialog = await screen.findByRole("dialog");
  const cancel = screen.getByRole("button", { name: en.Cancel });
  cancel.focus();
  const space = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    bubbles: true,
    cancelable: true,
  });
  cancel.dispatchEvent(space);
  expect(space.defaultPrevented).toBe(false);
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(screen.getByText("Regular two")).toBeInTheDocument();
});
it("F8 the exact artifact route selects its owning project instead of the default first project", async () => {
  const chosen = artifact();
  chosen.projectId = { value: 2n, $typeName: "study.v1.ProjectId" };
  chosen.title = "Selected Physics";
  vi.spyOn(rpc, "artifact").mockResolvedValue({ value: chosen } as never);
  vi.mocked(rpc.material).mockImplementation(
    async (request) =>
      ({
        items:
          request.value === 2n
            ? [{ current: chosen }]
            : [{ current: artifact() }],
      }) as never,
  );
  renderPage(
    <MaterialsPage
      selected="5"
      kind={ArtifactKind.FLASHCARDS}
      navigate={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "Selected Physics" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(rpc.material).toHaveBeenCalledWith(
      expect.objectContaining({ value: 2n }),
    ),
  );
});
it("F7 cancelled updates permit regeneration as well as retry", async () => {
  const user = userEvent.setup();
  const update = artifact();
  update.status = ArtifactStatus.PENDING;
  update.job = {
    id: { $typeName: "study.v1.JobId", value: 7n },
    status: JobStatus.CANCELLED,
  } as never;
  vi.mocked(rpc.material).mockResolvedValue({
    items: [{ current: artifact(), update }],
  } as never);
  const regenerate = vi
    .spyOn(rpc, "updateMaterial")
    .mockResolvedValue({ value: 9n } as never);
  renderPage(
    <MaterialsPage kind={ArtifactKind.FLASHCARDS} navigate={vi.fn()} />,
  );
  const button = await screen.findByRole("button", { name: en.UpdateMaterial });
  expect(button).toBeEnabled();
  await user.click(button);
  expect(regenerate).toHaveBeenCalledWith({
    project: project.id,
    kind: ArtifactKind.FLASHCARDS,
  });
});
it("F6 the Home review route mounts global review directly without requiring an extra click", async () => {
  const due = vi
    .spyOn(rpc, "dueCards")
    .mockResolvedValue({ items: [] } as never);
  renderPage(
    <MaterialsPage
      selected="review"
      kind={ArtifactKind.FLASHCARDS}
      navigate={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(due).toHaveBeenCalledWith({ project: undefined, limit: 100n }),
  );
  expect(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
  ).toHaveValue("");
});
it("F2 question digit shortcuts reject app modifiers and require the question focus scope", async () => {
  const { Question } = await import("./practice");
  const { PracticeQuestionSchema } = await import("../generated/study_pb");
  const question = create(PracticeQuestionSchema, {
    id: { value: 10n },
    written: {
      body: {
        kind: {
          case: "choice",
          value: { question: "Choose", choices: ["One", "Two"], answer: 0 },
        },
      },
    },
  });
  renderPage(
    <>
      <button>Outside question</button>
      <Question question={question} navigate={vi.fn()} />
    </>,
  );
  const choices = screen.getAllByRole("radio");
  fireEvent.keyDown(document, { key: "2", ctrlKey: true });
  expect(choices[1]).not.toBeChecked();
  fireEvent.keyDown(document, { key: "2" });
  expect(choices[1]).toBeChecked();
  screen.getByRole("button", { name: "Outside question" }).focus();
  fireEvent.keyDown(document, { key: "1" });
  expect(choices[1]).toBeChecked();
});
it("R3 a project-linked entry seeds selection without overriding later user choices or project refresh", async () => {
  const user = userEvent.setup();
  const view = renderPage(
    <MaterialsPage
      projectFilter="2"
      kind={ArtifactKind.FLASHCARDS}
      navigate={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Physics" });
  await user.click(screen.getByRole("button", { name: "Biology" }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Biology" }),
    ).toBeInTheDocument(),
  );
  act(() =>
    view.client.setQueryData(
      ["projects"],
      [
        project,
        create(ProjectSchema, { id: { value: 2n }, name: "Physics renamed" }),
      ],
    ),
  );
  expect(screen.getByRole("heading", { name: "Biology" })).toBeInTheDocument();
});
it("review history and upcoming counts follow Biology, Physics, global and material scopes", async () => {
  const user = userEvent.setup();
  const key = (value?: { value?: bigint }) => value?.value?.toString() ?? "all";
  const history = { "1": 2, "2": 9, all: 11 };
  const upcoming = { "1": 3n, "2": 7n, all: 10n };
  const times = vi.mocked(rpc.reviewTimes).mockImplementation(
    async (request) =>
      ({
        items: Array.from(
          { length: history[key(request.project) as keyof typeof history] },
          () => 1n,
        ),
      }) as never,
  );
  const future = vi.mocked(rpc.dueBy).mockImplementation(
    async (request) =>
      ({
        value: upcoming[key(request.project) as keyof typeof upcoming],
      }) as never,
  );
  vi.spyOn(rpc, "dueCards").mockResolvedValue({ items: [] } as never);
  const view = renderPage(
    <MaterialsPage
      kind={ArtifactKind.FLASHCARDS}
      projectFilter="1"
      selected="review"
      navigate={vi.fn()}
    />,
  );
  const scope = await screen.findByRole("combobox", {
    name: en.ReviewsByProject,
  });
  const assertScope = async (id: string, completed: number, due: bigint) => {
    await waitFor(() =>
      expect(times).toHaveBeenCalledWith(
        expect.objectContaining({
          project:
            id === "all"
              ? undefined
              : expect.objectContaining({ value: BigInt(id) }),
        }),
      ),
    );
    await waitFor(() =>
      expect(future).toHaveBeenCalledWith(
        expect.objectContaining({
          project:
            id === "all"
              ? undefined
              : expect.objectContaining({ value: BigInt(id) }),
        }),
      ),
    );
    expect(
      await screen.findByText(new RegExp(`^${completed} ·`)),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(`${due} · ${en.ProgressComingUp}`),
    ).toBeInTheDocument();
  };
  await assertScope("1", 2, 3n);
  times.mockClear();
  future.mockClear();
  await user.selectOptions(scope, "2");
  await assertScope("2", 9, 7n);
  times.mockClear();
  future.mockClear();
  await user.selectOptions(scope, "");
  await assertScope("all", 11, 10n);
  await user.click(screen.getByRole("button", { name: "Biology" }));
  expect(
    await screen.findByText(`2 · reviews in the last 7 days`),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(`3 · ${en.ProgressComingUp}`),
  ).toBeInTheDocument();
  view.rerender(
    <MaterialsPage
      kind={ArtifactKind.FLASHCARDS}
      selected="review"
      navigate={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(`11 · reviews in the last 7 days`),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(`10 · ${en.ProgressComingUp}`),
  ).toBeInTheDocument();
});
