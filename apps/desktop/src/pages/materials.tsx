import { DiagramCanvas } from "./diagram-canvas";
import { useState, useEffect, useId, useRef } from "react";
import { rpc } from "../rpc/client";
import { saveFile } from "../rpc/native";
import {
  ArtifactKind,
  ArtifactStatus,
  Rating,
  type Artifact,
  type ProjectId,
  type Flashcard,
  type DueCard,
} from "../generated/study_pb";
import { useI18n } from "../i18n";
import {
  Button,
  Textarea,
  Field,
  Modal,
  DeleteButton,
  Panel,
  Pending,
  Load,
  Empty,
  Markdown,
  Citations,
  JobLine,
  JobRecovery,
  jobActive,
  jobStopped,
  useData,
  useAction,
  useProjects,
  idKey,
  sameId,
  useShortcut,
} from "../components";
import { type Navigate } from "./projects";
export function MaterialsPage({
  kind,
  projectFilter,
  selected,
  navigate,
}: {
  kind: ArtifactKind;
  projectFilter?: string;
  selected?: string;
  navigate: Navigate;
}) {
  const { t, number } = useI18n();
  const projects = useProjects();
  const [projectKey, setProjectKey] = useState(projectFilter ?? "");
  const [reviewing, setReviewing] = useState(selected === "review");
  const [reviewProjectKey, setReviewProjectKey] = useState(
    selected === "review" ? (projectFilter ?? "") : "",
  );
  const action = useAction<unknown>();
  const project = projects.data?.find((p) => idKey(p.id) === projectKey)?.id;
  const reviewProject = projects.data?.find(
    (p) => idKey(p.id) === reviewProjectKey,
  )?.id;
  const reviewScopeReady = !reviewProjectKey || !!reviewProject;
  const selectedArtifact = useData(
    ["selected-artifact", selected],
    async () => (await rpc.artifact({ value: BigInt(selected!) })).value,
    !!selected && selected !== "review",
  );
  const materials = useData(
    ["materials", projectKey],
    async () => (project ? (await rpc.material(project)).items : []),
    !!project,
  );
  const due = useData(["due-count", projectKey], () =>
    rpc.dueCount({ project }),
  );
  const globalDue = useData(["due-count", "all"], () => rpc.dueCount({}));
  const progressKey = reviewing ? reviewProjectKey : projectKey;
  const progressProject = reviewing ? reviewProject : project;
  const progressScope =
    projects.data?.find((item) => sameId(item.id, progressProject))?.name ??
    t("AllProjects");
  const progress = useData(
    ["review-progress", progressKey || "all"],
    async () => {
      const now = Math.floor(Date.now() / 1000);
      const [reviews, future] = await Promise.all([
        rpc.reviewTimes({
          project: progressProject,
          since: BigInt(now - 7 * 86400),
        }),
        rpc.dueBy({ project: progressProject, until: BigInt(now + 7 * 86400) }),
      ]);
      return { reviews: reviews.items, future: future.value };
    },
    !progressKey || !!progressProject,
  );
  const offered = useData(
    ["can-material", projectKey, kind],
    () => rpc.canUpdateMaterial({ project, kind }),
    !!project,
  );
  const piece = materials.data?.find(
    (m) =>
      (m.current ?? m.update)?.kind === kind &&
      !(m.current ?? m.update)?.mistakes,
  );
  const artifact = piece?.current ?? piece?.update;
  const updating = jobActive(piece?.update?.job);
  const failed = jobStopped(piece?.update?.job);
  const changes = useData(
    ["material-changes", idKey(artifact?.id)],
    async () => (await rpc.materialChanges(artifact!.id!)).value,
    !!artifact,
  );
  const status = failed
    ? piece?.current
      ? "MaterialUpdateFailed"
      : "MaterialWriteFailed"
    : piece?.update
      ? piece.current
        ? "MaterialUpdating"
        : "WritingMaterial"
      : changes.data && (changes.data.files > 0 || changes.data.notes > 0)
        ? "UpdateMaterial"
        : "MaterialUpToDate";
  const mistakes =
    materials.data?.flatMap((m) =>
      m.current?.mistakes && m.current.kind === kind ? [m.current] : [],
    ) ?? [];
  useEffect(() => {
    if (projectFilter !== undefined) setProjectKey(projectFilter);
  }, [projectFilter]);
  useEffect(() => {
    if (projects.data)
      setProjectKey((current) =>
        projects.data.some((project) => idKey(project.id) === current)
          ? current
          : idKey(projects.data[0]?.id),
      );
  }, [projects.data]);
  useEffect(() => {
    if (selected === "review") {
      setReviewing(true);
      setReviewProjectKey(projectFilter ?? "");
    }
  }, [selected, projectFilter]);
  useEffect(() => {
    const chosen = selectedArtifact.data;
    if (chosen) {
      setProjectKey(idKey(chosen.projectId));
      setReviewing(false);
    }
  }, [
    selectedArtifact.data?.id?.value,
    selectedArtifact.data?.projectId?.value,
  ]);
  return (
    <div className="study-split">
      <Panel>
        {kind === ArtifactKind.FLASHCARDS && (
          <Button
            className="w-full justify-start mb-2"
            variant={reviewing && !reviewProjectKey ? "secondary" : "ghost"}
            onClick={() => {
              setReviewProjectKey("");
              setReviewing(true);
            }}
          >
            {t("ReviewDue")} · {number(globalDue.data?.value ?? 0n)}
          </Button>
        )}
        {projects.data?.map((p) => (
          <Button
            key={idKey(p.id)}
            className="w-full justify-start mb-1"
            variant={
              !reviewing && sameId(project, p.id) ? "secondary" : "ghost"
            }
            onClick={() => {
              setProjectKey(idKey(p.id));
              setReviewing(false);
            }}
          >
            {p.name}
          </Button>
        ))}
        {!projects.data?.length && <Empty label="NoProjectsYet" />}
      </Panel>
      <div className="space-y-5">
        <Pending
          error={action.error ?? selectedArtifact.error}
          pending={action.isPending}
        />
        {reviewing ? (
          <>
            <select
              className="study-select"
              aria-label={t("ReviewsByProject")}
              value={reviewProjectKey}
              onChange={(e) => setReviewProjectKey(e.target.value)}
            >
              {!reviewScopeReady && (
                <option value={reviewProjectKey} disabled>
                  {t(projects.isPending ? "LoadingStudy" : "ProblemGone")}
                </option>
              )}
              <option value="">{t("AllProjects")}</option>
              {projects.data?.map((p) => (
                <option key={idKey(p.id)} value={idKey(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
            {reviewScopeReady ? (
              <Reviews
                key={reviewProjectKey}
                project={reviewProject}
                navigate={navigate}
                onDone={() => setReviewing(false)}
              />
            ) : (
              <Load query={projects}>
                {() => <Empty label="ProblemGone" />}
              </Load>
            )}
          </>
        ) : (
          <>
            <div className="study-toolbar">
              <h2 className="study-grow">
                {projects.data?.find((p) => sameId(p.id, project))?.name ??
                  t(
                    kind === ArtifactKind.FLASHCARDS
                      ? "Flashcards"
                      : "Diagrams",
                  )}
              </h2>
              {kind === ArtifactKind.FLASHCARDS && project && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setReviewProjectKey(projectKey);
                    setReviewing(true);
                  }}
                >
                  {t("StartReview")} · {number(due.data?.value ?? 0n)}
                </Button>
              )}
              <Button
                disabled={
                  !project ||
                  !offered.data?.value ||
                  action.isPending ||
                  updating
                }
                onClick={() =>
                  action.mutate(() => rpc.updateMaterial({ project, kind }))
                }
              >
                {t(piece?.current ? "UpdateMaterial" : "MakeMaterial")}
              </Button>
            </div>
            {project ? (
              <Load query={materials}>
                {() => (
                  <>
                    {artifact ? (
                      <>
                        <p className="study-muted">
                          {t(status)}
                          {changes.data && (
                            <span>
                              {" "}
                              · {number(changes.data.files)} {t("SearchFiles")}{" "}
                              · {number(changes.data.notes)}{" "}
                              {t("SearchMessages")}
                            </span>
                          )}
                        </p>
                        {piece?.update?.job && (
                          <JobRecovery
                            job={piece.update.job}
                            onSettings={() => navigate("Settings")}
                          />
                        )}
                        <ArtifactView
                          key={idKey(artifact.id)}
                          artifact={artifact}
                          navigate={navigate}
                        />
                      </>
                    ) : (
                      <Empty label="MaterialNotMade" />
                    )}
                    {mistakes.map((deck) => (
                      <ArtifactView
                        key={idKey(deck.id)}
                        artifact={deck}
                        navigate={navigate}
                      />
                    ))}
                  </>
                )}
              </Load>
            ) : (
              <Empty label="NoProjectsYet" />
            )}
          </>
        )}
        {kind === ArtifactKind.FLASHCARDS &&
          (!progressKey || !!progressProject) && (
            <Panel title={`${t("ReviewProgress")} · ${progressScope}`}>
              <div className="study-toolbar">
                <span>
                  {number(progress.data?.reviews.length ?? 0)} ·{" "}
                  {t("ProgressCompleted")}
                </span>
                <span className="study-grow" />
                <span>
                  {number(progress.data?.future ?? 0n)} ·{" "}
                  {t("ProgressComingUp")}
                </span>
              </div>
            </Panel>
          )}
      </div>
    </div>
  );
}
export function exportedArtifact(artifact: Artifact) {
  const body = artifact.body?.kind;
  if (body?.case === "mermaid") return body.value;
  if (body?.case === "flashcards")
    return body.value.cards
      .map(
        (c) =>
          `${c.front.replace(/\s+/g, " ").trim()}\t${c.back.replace(/\s+/g, " ").trim()}`,
      )
      .join("\n");
  return "";
}
function ArtifactView({
  artifact,
  navigate,
}: {
  artifact: Artifact;
  navigate: Navigate;
}) {
  const focus = useRef<HTMLDivElement>(null);
  const citationProps = {
    citations: artifact.citations,
    onSource: (id: string, anchor?: import("../generated/study_pb").Anchor) =>
      navigate("MediaList", id, undefined, anchor),
  };
  const { t } = useI18n();
  const action = useAction<unknown>();
  const [edit, setEdit] = useState<{ index: number; card?: Flashcard }>();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [all, setAll] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const body = artifact.body?.kind;
  useEffect(() => {
    if (
      body?.case === "flashcards" &&
      ![...document.querySelectorAll("[data-card-deck]")].some((element) =>
        element.contains(document.activeElement),
      ) &&
      !document.querySelector("[data-shortcut-modal=true]")
    )
      focus.current?.focus();
  }, [artifact.id?.value, body?.case]);
  const cards = body?.case === "flashcards" ? body.value.cards : [];
  const shown = cards[Math.min(index, Math.max(cards.length - 1, 0))];
  const openEdit = (at: number) => {
    setEdit({ index: at, card: cards[at] });
    setFront(cards[at]?.front ?? "");
    setBack(cards[at]?.back ?? "");
  };
  useShortcut((event) => {
    if (
      (event.target instanceof Element &&
        event.target.matches("input,textarea,select")) ||
      edit ||
      all
    )
      return;
    if (event.key === "ArrowRight") {
      setIndex((i) => Math.min(cards.length - 1, i + 1));
      setFlipped(false);
    }
    if (event.key === "ArrowLeft") {
      setIndex((i) => Math.max(0, i - 1));
      setFlipped(false);
    }
    if (event.code === "Space" && shown) {
      event.preventDefault();
      setFlipped((f) => !f);
    }
  }, focus);
  return (
    <div
      ref={focus}
      data-card-deck
      role="region"
      aria-label={artifact.title || t("UntitledMaterial")}
      tabIndex={0}
      className="outline-none"
    >
      <Panel
        title={artifact.title || t("UntitledMaterial")}
        actions={
          <div className="study-toolbar">
            <Button
              variant="ghost"
              size="sm"
              disabled={!body?.case}
              onClick={() =>
                action.mutate(() =>
                  navigator.clipboard.writeText(exportedArtifact(artifact)),
                )
              }
            >
              {t("CopyMaterial")}
            </Button>
            {body?.case !== "mermaid" && (
              <Button
                variant="outline"
                size="sm"
                disabled={!body?.case}
                onClick={() =>
                  action.mutate(() =>
                    saveFile(
                      `${artifact.title || "Study"}.tsv`,
                      new TextEncoder().encode(exportedArtifact(artifact)),
                      "text/plain",
                    ),
                  )
                }
              >
                {t("SaveForAnki")}
              </Button>
            )}
            <DeleteButton
              label="DeleteMaterial"
              alert="AlertDeleteMaterial"
              confirm="ConfirmDeleteMaterial"
              onDelete={() =>
                artifact.mistakes
                  ? rpc.deleteArtifact(artifact.id!)
                  : rpc.deleteMaterial({
                      project: artifact.projectId,
                      kind: artifact.kind,
                    })
              }
            />
          </div>
        }
      >
        <Pending error={action.error} />
        {!body?.case ? (
          <>
            <Empty
              label={
                artifact.status === ArtifactStatus.WRITING
                  ? "WritingMaterial"
                  : "MaterialNotMade"
              }
            />
            {artifact.job && <JobLine job={artifact.job} />}
          </>
        ) : body.case === "mermaid" ? (
          <Diagram text={body.value} />
        ) : (
          <>
            <div className="study-toolbar">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAll((v) => !v)}
              >
                {t(all ? "FlashcardsHideAll" : "FlashcardsShowAll")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEdit(cards.length)}
              >
                {t("AddCard")}
              </Button>
              <span className="study-grow" />
              {index + 1}/{cards.length}
            </div>
            {all ? (
              <div className="study-grid mt-4">
                {cards.map((card, at) => (
                  <div key={at} className="study-panel">
                    <Markdown {...citationProps} text={card.front} />
                    <hr className="my-3 border-border" />
                    <Markdown {...citationProps} text={card.back} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(at)}
                    >
                      {t("EditCard")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : shown ? (
              <>
                <div
                  className="study-card-face w-full p-5"
                  onClick={(event) => {
                    if (
                      !(event.target instanceof Element) ||
                      !event.target.closest("a,button")
                    )
                      setFlipped((value) => !value);
                  }}
                >
                  <Markdown
                    {...citationProps}
                    text={flipped ? shown.back : shown.front}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => setFlipped((value) => !value)}
                  >
                    {t(flipped ? "HideAnswer" : "ShowAnswer")}
                  </Button>
                  <span className="study-muted">{t("CardTapToReveal")}</span>
                </div>
                <div className="study-toolbar">
                  <Button
                    variant="outline"
                    disabled={index === 0}
                    onClick={() => {
                      setIndex((i) => i - 1);
                      setFlipped(false);
                    }}
                  >
                    {t("PreviousCard")}
                  </Button>
                  <Button variant="ghost" onClick={() => openEdit(index)}>
                    {t("EditCard")}
                  </Button>
                  <span className="study-grow" />
                  <Button
                    variant="outline"
                    disabled={index >= cards.length - 1}
                    onClick={() => {
                      setIndex((i) => i + 1);
                      setFlipped(false);
                    }}
                  >
                    {t("NextCard")}
                  </Button>
                </div>
              </>
            ) : (
              <Empty label="MaterialNotMade" />
            )}
          </>
        )}
        <Citations
          items={artifact.citations}
          onSource={(id, anchor) =>
            navigate("MediaList", id, undefined, anchor)
          }
        />
        <Modal
          open={!!edit}
          onClose={() => setEdit(undefined)}
          title={edit?.card ? "EditCard" : "AddCard"}
          footer={
            <>
              <Button
                disabled={!front.trim() || !back.trim() || action.isPending}
                onClick={() =>
                  action.mutate(async () => {
                    await rpc.setCard({
                      artifact: artifact.id,
                      index: BigInt(edit!.index),
                      change: { case: "write", value: { front, back } },
                    });
                    setEdit(undefined);
                  })
                }
              >
                {t("SaveCard")}
              </Button>
              {edit?.card && (
                <DeleteButton
                  label="DeleteCard"
                  alert="AlertDeleteCard"
                  confirm="ConfirmDeleteCard"
                  onDelete={async () => {
                    await rpc.setCard({
                      artifact: artifact.id,
                      index: BigInt(edit.index),
                      change: { case: "delete", value: {} },
                    });
                    setEdit(undefined);
                    setIndex(0);
                  }}
                />
              )}
            </>
          }
        >
          <Field label="CardFront">
            <Textarea
              value={front}
              onChange={(e) => setFront(e.target.value)}
            />
          </Field>
          <Field label="CardBack">
            <Textarea value={back} onChange={(e) => setBack(e.target.value)} />
          </Field>
          <Pending error={action.error} />
        </Modal>
      </Panel>
    </div>
  );
}
export function Diagram({ text }: { text: string }) {
  const id = useId()
    .replaceAll(":", "")
    .replaceAll("«", "")
    .replaceAll("»", "");
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let stale = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          look: "handDrawn",
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "neutral",
        });
        return mermaid.render(`diagram${id}`, text);
      })
      .then(({ svg }) => {
        if (!stale) {
          setSvg(svg);
          setError(undefined);
        }
      })
      .catch((e) => {
        if (!stale) setError(String(e));
      });
    return () => {
      stale = true;
    };
  }, [text, id]);
  return error ? (
    <div className="study-error" role="alert">
      {error}
      <pre>{text}</pre>
    </div>
  ) : svg ? (
    <DiagramCanvas svg={svg} />
  ) : (
    <Empty label="DrawingDiagram" />
  );
}

