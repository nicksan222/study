import { useState } from "react";
import { rpc } from "../rpc/client";
import { JobStatus, ArtifactKind } from "../generated/study_pb";
import { useI18n } from "../i18n";
import {
  Button,
  Panel,
  Pending,
  Load,
  JobLine,
  useData,
  useAction,
  idKey,
  statusKey,
} from "../components";
import { type Navigate } from "./projects";
import { Processing } from "./settings";
export function JobsPage({ navigate }: { navigate: Navigate }) {
  const { t, date, number } = useI18n();
  const jobs = useData(
    ["jobs"],
    async () => (await rpc.jobOverviews({ limit: 500n })).items,
  );
  const [filter, setFilter] = useState<JobStatus | undefined>();
  const [config, setConfig] = useState(false);
  const action = useAction<unknown>();
  return (
    <>
      <div className="study-toolbar">
        <Button
          variant={config ? "outline" : "default"}
          onClick={() => setConfig(false)}
        >
          {t("Pipelines")}
        </Button>
        <Button
          variant={config ? "default" : "outline"}
          onClick={() => setConfig(true)}
        >
          {t("Processing")}
        </Button>
        {!config && (
          <select
            aria-label={t("FilterAll")}
            className="study-select"
            value={filter ?? ""}
            onChange={(e) =>
              setFilter(e.target.value ? Number(e.target.value) : undefined)
            }
          >
            <option value="">{t("FilterAll")}</option>
            {(
              [
                JobStatus.RUNNING,
                JobStatus.QUEUED,
                JobStatus.WAITING,
                JobStatus.BLOCKED,
                JobStatus.FAILED,
                JobStatus.CANCELLED,
                JobStatus.SUCCEEDED,
              ] as const
            ).map((s) => (
              <option key={s} value={s}>
                {t(statusKey(s))}
              </option>
            ))}
          </select>
        )}
      </div>
      <Pending error={action.error} />
      {config ? (
        <Processing />
      ) : (
        <Load query={jobs} empty="PipelinesEmpty">
          {(items) => (
            <div className="space-y-3">
              {items
                .filter(
                  (item) => filter === undefined || item.job?.status === filter,
                )
                .map((item) => {
                  const job = item.job!;
                  const stopped = [
                    JobStatus.FAILED,
                    JobStatus.CANCELLED,
                  ].includes(job.status);
                  const active = [
                    JobStatus.RUNNING,
                    JobStatus.QUEUED,
                    JobStatus.WAITING,
                    JobStatus.BLOCKED,
                  ].includes(job.status);
                  return (
                    <Panel
                      key={idKey(job.id)}
                      title={item.subject}
                      actions={
                        <div className="study-toolbar">
                          {stopped && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate(() => rpc.retryJob(job.id!))
                              }
                            >
                              {t("RetryJob")}
                            </Button>
                          )}
                          {active && (
                            <Button
                              size="sm"
                              variant="destructive-outline"
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate(() => rpc.cancelJob(job.id!))
                              }
                            >
                              {t("StopJob")}
                            </Button>
                          )}
                        </div>
                      }
                    >
                      <JobLine job={job} />
                      <p className="study-muted mt-2">
                        {date(job.updatedAt)} · {t("DetailAttempts")}:{" "}
                        {number(job.attempts)}
                      </p>
                      {(job.needs || job.waitingFor) && (
                        <Button
                          variant="link"
                          onClick={() => navigate("Settings")}
                        >
                          {t("GoToSettings")}
                        </Button>
                      )}
                      <div className="study-toolbar mt-2">
                        {item.sourceId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate("MediaList", idKey(item.sourceId))
                            }
                          >
                            {t("OpenInLibrary")}
                          </Button>
                        )}
                        {item.sessionId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate("Sessions", idKey(item.sessionId))
                            }
                          >
                            {t("OpenSession")}
                          </Button>
                        )}
                        {item.practiceId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate("Practice", idKey(item.practiceId))
                            }
                          >
                            {t("OpenPractice")}
                          </Button>
                        )}
                        {job.target?.kind.case === "artifact" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate(async () => {
                                if (job.target?.kind.case !== "artifact")
                                  return;
                                const artifact = (
                                  await rpc.artifact(job.target.kind.value)
                                ).value;
                                if (!artifact)
                                  throw new Error(t("MaterialNotMade"));
                                navigate(
                                  artifact.kind === ArtifactKind.DIAGRAM
                                    ? "Diagrams"
                                    : "Flashcards",
                                  idKey(artifact.id),
                                  idKey(artifact.projectId),
                                );
                              })
                            }
                          >
                            {t("OpenMaterial")}
                          </Button>
                        )}
                      </div>
                    </Panel>
                  );
                })}
            </div>
          )}
        </Load>
      )}
    </>
  );
}
