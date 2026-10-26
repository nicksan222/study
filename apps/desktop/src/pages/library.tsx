import { useDraftFiles } from "../hooks/draft-files";
import { anchorsOverlap } from "../anchors";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { stageFiles, useNativeDrop } from "../rpc/files";
import { useState, useEffect, useRef } from "react";
import { Download, FilePlus, Link, Plus, FolderOpen } from "lucide-react";
import { rpc } from "../rpc/client";
import { pickFiles, saveFile, openExternal } from "../rpc/native";
import {
  type Source,
  type ProjectId,
  type Anchor,
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
  useData,
  useAction,
  useProjects,
  idKey,
  sameId,
  sourceKey,
  AnchorLabel,
} from "../components";

export function Library({
  selected,
  onSelect,
  projectFilter,
  anchor,
}: {
  selected?: string;
  onSelect: (id?: string) => void;
  projectFilter?: string;
  anchor?: Anchor;
}) {
  const { t, date, number } = useI18n();
  const projects = useProjects();
  const sources = useData(
    ["sources"],
    async () => (await rpc.sources({})).items,
  );
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<ProjectId | undefined>(
    projectFilter
      ? { value: BigInt(projectFilter), $typeName: "study.v1.ProjectId" }
      : undefined,
  );
  const [creating, setCreating] = useState<"note" | "link" | undefined>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const action = useAction<unknown>();
  const create = async () => {
    const source =
      creating === "note"
        ? await rpc.createNote({ project, title, text: body })
        : await rpc.addLink({ project, url });
    setCreating(undefined);
    setTitle("");
    setBody("");
    setUrl("");
    onSelect(idKey(source.id));
  };
  const imports = useDraftFiles();
  const importSelection = async (paths: string[]) => {
    if (!paths.length) return;
    const lease = imports.retain(paths);
    try {
      if (!(await imports.add(paths))) {
        await lease.finish([]);
        return;
      }
      const result = await rpc.importFiles({ paths: lease.paths, project });
      const succeeded = result.items.flatMap((item) =>
        item.result.case === "source" ? [item.path] : [],
      );
      await lease.finish(succeeded);
      const errors = result.items.flatMap((item) =>
        item.result.case === "error" ? [item.result.value.message] : [],
      );
      if (errors.length) throw new Error(errors.join("\n"));
    } catch (error) {
      await lease.finish([]).catch(() => {});
      throw error;
    }
  };
  const importFiles = () =>
    action.mutate(async () => {
      await importSelection(await pickFiles());
    });
  const importPaths = (paths: string[]) =>
    action.mutate(() => importSelection(paths));
  useNativeDrop(importPaths, !action.isPending);
  const opened = sources.data?.find((source) => idKey(source.id) === selected);
  return (
    <div
      className="space-y-5"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        action.mutate(async () => {
          const paths = await stageFiles(files);
          await importSelection(paths);
        });
      }}
    >
      <div className="study-toolbar">
        <Button onClick={importFiles} disabled={action.isPending}>
          <Plus />
          {t("AddFiles")}
        </Button>
        <Button variant="outline" onClick={() => setCreating("note")}>
          <FilePlus />
          {t("NewNote")}
        </Button>
        <Button variant="outline" onClick={() => setCreating("link")}>
          <Link />
          {t("AddLink")}
        </Button>
        <ProjectSelect
          projects={projects.data ?? []}
          value={project}
          onChange={setProject}
          all
        />
        <Input
          aria-label={t("SearchMedia")}
          placeholder={t("SearchMedia")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-72"
        />
      </div>
      <Pending pending={action.isPending} error={action.error} />
      {imports.paths.length > 0 && (
        <div className="study-toolbar">
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => importPaths(imports.paths)}
          >
            {t("Retry")}
          </Button>
          <Button
            variant="ghost"
            disabled={action.isPending}
            onClick={() => action.mutate(() => imports.discard())}
          >
            {t("Cancel")}
          </Button>
        </div>
      )}
      {opened ? (
        <>
          <Button variant="ghost" onClick={() => onSelect(undefined)}>
            {t("Back")}
          </Button>
          <SourceDetail
            source={opened}
            anchor={anchor}
            projects={projects.data ?? []}
            onDeleted={() => onSelect(undefined)}
          />
        </>
      ) : (
        <Load query={sources} empty="NoMediaYet">
          {(items) => {
            const filtered = items.filter(
              (x) =>
                (!project || sameId(x.projectId, project)) &&
                x.name.toLowerCase().includes(query.toLowerCase()),
            );
            return filtered.length ? (
              <div className="study-grid">
                {filtered.map((source) => (
                  <Panel key={idKey(source.id)}>
                    <button
                      type="button"
                      className="text-left w-full"
                      onClick={() => onSelect(idKey(source.id))}
                    >
                      <FolderOpen className="text-primary mb-5" />
                      <h2>{source.name}</h2>
                      <div className="study-muted">
                        {t(sourceKey(source.kind))} · {number(source.sizeBytes)}{" "}
                        {t("UnitBytes")}
                      </div>
                      <div className="study-muted mt-2">
                        {source.projectName ?? t("NoProject")} ·{" "}
                        {date(source.createdAt)}
                      </div>
                    </button>
                  </Panel>
                ))}
              </div>
            ) : (
              <Empty label="NoMatchingMedia" />
            );
          }}
        </Load>
      )}
      <Modal
        open={!!creating}
        onClose={() => setCreating(undefined)}
        title={creating === "note" ? "NewNote" : "AddLink"}
        footer={
          <Button
            disabled={
              action.isPending ||
              (creating === "note"
                ? !title.trim() || !body.trim()
                : !url.trim())
            }
            onClick={() => action.mutate(create)}
          >
            {t(creating === "note" ? "SaveNote" : "AddLink")}
          </Button>
        }
      >
        <ProjectSelect
          projects={projects.data ?? []}
          value={project}
          onChange={setProject}
        />
        {creating === "note" ? (
          <>
            <Field label="NoteTitle">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="ReadFromFile">
              <Textarea
                placeholder={t("NoteBodyPlaceholder")}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label="AddLink" hint="AddLinkHint">
            <Input
              type="url"
              placeholder={t("LinkPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
        )}
        <Pending error={action.error} />
      </Modal>
    </div>
  );
}
export function SourceDetail(props: Parameters<typeof SourceDetailContent>[0]) {
  return <SourceDetailContent key={idKey(props.source.id)} {...props} />;
}
function SourceDetailContent({
  source,
  projects,
  onDeleted,
  anchor,
}: {
  source: Source;
  projects: NonNullable<ReturnType<typeof useProjects>["data"]>;
  onDeleted?: () => void;
  anchor?: Anchor;
}) {
  const { t } = useI18n();
  const key = idKey(source.id);
  const doc = useData(
    ["document", key],
    async () => (await rpc.sourceDocument(source.id!)).value,
  );
  const preview = useData(["preview", key], () => rpc.preview(source.id!));
  const blocks = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor || !doc.data) return;
    const target = blocks.current?.querySelector("[data-cited=true]");
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [anchor, doc.data]);
  const action = useAction<unknown>();
  const [editing, setEditing] = useState<
    { index: number; before: string } | undefined
  >();
  const [corrected, setCorrected] = useState("");
  return (
    <>
      <Panel
        title={source.name}
        actions={
          <div className="study-toolbar">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                action.mutate(async () => {
                  if (isTauri()) {
                    const destination = await invoke<string | null>(
                      "pick_export",
                      { defaultName: source.name },
                    );
                    if (destination)
                      await rpc.exportSourceToFile({
                        sourceId: source.id,
                        destination,
                      });
                  } else {
                    const bytes = (await rpc.exportSource(source.id!)).value;
                    await saveFile(source.name, bytes, source.mime);
                  }
                })
              }
            >
              <Download />
              {t("OpenOriginal")}
            </Button>
            {source.uri && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => action.mutate(() => openExternal(source.uri!))}
              >
                {t("OpenPage")}
              </Button>
            )}
            <DeleteButton
              label="DeleteMedia"
              alert="AlertDeleteMedia"
              confirm="ConfirmDeleteMedia"
              onDelete={async () => {
                await rpc.deleteSource(source.id!);
                onDeleted?.();
              }}
            />
          </div>
        }
      >
        <Field label="AssociateWithProject">
          <ProjectSelect
            projects={projects}
            value={source.projectId}
            onChange={(project) =>
              action.mutate(() =>
                rpc.setSourceProject({ id: source.id, project }),
              )
            }
          />
        </Field>
        <Pending error={action.error} pending={action.isPending} />
        <Load query={preview}>
          {(value) =>
            value.kind.case === "picture" ? (
              <img
                alt={source.name}
                className="study-preview"
                src={`data:image/png;base64,${bytesBase64(value.kind.value)}`}
              />
            ) : value.kind.case === "text" ? (
              <Markdown text={value.kind.value} />
            ) : (
              <Empty label="NothingRead" />
            )
          }
        </Load>
      </Panel>
      <div ref={blocks}>
        <Panel title={t("ReadFromFile")}>
          <Load query={doc}>
            {(document) =>
              document?.blocks.length ? (
                <>
                  {document.meta?.corrected && (
                    <p className="study-muted">{t("CorrectText")}</p>
                  )}
                  {document.blocks.map((block, index) => (
                    <div
                      key={index}
                      data-cited={anchorsOverlap(block.anchor, anchor)}
                      className="study-row"
                      style={{ alignItems: "start" }}
                    >
                      <div className="study-grow">
                        <AnchorLabel anchor={block.anchor} />
                        {editing?.index === index ? (
                          <Textarea
                            aria-label={t("CorrectText")}
                            value={corrected}
                            onChange={(e) => setCorrected(e.target.value)}
                          />
                        ) : (
                          <Markdown text={block.text} />
                        )}
                      </div>
                      {editing?.index === index ? (
                        <>
                          <Button
                            disabled={
                              action.isPending || corrected === block.text
                            }
                            onClick={() =>
                              action.mutate(async () => {
                                const result = await rpc.correctBlock({
                                  id: source.id,
                                  ordinal: BigInt(index),
                                  before: editing!.before,
                                  after: corrected,
                                });
                                if (!result.value)
                                  throw new Error(t("CorrectionStale"));
                                setEditing(undefined);
                              })
                            }
                          >
                            {t("Save")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setEditing(undefined)}
                          >
                            {t("Cancel")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing({ index, before: block.text });
                            setCorrected(block.text);
                          }}
                        >
                          {t("CorrectText")}
                        </Button>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <Empty label="NothingRead" />
              )
            }
          </Load>
        </Panel>
      </div>
    </>
  );
}
export function bytesBase64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192)
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}