export function Reviews({
  project,
  onDone,
  navigate,
}: {
  project?: ProjectId;
  navigate?: Navigate;
  onDone: () => void;
}) {
  const focus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focus.current?.focus();
  }, []);
  const { t, number } = useI18n();
  const due = useData(
    ["due-cards", idKey(project)],
    async () => (await rpc.dueCards({ project, limit: 100n })).items,
  );
  const [active, setActive] = useState<DueCard>();
  const [revealedCard, setRevealedCard] = useState<string>();
  const ratingPending = useRef(false);
  const [done, setDone] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const action = useAction<unknown>();
  const available = due.data?.filter((c) => !reviewed.has(idKey(c.card?.id)));
  // A live due-list refresh must not replace the card the student is reading.
  const current =
    active && available?.some((c) => sameId(c.card?.id, active.card?.id))
      ? active
      : available?.[0];
  const currentKey = idKey(current?.card?.id);
  const revealed = !!currentKey && revealedCard === currentKey;
  useEffect(() => {
    setActive(current);
    setRevealedCard(undefined);
  }, [currentKey]);
  const reveal = () => {
    if (!currentKey || action.isPending || ratingPending.current) return;
    setRevealedCard(currentKey);
    focus.current?.focus();
  };
  const cited = useData(
    ["review-artifact", idKey(current?.card?.artifactId)],
    async () => (await rpc.artifact(current!.card!.artifactId!)).value,
    !!current?.card?.artifactId,
  );
  const citationProps = {
    citations: cited.data?.citations,
    onSource: (id: string, anchor?: import("../generated/study_pb").Anchor) =>
      navigate?.("MediaList", id, undefined, anchor),
  };
  const rate = (rating: Rating) => {
    if (
      !revealed ||
      !current?.card?.id ||
      action.isPending ||
      ratingPending.current
    )
      return;
    const card = current.card.id;
    ratingPending.current = true;
    action.mutate(
      async () => {
        await rpc.review({ card, rating });
        setReviewed((v) => new Set([...v, idKey(card)]));
        setDone((n) => n + 1);
        setRevealedCard(undefined);
      },
      {
        onSettled: () => {
          ratingPending.current = false;
        },
      },
    );
  };
  useShortcut((event) => {
    if (
      event.target instanceof Element &&
      event.target.matches("input,textarea,select")
    )
      return;
    if (event.code === "Space" || event.key === "Enter") {
      event.preventDefault();
      reveal();
    }
    if (revealed && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      rate(Number(event.key) as Rating);
    }
  }, focus);
  return (
    <div ref={focus} tabIndex={0} className="outline-none">
      <Panel
        title={t("ReviewDue")}
        actions={
          <Button variant="ghost" onClick={onDone}>
            {t("BackToFlashcards")}
          </Button>
        }
      >
        <Pending error={action.error} />
        <Load query={due}>
          {() =>
            current ? (
              <>
                <p className="study-muted">
                  {current.artifactTitle} · {number(done)}
                </p>
                <div className="study-card-face">
                  <Markdown
                    {...citationProps}
                    text={current.card?.front ?? ""}
                  />
                  {revealed && (
                    <Markdown
                      {...citationProps}
                      text={current.card?.back ?? ""}
                    />
                  )}
                </div>
                {revealed ? (
                  <div className="study-toolbar justify-center">
                    {(
                      [
                        Rating.AGAIN,
                        Rating.HARD,
                        Rating.GOOD,
                        Rating.EASY,
                      ] as const
                    ).map((rating, i) => (
                      <Button
                        key={rating}
                        variant={rating === Rating.GOOD ? "default" : "outline"}
                        disabled={action.isPending}
                        onClick={() => rate(rating)}
                      >
                        {i + 1} ·{" "}
                        {t(
                          (
                            [
                              "RateAgain",
                              "RateHard",
                              "RateGood",
                              "RateEasy",
                            ] as const
                          )[i],
                        )}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    disabled={action.isPending}
                    onClick={reveal}
                  >
                    {t("ShowAnswer")}
                  </Button>
                )}
                <p className="study-muted mt-4">{t("ReviewKeysHint")}</p>
              </>
            ) : (
              <>
                <Empty label={done ? "ReviewDone" : "NothingDue"} />
                <Button variant="outline" onClick={onDone}>
                  {t("BackToFlashcards")}
                </Button>
              </>
            )
          }
        </Load>
      </Panel>
    </div>
  );
}
