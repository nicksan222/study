import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { rpc } from "../rpc/client";
import { PracticePage, Question } from "./practice";
import {
  PracticeSchema,
  PracticeSummarySchema,
  PracticeQuestionSchema,
  PracticeAnswerSchema,
  ProjectSchema,
  QuestionStatus,
  QuestionKind,
  JobStatus,
  JobKind,
  Requirement,
  Verdict,
} from "../generated/study_pb";
import { renderPage } from "../test/helpers";
import { catalogs } from "../generated/catalog";
const en = catalogs.english;
const projects = [
  create(ProjectSchema, { id: { value: 1n }, name: "Biology" }),
];
const quiz = (value: bigint) =>
  create(PracticeSchema, {
    id: { value },
    projectId: projects[0].id,
    questions: [],
  });
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(rpc, "projects").mockResolvedValue({ items: projects } as never);
  vi.spyOn(rpc, "practices").mockResolvedValue({
    items: [
      create(PracticeSummarySchema, {
        id: { value: 1n },
        projectId: projects[0].id,
      }),
      create(PracticeSummarySchema, {
        id: { value: 2n },
        projectId: projects[0].id,
      }),
    ],
  } as never);
  vi.spyOn(rpc, "practice").mockImplementation(
    async (request) => ({ value: quiz(request.value ?? 1n) }) as never,
  );
});
it("R1 changing to a cached quiz dismisses deletion opened for another quiz", async () => {
  const user = userEvent.setup(),
    deleted = vi
      .spyOn(rpc, "deletePractice")
      .mockResolvedValue({ value: true } as never);
  const view = renderPage(<PracticePage selected="1" navigate={vi.fn()} />);
  await screen.findByRole("button", { name: en.DeletePractice });
  act(() => view.client.setQueryData(["practice", "2"], quiz(2n)));
  await user.click(screen.getByRole("button", { name: en.DeletePractice }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  view.rerender(<PracticePage selected="2" navigate={vi.fn()} />);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(deleted).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: en.DeletePractice }));
  await user.click(
    screen.getByRole("button", { name: en.ConfirmDeletePractice }),
  );
  expect(deleted).toHaveBeenCalledWith(expect.objectContaining({ value: 2n }));
});
it.each([
  ["question", JobStatus.FAILED],
  ["question", JobStatus.CANCELLED],
  ["grade", JobStatus.FAILED],
  ["grade", JobStatus.CANCELLED],
] as const)(
  "R6 stopped %s work %s shows local retry instead of a permanent progress label",
  async (phase, status) => {
    const user = userEvent.setup(),
      retry = vi
        .spyOn(rpc, "retryJob")
        .mockResolvedValue({ value: true } as never);
    const question = create(PracticeQuestionSchema, {
      id: { value: 7n },
      status:
        phase === "grade" ? QuestionStatus.ANSWERED : QuestionStatus.PENDING,
      job: {
        id: { value: 12n },
        kind: phase === "grade" ? JobKind.GRADE : JobKind.QUESTION,
        status,
      },
      ...(phase === "grade"
        ? {
            written: {
              body: {
                kind: {
                  case: "open" as const,
                  value: { question: "Explain ATP", reference: "Energy" },
                },
              },
            },
            answer: { kind: { case: "open" as const, value: "My answer" } },
          }
        : {}),
    });
    renderPage(<Question question={question} navigate={vi.fn()} />);
    expect(
      screen.queryByText(
        en[phase === "grade" ? "CheckingAnswer" : "WritingQuestion"],
      ),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.RetryJob }));
    expect(retry).toHaveBeenCalledWith(question.job!.id);
  },
);
it.each(["question", "grade"] as const)(
  "R6 blocked %s work exposes local setup and cancellation",
  async (phase) => {
    const user = userEvent.setup(),
      navigate = vi.fn(),
      cancel = vi
        .spyOn(rpc, "cancelJob")
        .mockResolvedValue({ value: true } as never);
    const question = create(PracticeQuestionSchema, {
      id: { value: 7n },
      status:
        phase === "grade" ? QuestionStatus.ANSWERED : QuestionStatus.PENDING,
      job: {
        id: { value: 12n },
        kind: phase === "grade" ? JobKind.GRADE : JobKind.QUESTION,
        status: JobStatus.BLOCKED,
        needs: Requirement.LANGUAGE_MODELS,
      },
      ...(phase === "grade"
        ? {
            written: {
              body: {
                kind: {
                  case: "open" as const,
                  value: { question: "Explain ATP", reference: "Energy" },
                },
              },
            },
            answer: { kind: { case: "open" as const, value: "My answer" } },
          }
        : {}),
    });
    renderPage(<Question question={question} navigate={navigate} />);
    expect(
      screen.queryByText(
        en[phase === "grade" ? "CheckingAnswer" : "WritingQuestion"],
      ),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.GoToSettings }));
    expect(navigate).toHaveBeenCalledWith("Settings");
    await user.click(screen.getByRole("button", { name: en.StopJob }));
    expect(cancel).toHaveBeenCalledWith(question.job!.id);
  },
);
it("R6 a failed question ahead has recovery beside the answered question and after Next", async () => {
  const user = userEvent.setup();
  const q1 = create(PracticeQuestionSchema, {
    id: { value: 11n },
    ordinal: 1,
    kind: QuestionKind.OPEN,
    status: QuestionStatus.READY,
    written: {
      gist: "First question",
      body: {
        kind: {
          case: "open",
          value: { question: "Explain ATP", reference: "Energy" },
        },
      },
    },
  });
  const q2 = create(PracticeQuestionSchema, {
    id: { value: 12n },
    ordinal: 2,
    status: QuestionStatus.PENDING,
    job: {
      id: { value: 42n },
      kind: JobKind.QUESTION,
      status: JobStatus.FAILED,
    },
  });
  let current = create(PracticeSchema, { ...quiz(1n), questions: [q1] });
  vi.mocked(rpc.practice).mockImplementation(
    async () => ({ value: current }) as never,
  );
  vi.spyOn(rpc, "answerQuestion").mockImplementation(async () => {
    current = create(PracticeSchema, {
      ...quiz(1n),
      questions: [
        {
          ...q1,
          status: QuestionStatus.GRADED,
          answer: create(PracticeAnswerSchema, {
            kind: { case: "open", value: "ATP" },
          }),
          verdict: Verdict.CORRECT,
          feedback: "Checked answer",
        },
        q2,
      ],
    });
    return {} as never;
  });
  const retry = vi
      .spyOn(rpc, "retryJob")
      .mockResolvedValue({ value: true } as never),
    advance = vi
      .spyOn(rpc, "projectPractice")
      .mockResolvedValue({ value: 1n } as never);
  renderPage(<PracticePage selected="1" navigate={vi.fn()} />);
  await user.type(
    await screen.findByRole("textbox", { name: en.YourAnswer }),
    "ATP",
  );
  await user.click(screen.getByRole("button", { name: en.SubmitAnswer }));
  expect(await screen.findByText("Checked answer")).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: en.RetryJob }));
  expect(retry).toHaveBeenCalledWith(q2.job!.id);
  await user.click(screen.getByRole("button", { name: en.NextQuestion }));
  expect(
    await screen.findByRole("button", { name: en.RetryJob }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Checked answer")).not.toBeInTheDocument();
  expect(advance).not.toHaveBeenCalled();
});
it("R1 deletion already confirmed keeps its original ID and does not navigate away from a subsequently opened quiz", async () => {
  const user = userEvent.setup(),
    navigate = vi.fn();
  let finish!: (value: never) => void;
  const deleted = vi.spyOn(rpc, "deletePractice").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderPage(<PracticePage selected="1" navigate={navigate} />);
  await screen.findByRole("button", { name: en.DeletePractice });
  act(() => view.client.setQueryData(["practice", "2"], quiz(2n)));
  await user.click(screen.getByRole("button", { name: en.DeletePractice }));
  await user.click(
    screen.getByRole("button", { name: en.ConfirmDeletePractice }),
  );
  await waitFor(() =>
    expect(deleted).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1n }),
    ),
  );
  view.rerender(<PracticePage selected="2" navigate={navigate} />);
  await act(async () => {
    finish({ value: true } as never);
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(navigate).not.toHaveBeenCalled();
  expect(deleted).toHaveBeenCalledTimes(1);
});
it("R6 Next guards duplicate requests and exposes failure without abandoning the current answer", async () => {
  const user = userEvent.setup();
  const graded = create(PracticeQuestionSchema, {
    id: { value: 11n },
    ordinal: 1,
    status: QuestionStatus.GRADED,
    verdict: Verdict.CORRECT,
    written: {
      gist: "Answered",
      body: {
        kind: {
          case: "open",
          value: { question: "Explain ATP", reference: "Energy" },
        },
      },
    },
    answer: { kind: { case: "open", value: "ATP" } },
    feedback: "Existing feedback",
  });
  vi.mocked(rpc.practice).mockResolvedValue({
    value: create(PracticeSchema, { ...quiz(1n), questions: [graded] }),
  } as never);
  let fail!: (error: Error) => void;
  const next = vi.spyOn(rpc, "projectPractice").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  renderPage(<PracticePage selected="1" navigate={vi.fn()} />);
  const button = await screen.findByRole("button", { name: en.NextQuestion });
  await user.dblClick(button);
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled();
  await act(async () => {
    fail(new Error("Next request rejected"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Next request rejected",
  );
  expect(screen.getByText("Existing feedback")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: en.NextQuestion })).toBeEnabled();
});
