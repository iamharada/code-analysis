#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import csv
import json
import os
from typing import Any, Dict, Iterable

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

JSON_STRINGIFY_FIELDS = {"processing_structure", "advice"}


def iter_jsonl(path: str) -> Iterable[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"JSONL parse error: {path}:{i}: {e}") from e
            if isinstance(obj, dict):
                yield obj


def ensure_row(obj: Dict[str, Any]) -> Dict[str, Any]:
    row: Dict[str, Any] = {}
    for k in UNIFIED_KEYS:
        v = obj.get(k, None)

        if k in JSON_STRINGIFY_FIELDS and v is not None:
            v = json.dumps(v, ensure_ascii=False)

        if v is None:
            v = ""

        row[k] = v
    return row


def iter_files(root: str) -> Iterable[str]:
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.startswith("."):
                continue
            if fn.lower().endswith(".jsonl"):
                yield os.path.join(dirpath, fn)


def to_out_path(in_path: str, in_root: str, out_root: str) -> str:
    rel = os.path.relpath(in_path, in_root)
    base, _ = os.path.splitext(rel)
    return os.path.join(out_root, base + ".csv")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_dir", required=True, help="input dir (log_jsonl)")
    ap.add_argument("--out", dest="out_dir", required=True, help="output dir (log_csv)")
    ap.add_argument("--delimiter", default=",", help="CSV delimiter (default: ,)")
    args = ap.parse_args()

    in_dir = args.in_dir
    out_dir = args.out_dir

    count_files = 0
    count_rows = 0

    for fp in iter_files(in_dir):
        out_path = to_out_path(fp, in_dir, out_dir)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)

        with open(out_path, "w", encoding="utf-8", newline="") as wf:
            writer = csv.DictWriter(wf, fieldnames=UNIFIED_KEYS, delimiter=args.delimiter)
            writer.writeheader()

            for obj in iter_jsonl(fp):
                writer.writerow(ensure_row(obj))
                count_rows += 1

        count_files += 1

    print(f"Done. Converted {count_files} file(s), wrote {count_rows} row(s) into: {out_dir}")


if __name__ == "__main__":
    main()
