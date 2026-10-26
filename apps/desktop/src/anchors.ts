import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnchorSchema, type Anchor } from "./generated/study_pb";
export function encodeAnchor(anchor: Anchor): string {
  return btoa(String.fromCharCode(...toBinary(AnchorSchema, anchor)));
}
export function decodeAnchor(value: string | null): Anchor | undefined {
  if (!value || value.length > 16_384) return undefined;
  try {
    return fromBinary(
      AnchorSchema,
      Uint8Array.from(atob(value), (char) => char.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
}
export function anchorsOverlap(left?: Anchor, right?: Anchor): boolean {
  if (!left || !right || left.kind.case !== right.kind.case) return false;
  switch (left.kind.case) {
    case "page":
      return right.kind.case === "page" && left.kind.value === right.kind.value;
    case "slide":
      return (
        right.kind.case === "slide" && left.kind.value === right.kind.value
      );
    case "paragraph":
      return (
        right.kind.case === "paragraph" && left.kind.value === right.kind.value
      );
    case "time":
      return (
        right.kind.case === "time" &&
        ((left.kind.value.startMs < right.kind.value.endMs &&
          right.kind.value.startMs < left.kind.value.endMs) ||
          left.kind.value.startMs === right.kind.value.startMs)
      );
    case "text":
      return (
        right.kind.case === "text" &&
        left.kind.value.lineStart <= right.kind.value.lineEnd &&
        right.kind.value.lineStart <= left.kind.value.lineEnd
      );
    case "url":
      return (
        right.kind.case === "url" &&
        left.kind.value.url === right.kind.value.url
      );
    default:
      return false;
  }
}
