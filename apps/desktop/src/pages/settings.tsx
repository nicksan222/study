import { useInstallation } from "../hooks/installation-state";
import { useSaveAppSettings } from "../hooks/app-settings";
import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { rpc } from "../rpc/client";
import { openExternal } from "../rpc/native";
import {
  Appearance,
  Placement,
  type Report,
  type ModelStatus,
  Language,
  LocalModel,
  LlmModel,
  LlmProvider,
  ExtractorKind,
  RefinerKind,
  type AppSettings,
  type LlmSettings,
  type Processor,
} from "../generated/study_pb";
import { useI18n, type MessageKey } from "../i18n";
import {
  Button,
  Input,
  Field,
  Panel,
  Pending,
  Load,
  useData,
  useAction,
  sourceKey,
  stageKey,
} from "../components";
export function SettingsPage({ settings }: { settings: AppSettings }) {
  const { t } = useI18n();
  const [section, setSection] = useState<MessageKey>("SettingsGeneral");
  const sections: MessageKey[] = [
    "SettingsGeneral",
    "Llm",
    "Transcription",
    "System",
    "Processing",
    "Updates",
  ];
  return (
    <div className="study-split">
      <Panel>
        {sections.map((key) => (
          <Button
            key={key}
            className="w-full justify-start mb-1"
            variant={section === key ? "secondary" : "ghost"}
            onClick={() => setSection(key)}
          >
            {t(key)}
          </Button>
        ))}
      </Panel>
      <div className="space-y-5">
        {section === "SettingsGeneral" ? (
          <General settings={settings} />
        ) : section === "Llm" ? (
          <LlmSettingsPage />
        ) : section === "Transcription" ? (
          <Transcription />
        ) : section === "System" ? (
          <SystemSettings />
        ) : section === "Processing" ? (
          <Processing />
        ) : (
          <Updates />
        )}
      </div>
    </div>
  );
}
function General({ settings }: { settings: AppSettings }) {
  const { t } = useI18n();
  const action = useSaveAppSettings();
  const save = action.mutate;
  return (
    <>
      <Panel title={t("Language")}>
        <p className="study-muted">{t("LanguageDescription")}</p>
        <div className="study-toolbar mt-3">
          {([Language.ENGLISH, Language.ITALIAN] as const).map((language) => (
            <Button
              key={language}
              variant={settings.language === language ? "default" : "outline"}
              disabled={action.isPending}
              onClick={() => save({ language })}
            >
              {t(
                language === Language.ENGLISH
                  ? "EnglishOwnName"
                  : "ItalianOwnName",
              )}
            </Button>
          ))}
        </div>
      </Panel>
      <Panel title={t("Appearance")}>
        <p className="study-muted">{t("AppearanceDescription")}</p>
        <div className="study-toolbar mt-3">
          {([Appearance.LIGHT, Appearance.DARK] as const).map((appearance) => (
            <Button
              key={appearance}
              variant={
                settings.appearance === appearance ? "default" : "outline"
              }
              disabled={action.isPending}
              onClick={() => save({ appearance })}
            >
              {t(appearance === Appearance.LIGHT ? "Light" : "Dark")}
            </Button>
          ))}
        </div>
        <Field label="TextSize">
          <select
            className="study-select"
            value={settings.zoomPercent}
            disabled={action.isPending}
            onChange={(e) => save({ zoomPercent: Number(e.target.value) })}
          >
            {[75, 90, 100, 110, 125, 150, 175, 200].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </Field>
      </Panel>
      <Pending error={action.error} />
    </>
  );
}
function LlmSettingsPage() {
  const { t } = useI18n();
  const settings = useData(["llm-settings"], () => rpc.getLlmSettings({}));
  const connections = useData(["connections"], () => rpc.connections({}));
  const action = useAction<unknown>();
  const [attempt, setAttempt] = useState<string>();
  const [draft, setDraft] = useState<LlmSettings>();
  const current = draft ?? settings.data;
  const signIn = (reconsent = false) =>
    action.mutate(async () => {
      const result = await rpc.startChatgptSignIn({ reconsent });
      setAttempt(result.attemptId);
      await openExternal(result.url);
    });
  return (
    <>
      <Panel title={t("LlmProviderChatGpt")}>
        <p className="study-muted">{t("LlmChatGptHint")}</p>
        <Load query={connections}>
          {(value) => (
            <>
              <p className="my-3">
                {value.chatgpt
                  ? `${t("LlmChatGptSignedIn")} · ${value.chatgpt.email ?? value.chatgpt.subject}`
                  : t("LlmChatGptSignedOut")}
              </p>
              <div className="study-toolbar">
                {!attempt ? (
                  <>
                    {value.chatgpt ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() => signIn(true)}
                        >
                          {t("LlmChatGptAllowPlan")}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate(() => rpc.signOutChatgpt({}))
                          }
                        >
                          {t("LlmChatGptSignOut")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={action.isPending}
                        onClick={() => signIn()}
                      >
                        {t("LlmChatGptSignIn")}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <span role="status">{t("LlmChatGptWaiting")}</span>
                    <Button
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate(async () => {
                          await rpc.finishChatgptSignIn({ attemptId: attempt });
                          setAttempt(undefined);
                        })
                      }
                    >
                      {t("LlmChatGptBrowserDone")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        action.mutate(async () => {
                          await rpc.cancelChatgptSignIn({ attemptId: attempt });
                          setAttempt(undefined);
                        })
                      }
                    >
                      {t("Cancel")}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Load>
      </Panel>
      <Panel title={t("LlmModels")}>
        <Load query={settings}>
          {() =>
            current && (
              <>
                {(["tiny", "medium", "smart"] as const).map((tier, index) => (
                  <Field
                    key={tier}
                    label={
                      (
                        [
                          "LlmTierTiny",
                          "LlmTierMedium",
                          "LlmTierSmart",
                        ] as const
                      )[index]
                    }
                    hint="LlmModelHint"
                  >
                    <select
                      className="study-select"
                      value={current[tier]?.model ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...current,
                          [tier]: {
                            provider: LlmProvider.CHAT_GPT,
                            model: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          },
                        })
                      }
                    >
                      <option value="">{t("LlmProviderChatGpt")}</option>
                      {(
                        [
                          LlmModel.GPT6_LUNA,
                          LlmModel.GPT61_SOL,
                          LlmModel.GPT6_ASTRA,
                        ] as const
                      ).map((model) => (
                        <option value={model} key={model}>
                          {LlmModel[model].replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
                <Button
                  disabled={!draft || action.isPending}
                  onClick={() =>
                    action.mutate(async () => {
                      await rpc.saveLlmSettings(current);
                      setDraft(undefined);
                    })
                  }
                >
                  {t("Save")}
                </Button>
              </>
            )
          }
        </Load>
      </Panel>
      <Pending error={action.error} pending={action.isPending} />
    </>
  );
}
function ModelInstall({
  model,
  title,
}: {
  model: LocalModel;
  title: MessageKey;
}) {
  const { t, number } = useI18n();
  const status = useData(["model-status", model], () =>
    rpc.modelStatus({ model }),
  );
  const action = useAction<unknown>();
  return (
    <Panel title={t(title)}>
      <Load query={status}>
        {(value) => (
          <>
            <p className="study-muted mb-3">
              {t(value.installed ? "LocalModelReady" : "LocalModelMissing")} ·{" "}
              {number(Number(value.sizeBytes) / 1024 ** 2)} {t("UnitMegabytes")}
            </p>
            {!value.installed && (
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate(() => rpc.installModel({ model }))}
              >
                {t(action.isPending ? "DownloadingModel" : "DownloadModel")}
              </Button>
            )}
          </>
        )}
      </Load>
      <Pending error={action.error} />
    </Panel>
  );
}
function Transcription() {
  const { t } = useI18n();
  const settings = useData(["transcription-settings"], () =>
    rpc.getTranscriptionSettings({}),
  );
  const [instances, setInstances] = useState<number>();
  const action = useAction<unknown>();
  return (
    <>
      <ModelInstall model={LocalModel.TRANSCRIPTION} title="Transcription" />
      <Panel title={t("Transcription")}>
        <p className="study-muted">{t("TranscriptionDescription")}</p>
        <Load query={settings}>
          {(value) => (
            <>
              <Field label="ModelCopies" hint="ModelCopiesHint">
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={instances ?? value.localInstances}
                  onChange={(e) => setInstances(Number(e.target.value))}
                />
              </Field>
              <Button
                disabled={
                  action.isPending ||
                  instances === undefined ||
                  instances < 1 ||
                  instances > 8
                }
                onClick={() =>
                  action.mutate(() =>
                    rpc.saveTranscriptionSettings({
                      localInstances: instances!,
                    }),
                  )
                }
              >
                {t("Save")}
              </Button>
            </>
          )}
        </Load>
        <Pending error={action.error} />
      </Panel>
    </>
  );
}
function SystemSettings() {
  const { t, number } = useI18n();
  const search = useData(["model-status", LocalModel.SEARCH], () =>
    rpc.modelStatus({ model: LocalModel.SEARCH }),
  );
  const report = useData(
    ["machine-report"],
    async () => (await rpc.machineReport({})).value,
  );
  const action = useAction<unknown>();
  return (
    <>
      <Panel
        title={t("System")}
        actions={
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate(() => rpc.measureMachine({}))}
          >
            {t("MeasureAgain")}
          </Button>
        }
      >
        <Pending error={action.error} pending={action.isPending} />
        <Load query={report}>
          {(value) =>
            value ? (
              <>
                <ReportPlan report={value} search={search.data} />
                <h3>{t("SysDetected")}</h3>
                <dl className="space-y-2">
                  <div>{value.system?.cpuBrand}</div>
                  <div>
                    {value.system?.os} {value.system?.osVersion} ·{" "}
                    {value.system?.arch}
                  </div>
                  <div>
                    {t("SysCores")}: {number(value.system?.logicalCores ?? 0n)}
                  </div>
                  <div>
                    {t("SysMemory")}:{" "}
                    {number(
                      Number(value.system?.totalMemoryBytes ?? 0n) / 1024 ** 3,
                    )}{" "}
                    {t("UnitGigabytes")}
                  </div>
                  <div>
                    {t("SysMemoryAvailable")}:{" "}
                    {number(
                      Number(value.system?.availableMemoryBytes ?? 0n) /
                        1024 ** 3,
                    )}{" "}
                    {t("UnitGigabytes")}
                  </div>
                  <div>
                    {t("SysSimd")}: {value.system?.simd.join(", ")}
                  </div>
                  <div>
                    {t("SysMatmul")}: {number(value.compute?.matmulGflops ?? 0)}{" "}
                    {t("UnitGigaflops")}
                  </div>
                  <div>
                    {t("SysBandwidth")}:{" "}
                    {number(value.compute?.memoryBandwidthGbps ?? 0)}{" "}
                    {t("UnitBandwidth")}
                  </div>
                </dl>
              </>
            ) : (
              <p>{t("SysNotMeasured")}</p>
            )
          }
        </Load>
      </Panel>
      <ModelInstall model={LocalModel.SEARCH} title="SysSearch" />
    </>
  );
}
export function ReportPlan({
  report,
  search,
}: {
  report: Report;
  search?: ModelStatus;
}) {
  const { t, number } = useI18n();
  const plan = report.plan;
  const placement = plan?.transcription;
  const reason =
    placement === Placement.NOT_ENOUGH_MEMORY
      ? "PlacementNotEnoughMemory"
      : placement === Placement.TOO_SLOW
        ? "PlacementTooSlow"
        : undefined;
  return (
    <section className="mb-5">
      <h3>{t("SysDecided")}</h3>
      <div className="study-row">
        <div className="study-grow">
          <strong>{t("SysTranscription")}</strong>
          {reason && <p className="study-muted">{t(reason)}</p>}
          {plan?.transcriptionInstances !== undefined && (
            <p className="study-muted">
              {t("ModelCopies")}: {number(plan.transcriptionInstances)}
            </p>
          )}
        </div>
        <span>
          {t(
            placement === Placement.LOCAL
              ? "RunsHere"
              : reason
                ? "NotRecommendedHere"
                : "SysNotMeasured",
          )}
        </span>
      </div>
      <div className="study-row">
        <div className="study-grow">
          <strong>{t("SysSearch")}</strong>
          <p className="study-muted">
            {t(search?.installed ? "ModelInstalled" : "SearchModelMissing")}
            {search && !search.installed && (
              <>
                {" "}
                · {number(search.sizeBytes)} {t("UnitBytes")}
              </>
            )}
          </p>
        </div>
        <span>{t("RunsHere")}</span>
      </div>
    </section>
  );
}
export function processorLabel(processor?: Processor): MessageKey {
  if (processor?.kind.case === "extractor")
    return (
      {
        [ExtractorKind.UNSPECIFIED]: "SourceOther",
        [ExtractorKind.TRANSCRIPTION]: "ExtractorTranscription",
        [ExtractorKind.VISION]: "ExtractorVision",
        [ExtractorKind.OFFICE]: "ExtractorOffice",
        [ExtractorKind.WEB]: "ExtractorWeb",
        [ExtractorKind.TEXT]: "ExtractorText",
      } as const
    )[processor.kind.value];
  if (processor?.kind.case === "refiner")
    return processor.kind.value === RefinerKind.TRANSCRIPT
      ? "RefinerTranscript"
      : "RefinerWhitespace";
  if (processor?.kind.case === "stage") return stageKey(processor.kind.value);
  if (processor?.kind.case === "enhancer")
    return processor.kind.value === 1 ? "KindFlashcards" : "KindDiagram";
  return "SourceOther";
}
export function Processing() {
  const { t } = useI18n();
  const [pendingSwitches, setPendingSwitches] = useState<
    Record<string, boolean>
  >({});
  const [pendingSift, setPendingSift] = useState<boolean>();
  const processing = useData(["processing"], () => rpc.processing({}));
  const material = useData(["material-settings"], () =>
    rpc.getMaterialSettings({}),
  );
  const review = useData(["review-settings"], () => rpc.getReviewSettings({}));
  const [cards, setCards] = useState<number>();
  const action = useAction<unknown>();
  return (
    <>
      <Panel title={t("Processing")}>
        <p className="study-muted">{t("ProcessingDescription")}</p>
        <Load query={processing}>
          {(value) =>
            [...new Set(value.switches.map((s) => s.source))].map((source) => (
              <section key={source} className="mt-5">
                <h3>{t(sourceKey(source))}</h3>
                <div className="study-grid">
                  {value.switches
                    .filter((s) => s.source === source)
                    .map((item, index) => (
                      <label key={index} className="study-row">
                        <input
                          type="checkbox"
                          checked={
                            pendingSwitches[`${source}-${index}`] ?? item.on
                          }
                          disabled={action.isPending}
                          onChange={(e) => {
                            const on = e.target.checked;
                            const key = `${source}-${index}`;
                            setPendingSwitches((previous) => ({
                              ...previous,
                              [key]: on,
                            }));
                            action.mutate(
                              () =>
                                rpc.switchProcessor({
                                  kind: item.source,
                                  processor: item.processor,
                                  on,
                                }),
                              {
                                onSettled: () =>
                                  setPendingSwitches((previous) => {
                                    const next = { ...previous };
                                    delete next[key];
                                    return next;
                                  }),
                              },
                            );
                          }}
                        />
                        <span>{t(processorLabel(item.processor))}</span>
                      </label>
                    ))}
                </div>
              </section>
            ))
          }
        </Load>
      </Panel>
      <Panel title={t("ProcessingMaterial")}>
        <Load query={material}>
          {(value) => (
            <label className="study-row">
              <input
                type="checkbox"
                checked={pendingSift ?? value.sift}
                disabled={action.isPending}
                onChange={(e) => {
                  const sift = e.target.checked;
                  setPendingSift(sift);
                  action.mutate(() => rpc.saveMaterialSettings({ sift }), {
                    onSettled: () => setPendingSift(undefined),
                  });
                }}
              />
              <span>
                {t("ProcessingSift")}
                <span className="block study-muted">
                  {t("ProcessingSiftHint")}
                </span>
              </span>
            </label>
          )}
        </Load>
      </Panel>
      <Panel title={t("ReviewDue")}>
        <Load query={review}>
          {(value) => (
            <>
              <Field label="NewCardsPerDay" hint="NewCardsPerDayHint">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={cards ?? value.newCardsPerDay}
                  onChange={(e) => setCards(Number(e.target.value))}
                />
              </Field>
              <Button
                disabled={cards === undefined || cards < 1 || action.isPending}
                onClick={() =>
                  action.mutate(() =>
                    rpc.saveReviewSettings({ newCardsPerDay: cards! }),
                  )
                }
              >
                {t("Save")}
              </Button>
            </>
          )}
        </Load>
      </Panel>
      <Pending error={action.error} pending={action.isPending} />
    </>
  );
}
interface UpdateInfo {
  configured: boolean;
  currentVersion: string;
  version: string | null;
  body: string | null;
}
function Updates() {
  const installation = useInstallation();
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo>();
  const [checked, setChecked] = useState(false);
  const action = useAction<unknown>();
  return (
    <Panel title={t("Updates")}>
      <p className="study-muted mb-3">{t("UpdatesDescription")}</p>
      {!isTauri() ? (
        <p>{t("UpdateUnavailable")}</p>
      ) : (
        <>
          <Button
            disabled={action.isPending}
            onClick={() =>
              action.mutate(async () => {
                setInfo(await invoke<UpdateInfo>("check_update"));
                setChecked(true);
              })
            }
          >
            {t("UpdateCheck")}
          </Button>
          {checked && (
            <div className="my-3">
              {info?.configured
                ? info.version
                  ? `${info.currentVersion} → ${info.version}`
                  : t("UpdateCurrent")
                : t("UpdateUnavailable")}
            </div>
          )}
          {info?.body && (
            <p className="whitespace-pre-wrap my-3">{info.body}</p>
          )}
          {info?.configured && info.version && (
            <Button
              disabled={action.isPending || installation.busy}
              onClick={async () => {
                if (!(await installation.install())) {
                  setInfo(undefined);
                  setChecked(false);
                }
              }}
            >
              {t("UpdateInstall")}
            </Button>
          )}
          {info?.version && installation.busy && !installation.installing && (
            <p className="study-muted mt-3">{t("UpdateBusy")}</p>
          )}
          <Pending error={action.error} pending={action.isPending} />
        </>
      )}
    </Panel>
  );
}
