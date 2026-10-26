import { useState } from "react";
import { useRecording } from "../hooks/recording";
import { Plus, BookOpen } from "lucide-react";
import { rpc } from "../rpc/client";
import { type Project, type Day, type Anchor } from "../generated/study_pb";
import { useI18n } from "../i18n";
import {
  Button,
  Input,
  Field,
  Modal,
  DeleteButton,
  Panel,
  Pending,
  Load,
  useAction,
  useProjects,
  idKey,
} from "../components";
export type Navigate = (
  page: string,
  id?: string,
  project?: string,
  anchor?: Anchor,
) => void;
export function dayInput(day?: Day) {
  return day
    ? `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`
    : "";
}
export function parseDay(input: string) {
  if (!input) return undefined;
  const [year, month, day] = input.split("-").map(Number);
  return { year, month, day };
}
export function ProjectsPage({ navigate }: { navigate: Navigate }) {
  const { t } = useI18n();
  const recording = useRecording();
  const projects = useProjects();
  const action = useAction<unknown>();
  const [editing, setEditing] = useState<Project | "new" | undefined>();
  const [name, setName] = useState("");
  const [exam, setExam] = useState("");
  const edit = (project: Project | "new") => {
    setEditing(project);
    setName(project === "new" ? "" : project.name);
    setExam(project === "new" ? "" : dayInput(project.examOn));
  };
  const save = async () => {
    const project =
      editing === "new" ? await rpc.createProject({ name }) : editing;
    if (!project) return;
    if (editing !== "new") await rpc.renameProject({ id: project.id, name });
    await rpc.setExam({ id: project.id, examOn: parseDay(exam) });
    setEditing(undefined);
  };
  return (
    <>
      <div>
        <Button onClick={() => edit("new")}>
          <Plus />
          {t("NewProject")}
        </Button>
      </div>
      <Pending error={action.error} />
      <Load query={projects} empty="NoProjectsYet">
        {(items) => (
          <div className="study-grid">
            {items.map((project) => (
              <Panel
                key={idKey(project.id)}
                title={
                  <>
                    <BookOpen className="inline size-4 mr-2 text-primary" />
                    {project.name}
                  </>
                }
              >
                <p className="study-muted">
                  {project.examOn
                    ? `${t("ExamDay")}: ${dayInput(project.examOn)}`
                    : t("ProjectDetailDescription")}
                </p>
                <div className="study-toolbar mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate("MediaList", undefined, idKey(project.id))
                    }
                  >
                    {t("ViewProjectFiles")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate("Sessions", undefined, idKey(project.id))
                    }
                  >
                    {t("NewSession")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate("Flashcards", undefined, idKey(project.id))
                    }
                  >
                    {t("OpenProjectCards")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate("Practice", undefined, idKey(project.id))
                    }
                  >
                    {t("OpenProjectQuiz")}
                  </Button>
                </div>
                <div className="study-toolbar mt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => edit(project)}
                  >
                    {t("RenameProject")}
                  </Button>
                  {recording.protectsProject(idKey(project.id)) ? (
                    <Button variant="ghost-destructive" size="sm" disabled>
                      {t("DeleteProject")}
                    </Button>
                  ) : (
                    <DeleteButton
                      label="DeleteProject"
                      alert="AlertDeleteProject"
                      confirm="ConfirmDeleteProject"
                      onDelete={async () => {
                        if (recording.protectsProject(idKey(project.id)))
                          return;
                        await rpc.deleteProject(project.id!);
                      }}
                    />
                  )}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Load>
      <Modal
        open={!!editing}
        onClose={() => setEditing(undefined)}
        title={editing === "new" ? "NewProject" : "ProjectDetails"}
        footer={
          <Button
            disabled={!name.trim() || action.isPending}
            onClick={() => action.mutate(save)}
          >
            {t(editing === "new" ? "CreateProject" : "Save")}
          </Button>
        }
      >
        <Field label="ProjectName" hint="ProjectNameDescription">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="ExamDay" hint="ExamDayHint">
          <Input
            type="date"
            value={exam}
            onChange={(e) => setExam(e.target.value)}
          />
        </Field>
        <Pending error={action.error} />
      </Modal>
    </>
  );
}
