import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { normalizeRpcError } from "./client";
export function fixtureHeaders(): Record<string, string> {
  const id = localStorage.getItem("study.fixture-session");
  return id ? { "x-study-session": id } : {};
}
export async function stageFiles(files: FileList | File[]): Promise<string[]> {
  if (isTauri()) {
    const staged: string[] = [];
    try {
      for (const file of files)
        staged.push(
          await invoke<string>("stage_file", {
            name: file.name,
            bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
          }),
        );
      return staged;
    } catch (error) {
      try {
        await releaseFiles(staged);
      } catch {
        /* Native TempDir retains failed cleanup for process teardown. */
      }
      throw normalizeRpcError(error);
    }
  }
  const data = new FormData();
  for (const file of files) data.append("files", file, file.name);
  const response = await fetch("/rpc/__study/files", {
    method: "POST",
    headers: fixtureHeaders(),
    body: data,
  });
  if (!response.ok) throw normalizeRpcError(await response.json());
  return ((await response.json()) as { paths: string[] }).paths;
}
export async function releaseFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const unique = [...new Set(paths)];
    if (isTauri()) await invoke("release_files", { paths: unique });
    else {
      const response = await fetch("/rpc/__study/files", {
        method: "DELETE",
        headers: { ...fixtureHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ paths: unique }),
      });
      if (!response.ok) throw await response.json();
    }
  } catch (error) {
    throw normalizeRpcError(error);
  }
}
export function useNativeDrop(
  onDrop: (paths: string[]) => void,
  enabled = true,
) {
  const callback = useRef(onDrop);
  callback.current = onDrop;
  useEffect(() => {
    if (!isTauri() || !enabled) return;
    let done = false;
    let remove: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "drop") callback.current(payload.paths);
      })
      .then((unlisten) => {
        if (done) unlisten();
        else remove = unlisten;
      });
    return () => {
      done = true;
      remove?.();
    };
  }, [enabled]);
}
