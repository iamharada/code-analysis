import os
import json
import difflib
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse

app = FastAPI()

LOG_ROOT = os.environ.get("LOG_ROOT", "/data/log_jsonl")


def user_dir(uid): return os.path.join(LOG_ROOT, uid)

@app.get("/api/users")
def users():
    return sorted(d for d in os.listdir(LOG_ROOT) if d.startswith("user_"))

@app.get("/api/users/{user}/tasks")
def tasks(user: str):
    path = user_dir(user)
    if not os.path.isdir(path):
        raise HTTPException(404)
    tasks = []
    for f in os.listdir(path):
        if "task" in f:
            t = int(f.split("task")[1].split(".")[0])
            tasks.append(t)
    return sorted(tasks)

def load_events(user, task):
    fn = f"user{int(user.split('_')[1]):03d}_task{task:03d}.jsonl"
    path = os.path.join(user_dir(user), fn)
    if not os.path.exists(path):
        raise HTTPException(404)
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f]

@app.get("/api/users/{user}/tasks/{task}/events")
def events(user: str, task: int):
    evs = load_events(user, task)
    return [{"idx": i, "ts": e["ts"], "event": e["event"]} for i,e in enumerate(evs)]

@app.get("/api/users/{user}/tasks/{task}/events/{idx}")
def event_detail(user: str, task: int, idx: int):
    evs = load_events(user, task)
    return evs[idx]

@app.get("/api/users/{user}/tasks/{task}/diff/{idx}", response_class=PlainTextResponse)
def get_diff(user: str, task: int, idx: int):
    events = load_events(user, task)  # ←あなたの既存関数でOK
    if idx <= 0 or idx >= len(events):
        return ""

    before = events[idx - 1].get("code") or ""
    after = events[idx].get("code") or ""

    d = difflib.unified_diff(
        before.splitlines(),
        after.splitlines(),
        fromfile="prev",
        tofile="current",
        lineterm=""
    )
    return "\n".join(d)
