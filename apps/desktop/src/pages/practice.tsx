import { useState, useEffect, useRef } from "react";
import { rpc } from "../rpc/client";
import {
  QuestionStatus,
  JobStatus,
  Verdict,
  type PracticeQuestion,
  type ProjectId,
} from "../generated/study_pb";
import { useI18n } from "../i18n";
import {
  Button,
  Textarea,
  Panel,
  ProjectSelect,
  Pending,
  Load,
  Empty,
  Markdown,
  Citations,
  JobRecovery,
  jobStopped,
  DeleteButton,
  useData,
  useAction,
  useProjects,
  idKey,
  useShortcut,
} from "../components";
import { type Navigate } from "./projects";
export function PracticePage({
  selected,
  projectFilter,
  navigate,
}: {
  selected?: string;
  projectFilter?: string;
  navigate: Navigate;
}) {
  const { t, number } = useI18n();
  const projects = useProjects();
  const practices = useData(
    ["practices"],
    async () => (await rpc.practices({})).items,
  );
  const [project, setProject] = useState<ProjectId | undefined>();
  const action = useAction<unknown>();
  const selectedPractice = practices.data?.find(
    (p) => idKey(p.id) === selected,
  );
  const detail = useData(
    ["practice", selected],
    async () => (await rpc.practice(selectedPractice!.id!)).value,
    !!selectedPractice,
    1500,
  );
  const [questionKey, setQuestionKey] = useState<string>();
  useEffect(() => {
    setQuestionKey(undefined);
  }, [selected]);
  const current =
    detail.data?.questions.find((q) => idKey(q.id) === questionKey) ??
    detail.data?.questions.find((q) => q.status !== QuestionStatus.GRADED) ??
    detail.data?.questions.at(-1);
  useEffect(() => {
    if (!questionKey && current) setQuestionKey(idKey(current.id));
  }, [questionKey, current]);
  const ahead = detail.data?.questions.find(
    (question) => question.ordinal > (current?.ordinal ?? -1),
  );
  const advancing = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const advance = () => {
    if (action.isPending || advancing.current || !selectedPractice) return;
    if (ahead) {
      setQuestionKey(idKey(ahead.id));
      return;
    }
    const target = selectedPractice;
    const context = selected;
    const ordinal = current?.ordinal ?? -1;
    advancing.current = true;
    action.mutate(async () => {
      try {
        await rpc.projectPractice(target.projectId!);
        const latest = (await rpc.practice(target.id!)).value;
        const next = latest?.questions.find((q) => q.ordinal > ordinal);
        if (next && selectedRef.current === context)
          setQuestionKey(idKey(next.id));
      } finally {
        advancing.current = false;
      }
    });
  };
  const [results, setResults] = useState(false);
  return (
    <>
      <div className="study-toolbar">
        <ProjectSelect
          projects={projects.data ?? []}
          value={
            project ??
            projects.data?.find((p) => idKey(p.id) === projectFilter)?.id
          }
          onChange={setProject}
          required
        />
        <Button
          disabled={
            action.isPending ||
            !(
              project ??
              projects.data?.find((p) => idKey(p.id) === projectFilter)?.id
            )
          }
          onClick={() =>
            action.mutate(async () => {
              const id = await rpc.projectPractice(
                project ??
                  projects.data!.find((p) => idKey(p.id) === projectFilter)!
                    .id!,
              );
              setResults(false);
              navigate("Practice", idKey(id));
            })
          }
        >
          {t("OpenProjectQuiz")}
        </Button>
      </div>
      <Pending error={action.error} />
      <div className="study-split">
        <Panel>
          <Load query={practices} empty="PracticeNoResults">
            {(items) =>
              items.map((p) => (
                <Button
                  key={idKey(p.id)}
                  className="w-full justify-start mb-1"
                  variant={idKey(p.id) === selected ? "secondary" : "ghost"}
                  onClick={() => {
                    navigate("Practice", idKey(p.id));
                    setResults(false);
                  }}
                >
                  {projects.data?.find(
                    (project) => idKey(project.id) === idKey(p.projectId),
                  )?.name ?? t("Practice")}{" "}
                  · {number(p.score?.answered ?? 0)}
                </Button>
              ))
            }
          </Load>
        </Panel>
        <div>
          {selectedPractice ? (
            <Load query={detail}>
              {(practice) =>
                practice ? (
                  <>
                    <div className="study-toolbar mb-4">
                      <h2 className="study-grow">{t("Practice")}</h2>
                      <Button
                        variant="outline"
                        onClick={() => setResults((r) => !r)}
                      >
                        {t("PracticeResults")}
                      </Button>
                      <DeleteButton
                        key={idKey(practice.id)}
                        label="DeletePractice"
                        alert="AlertDeletePractice"
                        confirm="ConfirmDeletePractice"
                        onDelete={async () => {
                          await rpc.deletePractice(practice.id!);
                          if (selectedRef.current === idKey(practice.id))
                            navigate("Practice");
                        }}
                      />
                    </div>
                    <Panel title={t("PracticeResults")}>
                      <div className="study-toolbar">
                        <span>
                          {t("YourAnswer")}:{" "}
                          {number(practice.score?.answered ?? 0)}/
                          {number(practice.score?.asked ?? 0)}
                        </span>
                        <span className="text-success-foreground">
                          {t("VerdictCorrect")}:{" "}
                          {number(practice.score?.correct ?? 0)}
                        </span>
                        <span>
                          {t("VerdictPartly")}:{" "}
                          {number(practice.score?.partly ?? 0)}
                        </span>
                        <span>
                          {t("VerdictIncorrect")}:{" "}
                          {number(practice.score?.incorrect ?? 0)}
                        </span>
                      </div>
                    </Panel>
                    <div className="space-y-4 mt-4">
                      {results ? (
                        practice.questions
                          .filter((q) => q.status === QuestionStatus.GRADED)
                          .map((q) => (
                            <Question
                              key={idKey(q.id)}
                              question={q}
                              navigate={navigate}
                            />
                          ))
                      ) : current ? (
                        <Question
                          key={idKey(current.id)}
                          question={current}
                          navigate={navigate}
                          onNext={advance}
                          ahead={ahead}
                          nextPending={action.isPending}
                        />
                      ) : (
                        <>
                          <Empty label="PracticeNothingToAsk" />
                          <Button
                            variant="outline"
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate(() =>
                                rpc.projectPractice(practice.projectId!),
                              )
                            }
                          >
                            {t("NextQuestion")}
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <Empty label="PracticeNoResults" />
                )
              }
            </Load>
          ) : (
            <Empty label="PracticeDescription" />
          )}
        </div>
      </div>
    </>
  );
}
export function Question({
  question,
  navigate,
  onNext,
  ahead,
  nextPending = false,
}: {
  question: PracticeQuestion;
  navigate: Navigate;
  onNext?: () => void;
  ahead?: PracticeQuestion;
  nextPending?: boolean;
}) {
  const focus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focus.current?.focus();
  }, []);
  const citationProps = {
    citations: question.citations,
    onSource: (id: string, anchor?: import("../generated/study_pb").Anchor) =>
      navigate("MediaList", id, undefined, anchor),
  };
  const { t } = useI18n();
  const body = question.written?.body?.kind;
  const [choice, setChoice] = useState<number>();
  const [text, setText] = useState("");
  const [added, setAdded] = useState(false);
  const action = useAction<unknown>();
  const answered = !!question.answer?.kind.case;
  const submit = () =>
    action.mutate(() =>
      rpc.answerQuestion({
        id: question.id,
        answer: {
          kind:
            body?.case === "choice"
              ? { case: "choice", value: choice! }
              : { case: "open", value: text },
        },
      }),
    );
  useShortcut((event) => {
    if (
      answered &&
      !nextPending &&
      question.verdict !== undefined &&
      event.key === "Enter" &&
      !(
        event.target instanceof Element &&
        event.target.matches("button,input,textarea,select")
      )
    ) {
      event.preventDefault();
      onNext?.();
      return;
    }
    if (
      (event.target instanceof Element &&
        event.target.matches("input,textarea,select")) ||
      answered
    )
      return;
    if (body?.case === "choice" && /^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < body.value.choices.length) setChoice(index);
    }
    if (
      event.key === "Enter" &&
      (body?.case === "choice" ? choice !== undefined : !!text.trim())
    )
      submit();
  }, focus);
  if (!body?.case)
    return (
      <div ref={focus} tabIndex={0} className="outline-none">
        <Panel>
          <Empty label={practiceWorkLabel(question, false)} />
          {question.job && (
            <JobRecovery
              job={question.job}
              onSettings={() => navigate("Settings")}
            />
          )}
        </Panel>
      </div>
    );
  return (
    <div ref={focus} tabIndex={0} className="outline-none">
      <Panel title={question.written?.gist}>
        <Markdown {...citationProps} text={body.value.question} />
        {body.case === "choice" ? (
          <fieldset
            className="space-y-2 mt-4"
            disabled={answered || action.isPending}
          >
            <legend className="sr-only">{t("QuestionChoice")}</legend>
            {body.value.choices.map((value, index) => (
              <label key={index} className="study-row cursor-pointer">
                <input
                  type="radio"
                  name={idKey(question.id)}
                  checked={
                    (answered && question.answer?.kind.case === "choice"
                      ? question.answer.kind.value
                      : choice) === index
                  }
                  onChange={() => setChoice(index)}
                />
                <span>
                  {index + 1}. {value}
                </span>
                {answered && body.value.answer === index && (
                  <span className="text-success-foreground">
                    {t("RightAnswer")}
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="mt-3">
            <Textarea
              aria-label={t("YourAnswer")}
              placeholder={t("AnswerPlaceholder")}
              value={
                answered && question.answer?.kind.case === "open"
                  ? question.answer.kind.value
                  : text
              }
              disabled={answered || action.isPending}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        {!answered ? (
          <Button
            className="mt-4"
            disabled={
              action.isPending ||
              (body.case === "choice" ? choice === undefined : !text.trim())
            }
            onClick={submit}
          >
            {t("SubmitAnswer")}
          </Button>
        ) : (
          <div className="mt-4 space-y-3">
            {question.verdict !== undefined ? (
              <>
                <strong>
                  {t(
                    question.verdict === Verdict.CORRECT
                      ? "VerdictCorrect"
                      : question.verdict === Verdict.PARTLY
                        ? "VerdictPartly"
                        : "VerdictIncorrect",
                  )}
                </strong>
                <Markdown
                  {...citationProps}
                  text={
                    question.feedback ??
                    (body.case === "choice"
                      ? body.value.explanation
                      : body.value.reference)
                  }
                />
                <Button
                  variant="outline"
                  disabled={added || action.isPending}
                  onClick={() =>
                    action.mutate(async () => {
                      await rpc.addToFlashcards({
                        question: question.id,
                        title: question.written?.gist ?? t("Flashcards"),
                      });
                      setAdded(true);
                    })
                  }
                >
                  {t(added ? "AddedToFlashcards" : "AddToFlashcards")}
                </Button>
              </>
            ) : (
              <p role="status">{t(practiceWorkLabel(question, true))}</p>
            )}
          </div>
        )}
        {onNext && question.status === QuestionStatus.GRADED && (
          <div className="mt-4 space-y-3">
            <Button disabled={nextPending} onClick={onNext}>
              {t(nextPending ? "WritingQuestion" : "NextQuestion")}
            </Button>
            {ahead?.job && (
              <section aria-label={t("NextQuestion")}>
                <JobRecovery
                  job={ahead.job}
                  onSettings={() => navigate("Settings")}
                />
              </section>
            )}
          </div>
        )}
        <Pending error={action.error} />
        {question.job && (
          <JobRecovery
            job={question.job}
            onSettings={() => navigate("Settings")}
          />
        )}
        <Citations
          items={question.citations}
          onSource={(id, anchor) =>
            navigate("MediaList", id, undefined, anchor)
          }
        />
      </Panel>
    </div>
  );
}

function practiceWorkLabel(question: PracticeQuestion, grading: boolean) {
  if (jobStopped(question.job)) return "StatusFailed";
  if (
    question.job &&
    [JobStatus.BLOCKED, JobStatus.WAITING].includes(question.job.status)
  )
    return "StatusWaiting";
  return grading ? "CheckingAnswer" : "WritingQuestion";
}
