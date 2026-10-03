#!/usr/bin/env python3
"""Report locally recorded Claude Code token usage.

This intentionally reports only what is present in Claude Code's local JSONL
transcripts.  It cannot say how much of a user's subscription allowance
remains.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)
_NON_ALPHANUMERIC = re.compile(r"[^A-Za-z0-9]")


def encoded_project_path(repo: Path) -> str:
    """Return Claude Code's directory encoding for a repository path."""

    return _NON_ALPHANUMERIC.sub("-", str(repo.resolve()))


def default_logs_path() -> Path:
    """Return the local Claude project directory for this checkout."""

    repo = Path(__file__).resolve().parents[2]
    return Path.home() / ".claude" / "projects" / encoded_project_path(repo)


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_synthetic_model(model: str) -> bool:
    # Synthetic records are internal and excluded from usage.
    normalized = model.strip().lower()
    return normalized in {"synthetic", "<synthetic>", "<synthetic_model>"}


def _token_value(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value) if value >= 0 else None
    return None


@dataclass
class _UsageEntry:
    """Maximum token usage for one deduplicated message/request identity.

    Streaming responses can write several snapshots for the same identity.
    Token totals are maxima, while session IDs are accumulated for unique
    model-level session counts.
    """

    model: str
    session_ids: set[str] = field(default_factory=set)
    totals: dict[str, int] = field(
        default_factory=lambda: {field_name: 0 for field_name in TOKEN_FIELDS}
    )

    def update(self, values: dict[str, int], session_id: str | None) -> None:
        # A replayed snapshot may contain lower totals than the final snapshot.
        # A field-by-field max keeps the final value without double-counting.
        for field_name, value in values.items():
            self.totals[field_name] = max(self.totals[field_name], value)
        if session_id:
            self.session_ids.add(session_id)


def _jsonl_files(logs_path: Path) -> Iterator[Path]:
    """Yield all transcript files, including nested subagent logs."""

    yield from sorted(path for path in logs_path.rglob("*.jsonl") if path.is_file())


def _record_timestamp(record: dict[str, Any]) -> datetime | None:
    timestamp = _parse_timestamp(record.get("timestamp"))
    if timestamp is not None:
        return timestamp
    message = record.get("message")
    if isinstance(message, dict):
        return _parse_timestamp(message.get("timestamp"))
    return None


