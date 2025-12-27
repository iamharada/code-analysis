#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flatten logs into per-user per-task JSONL files with a unified schema.

Input (example):
log/
├── user_001/
│   ├── task_1/
│   │   ├── run.json
│   │   ├── auto_save.json
│   │   └── ai-help.json
│   └── task_10/
│       └── ...

Output (example):
log_jsonl/
├── user_021/
│   ├── user021_task014.jsonl
│   └── user021_task039.jsonl
└── user_022/
    └── ...

Unified schema keys (always present):
ts, user_id, username, task, event, code,
stdout, stderr,
estimated_stage, next_stage, processing_structure, advice
"""

import argparse
import json
import os
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple


UNIFIED_KEYS = [
    "ts",
    "user_id",
    "username",
    "task",
    "event",
    "code",
    "stdout",
    "stderr",
    "estimated_stage",
    "next_stage",
    "processing_structure",
    "advice",
]


USER_DIR_RE = re.compile(r"^user_(\d+)$")
TASK_DIR_RE = re.compile(r"^task_(\d+)$")


def to_int_or_none(x: Any) -> Optional[int]:
    if x is None:
        return None
    if isinstance(x, int):
        return x
    if isinstance(x, str):
        s = x.strip()
        if s.isdigit():
            return int(s)
    return None


def parse_iso_ts(ts: Any) -> Optional[datetime]:
    """Best-effort parse for sorting. Accepts 'Z'."""
    if not isinstance(ts, str):
        return None
    s = ts.strip()
    try:
        # Handle trailing Z
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except Exception:
        return None


def pad_user_id(user_id: str) -> str:
    """
    Normalize to 'user_XXX' where XXX is 3+ digits.
    Accepts: 'user_21', 'user_021', '21', 21
    """
    if isinstance(user_id, int):
        n = user_id
    else:
        m = re.search(r"(\d+)", str(user_id))
        n = int(m.group(1)) if m else 0
    return f"user_{n:03d}"


def filename_user_task(user_id: str, task_num: int) -> str:
    u = re.search(r"(\d+)", user_id)
    unum = int(u.group(1)) if u else 0
    return f"user{unum:03d}_task{task_num:03d}.jsonl"


def read_json_or_jsonl(path: str) -> Iterable[Dict[str, Any]]:
    """
    - If .jsonl: yield each JSON object per line
    - Else: treat as single JSON object
    """
    if path.lower().endswith(".jsonl"):
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        yield obj
                except json.JSONDecodeError as e:
                    raise RuntimeError(f"JSONL parse error: {path}:{i}: {e}") from e
    else:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
            if isinstance(obj, dict):
                yield obj
            elif isinstance(obj, list):
                # just in case someone stored a list of events in a .json
                for it in obj:
                    if isinstance(it, dict):
                        yield it


def normalize_event(raw: Dict[str, Any], fallback_user: Optional[str], fallback_task: Optional[int]) -> Dict[str, Any]:
    """
    Map your current formats (run/auto_save/ai-help) into one unified schema.
    Missing fields are set to None.
    """
    event_type = raw.get("event") or raw.get("type") or raw.get("event_type")
    # accept common variants
    if isinstance(event_type, str):
        event_type = event_type.strip()

    user_id = raw.get("userId") or raw.get("user_id") or raw.get("user") or fallback_user
    username = raw.get("username") or raw.get("userName") or raw.get("name")

    task_num = to_int_or_none(raw.get("taskNumber") or raw.get("task") or raw.get("task_id"))
    if task_num is None:
        task_num = fallback_task

    # unified output
    out: Dict[str, Any] = {k: None for k in UNIFIED_KEYS}

    out["ts"] = raw.get("timestamp") or raw.get("ts") or raw.get("time") or raw.get("occurred_at")
    out["user_id"] = pad_user_id(user_id) if user_id is not None else None
    out["username"] = username
    out["task"] = task_num
    out["event"] = event_type
    out["code"] = raw.get("code")

    # run payload
    out["stdout"] = raw.get("stdout")
    out["stderr"] = raw.get("stderr")

    # ai_help payload
    out["estimated_stage"] = raw.get("estimated_stage")
    out["next_stage"] = raw.get("next_stage")
    out["processing_structure"] = raw.get("processing_structure")
    out["advice"] = raw.get("advice")

    return out


def discover_user_task_from_path(path: str) -> Tuple[Optional[str], Optional[int]]:
    """
    Try to infer (user_id, task_num) from directory structure:
    .../user_001/task_14/xxx.json  -> ('user_001', 14)
    """
    parts = os.path.normpath(path).split(os.sep)
    user_id = None
    task_num = None
    for p in parts:
        um = USER_DIR_RE.match(p)
        if um:
            user_id = f"user_{int(um.group(1)):03d}"
        tm = TASK_DIR_RE.match(p)
        if tm:
            task_num = int(tm.group(1))
    return user_id, task_num


def iter_input_files(root: str) -> Iterable[str]:
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.startswith("."):
                continue
            low = fn.lower()
            if low.endswith(".json") or low.endswith(".jsonl"):
                yield os.path.join(dirpath, fn)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_dir", required=True, help="input root dir (e.g., log)")
    ap.add_argument("--out", dest="out_dir", required=True, help="output root dir (e.g., log_jsonl)")
    ap.add_argument("--sort", action="store_true", help="sort events by ts within each user-task before writing")
    ap.add_argument("--append", action="store_true", help="append to existing output files instead of overwriting")
    args = ap.parse_args()

    in_dir = args.in_dir
    out_dir = args.out_dir

    # Collect events per (user_id, task)
    buckets: Dict[Tuple[str, int], List[Dict[str, Any]]] = defaultdict(list)

    for fp in iter_input_files(in_dir):
        fb_user, fb_task = discover_user_task_from_path(fp)
        for raw in read_json_or_jsonl(fp):
            ev = normalize_event(raw, fallback_user=fb_user, fallback_task=fb_task)

            # Skip if we still can't identify user/task
            if not ev.get("user_id") or ev.get("task") is None:
                continue

            buckets[(ev["user_id"], int(ev["task"]))].append(ev)

    # Write outputs
    for (user_id, task_num), events in buckets.items():
        if args.sort:
            events.sort(key=lambda e: (parse_iso_ts(e.get("ts")) or datetime.min))

        user_folder = os.path.join(out_dir, user_id)
        os.makedirs(user_folder, exist_ok=True)

        out_path = os.path.join(user_folder, filename_user_task(user_id, task_num))
        mode = "a" if args.append else "w"

        with open(out_path, mode, encoding="utf-8") as f:
            for ev in events:
                # ensure key order & always all keys
                row = {k: ev.get(k, None) for k in UNIFIED_KEYS}
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"Done. Wrote {len(buckets)} file(s) under: {out_dir}")


if __name__ == "__main__":
    main()
