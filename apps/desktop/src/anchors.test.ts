import { create } from "@bufbuild/protobuf";
import { it, expect } from "vitest";
import { AnchorSchema } from "./generated/study_pb";
import { anchorsOverlap, encodeAnchor, decodeAnchor } from "./anchors";
it("routes canonical anchors losslessly, including 64-bit media times", () => {
  const anchor = create(AnchorSchema, {
    kind: {
      case: "time",
      value: { startMs: 9007199254740993n, endMs: 9007199254741993n },
    },
  });
  expect(decodeAnchor(encodeAnchor(anchor))).toEqual(anchor);
  expect(decodeAnchor("invalid % value")).toBeUndefined();
});
it("highlights overlapping anchored passages and distinguishes other pages", () => {
  const page = (n: number) =>
    create(AnchorSchema, { kind: { case: "page", value: n } });
  expect(anchorsOverlap(page(2), page(2))).toBe(true);
  expect(anchorsOverlap(page(1), page(2))).toBe(false);
  const time = (startMs: bigint, endMs: bigint) =>
    create(AnchorSchema, { kind: { case: "time", value: { startMs, endMs } } });
  expect(anchorsOverlap(time(10n, 20n), time(15n, 25n))).toBe(true);
  expect(anchorsOverlap(time(10n, 20n), time(30n, 40n))).toBe(false);
  expect(anchorsOverlap(time(10n, 20n), time(20n, 30n))).toBe(false);
  expect(anchorsOverlap(time(10n, 10n), time(10n, 10n))).toBe(true);
});
