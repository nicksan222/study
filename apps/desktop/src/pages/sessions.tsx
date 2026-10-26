import { create } from "@bufbuild/protobuf";
import {
  useComposerDraft,
  useSessionDraftStore,
} from "../hooks/session-drafts";
import { useRecording, canRecordNatively } from "../hooks/recording";
import { useState, useEffect, useRef } from "react";
import { Plus, Paperclip, Send, Mic, Square, X } from "lucide-react";
import { rpc } from "../rpc/client";
import { pickFiles } from "../rpc/native";
import {
  type ChatMessage,
  type SessionId,
  type PartId,
  type ProjectId,
  type Recording,
  MessageRole,
  MessageStatus,
  AnchorSchema,
  VersionOrigin,
} from "../generated/study_pb";
import { useI18n } from "../i18n";
import {
  Button,
  Input,
  Textarea,
  Field,
  Modal,
  DeleteButton,
  Panel,
  ProjectSelect,
  Pending,
  Load,
  Empty,
  Markdown,
  Citations,
  JobLine,
  JobRecovery,
  jobActive,
  useData,
  useAction,
  useProjects,
  idKey,
  sameId,
} from "../components";
import { stageFiles, useNativeDrop } from "../rpc/files";
import { type Navigate } from "./projects";
export function activeText(message: ChatMessage) {
  return (
    (
      message.versions.find((v) => sameId(v.id, message.activeVersion)) ??
      message.versions.at(-1)
    )?.text ?? ""
  );
}
export function SessionsPage({
  selected,
  navigate,
  projectFilter,
}: {
  selected?: string;
  navigate: Navigate;
  projectFilter?: string;
}) {
  const drafts = useSessionDraftStore();
  const { t } = useI18n();
  const projects = useProjects();
  const sessions = useData(
    ["sessions"],
    async () => (await rpc.allSessions({})).items,
  );
  useEffect(() => {
    if (sessions.data)
      void drafts
        ?.keepSessions(
          new Set(sessions.data.map((session) => idKey(session.id))),
        )
        .catch(() => {});
  }, [drafts, sessions.data]);
  const action = useAction<unknown>();
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<ProjectId | undefined>();
  const [title, setTitle] = useState("");
  const current = sessions.data?.find((s) => idKey(s.id) === selected);
  const filtered =
    sessions.data?.filter(
      (s) => !projectFilter || idKey(s.projectId) === projectFilter,
    ) ?? [];
  const openCreate = () => {
    setProject(
      projects.data?.find((p) => idKey(p.id) === projectFilter)?.id ??
        projects.data?.[0]?.id,
    );
    setTitle("");
    setCreating(true);
  };
  return (
    <>
      <div className="study-toolbar">
        <Button onClick={openCreate} disabled={!projects.data?.length}>
          <Plus />
          {t("NewSession")}
        </Button>
        {!projects.data?.length && (
          <Button variant="link" onClick={() => navigate("Projects")}>
            {t("GoToProjects")}
          </Button>
        )}
      </div>
      <div className="study-split">
        <Panel>
          <Load query={sessions}>
            {() =>
              filtered.length ? (
                filtered.map((session) => (
                  <Button
                    className="w-full justify-start mb-1"
                    key={idKey(session.id)}
                    variant={
                      sameId(session.id, current?.id) ? "secondary" : "ghost"
                    }
                    onClick={() => navigate("Sessions", idKey(session.id))}
                  >
                    {session.title}
                  </Button>
                ))
              ) : (
                <Empty label="DashboardNoSessions" />
              )
            }
          </Load>
        </Panel>
        {current ? (
          <Conversation
            key={idKey(current.id)}
            session={current.id!}
            title={current.title}
            project={current.projectId!}
            navigate={navigate}
            onDeleted={() => navigate("Sessions")}
          />
        ) : (
          <Empty label="StartSessionDescription" />
        )}
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="NewSession"
        footer={
          <Button
            disabled={!project || action.isPending}
            onClick={() =>
              action.mutate(async () => {
                const session = title.trim()
                  ? await rpc.createSession({ project, title })
                  : await rpc.createUntitledSession({
                      project,
                      title: t("NewSession"),
                    });
                setCreating(false);
                navigate("Sessions", idKey(session.id));
              })
            }
          >
            {t("StartSession")}
          </Button>
        }
      >
        <Field label="ChooseProject">
          <ProjectSelect
            projects={projects.data ?? []}
            value={project}
            onChange={setProject}
            required
          />
        </Field>
        <Field label="NewSession">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("NewSession")}
          />
        </Field>
        <Pending error={action.error} />
      </Modal>
    </>
  );
}
function Conversation({
  session,
  title,
  project,
  navigate,
  onDeleted,
}: {
  session: SessionId;
  title: string;
  project: ProjectId;
  navigate: Navigate;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const recording = useRecording();
  const drafts = useSessionDraftStore();
  const action = useAction<unknown>();
  const messages = useData(
    ["messages", idKey(session)],
    async () => (await rpc.messages(session)).items,
    true,
    1500,
  );
  const [thread, setThread] = useState<PartId | undefined>();
  const threadQuery = useData(
    ["thread", idKey(thread)],
    async () => (await rpc.thread(thread!)).value,
    !!thread,
    1500,
  );
  const bottom = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow)
      bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.data?.length, follow]);
  return (
    <div className="space-y-4 min-w-0">
      <div className="study-toolbar">
        <h2 className="study-grow">{title}</h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={action.isPending}
          onClick={() => action.mutate(() => rpc.regenerateTitle(session))}
        >
          {t("RegenerateTitle")}
        </Button>
        {recording.protectsSession(idKey(session)) ? (
          <Button variant="ghost-destructive" size="sm" disabled>
            {t("DeleteSession")}
          </Button>
        ) : (
          <DeleteButton
            label="DeleteSession"
            alert="AlertDeleteSession"
            confirm="ConfirmDeleteSession"
            onDelete={async () => {
              if (recording.protectsSession(idKey(session))) return;
              await rpc.deleteSession(session);
              await drafts?.discardSession(idKey(session));
              onDeleted();
            }}
          />
        )}
      </div>
      <Pending error={action.error} />
      <Load query={messages}>
        {(items) =>
          items.length ? (
            items.map((message) => (
              <MessageView
                key={idKey(message.id)}
                message={message}
                onThread={setThread}
                navigate={navigate}
              />
            ))
          ) : (
            <Empty label="SessionEmptyHint" />
          )
        }
      </Load>
      <div ref={bottom} />
      <Composer
        session={session}
        dropEnabled={!thread}
        onSent={() => setFollow(true)}
      />
      <Recordings session={session} project={project} />
      <Modal
        open={!!thread}
        onClose={() => setThread(undefined)}
        title="ThreadTitle"
      >
        <Load query={threadQuery}>
          {(value) =>
            value ? (
              <div className="space-y-4">
                <h3>{value.root?.content?.name}</h3>
                {value.root?.document?.blocks.map((b, i) => (
                  <Markdown key={i} text={b.text} />
                ))}
                {value.replies.map((message) => (
                  <MessageView
                    key={idKey(message.id)}
                    message={message}
                    navigate={navigate}
                    onThread={setThread}
                  />
                ))}
                <Composer session={session} thread={thread} />
              </div>
            ) : (
              <Empty label="ThreadLoadError" />
            )
          }
        </Load>
      </Modal>
    </div>
  );
}
export function MessageView({
  message,
  onThread,
  navigate,
}: {
  message: ChatMessage;
  onThread: (id: PartId) => void;
  navigate: Navigate;
}) {
  const { t, date } = useI18n();
  const action = useAction<unknown>();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState("");
  const [rewrite, setRewrite] = useState(false);
  const [instruction, setInstruction] = useState("");
  const current =
    message.versions.find((v) => sameId(v.id, message.activeVersion)) ??
    message.versions.at(-1);
  const busy =
    message.versions.some((v) => v.status !== MessageStatus.COMPLETE) &&
    jobActive(message.reply);
  const rewriteMessage = (how: "improve" | "summarize" | "instruction") =>
    action.mutate(async () => {
      const result = await rpc.rewriteMessage({
        id: message.id,
        how:
          how === "instruction"
            ? { case: "instruction", value: instruction }
            : { case: how, value: {} },
      });
      if (result.result.case === "unavailable")
        throw new Error(t("RewriteUnavailable"));
      if (result.result.case === "busy") throw new Error(t("RewriteBusy"));
      setRewrite(false);
    });
  const origins = {
    [VersionOrigin.UNSPECIFIED]: "VersionOriginTyped",
    [VersionOrigin.TYPED]: "VersionOriginTyped",
    [VersionOrigin.EDITED]: "VersionOriginEdited",
    [VersionOrigin.ANSWER]: "VersionOriginAnswer",
    [VersionOrigin.IMPROVE]: "VersionOriginImproved",
    [VersionOrigin.SUMMARIZE]: "VersionOriginSummarized",
    [VersionOrigin.INSTRUCTION]: "RewriteInstruction",
  } as const;
  return (
    <article
      className="study-message space-y-3"
      data-role={message.role === MessageRole.USER ? "user" : "assistant"}
    >
      <div className="study-toolbar study-muted">
        <span>
          {message.role === MessageRole.ASSISTANT
            ? t("AnswerAuthor")
            : date(message.createdAt)}
        </span>
        {message.recordingMs !== undefined &&
          (message.recordedIn ? (
            <Button
              variant="link"
              size="sm"
              aria-label={t("OpenInLibrary")}
              onClick={() =>
                navigate(
                  "MediaList",
                  idKey(message.recordedIn),
                  undefined,
                  create(AnchorSchema, {
                    kind: {
                      case: "time",
                      value: {
                        startMs: message.recordingMs!,
                        endMs: message.recordingMs! + 1n,
                      },
                    },
                  }),
                )
              }
            >
              <Mic />
              {Math.round(Number(message.recordingMs) / 1000)}{" "}
              {t("UnitSeconds")}
            </Button>
          ) : (
            <span>
              <Mic className="inline size-3" />
              {Math.round(Number(message.recordingMs) / 1000)}{" "}
              {t("UnitSeconds")}
            </span>
          ))}
        <span className="study-grow" />
        {message.versions.length > 1 && (
          <select
            className="study-select"
            aria-label={t("VersionSwitcher")}
            value={idKey(current?.id)}
            disabled={action.isPending}
            onChange={(e) => {
              const version = message.versions.find(
                (v) => idKey(v.id) === e.target.value,
              )?.id;
              action.mutate(() =>
                rpc.setActiveVersion({ message: message.id, version }),
              );
            }}
          >
            {message.versions.map((v) => (
              <option key={idKey(v.id)} value={idKey(v.id)}>
                {v.number} · {t(origins[v.origin])}
              </option>
            ))}
          </select>
        )}
      </div>
      {edit ? (
        <>
          <Textarea
            aria-label={t("EditMessage")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="study-toolbar">
            <Button
              disabled={
                action.isPending || text === activeText(message) || !text.trim()
              }
              onClick={() =>
                action.mutate(async () => {
                  await rpc.editMessage({ id: message.id, text });
                  setEdit(false);
                })
              }
            >
              {t("Save")}
            </Button>
            <Button variant="ghost" onClick={() => setEdit(false)}>
              {t("Cancel")}
            </Button>
          </div>
        </>
      ) : (
        <Markdown
          text={activeText(message)}
          citations={message.citations}
          onSource={(id, anchor) =>
            navigate("MediaList", id, undefined, anchor)
          }
        />
      )}
      {message.parts.map((part) => (
        <div
          key={idKey(part.id)}
          className="rounded-lg border border-border p-3 space-y-2"
        >
          <div className="study-toolbar">
            <Button
              variant="link"
              disabled={!part.content?.sourceId}
              onClick={() =>
                navigate("MediaList", idKey(part.content?.sourceId))
              }
            >
              {part.content?.name ?? t("FileRemovedFromLibrary")}
            </Button>
            <span className="study-grow" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => onThread(part.id!)}
            >
              {t("ReplyInThread")}
              {part.thread?.replies ? ` · ${part.thread.replies}` : ""}
            </Button>
          </div>
          {part.document?.blocks.slice(0, 2).map((b, i) => (
            <Markdown key={i} text={b.text} />
          ))}
          {part.jobs.map((j) => (
            <div key={idKey(j.id)}>
              <JobLine job={j} />
            </div>
          ))}
        </div>
      ))}
      {busy && (
        <p role="status" className="study-muted">
          {t("VersionWriting")}
        </p>
      )}
      {message.reply && (
        <JobRecovery
          job={message.reply}
          stopLabel="StopVersion"
          onSettings={() => navigate("Settings")}
        />
      )}
      <Citations
        items={message.citations}
        onSource={(id, anchor) => navigate("MediaList", id, undefined, anchor)}
      />
      <div className="study-toolbar">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setText(activeText(message));
            setEdit(true);
          }}
        >
          {t("EditMessage")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || action.isPending}
          onClick={() =>
            action.mutate(async () => {
              const result = await rpc.reanswer(message.id!);
              if (result.result.case === "unavailable")
                throw new Error(t("RewriteUnavailable"));
              if (result.result.case === "busy")
                throw new Error(t("RewriteBusy"));
              return result;
            })
          }
        >
          {t("Regenerate")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setRewrite(true)}
        >
          {t("AiEdit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!activeText(message)}
          onClick={() =>
            action.mutate(() =>
              navigator.clipboard.writeText(activeText(message)),
            )
          }
        >
          {t("CopyText")}
        </Button>
        <DeleteButton
          label="DeleteMessage"
          alert="AlertDeleteMessage"
          confirm="ConfirmDeleteMessage"
          onDelete={() => rpc.deleteMessage(message.id!)}
        />
      </div>
      <Pending error={action.error} />
      <Modal open={rewrite} onClose={() => setRewrite(false)} title="AiEdit">
        <div className="study-toolbar">
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => rewriteMessage("improve")}
          >
            {t("RewriteImprove")}
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => rewriteMessage("summarize")}
          >
            {t("RewriteSummarize")}
          </Button>
        </div>
        <Field label="RewriteInstruction">
          <Textarea
            value={instruction}
            placeholder={t("RewriteInstructionPlaceholder")}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </Field>
        <Button
          disabled={!instruction.trim() || action.isPending}
          onClick={() => rewriteMessage("instruction")}
        >
          {t("RewriteRun")}
        </Button>
        <Pending error={action.error} />
      </Modal>
    </article>
  );
}
export function Composer({
  session,
  thread,
  onSent,
  dropEnabled = true,
}: {
  session: SessionId;
  thread?: PartId;
  onSent?: () => void;
  dropEnabled?: boolean;
}) {
  const { t } = useI18n();
  const draft = useComposerDraft(
    idKey(session),
    thread ? idKey(thread) : undefined,
  );
  const text = draft.text;
  const setText = (value: string | ((before: string) => string)) =>
    draft.setText(value);
  const attachments = draft.files;
  const files = attachments.paths;
  const action = useAction<unknown>();
  useNativeDrop(
    (paths) => action.mutate(() => attachments.add(paths)),
    dropEnabled && !action.isPending,
  );
  const send = () => {
    if ((!text.trim() && !attachments.paths.length) || action.isPending) return;
    const sendingText = text;
    const lease = attachments.retain();
    action.mutate(async () => {
      let posted = false;
      try {
        await rpc.postMessage({
          place: thread
            ? { case: "thread", value: thread }
            : { case: "timeline", value: session },
          text: sendingText,
          files: lease.paths,
        });
        posted = true;
        setText((current) => (current === sendingText ? "" : current));
        onSent?.();
        await lease.finish(lease.paths);
      } catch (error) {
        if (!posted) await lease.finish([]).catch(() => {});
        throw error;
      }
    });
  };
  return (
    <div
      className="study-composer"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        action.mutate(async () => {
          const paths = await stageFiles(files);
          await attachments.add(paths);
        });
      }}
      onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files);
        if (pasted.length) {
          event.preventDefault();
          action.mutate(async () => {
            const paths = await stageFiles(pasted);
            await attachments.add(paths);
          });
        }
      }}
    >
      <Textarea
        aria-label={t("SendMessage")}
        placeholder={t(
          thread ? "ThreadComposerPlaceholder" : "ComposerPlaceholder",
        )}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      {files.map((file, i) => (
        <div key={`${file}-${i}`} className="study-toolbar study-muted mt-2">
          <Paperclip className="size-3" />
          <span>{file.split("/").at(-1)}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("RemoveAttachment")}
            disabled={action.isPending}
            onClick={() => action.mutate(() => attachments.remove(file))}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="study-toolbar mt-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={action.isPending}
          onClick={() =>
            action.mutate(async () => {
              const picked = await pickFiles();
              await attachments.add(picked);
            })
          }
        >
          <Paperclip />
          {t("AttachFiles")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setText(
              (value) =>
                `${value}${value && !value.endsWith(" ") ? " " : ""}@study `,
            )
          }
        >
          {t("AskAssistant")}
        </Button>
        <span className="study-grow" />
        <Button
          disabled={action.isPending || (!text.trim() && !files.length)}
          onClick={send}
        >
          <Send />
          {t(action.isPending ? "SendingMessage" : "SendMessage")}
        </Button>
      </div>
      <Pending error={action.error} />
    </div>
  );
}
function Recordings({
  session,
  project,
}: {
  session: SessionId;
  project: ProjectId;
}) {
  const { t } = useI18n();
  const recording = useRecording();
  const items = useData(
    ["recordings"],
    async () => (await rpc.recordings({})).items,
  );
  const target = (item?: Recording) => ({
    sessionId: idKey(item?.sessionId ?? session),
    projectId: idKey(project),
    recordingId: item ? idKey(item.id) : undefined,
  });
  const here = recording.busy && recording.owner.sessionId === idKey(session);
  return (
    <Panel
      title={t("StartWithRecording")}
      actions={
        here ? (
          <Button
            variant="destructive-outline"
            disabled={recording.phase !== "live"}
            onClick={() => void recording.stop().catch(() => {})}
          >
            <Square />
            {t("StopRecording")}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={recording.busy || !canRecordNatively()}
            onClick={() => void recording.start(target()).catch(() => {})}
          >
            <Mic />
            {t(recording.busy ? "RecordingElsewhere" : "StartRecording")}
          </Button>
        )
      }
    >
      <Pending error={recording.error} />
      {!canRecordNatively() && (
        <p className="study-muted">{t("RecordingDesktopOnly")}</p>
      )}
      {here && (
        <div role="status">
          <p className="study-muted">
            {t(recording.phase === "live" ? "RecordingLive" : "Saving")} ·{" "}
            {recording.status.seconds} {t("UnitSeconds")}
          </p>
          <meter
            className="w-full"
            min={0}
            max={1}
            value={recording.status.level}
            aria-label={t("RecordingLive")}
          />
        </div>
      )}
      {items.data
        ?.filter((item) => sameId(item.sessionId, session))
        .map((item) => (
          <div className="study-row" key={idKey(item.id)}>
            <span className="study-grow">
              {t("RecordingInterrupted")} ·{" "}
              {Math.round(Number(item.samples) / 16000)} {t("UnitSeconds")}
            </span>
            {recording.owner.recordingId !== idKey(item.id) ||
            !recording.busy ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={recording.busy || !canRecordNatively()}
                  onClick={() =>
                    void recording.start(target(item)).catch(() => {})
                  }
                >
                  {t("ResumeRecording")}
                </Button>
                <Button
                  size="sm"
                  disabled={recording.busy || item.samples === 0n}
                  onClick={() =>
                    void recording.send(target(item)).catch(() => {})
                  }
                >
                  {t("SendRecording")}
                </Button>
                {recording.busy ? (
                  <Button variant="ghost-destructive" disabled>
                    {t("DiscardRecording")}
                  </Button>
                ) : (
                  <DeleteButton
                    label="DiscardRecording"
                    alert="DiscardRecording"
                    confirm="DiscardRecording"
                    onDelete={async () => {
                      if (recording.busy) return;
                      await recording.discard(target(item));
                    }}
                  />
                )}
              </>
            ) : null}
          </div>
        ))}
    </Panel>
  );
}
