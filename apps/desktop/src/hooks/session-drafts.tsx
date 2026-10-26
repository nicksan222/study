import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DraftFiles } from "./draft-files";
import { releaseFiles } from "../rpc/files";
class SessionDraft {
  text = "";
  private revision = 0;
  private listeners = new Set<() => void>();
  readonly files = new DraftFiles(releaseFiles, () => this.notify());
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  snapshot = () => this.revision;
  private notify() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  setText(value: string | ((before: string) => string)) {
    this.text = typeof value === "function" ? value(this.text) : value;
    this.notify();
  }
}
export class SessionDraftStore {
  private drafts = new Map<string, SessionDraft>();
  get(session: string, thread?: string) {
    const key = `${session}/${thread ?? "timeline"}`;
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = new SessionDraft();
      this.drafts.set(key, draft);
    }
    return draft;
  }
  async discardSession(session: string) {
    const found = [...this.drafts].filter(([key]) =>
      key.startsWith(`${session}/`),
    );
    for (const [key] of found) this.drafts.delete(key);
    await Promise.all(found.map(([, draft]) => draft.files.dispose()));
  }
  async keepSessions(ids: Set<string>) {
    const missing = new Set(
      [...this.drafts.keys()]
        .map((key) => key.split("/")[0])
        .filter((session) => !ids.has(session)),
    );
    await Promise.all(
      [...missing].map((session) => this.discardSession(session)),
    );
  }
  async dispose() {
    const drafts = [...this.drafts.values()];
    this.drafts.clear();
    await Promise.all(drafts.map((draft) => draft.files.dispose()));
  }
}
const DraftContext = createContext<SessionDraftStore | null>(null);
export function SessionDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SessionDraftStore());
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    return () => {
      queueMicrotask(() => {
        if (generation.current === current)
          void store.dispose().catch(() => {});
      });
    };
  }, [store]);
  return <DraftContext value={store}>{children}</DraftContext>;
}
export function useSessionDraftStore() {
  return useContext(DraftContext);
}
export function useComposerDraft(session: string, thread?: string) {
  const shared = useContext(DraftContext);
  const [local] = useState(() => new SessionDraftStore());
  const store = shared ?? local;
  const draft = useMemo(
    () => store.get(session, thread),
    [store, session, thread],
  );
  useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot);
  useEffect(() => {
    draft.files.activate();
    return () => {
      if (!shared) void draft.files.dispose().catch(() => {});
    };
  }, [draft, shared, local]);
  return draft;
}
