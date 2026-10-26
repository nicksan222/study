import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { App } from "./app";
import { rpc } from "./rpc/client";
import {
  AppSettingsSchema,
  Language,
  Appearance,
  ProjectSchema,
  ArtifactSchema,
  ArtifactKind,
  ArtifactStatus,
  DueCardSchema,
} from "./generated/study_pb";
import { renderPage } from "./test/helpers";
import { catalogs } from "./generated/catalog";
const en = catalogs.english;
vi.mock("./rpc/refresh", () => ({ subscribeRefresh: vi.fn() }));
const projects = [
  create(ProjectSchema, { id: { value: 1n }, name: "Biology" }),
  create(ProjectSchema, { id: { value: 2n }, name: "Physics" }),
];
const deck = (value: bigint) =>
  create(ArtifactSchema, {
    id: { value: value === 2n ? 42n : 41n },
    projectId: { value },
    kind: ArtifactKind.FLASHCARDS,
    status: ArtifactStatus.COMPLETE,
    title: value === 2n ? "Exact Physics artifact" : "Default Biology artifact",
    body: {
      kind: {
        case: "flashcards",
        value: {
          cards: [{ front: "Artifact question", back: "Artifact answer" }],
        },
      },
    },
  });
function route(hash: string) {
  act(() => {
    history.replaceState(null, "", `/${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
beforeEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  vi.spyOn(rpc, "getAppSettings").mockResolvedValue(
    create(AppSettingsSchema, {
      language: Language.ENGLISH,
      appearance: Appearance.LIGHT,
      zoomPercent: 100,
      onboarded: true,
    }),
  );
  vi.spyOn(rpc, "projects").mockResolvedValue({ items: projects } as never);
  vi.spyOn(rpc, "dueCount").mockResolvedValue({ value: 2n } as never);
  vi.spyOn(rpc, "dueCards").mockResolvedValue({
    items: [
      create(DueCardSchema, {
        projectId: projects[0].id,
        card: {
          id: { value: 1n },
          front: "Biology due card",
          back: "Biology answer",
        },
      }),
      create(DueCardSchema, {
        projectId: projects[1].id,
        card: {
          id: { value: 2n },
          front: "Physics due card",
          back: "Physics answer",
        },
      }),
    ],
  } as never);
  vi.spyOn(rpc, "material").mockImplementation(
    async (request) =>
      ({ items: [{ current: deck(request.value ?? 1n) }] }) as never,
  );
  vi.spyOn(rpc, "canUpdateMaterial").mockResolvedValue({
    value: true,
  } as never);
  vi.spyOn(rpc, "materialChanges").mockResolvedValue({
    value: { files: 0n, notes: 0n },
  } as never);
  vi.spyOn(rpc, "reviewTimes").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "dueBy").mockResolvedValue({ value: 2n } as never);
  vi.spyOn(rpc, "artifact").mockResolvedValue({ value: deck(2n) } as never);
  vi.spyOn(rpc, "sources").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "allSessions").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "jobOverviews").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "practices").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "machineReport").mockResolvedValue({} as never);
});
it("R2 actual Home Review now immediately opens global review through the production shell", async () => {
  const user = userEvent.setup();
  renderPage(<App />);
  await user.click(await screen.findByRole("button", { name: en.ReviewNow }));
  await waitFor(() => expect(location.hash).toBe("#Flashcards?id=review"));
  expect(await screen.findByText("Biology due card")).toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
  ).toHaveValue("");
  expect(rpc.dueCards).toHaveBeenCalledWith({
    project: undefined,
    limit: 100n,
  });
  expect(
    screen.queryByRole("heading", { name: "Default Biology artifact" }),
  ).not.toBeInTheDocument();
});
it("R2 a review route transition reaches an already mounted Flashcards page without a second review click", async () => {
  route("#Flashcards");
  renderPage(<App />);
  await screen.findByRole("heading", { name: "Default Biology artifact" });
  expect(rpc.dueCards).not.toHaveBeenCalled();
  route("#Flashcards?id=review");
  expect(await screen.findByText("Biology due card")).toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
  ).toHaveValue("");
  expect(rpc.dueCards).toHaveBeenCalledWith({
    project: undefined,
    limit: 100n,
  });
});
it.each([true, false])(
  "R2 exact artifact identity crosses the actual shell on initial entry=%s",
  async (initial) => {
    route(initial ? "#Flashcards?id=42" : "#Flashcards");
    renderPage(<App />);
    if (!initial) {
      await screen.findByRole("heading", { name: "Default Biology artifact" });
      route("#Flashcards?id=42");
    }
    await waitFor(() =>
      expect(rpc.artifact).toHaveBeenCalledWith(
        expect.objectContaining({ value: 42n }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Exact Physics artifact" }),
    ).toBeInTheDocument();
  },
);
function holdProjects() {
  let resolve!: (value: { items: typeof projects }) => void;
  const pending = new Promise<{ items: typeof projects }>((done) => {
    resolve = done;
  });
  vi.mocked(rpc.projects).mockReturnValue(pending as never);
  return async (items = projects) => {
    await act(async () => {
      resolve({ items });
      await pending;
    });
  };
}
function scopedReviewCards() {
  return vi.mocked(rpc.dueCards).mockImplementation(
    async (request) =>
      ({
        items: [
          create(DueCardSchema, {
            projectId: { value: request.project?.value === 2n ? 2n : 1n },
            card: {
              id: { value: request.project?.value === 2n ? 2n : 1n },
              front:
                request.project?.value === 2n
                  ? "Physics due card"
                  : "Biology due card",
              back: "Answer",
            },
          }),
        ],
      }) as never,
  );
}
it("a specific review waits for its project before requesting or rating cards through App", async () => {
  const user = userEvent.setup();
  const resolve = holdProjects();
  const due = scopedReviewCards();
  const rating = vi.spyOn(rpc, "review").mockResolvedValue({} as never);
  route("#Flashcards?id=review&project=2");
  renderPage(<App />);
  await screen.findByRole("heading", { name: en.Flashcards });
  await waitFor(() => expect(rpc.projects).toHaveBeenCalled());
  expect(due).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: en.ShowAnswer }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `3 · ${en.RateGood}` }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
  ).toHaveValue("2");
  expect(
    screen.queryByRole("heading", {
      name: `${en.ReviewProgress} · ${en.AllProjects}`,
    }),
  ).not.toBeInTheDocument();
  await resolve();
  await screen.findByText("Physics due card");
  expect(screen.queryByText("Biology due card")).not.toBeInTheDocument();
  expect(
    due.mock.calls.every(([request]) => request.project?.value === 2n),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: en.ShowAnswer }));
  await user.click(screen.getByRole("button", { name: `3 · ${en.RateGood}` }));
  await waitFor(() =>
    expect(rating).toHaveBeenCalledWith(
      expect.objectContaining({ card: expect.objectContaining({ value: 2n }) }),
    ),
  );
});
it("a missing specific review never falls back to global cards without an explicit scope choice", async () => {
  const user = userEvent.setup();
  const resolve = holdProjects();
  const due = scopedReviewCards();
  route("#Flashcards?id=review&project=2");
  renderPage(<App />);
  await screen.findByRole("heading", { name: en.Flashcards });
  expect(due).not.toHaveBeenCalled();
  await resolve([projects[0]]);
  await waitFor(() =>
    expect(screen.getAllByText(en.ProblemGone).length).toBeGreaterThan(0),
  );
  expect(due).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: en.ShowAnswer }),
  ).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
    "",
  );
  await screen.findByText("Biology due card");
  expect(due).toHaveBeenCalledWith({ project: undefined, limit: 100n });
});
it("explicit global review remains available while the Projects query is unresolved", async () => {
  const resolve = holdProjects();
  const due = scopedReviewCards();
  route("#Flashcards?id=review");
  renderPage(<App />);
  await screen.findByText("Biology due card");
  expect(due).toHaveBeenCalledWith({ project: undefined, limit: 100n });
  expect(
    screen.getByRole("combobox", { name: en.ReviewsByProject }),
  ).toHaveValue("");
  expect(
    screen.getByRole("button", { name: en.ShowAnswer }),
  ).toBeInTheDocument();
  await resolve();
});
