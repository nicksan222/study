import { InstallationProvider } from "./hooks/installation";
import { useInstallation } from "./hooks/installation-state";
import { useSaveAppSettings } from "./hooks/app-settings";
import { SessionDraftProvider } from "./hooks/session-drafts";
import { RecordingProvider } from "./hooks/recording";
import { encodeAnchor, decodeAnchor } from "./anchors";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNativeMenu, nextZoom } from "./rpc/menu";
import { subscribeRefresh } from "./rpc/refresh";
import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  Home as HomeIcon,
  Library as LibraryIcon,
  Folder,
  MessagesSquare,
  Layers,
  Network,
  GraduationCap,
  Activity,
  Settings as SettingsIcon,
  CircleHelp,
  PanelLeftClose,
  Search,
  RefreshCw,
} from "lucide-react";
import { rpc } from "./rpc/client";
import {
  Appearance,
  Language,
  ArtifactKind,
  type AppSettings,
} from "./generated/study_pb";
import { LanguageProvider, useI18n } from "./i18n";
import {
  Button,
  Input,
  Modal,
  Panel,
  Pending,
  Load,
  Empty,
  useData,
  useAction,
  useShortcut,
  idKey,
} from "./components";
import { Home } from "./pages/home";
import { Library } from "./pages/library";
import { ProjectsPage, type Navigate } from "./pages/projects";
import { SessionsPage } from "./pages/sessions";
import { MaterialsPage } from "./pages/materials";
import { PracticePage } from "./pages/practice";
import { JobsPage } from "./pages/jobs";
import { SettingsPage } from "./pages/settings";
const routes = [
  ["Home", HomeIcon],
  ["MediaList", LibraryIcon],
  ["Projects", Folder],
  ["Sessions", MessagesSquare],
  ["Flashcards", Layers],
  ["Diagrams", Network],
  ["Practice", GraduationCap],
  ["Pipelines", Activity],
  ["Settings", SettingsIcon],
  ["Help", CircleHelp],
] as const;
type RouteName = (typeof routes)[number][0];
function readRoute() {
  const [page, search] = window.location.hash.slice(1).split("?");
  const query = new URLSearchParams(search ?? "");
  return {
    page: routes.some(([key]) => key === page) ? (page as RouteName) : "Home",
    id: query.get("id") ?? undefined,
    project: query.get("project") ?? undefined,
    anchor: decodeAnchor(query.get("anchor")),
  };
}
export function App() {
  const settings = useData(
    ["app-settings"],
    () => rpc.getAppSettings({}),
    true,
    0,
  );
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    let unlisten: undefined | (() => void);
    if (isTauri())
      listen("study://refresh", () => queryClient.invalidateQueries()).then(
        (stop) => {
          if (cancelled) stop();
          else unlisten = stop;
        },
      );
    const abort = new AbortController();
    if (!isTauri())
      void subscribeRefresh(abort.signal, () => {
        void queryClient.invalidateQueries();
      });
    const focus = () => {
      void queryClient.invalidateQueries();
    };
    window.addEventListener("focus", focus);
    return () => {
      cancelled = true;
      abort.abort();
      unlisten?.();
      window.removeEventListener("focus", focus);
    };
  }, [queryClient]);
  const locale =
    settings.data?.language === Language.ITALIAN ? "italian" : "english";
  useEffect(() => {
    document.documentElement.lang = locale === "italian" ? "it" : "en";
    document.documentElement.classList.toggle(
      "dark",
      settings.data?.appearance !== Appearance.LIGHT,
    );
    document.documentElement.style.fontSize = "16px";
    const factor = (settings.data?.zoomPercent ?? 100) / 100;
    if (isTauri()) {
      document.documentElement.style.zoom = "1";
      void getCurrentWebview()
        .setZoom(factor)
        .catch(() => {
          document.documentElement.style.zoom = String(factor);
        });
    } else document.documentElement.style.zoom = String(factor);
  }, [locale, settings.data?.appearance, settings.data?.zoomPercent]);
  return (
    <LanguageProvider locale={locale}>
      <RecordingProvider>
        <InstallationProvider>
          <SessionDraftProvider>
            <Load query={settings}>
              {(value) => <Shell settings={value} />}
            </Load>
          </SessionDraftProvider>
        </InstallationProvider>
      </RecordingProvider>
    </LanguageProvider>
  );
}
function Shell({ settings }: { settings: AppSettings }) {
  const { t, locale } = useI18n();
  const [sidebar, setSidebar] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const action = useAction<unknown>();
  const [route, setRoute] = useState(readRoute);
  const [search, setSearch] = useState(false);
  const [tour, setTour] = useState(!settings.onboarded);
  const queryClient = useQueryClient();
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const navigate: Navigate = useCallback((page, id, project, anchor) => {
    const query = new URLSearchParams();
    if (id) query.set("id", id);
    if (project) query.set("project", project);
    if (anchor) query.set("anchor", encodeAnchor(anchor));
    window.location.hash = `${page}${query.size ? `?${query}` : ""}`;
    setRoute(readRoute());
  }, []);
  const installation = useInstallation();
  const saveSettings = useSaveAppSettings();
  const zoom = (direction: "in" | "out" | "reset") => {
    if (installation.blocksChanges()) return;
    saveSettings.mutate((current) => ({
      zoomPercent: nextZoom(current.zoomPercent, direction),
    }));
  };
  const toggleFullscreen = () => {
    if (isTauri()) {
      action.mutate(async () => {
        await getCurrentWindow().setFullscreen(!fullscreen);
        setFullscreen(!fullscreen);
      });
    } else {
      action.mutate(async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        setFullscreen(!fullscreen);
      });
    }
  };
  useNativeMenu(t, locale, (menuAction) => {
    if (installation.blocksChanges()) return;
    if (menuAction === "settings") navigate("Settings");
    if (menuAction === "search") setSearch(true);
    if (menuAction === "zoomIn") zoom("in");
    if (menuAction === "zoomOut") zoom("out");
    if (menuAction === "resetZoom") zoom("reset");
    if (menuAction === "sidebar") setSidebar((value) => !value);
    if (menuAction === "fullscreen") toggleFullscreen();
  });
  useShortcut((event) => {
    if (installation.blocksChanges()) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      ["+", "=", "-", "_", "0"].includes(event.key)
    ) {
      event.preventDefault();
      zoom(
        event.key === "0"
          ? "reset"
          : ["-", "_"].includes(event.key)
            ? "out"
            : "in",
      );
      return;
    }
    if (
      event.key === "F11" ||
      (event.ctrlKey && event.metaKey && event.key.toLowerCase() === "f")
    ) {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
      event.preventDefault();
      setSidebar((value) => !value);
      return;
    }
    const editing =
      event.target instanceof Element &&
      event.target.matches("input,textarea,select,[contenteditable=true]");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setSearch((v) => !v);
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      /^[1-9]$/.test(event.key) &&
      !editing
    ) {
      event.preventDefault();
      navigate(routes[Number(event.key) - 1][0]);
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ",") {
      event.preventDefault();
      navigate("Settings");
    }
  });
  return (
    <div className="study-shell" data-sidebar={sidebar ? "open" : "closed"}>
      <aside className="study-sidebar">
        <div className="study-brand">
          {t("AppName")}
          <span className="text-primary">.</span>
        </div>
        <Button
          variant="outline"
          className="mb-5"
          onClick={() => setSearch(true)}
        >
          <Search className="size-4" />
          <span className="nav-label study-grow text-left">{t("Search")}</span>
          <kbd className="nav-label text-[10px] study-muted">
            {t("SearchShortcut")}
          </kbd>
        </Button>
        <nav aria-label={t("AppName")} className="space-y-1">
          {routes.map(([page, Icon], index) => (
            <Button
              key={page}
              variant={route.page === page ? "secondary" : "ghost-muted"}
              className={index === 8 ? "mt-6" : ""}
              aria-current={route.page === page ? "page" : undefined}
              onClick={() => navigate(page)}
              title={t(page)}
            >
              <Icon className="size-4" />
              <span className="nav-label">{t(page)}</span>
            </Button>
          ))}
        </nav>
        <div className="study-grow" />
        <span className="study-muted nav-label px-3 mt-8">{t("AppName")}</span>
      </aside>
      <main className="study-content">
        <header className="study-header">
          <div className="study-toolbar">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("ToggleSidebar")}
              onClick={() => setSidebar((v) => !v)}
            >
              <PanelLeftClose />
            </Button>
            <h1>{t(route.page)}</h1>
          </div>
          <div className="study-toolbar">
            <details className="relative">
              <summary className="cursor-pointer study-muted">
                {t("ViewMenu")}
              </summary>
              <div className="absolute right-0 top-7 z-50 w-56 p-2 rounded-lg border border-border bg-popover shadow-lg space-y-1">
                {(
                  [
                    ["ZoomIn", () => zoom("in")],
                    ["ZoomOut", () => zoom("out")],
                    ["ResetZoom", () => zoom("reset")],
                    ["ToggleSidebar", () => setSidebar((v) => !v)],
                    ["ToggleFullscreen", toggleFullscreen],
                  ] as const
                ).map(([key, onClick]) => (
                  <Button
                    key={key}
                    className="w-full justify-start"
                    variant="ghost"
                    onClick={onClick}
                  >
                    {t(key)}
                  </Button>
                ))}
              </div>
            </details>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Retry")}
              onClick={() => queryClient.invalidateQueries()}
            >
              <RefreshCw />
            </Button>
          </div>
        </header>
        <div className="study-page">
          <Pending error={action.error ?? saveSettings.error} />
          {route.page === "Home" ? (
            <Home navigate={navigate} />
          ) : route.page === "MediaList" ? (
            <Library
              key={route.project}
              selected={route.id}
              anchor={route.anchor}
              projectFilter={route.project}
              onSelect={(id) => navigate("MediaList", id, route.project)}
            />
          ) : route.page === "Projects" ? (
            <ProjectsPage navigate={navigate} />
          ) : route.page === "Sessions" ? (
            <SessionsPage
              selected={route.id}
              projectFilter={route.project}
              navigate={navigate}
            />
          ) : route.page === "Flashcards" || route.page === "Diagrams" ? (
            <MaterialsPage
              key={route.page}
              selected={route.id}
              kind={
                route.page === "Flashcards"
                  ? ArtifactKind.FLASHCARDS
                  : ArtifactKind.DIAGRAM
              }
              projectFilter={route.project}
              navigate={navigate}
            />
          ) : route.page === "Practice" ? (
            <PracticePage
              selected={route.id}
              projectFilter={route.project}
              navigate={navigate}
            />
          ) : route.page === "Pipelines" ? (
            <JobsPage navigate={navigate} />
          ) : route.page === "Settings" ? (
            <SettingsPage settings={settings} />
          ) : (
            <HelpPage replay={() => setTour(true)} />
          )}
        </div>
      </main>
      <SearchPalette
        open={search}
        onClose={() => setSearch(false)}
        navigate={navigate}
      />
      <Onboarding
        open={tour}
        onDone={() => setTour(false)}
        navigate={navigate}
      />
    </div>
  );
}
function SearchPalette({
  open,
  onClose,
  navigate,
}: {
  open: boolean;
  onClose: () => void;
  navigate: Navigate;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(0);
  const results = useData(
    ["search", debounced],
    () => rpc.search({ query: debounced, limit: 30n }),
    open && !!debounced,
    0,
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim());
      setIndex(0);
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  const pick = (at: number) => {
    const target = results.data?.hits[at]?.target?.kind;
    if (!target?.case) return;
    if (target.case === "project") navigate("Projects", idKey(target.value));
    if (target.case === "session")
      navigate("Sessions", idKey(target.value.sessionId));
    if (target.case === "source")
      navigate(
        "MediaList",
        idKey(target.value.sourceId),
        undefined,
        target.value.anchor,
      );
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Search"
      description="SearchPrompt"
    >
      <Input
        autoFocus
        placeholder={t("SearchPlaceholder")}
        aria-label={t("Search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) =>
              Math.min((results.data?.hits.length ?? 1) - 1, i + 1),
            );
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            pick(index);
          }
        }}
      />
      {debounced ? (
        <Load query={results}>
          {(value) => (
            <>
              {!value.semantic && (
                <p className="study-muted">{t("SearchKeywordOnly")}</p>
              )}
              {value.hits.length ? (
                value.hits.map((hit, at) => (
                  <Button
                    key={at}
                    className="w-full h-auto justify-start text-left py-3"
                    variant={at === index ? "secondary" : "ghost"}
                    onClick={() => pick(at)}
                  >
                    <span>
                      <strong className="block">{hit.title}</strong>
                      <span className="study-muted block whitespace-normal">
                        {hit.context} {hit.excerpt}
                      </span>
                    </span>
                  </Button>
                ))
              ) : (
                <Empty label="SearchNoResults" />
              )}
            </>
          )}
        </Load>
      ) : (
        <Empty label="SearchPrompt" />
      )}
    </Modal>
  );
}
function HelpPage({ replay }: { replay: () => void }) {
  const { t } = useI18n();
  const sections = [
    ["HelpCaptureTitle", "HelpCaptureBody"],
    ["HelpAskTitle", "HelpAskBody"],
    ["HelpStudyTitle", "HelpStudyBody"],
    ["HelpPracticeTitle", "HelpPracticeBody"],
    ["HelpKeysTitle", "HelpKeysBody"],
  ] as const;
  return (
    <>
      <p className="study-muted">{t("HelpDescription")}</p>
      <div className="study-grid">
        {sections.map(([title, body]) => (
          <Panel key={title} title={t(title)}>
            <p className="leading-relaxed study-muted">{t(body)}</p>
          </Panel>
        ))}
      </div>
      <div>
        <Button variant="outline" onClick={replay}>
          {t("ReplayOnboarding")}
        </Button>
      </div>
    </>
  );
}
function Onboarding({
  open,
  onDone,
  navigate,
}: {
  open: boolean;
  onDone: () => void;
  navigate: Navigate;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const action = useSaveAppSettings();
  const steps = [
    ["OnboardingWelcomeTitle", "OnboardingWelcomeIntro"],
    ["OnboardingCaptureTitle", "OnboardingCaptureText"],
    ["OnboardingAskTitle", "OnboardingAskText"],
    ["OnboardingReviewTitle", "OnboardingReviewText"],
    ["OnboardingAiTitle", "OnboardingAiIntro"],
    ["OnboardingReadyTitle", "OnboardingReadyIntro"],
  ] as const;
  const finish = () =>
    action.mutate(
      { onboarded: true },
      {
        onSuccess: () => {
          setStep(0);
          onDone();
        },
      },
    );
  return (
    <Modal
      open={open}
      onClose={finish}
      title={steps[step][0]}
      footer={
        <>
          <Button variant="ghost" disabled={action.isPending} onClick={finish}>
            {t("OnboardingSkip")}
          </Button>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              {t("Back")}
            </Button>
          )}
          <Button
            disabled={action.isPending}
            onClick={() =>
              step === steps.length - 1 ? finish() : setStep((s) => s + 1)
            }
          >
            {t(
              step === steps.length - 1 ? "OnboardingFinish" : "OnboardingNext",
            )}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed">{t(steps[step][1])}</p>
      <div className="flex gap-2 my-5">
        {steps.map((_, at) => (
          <span
            key={at}
            className={`h-1.5 flex-1 rounded ${at <= step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>
      {step === 4 && (
        <Button
          variant="outline"
          onClick={() => {
            finish();
            navigate("Settings");
          }}
        >
          {t("OnboardingOpenAiSettings")}
        </Button>
      )}
      <Pending error={action.error} />
    </Modal>
  );
}
