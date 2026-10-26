import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  PracticeQuestionSchema,
  QuestionStatus,
  Verdict,
} from "../generated/study_pb";
import { rpc } from "../rpc/client";
import { Question } from "./practice";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: { answerQuestion: vi.fn(), addToFlashcards: vi.fn() },
}));
it("submits the choice using the canonical answer oneof", async () => {
  const user = userEvent.setup();
  const q = create(PracticeQuestionSchema, {
    id: { value: 12n },
    status: QuestionStatus.READY,
    written: {
      gist: "Cells",
      body: {
        kind: {
          case: "choice",
          value: {
            question: "What powers cells?",
            choices: ["ATP", "DNA"],
            answer: 0,
          },
        },
      },
    },
  });
  renderPage(<Question question={q} navigate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: /ATP/ }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(rpc.answerQuestion).toHaveBeenCalledWith({
      id: q.id,
      answer: { kind: { case: "choice", value: 0 } },
    }),
  );
});
it("shows grading feedback and adds a question to cards only by explicit action", async () => {
  const user = userEvent.setup();
  const q = create(PracticeQuestionSchema, {
    id: { value: 12n },
    status: QuestionStatus.GRADED,
    verdict: Verdict.CORRECT,
    feedback: "Good reasoning",
    answer: { kind: { case: "open", value: "ATP" } },
    written: {
      gist: "Cells",
      body: {
        kind: {
          case: "open",
          value: { question: "Explain ATP", reference: "Energy" },
        },
      },
    },
  });
  renderPage(<Question question={q} navigate={vi.fn()} />);
  expect(screen.getByText("Good reasoning")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Add to my flashcards" }),
  );
  await waitFor(() =>
    expect(rpc.addToFlashcards).toHaveBeenCalledWith({
      question: q.id,
      title: "Cells",
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Added to flashcards" }),
  ).toBeDisabled();
});
