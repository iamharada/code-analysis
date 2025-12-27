from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Optional
import os
import re
import json
from pathlib import Path

app = FastAPI()

# CORS（Vite devから叩く想定）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG_ROOT = Path(os.environ.get("LOG_ROOT", "/data/log_jsonl"))

USER_DIR_RE = re.compile(r"^user_\d+$")
TASK_FILE_RE = re.compile(r"^user\d+_task(\d+)\.jsonl$")


def must_exist_dir(p: Path) -> None:
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=500, detail=f"LOG_ROOT not found: {str(p)}")


def normalize_event(obj: Dict[str, Any], idx: int) -> Dict[str, Any]:
    """
    既存ログ（auto_save / run / ai-help）を壊さず、フロントが読みやすいキーに寄せる
    """
    ts = obj.get("timestamp") or obj.get("ts") or obj.get("time") or obj.get("datetime")
    user = obj.get("user") or obj.get("userId") or obj.get("username")
    task = obj.get("task") or obj.get("taskNumber") or obj.get("task_id")
    event_type = obj.get("event") or obj.get("type")

    code = obj.get("code") or obj.get("source") or obj.get("program")

    stdout = obj.get("stdout")
    stderr = obj.get("stderr")

    # もし run: {stdout, stderr} みたいな構造が来ても拾う
    run_obj = obj.get("run") if isinstance(obj.get("run"), dict) else {}
    if stdout is None:
        stdout = run_obj.get("stdout")
    if stderr is None:
        stderr = run_obj.get("stderr")

    estimated_stage = obj.get("estimated_stage")
    next_stage = obj.get("next_stage")
    processing_structure = obj.get("processing_structure")
    advice = obj.get("advice")

    return {
        "idx": idx,
        "ts": ts,
        "user": user,
        "task": task,
        "event": event_type,
        "code": code,
        "stdout": stdout,
        "stderr": stderr,
        "estimated_stage": estimated_stage,
        "next_stage": next_stage,
        "processing_structure": processing_structure,
        "advice": advice,
        "raw": obj,  # デバッグ用に生ログも返す
    }


def read_jsonl_events(path: Path) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    if not path.exists():
        return events
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        idx = 0
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                # 壊れ行は飛ばす（必要ならここでログ出し）
                continue
            events.append(normalize_event(obj, idx))
            idx += 1
    return events


@app.get("/api/health")
def health():
    return {"ok": True, "log_root": str(LOG_ROOT)}


@app.get("/api/users")
def users():
    must_exist_dir(LOG_ROOT)
    dirs = [p.name for p in LOG_ROOT.iterdir() if p.is_dir() and USER_DIR_RE.match(p.name)]
    return sorted(dirs)


@app.get("/api/users/{user}/tasks")
def tasks(user: str):
    must_exist_dir(LOG_ROOT)
    user_dir = LOG_ROOT / user
    if not user_dir.exists() or not user_dir.is_dir():
        raise HTTPException(status_code=404, detail="User not found")

    task_nums: List[int] = []
    for p in user_dir.iterdir():
        if not p.is_file():
            continue
        m = TASK_FILE_RE.match(p.name)
        if not m:
            continue
        task_nums.append(int(m.group(1)))

    task_nums.sort()
    return task_nums


@app.get("/api/users/{user}/tasks/{task}/events")
def events(user: str, task: int):
    must_exist_dir(LOG_ROOT)
    user_dir = LOG_ROOT / user
    if not user_dir.exists() or not user_dir.is_dir():
        raise HTTPException(status_code=404, detail="User not found")

    # user021_task014.jsonl 形式
    # user_021 の数字部分は user021 にしたいので、 user_021 -> user021 を作る
    user_digits = re.sub(r"\D", "", user)  # "user_021" -> "021"
    filename = f"user{user_digits}_task{int(task):03d}.jsonl"
    path = user_dir / filename

    evs = read_jsonl_events(path)
    return {
        "user": user,
        "task": task,
        "count": len(evs),
        "events": evs,
    }
