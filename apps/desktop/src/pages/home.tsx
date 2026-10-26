import { ArrowRight, FilePlus, FolderPlus } from "lucide-react";
import { rpc } from "../rpc/client";
import {
  Button,
  Panel,
  Load,
  Empty,
  useData,
  idKey,
  sourceKey,
  JobLine,
} from "../components";
import { useI18n } from "../i18n";
import { type Navigate } from "./projects";
export function Home({ navigate }: { navigate: Navigate }) {
  const { t, number, date } = useI18n();
  const dashboard = useData(["dashboard"], async () => {
    const [due, sources, sessions, jobs, practices, report] = await Promise.all(
      [
        rpc.dueCount({}),
        rpc.sources({}),
        rpc.allSessions({}),
        rpc.jobOverviews({ limit: 8n }),
        rpc.practices({}),
        rpc.machineReport({}),
      ],
    );
    return {
      due: due.value,
      sources: sources.items,
      sessions: sessions.items,
      jobs: jobs.items,
      practices: practices.items,
      report: report.value,
    };
  });
  return (
    <>
      <div>
        <h2 className="text-2xl tracking-tight">
          {t(
            new Date().getHours() < 12
              ? "GreetingMorning"
              : new Date().getHours() < 18
                ? "GreetingAfternoon"
                : "GreetingEvening",
          )}
        </h2>
        <div className="study-toolbar">
          <Button onClick={() => navigate("MediaList")}>
            <FilePlus />
            {t("AddFiles")}
          </Button>
          <Button variant="outline" onClick={() => navigate("Projects")}>
            <FolderPlus />
            {t("NewProjectAction")}
          </Button>
        </div>
      </div>
      <Load query={dashboard}>
        {(data) => (
          <>
            <div className="study-grid">
              <Panel title={t("Today")}>
                <div className="study-stat">{number(data.due)}</div>
                <p className="study-muted">
                  {t(data.due > 0 ? "TodayDue" : "TodayNothingDue")}
                </p>
                <Button
                  onClick={() => navigate("Flashcards", "review")}
                  variant="outline"
                >
                  {t("ReviewNow")}
                  <ArrowRight />
                </Button>
              </Panel>
              <Panel title={t("Practice")}>
                <div className="study-stat">
                  {number(data.practices.length)}
                </div>
                <p className="study-muted">{t("TodayPractise")}</p>
                <Button variant="outline" onClick={() => navigate("Practice")}>
                  {t("OpenPractice")}
                  <ArrowRight />
                </Button>
              </Panel>
              <Panel title={t("System")}>
                <p>{data.report?.system?.cpuBrand ?? t("SysNotMeasured")}</p>
                <p className="study-muted">
                  {data.report?.system
                    ? `${number(Number(data.report.system.totalMemoryBytes) / 1024 ** 3)} ${t("UnitGigabytes")}`
                    : t("SystemDescription")}
                </p>
                <Button variant="outline" onClick={() => navigate("Settings")}>
                  {t("SeeDetails")}
                  <ArrowRight />
                </Button>
              </Panel>
            </div>
            <div className="study-grid">
              <Panel title={t("ContinueTitle")}>
                {data.sessions.length ? (
                  data.sessions.slice(0, 5).map((session) => (
                    <div className="study-row" key={idKey(session.id)}>
                      <div className="study-grow">
                        <Button
                          variant="link"
                          onClick={() =>
                            navigate("Sessions", idKey(session.id))
                          }
                        >
                          {session.title}
                        </Button>
                        <div className="study-muted">
                          {date(session.updatedAt)}
                        </div>
                      </div>
                      <ArrowRight className="size-4" />
                    </div>
                  ))
                ) : (
                  <Empty label="DashboardNoSessions" />
                )}
              </Panel>
              <Panel
                title={t("RecentFiles")}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("MediaList")}
                  >
                    {t("OpenLibrary")}
                  </Button>
                }
              >
                {data.sources.length ? (
                  data.sources.slice(0, 5).map((source) => (
                    <div className="study-row" key={idKey(source.id)}>
                      <div className="study-grow">
                        <Button
                          variant="link"
                          onClick={() =>
                            navigate("MediaList", idKey(source.id))
                          }
                        >
                          {source.name}
                        </Button>
                        <div className="study-muted">
                          {t(sourceKey(source.kind))}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty label="NoFilesYet" />
                )}
              </Panel>
            </div>
            <Panel
              title={t("Pipelines")}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("Pipelines")}
                >
                  {t("OpenPipelines")}
                </Button>
              }
            >
              {data.jobs.length ? (
                data.jobs.map((item) => (
                  <div className="study-row" key={idKey(item.job?.id)}>
                    <span className="study-grow">{item.subject}</span>
                    {item.job && <JobLine job={item.job} />}
                  </div>
                ))
              ) : (
                <Empty label="AllCaughtUp" />
              )}
            </Panel>
          </>
        )}
      </Load>
    </>
  );
}
