import { InstallationContext } from "./hooks/installation-state";
import { inlineCitations } from "./inline-citations";
import { Code, ConnectError } from "@connectrpc/connect";
import { openExternal } from "./rpc/native";
import {
  type ReactNode,
  type RefObject,
  useState,
  useEffect,
  useContext,
} from "react";
import { Button } from "@study/ui/button";
import { Input } from "@study/ui/input";
import { Textarea } from "@study/ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "@study/ui/dialog";
import { Spinner } from "@study/ui/spinner";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n, type MessageKey } from "./i18n";
import { rpc, normalizeRpcError } from "./rpc/client";
import {
  type ProjectId,
  type Project,
  type Anchor,
  SourceKind,
  JobKind,
  JobStatus,
  type Job,
  type Citation,
} from "./generated/study_pb";
export { Button, Input, Textarea };
export function idKey(id: { value: bigint } | undefined) {
  return id?.value.toString() ?? "";
}
export function sameId(
  a: { value: bigint } | undefined,
  b: { value: bigint } | undefined,
) {
  return !!a && !!b && a.value === b.value;
}
export function useData<T>(
  key: readonly unknown[],
  load: () => Promise<T>,
  enabled = true,
  poll = 3000,
) {
  return useQuery({
    queryKey: key,
    queryFn: load,
    enabled,
    refetchInterval: poll,
  });
}
export function useAction<T = void>() {
  const installation = useContext(InstallationContext);
  const { t } = useI18n();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: () => Promise<T>) => {
      if (installation?.blocksChanges()) throw new Error(t("UpdateBusy"));
      return action();
    },
    onSuccess: () => client.invalidateQueries(),
  });
}
export function Pending({
  error,
  pending,
}: {
  error?: Error | null;
  pending?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {pending && (
        <div className="study-toolbar" role="status">
          <Spinner label={t("Saving")} />
          {t("Saving")}
        </div>
      )}
      {error && (
        <div className="study-error" role="alert">
          {t("ActionError")} <span>{error.message}</span>
        </div>
      )}
    </>
  );
}
export function Load<T>({
  query,
  children,
  empty,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  empty?: MessageKey;
}) {
  const { t } = useI18n();
  if (query.isPending)
    return (
      <div className="study-empty" role="status">
        <Spinner label={t("Saving")} />
      </div>
    );
  if (query.isError)
    return (
      <div className="study-error" role="alert">
        {t("ActionError")} {query.error.message}{" "}
        <Button onClick={() => query.refetch()} variant="outline">
          {t("Retry")}
        </Button>
      </div>
    );
  if (empty && Array.isArray(query.data) && !query.data.length)
    return <Empty label={empty} />;
  return <>{children(query.data)}</>;
}
export function Empty({ label }: { label: MessageKey }) {
  const { t } = useI18n();
  return <div className="study-empty">{t(label)}</div>;
}
export function Panel({
  title,
  children,
  actions,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="study-panel">
      {title && (
        <div
          className="study-toolbar"
          style={{ justifyContent: "space-between", marginBottom: 12 }}
        >
          <h2 style={{ margin: 0 }}>{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: MessageKey;
  children: ReactNode;
  hint?: MessageKey;
}) {
  const { t } = useI18n();
  return (
    <label className="study-field">
      <span>{t(label)}</span>
      {children}
      {hint && <span className="study-muted">{t(hint)}</span>}
    </label>
  );
}
export function ProjectSelect({
  projects,
  value,
  onChange,
  all = false,
  required = false,
}: {
  projects: Project[];
  value?: ProjectId;
  onChange: (id?: ProjectId) => void;
  all?: boolean;
  required?: boolean;
}) {
  const { t } = useI18n();
  return (
    <select
      aria-label={t("ChooseProject")}
      className="study-select"
      value={idKey(value)}
      required={required}
      onChange={(e) =>
        onChange(projects.find((p) => idKey(p.id) === e.target.value)?.id)
      }
    >
      <option value="">
        {t(all ? "AllMedia" : required ? "ChooseProject" : "NoProject")}
      </option>
      {projects.map((p) => (
        <option key={idKey(p.id)} value={idKey(p.id)}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: MessageKey;
  description?: MessageKey;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPopup
        data-shortcut-modal={open ? "true" : undefined}
        showCloseButton={false}
        closeLabel={t("Close")}
      >
        <DialogHeader>
          <DialogTitle>{t(title)}</DialogTitle>
          {description && (
            <DialogDescription>{t(description)}</DialogDescription>
          )}
        </DialogHeader>
        <DialogPanel>{children}</DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          {footer}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
export function DeleteButton({
  label,
  alert,
  confirm,
  onDelete,
}: {
  label: MessageKey;
  alert: MessageKey;
  confirm: MessageKey;
  onDelete: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const action = useAction<unknown>();
  return (
    <>
      <Button
        variant="ghost-destructive"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t(label)}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={alert}
        footer={
          <Button
            variant="destructive"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(async () => {
                await onDelete();
                setOpen(false);
              })
            }
          >
            {t(confirm)}
          </Button>
        }
      >
        <Pending error={action.error} pending={action.isPending} />
      </Modal>
    </>
  );
}
export function Markdown({
  text,
  citations = [],
  onSource,
}: {
  text: string;
  citations?: Citation[];
  onSource?: (id: string, anchor?: Anchor) => void;
}) {
  const { t } = useI18n();
  const [linkError, setLinkError] = useState<Error | null>(null);
  return (
    <>
      <div className="study-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, inlineCitations(citations)]}
          components={{
            a: ({ href, children, title }) => (
              <a
                className="text-primary underline underline-offset-2"
                title={title}
                href={
                  href?.startsWith("#") || /^https?:\/\//i.test(href ?? "")
                    ? href
                    : "#"
                }
                onClick={(event) => {
                  event.preventDefault();
                  setLinkError(null);
                  const marker = href?.match(/^#study-citation-(\d+)$/);
                  const citation = marker
                    ? citations.find((c) => c.marker === Number(marker[1]))
                    : undefined;
                  if (citation?.sourceId && onSource) {
                    onSource(idKey(citation.sourceId), citation.anchor);
                    return;
                  }
                  if (href?.startsWith("#")) {
                    try {
                      document
                        .getElementById(decodeURIComponent(href.slice(1)))
                        ?.scrollIntoView({ block: "center" });
                    } catch (error) {
                      setLinkError(normalizeRpcError(error));
                    }
                    return;
                  }
                  if (!href || !/^https?:\/\//i.test(href)) {
                    setLinkError(
                      new ConnectError(t("ActionError"), Code.InvalidArgument),
                    );
                    return;
                  }
                  void openExternal(href).catch((error) =>
                    setLinkError(normalizeRpcError(error)),
                  );
                }}
              >
                {children}
              </a>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
      <Pending error={linkError} />
    </>
  );
}

export function sourceKey(kind: SourceKind): MessageKey {
  const keys: Record<SourceKind, MessageKey> = {
    [SourceKind.UNSPECIFIED]: "SourceOther",
    [SourceKind.AUDIO]: "SourceAudio",
    [SourceKind.VIDEO]: "SourceVideo",
    [SourceKind.IMAGE]: "SourceImage",
    [SourceKind.PDF]: "SourcePdf",
    [SourceKind.TEXT]: "SourceText",
    [SourceKind.CODE]: "SourceCode",
    [SourceKind.DOCUMENT]: "SourceDocument",
    [SourceKind.SPREADSHEET]: "SourceSpreadsheet",
    [SourceKind.SLIDES]: "SourceSlides",
    [SourceKind.ARCHIVE]: "SourceArchive",
    [SourceKind.WEB]: "SourceWeb",
    [SourceKind.NOTE]: "SourceNote",
    [SourceKind.LINK]: "SourceLink",
    [SourceKind.OTHER]: "SourceOther",
  };
  return keys[kind];
}
export function stageKey(kind: JobKind): MessageKey {
  return (
    {
      [JobKind.UNSPECIFIED]: "ActivityWorking",
      [JobKind.FETCH]: "StageFetch",
      [JobKind.EXTRACT]: "StageReading",
      [JobKind.INDEX]: "StageIndex",
      [JobKind.EMBED]: "StageEmbed",
      [JobKind.TITLE]: "StageTitle",
      [JobKind.REPLY]: "StageReply",
      [JobKind.ARTIFACT]: "StageArtifact",
      [JobKind.QUESTION]: "StageQuestion",
      [JobKind.GRADE]: "StageGrade",
      [JobKind.REWRITE]: "StageRewrite",
    } as const
  )[kind];
}
export function statusKey(status: JobStatus): MessageKey {
  return (
    {
      [JobStatus.UNSPECIFIED]: "StatusWaiting",
      [JobStatus.BLOCKED]: "StatusWaiting",
      [JobStatus.QUEUED]: "StatusQueued",
      [JobStatus.WAITING]: "StatusWaiting",
      [JobStatus.RUNNING]: "ActivityWorking",
      [JobStatus.SUCCEEDED]: "StatusFinished",
      [JobStatus.FAILED]: "StatusFailed",
      [JobStatus.CANCELLED]: "StatusStopped",
    } as const
  )[status];
}
export function JobLine({ job }: { job: Job }) {
  const { t } = useI18n();
  return (
    <span className="study-muted">
      {t(stageKey(job.kind))} · {t(statusKey(job.status))}
      {job.error && <> · {job.error}</>}
    </span>
  );
}
export function AnchorLabel({ anchor }: { anchor?: Anchor }) {
  const { number } = useI18n();
  if (!anchor) return null;
  const k = anchor.kind;
  return (
    <span className="study-muted">
      {k.case === "page"
        ? number(k.value)
        : k.case === "time"
          ? `${Math.floor(Number(k.value.startMs) / 60000)}:${String(Math.floor(Number(k.value.startMs) / 1000) % 60).padStart(2, "0")}`
          : k.case === "text"
            ? `${number(k.value.lineStart)}–${number(k.value.lineEnd)}`
            : ""}
    </span>
  );
}
export function Citations({
  items,
  onSource,
}: {
  items: Citation[];
  onSource: (id: string, anchor?: Anchor) => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <details>
      <summary>{t("AnswerSources")}</summary>
      {items.map((c) => (
        <div key={c.marker} className="study-row">
          <Button
            variant="link"
            onClick={() => onSource(idKey(c.sourceId), c.anchor)}
          >
            [{c.marker}] {c.sourceName}
          </Button>
          <AnchorLabel anchor={c.anchor} />
          {c.quote && <q className="study-muted">{c.quote}</q>}
        </div>
      ))}
    </details>
  );
}
export function useProjects() {
  return useData(["projects"], async () => (await rpc.projects({})).items);
}
export function useShortcut(
  handler: (event: KeyboardEvent) => void,
  scope?: RefObject<HTMLElement | null>,
  allowShift = false,
) {
  useEffect(() => {
    const run = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (scope) {
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          (event.shiftKey && !allowShift)
        )
          return;
        const root = scope.current;
        if (!root) return;
        const active = document.activeElement;
        if (!root.contains(active)) return;
        const modal = [
          ...document.querySelectorAll("[data-shortcut-modal=true]"),
        ].at(-1);
        if (modal && !modal.contains(root)) return;
        const target = event.target instanceof Element ? event.target : active;
        if (target?.closest("input,textarea,select,[contenteditable=true]"))
          return;
        if (
          (event.key === " " ||
            event.code === "Space" ||
            event.key === "Enter") &&
          target?.closest("button,a,[role=button]")
        )
          return;
      }
      handler(event);
    };
    document.addEventListener("keydown", run);
    return () => document.removeEventListener("keydown", run);
  }, [handler, scope, allowShift]);
}
export function jobActive(job?: Job) {
  return (
    !!job &&
    [
      JobStatus.BLOCKED,
      JobStatus.QUEUED,
      JobStatus.WAITING,
      JobStatus.RUNNING,
    ].includes(job.status)
  );
}
export function jobStopped(job?: Job) {
  return !!job && [JobStatus.FAILED, JobStatus.CANCELLED].includes(job.status);
}
export function JobRecovery({
  job,
  onSettings,
  stopLabel = "StopJob",
}: {
  job: Job;
  onSettings: () => void;
  stopLabel?: MessageKey;
}) {
  const { t } = useI18n();
  const action = useAction<unknown>();
  return (
    <div className="space-y-2">
      <JobLine job={job} />
      <div className="study-toolbar">
        {jobStopped(job) && (
          <Button
            variant="outline"
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate(() => rpc.retryJob(job.id!))}
          >
            {t("RetryJob")}
          </Button>
        )}
        {jobActive(job) && (
          <Button
            variant="destructive-outline"
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate(() => rpc.cancelJob(job.id!))}
          >
            {t(stopLabel)}
          </Button>
        )}
        {(job.needs || job.waitingFor) && (
          <Button size="sm" variant="outline" onClick={onSettings}>
            {t("GoToSettings")}
          </Button>
        )}
      </div>
      <Pending error={action.error} />
    </div>
  );
}