def _session_id(record: dict[str, Any]) -> str | None:
    value = record.get("sessionId", record.get("session_id"))
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _request_id(record: dict[str, Any], message: dict[str, Any]) -> str | None:
    for value in (
        record.get("requestId"),
        record.get("request_id"),
        message.get("requestId"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _parse_usage_record(
    record: Any,
) -> tuple[tuple[str, ...], str, dict[str, int], str | None, bool] | None:
    """Parse one assistant record into stable reporting fields.

    None means the record is irrelevant, such as a user or synthetic record.
    ValueError means it looked like a real assistant usage record but was
    incomplete. The final boolean flags a malformed token field; usable fields
    are still retained.
    """

    if not isinstance(record, dict) or record.get("type") != "assistant":
        return None
    if record.get("isSynthetic") is True:
        return None
    message = record.get("message")
    if not isinstance(message, dict):
        raise ValueError("assistant record has no message object")
    usage = message.get("usage")
    if not isinstance(usage, dict):
        raise ValueError("assistant record has no usage object")
    model = message.get("model")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("assistant usage record has no model")
    if _is_synthetic_model(model):
        return None

    message_id = message.get("id")
    if isinstance(message_id, str):
        message_id = message_id.strip() or None
    else:
        message_id = None
    request_id = _request_id(record, message)
    if not message_id and not request_id:
        raise ValueError("assistant usage record has no message id or request id")
    key = (message_id or "", request_id or "")

    values: dict[str, int] = {}
    invalid_field = False
    for field_name in TOKEN_FIELDS:
        if field_name not in usage:
            continue
        value = _token_value(usage[field_name])
        if value is None:
            invalid_field = True
        else:
            values[field_name] = value
    if not values:
        raise ValueError("assistant usage record has no usable token fields")
    return key, model.strip(), values, _session_id(record), invalid_field


def collect_report(
    logs_path: Path, hours: float, now: datetime | None = None
) -> dict[str, Any]:
    """Collect local recorded usage for one UTC time window.

    Records are filtered before deduplication. Each in-window identity then
    contributes one message with the maximum observed value of each token
    field, which avoids both replay double-counting and partial totals.
    """

    if not math.isfinite(hours) or hours <= 0:
        raise ValueError("hours must be a positive finite number")
    if not logs_path.is_dir():
        raise FileNotFoundError(f"Claude project log directory does not exist: {logs_path}")

    until = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    since = until - timedelta(hours=hours)
    entries: dict[tuple[str, ...], _UsageEntry] = {}
    malformed = 0

    for path in _jsonl_files(logs_path):
        # Each line is independent, so one truncated record cannot abort the
        # remaining transcript scan.
        try:
            lines = path.open(encoding="utf-8", errors="replace")
        except OSError:
            malformed += 1
            continue
        with lines:
            for line in lines:
                try:
                    record = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    malformed += 1
                    continue
                if not isinstance(record, dict) or record.get("type") != "assistant":
                    continue
                timestamp = _record_timestamp(record)
                if timestamp is None:
                    malformed += 1
                    continue
                # _record_timestamp normalized offsets to UTC for this
                # inclusive window check.
                if timestamp < since or timestamp > until:
                    continue
                try:
                    parsed = _parse_usage_record(record)
                except ValueError:
                    malformed += 1
                    continue
                if parsed is None:
                    continue
                key, model, values, session_id, has_invalid_field = parsed
                if has_invalid_field:
                    malformed += 1
                entry = entries.get(key)
                if entry is None:
                    entry = _UsageEntry(model=model)
                    entries[key] = entry
                entry.update(values, session_id)

    # Keep session sets while aggregating so many messages in one session
    # count once for the model and once for the global report.
    by_model: dict[str, dict[str, Any]] = {}
    model_sessions: dict[str, set[str]] = {}
    all_sessions: set[str] = set()
    totals = {field_name: 0 for field_name in TOKEN_FIELDS}
    for entry in entries.values():
        model_report = by_model.setdefault(
            entry.model,
            {field_name: 0 for field_name in TOKEN_FIELDS} | {"messages": 0, "sessions": 0},
        )
        model_report["messages"] += 1
        model_sessions.setdefault(entry.model, set()).update(entry.session_ids)
        all_sessions.update(entry.session_ids)
        for field_name, value in entry.totals.items():
            totals[field_name] += value
            model_report[field_name] += value
    for model, session_ids in model_sessions.items():
        by_model[model]["sessions"] = len(session_ids)

    report: dict[str, Any] = {
        "scope": "local recorded usage",
        "logs": str(logs_path),
        "hours": hours,
        "since_utc": since.isoformat().replace("+00:00", "Z"),
        "until_utc": until.isoformat().replace("+00:00", "Z"),
        "messages": len(entries),
        "sessions": len(all_sessions),
        "malformed_records": malformed,
        "by_model": dict(sorted(by_model.items())),
    }
    report.update(totals)
    if malformed:
        report["warning"] = (
            f"Skipped {malformed} malformed or incomplete assistant record(s); "
            "usage is local recorded usage only."
        )
    return report


def _positive_finite_hours(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("hours must be a positive finite number") from exc
    if not math.isfinite(parsed) or parsed <= 0:
        raise argparse.ArgumentTypeError("hours must be a positive finite number")
    return parsed


def _print_table(report: dict[str, Any]) -> None:
    print(f"Local recorded usage for the last {report['hours']:g} UTC hour(s)")
    print(f"Logs: {report['logs']}")
    print(f"Messages: {report['messages']}    Sessions: {report['sessions']}")
    print(
        "Totals: "
        + "  ".join(f"{field_name}={report[field_name]}" for field_name in TOKEN_FIELDS)
    )
    if report["by_model"]:
        print("\nModel usage:")
        columns = ("model", "messages", "sessions", *TOKEN_FIELDS)
        print("  ".join(columns))
        for model, values in report["by_model"].items():
            print(
                "  ".join(
                    [model, str(values["messages"]), str(values["sessions"])]
                    + [str(values[field_name]) for field_name in TOKEN_FIELDS]
                )
            )
    else:
        print("No matching assistant usage records.")
    if report["malformed_records"]:
        print(f"Warning: {report['malformed_records']} malformed or incomplete record(s) skipped.", file=sys.stderr)
    print("This is local recorded usage; it does not report remaining plan allowance.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report local Claude Code JSONL usage.")
    parser.add_argument("--hours", type=_positive_finite_hours, default=24.0)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--logs", type=Path, default=default_logs_path())
    args = parser.parse_args(argv)

    try:
        report = collect_report(args.logs.expanduser(), args.hours)
    except (FileNotFoundError, ValueError) as exc:
        error = {"error": str(exc), "logs": str(args.logs.expanduser())}
        if args.as_json:
            print(json.dumps(error, sort_keys=True))
        else:
            print(f"Error: {exc}", file=sys.stderr)
            print("Pass --logs PATH to select a Claude project log directory.", file=sys.stderr)
        return 2

    if args.as_json:
        print(json.dumps(report, sort_keys=True))
    else:
        _print_table(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
