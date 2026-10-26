import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { Square, X } from "lucide-react";
import { Button, Pending } from "../components";
import { useI18n, type MessageKey } from "../i18n";
import {
  startRecording,
  stopRecording,
  sendRecording,
  discardRecording,
  acknowledgeRecording,
  useRecordingStatus,
  type RecordingStatus,
  type RecordingTarget,
  type RecordingEvent,
  type RecordingPhase,
} from "../rpc/native";
const idle: RecordingStatus = {
  revision: "0",
  phase: "idle",
  recordingId: null,
  sessionId: null,
  projectId: null,
  seconds: 0,
  level: 0,
  ended: true,
  events: [],
};
const api = {
  start: (target: RecordingTarget) => startRecording(target),
  stop: () => stopRecording(),
  send: (id: string) => sendRecording(id),
  discard: (id: string) => discardRecording(id),
  ack: (through: string) => acknowledgeRecording(through),
};
export class RecordingController {
  status: RecordingStatus = idle;
  intent?: RecordingTarget & { phase: RecordingPhase };
  events = new Map<string, RecordingEvent>();
  error: Error | null = null;
  completed = 0;
  private revision = 0;
  private listeners = new Set<() => void>();
  private acknowledged = 0n;
  constructor(private readonly commands = api) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  observe(status: RecordingStatus) {
    if (BigInt(status.revision) < BigInt(this.status.revision)) return;
    this.status = status;
    for (const event of status.events)
      if (BigInt(event.id) > this.acknowledged)
        this.events.set(event.id, event);
    this.changed();
  }
  get phase() {
    return this.intent?.phase ?? this.status.phase;
  }
  get owner() {
    return this.intent ?? this.status;
  }
  get busy() {
    return this.phase !== "idle";
  }
  protectsSession = (id: string) =>
    [this.intent, this.status.phase !== "idle" ? this.status : undefined].some(
      (owner) => owner && (!owner.sessionId || owner.sessionId === id),
    );
  protectsProject = (id: string) =>
    [this.intent, this.status.phase !== "idle" ? this.status : undefined].some(
      (owner) => owner && (!owner.projectId || owner.projectId === id),
    );
  private async perform(
    phase: RecordingPhase,
    target: RecordingTarget,
    work: () => Promise<RecordingStatus | void>,
  ) {
    if (this.busy) return;
    this.intent = { ...target, phase };
    this.error = null;
    this.changed();
    try {
      const status = await work();
      if (status) this.observe(status);
      this.completed++;
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.intent = undefined;
      this.changed();
    }
  }
  start = (target: RecordingTarget) =>
    this.perform("starting", target, () => this.commands.start(target));
  stop = async () => {
    if (this.intent || this.status.phase !== "live") return;
    const target = {
      sessionId: this.status.sessionId!,
      projectId: this.status.projectId ?? undefined,
      recordingId: this.status.recordingId ?? undefined,
    };
    this.intent = { ...target, phase: "stopping" };
    this.error = null;
    this.changed();
    try {
      this.observe(await this.commands.stop());
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.intent = undefined;
      this.changed();
    }
  };
  send = (target: RecordingTarget) =>
    this.perform("sending", target, () =>
      this.commands.send(target.recordingId!),
    );
  discard = (target: RecordingTarget) =>
    this.perform("discarding", target, () =>
      this.commands.discard(target.recordingId!),
    );
  async acknowledge(events: RecordingEvent[]) {
    if (!events.length) return;
    const newest = events.reduce((a, b) =>
      BigInt(a.id) > BigInt(b.id) ? a : b,
    ).id;
    await this.commands.ack(newest);
    this.acknowledged =
      BigInt(newest) > this.acknowledged ? BigInt(newest) : this.acknowledged;
    for (const event of events)
      if (
        !["full", "failed", "save_failed", "microphone_failed"].includes(
          event.kind,
        )
      )
        this.events.delete(event.id);
    this.changed();
  }
  dismiss = (id: string) => {
    this.events.delete(id);
    this.changed();
  };
}
const Context = createContext<RecordingController | null>(null);
function useController(shared: RecordingController | null) {
  const [fallback] = useState(() => new RecordingController());
  const controller = shared ?? fallback;
  const query = useRecordingStatus();
  const client = useQueryClient();
  useEffect(() => {
    if (controller.completed) void client.invalidateQueries();
  }, [client, controller, controller.completed]);
  useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    if (!shared && query.data) controller.observe(query.data);
  }, [shared, query.data, controller]);
  return controller;
}
export function useRecording() {
  return useController(useContext(Context));
}
export function RecordingProvider({
  children,
  controller: provided,
}: {
  children: ReactNode;
  controller?: RecordingController;
}) {
  const [controller] = useState(() => provided ?? new RecordingController());
  const query = useRecordingStatus();
  const client = useQueryClient();
  useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    if (query.data) controller.observe(query.data);
  }, [controller, query.data]);
  useEffect(() => {
    if (controller.completed) void client.invalidateQueries();
  }, [client, controller, controller.completed]);
  const events = [...controller.events.values()];
  const observed = useRef(new Set<string>());
  // This effect runs after the notices below commit to the DOM. Native acknowledgement
  // never races query receipt ahead of presentation, and local notices survive route changes.
  useEffect(() => {
    const fresh = events.filter((event) => !observed.current.has(event.id));
    if (!fresh.length) return;
    for (const event of fresh) observed.current.add(event.id);
    void client.invalidateQueries();
    void controller.acknowledge(fresh).catch(() => {
      for (const event of fresh) observed.current.delete(event.id);
    });
  }, [events, controller, client]);
  return (
    <Context value={controller}>
      <div className="flex h-full min-h-0 flex-col">
        <RecordingNotices controller={controller} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </Context>
  );
}
const notice: Partial<Record<RecordingEvent["kind"], MessageKey>> = {
  full: "RecordingFull",
  failed: "RecordingFailed",
  save_failed: "RecordingSaveError",
  microphone_failed: "MicrophoneError",
};
function RecordingNotices({ controller }: { controller: RecordingController }) {
  const { t } = useI18n();
  return (
    <div
      className="max-h-[35vh] shrink-0 space-y-2 overflow-y-auto"
      aria-live="polite"
    >
      {controller.busy && (
        <div className="study-panel study-toolbar" role="status">
          <span>
            {t(controller.phase === "live" ? "RecordingLive" : "Saving")} ·{" "}
            {controller.status.seconds} {t("UnitSeconds")}
          </span>
          {controller.phase === "live" && (
            <meter
              min={0}
              max={1}
              value={controller.status.level}
              aria-label={t("RecordingLive")}
            />
          )}
          {controller.owner.sessionId && (
            <a href={`#Sessions?id=${controller.owner.sessionId}`}>
              {t("OpenSession")}
            </a>
          )}
          <Button
            variant="destructive-outline"
            disabled={controller.phase !== "live"}
            onClick={() => void controller.stop().catch(() => {})}
          >
            <Square />
            {t("StopRecording")}
          </Button>
        </div>
      )}
      {[...controller.events.values()].map(
        (event) =>
          notice[event.kind] && (
            <div
              className="study-panel study-toolbar"
              role="alert"
              key={event.id}
            >
              <span>{t(notice[event.kind]!)}</span>
              {event.sessionId && (
                <a href={`#Sessions?id=${event.sessionId}`}>
                  {t("OpenSession")}
                </a>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("Close")}
                onClick={() => controller.dismiss(event.id)}
              >
                <X />
              </Button>
            </div>
          ),
      )}
      <Pending error={controller.error} />
    </div>
  );
}
export const canRecordNatively = isTauri;
