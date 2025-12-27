import { useEffect, useMemo, useState } from "react";

function fmt(s) {
  return s ?? "";
}

/** diffが "\\n" を含む場合でも実改行に復元して統一 */
function normalizeNewlines(text) {
  const t = text ?? "";
  // 文字として "\n" が入っている場合に復元
  return t.includes("\\n") ? t.replaceAll("\\n", "\n") : t;
}

/**
 * unified diff を行ごとに強調表示するビューア
 *  +（追加）: 緑
 *  -（削除）: 赤
 *  @@（hunk header）: 青
 *  --- / +++（header）: グレー
 */
function DiffViewer({ text }) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");

  return (
    <pre
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {lines.map((line, i) => {
        let bg = "transparent";
        let color = "inherit";
        let weight = 400;
        let borderLeft = "4px solid transparent";

        if (line.startsWith("+") && !line.startsWith("+++")) {
          bg = "#e6ffed";
          color = "#0a5d1a";
          borderLeft = "4px solid #2da44e";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          bg = "#ffeef0";
          color = "#86181d";
          borderLeft = "4px solid #cf222e";
        } else if (line.startsWith("@@")) {
          bg = "#f1f8ff";
          color = "#005cc5";
          weight = 700;
          borderLeft = "4px solid #0969da";
        } else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
          bg = "#f6f8fa";
          color = "#24292e";
          weight = 600;
          borderLeft = "4px solid #d0d7de";
        }

        return (
          <div
            key={i}
            style={{
              background: bg,
              color,
              fontWeight: weight,
              padding: "0 8px",
              borderLeft,
            }}
          >
            {line === "" ? " " : line}
          </div>
        );
      })}
    </pre>
  );
}

/**
 * 現在コードの中で「変更/追加っぽい行」をハイライト（簡易版）
 * - unified diffの "+" 行の中身と一致する行を緑で強調
 * - 完全な行番号追跡ではなく、研究用途の“見やすさ優先”の軽量実装
 */
function CodeViewer({ code, addedLineSet }) {
  const lines = (code ?? "").split("\n");

  return (
    <div
      style={{
        background: "#0b1020",
        color: "#e6e6e6",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {lines.map((line, i) => {
          const isChanged = addedLineSet?.has(line);
          return (
            <div
              key={i}
              style={{
                background: isChanged ? "rgba(46, 160, 67, 0.25)" : "transparent",
                borderLeft: isChanged ? "4px solid #2da44e" : "4px solid transparent",
                padding: "0 8px",
              }}
            >
              {line === "" ? " " : line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);

  const [tasks, setTasks] = useState([]);
  const [task, setTask] = useState(null);

  const [events, setEvents] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);

  const [detail, setDetail] = useState(null);
  const [diff, setDiff] = useState("");

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // users
  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error(`GET /api/users failed: ${res.status}`);
        const data = await res.json();
        setUsers(data);
        setUser(data?.[0] ?? null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  // tasks
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setErr("");
        setTask(null);
        setTasks([]);
        setEvents([]);
        setSelectedIdx(null);
        setDetail(null);
        setDiff("");

        const res = await fetch(`/api/users/${user}/tasks`);
        if (!res.ok) throw new Error(`GET /tasks failed: ${res.status}`);
        const data = await res.json();
        setTasks(data);
        setTask(data?.[0] ?? null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [user]);

  // events
  useEffect(() => {
    if (!user || task == null) return;
    (async () => {
      try {
        setErr("");
        setEvents([]);
        setSelectedIdx(null);
        setDetail(null);
        setDiff("");

        const res = await fetch(`/api/users/${user}/tasks/${task}/events`);
        if (!res.ok) throw new Error(`GET /events failed: ${res.status}`);
        const data = await res.json();
        setEvents(data);
        setSelectedIdx(data?.[0]?.idx ?? null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [user, task]);

  // select event -> detail + diff
  useEffect(() => {
    if (!user || task == null || selectedIdx == null) return;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const d = await fetch(
          `/api/users/${user}/tasks/${task}/events/${selectedIdx}`
        ).then((r) => {
          if (!r.ok)
            throw new Error(`GET /event/${selectedIdx} failed: ${r.status}`);
          return r.json();
        });

        const df = await fetch(
          `/api/users/${user}/tasks/${task}/diff/${selectedIdx}`
        ).then((r) => {
          if (!r.ok)
            throw new Error(`GET /diff/${selectedIdx} failed: ${r.status}`);
          return r.text();
        });

        setDetail(d);
        setDiff(df);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [user, task, selectedIdx]);

  // which position in events array?
  const selectedPos = useMemo(() => {
    if (selectedIdx == null) return -1;
    return events.findIndex((e) => e.idx === selectedIdx);
  }, [events, selectedIdx]);

  // keyboard navigation (←/→ or ↑/↓)
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (events.length === 0 || selectedPos < 0) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(0, selectedPos - 1);
        setSelectedIdx(events[prev].idx);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(events.length - 1, selectedPos + 1);
        setSelectedIdx(events[next].idx);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [events, selectedPos]);

  // counts
  const eventCounts = useMemo(() => {
    const m = { run: 0, "ai-help": 0, ai_help: 0, auto_save: 0 };
    for (const e of events) {
      if (!e?.event) continue;
      m[e.event] = (m[e.event] ?? 0) + 1;
    }
    return m;
  }, [events]);

  const canPrev = selectedPos > 0;
  const canNext = selectedPos >= 0 && selectedPos < events.length - 1;

  // diffの "+" 行（追加/変更）から、現在コード内でハイライトしたい行集合を作る（簡易）
  const addedLineSet = useMemo(() => {
    const set = new Set();
    const normalized = normalizeNewlines(diff);
    for (const line of normalized.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        set.add(line.slice(1)); // "+" を除いた行内容
      }
    }
    return set;
  }, [diff]);

  return (
    <div style={{ height: "100vh", display: "flex", fontFamily: "sans-serif" }}>
      {/* left: users */}
      <div
        style={{
          width: 220,
          borderRight: "1px solid #ddd",
          padding: 12,
          overflow: "auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Users</h2>
        {users.map((u) => (
          <div
            key={u}
            onClick={() => setUser(u)}
            style={{
              padding: "6px 8px",
              marginBottom: 4,
              borderRadius: 6,
              cursor: "pointer",
              background: u === user ? "#eee" : "transparent",
            }}
            title="Click to select user"
          >
            {u}
          </div>
        ))}
      </div>

      {/* mid-left: tasks */}
      <div
        style={{
          width: 160,
          borderRight: "1px solid #ddd",
          padding: 12,
          overflow: "auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Tasks</h2>
        {tasks.map((t) => (
          <div
            key={t}
            onClick={() => setTask(t)}
            style={{
              padding: "6px 8px",
              marginBottom: 4,
              borderRadius: 6,
              cursor: "pointer",
              background: t === task ? "#eee" : "transparent",
            }}
            title="Click to select task"
          >
            task {t}
          </div>
        ))}
      </div>

      {/* mid: timeline */}
      <div
        style={{
          width: 340,
          borderRight: "1px solid #ddd",
          padding: 12,
          overflow: "auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Timeline</h2>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          {events.length} events / run:{eventCounts.run ?? 0} / ai_help:
          {(eventCounts.ai_help ?? 0) + (eventCounts["ai-help"] ?? 0)} /
          auto_save:{eventCounts.auto_save ?? 0}
        </div>

        {events.map((e) => (
          <div
            key={e.idx}
            onClick={() => setSelectedIdx(e.idx)}
            style={{
              padding: "8px 10px",
              marginBottom: 6,
              borderRadius: 8,
              cursor: "pointer",
              background: e.idx === selectedIdx ? "#eee" : "#fafafa",
              border: "1px solid #eee",
            }}
            title="Click to open (use arrow keys too)"
          >
            <div style={{ fontSize: 12, opacity: 0.8 }}>{e.ts}</div>
            <div style={{ fontWeight: 700 }}>{e.event}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>idx: {e.idx}</div>
          </div>
        ))}
      </div>

      {/* right: detail */}
      <div style={{ flex: 1, padding: 12, overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0 }}>Log Viewer</h1>

          <button
            onClick={() => canPrev && setSelectedIdx(events[selectedPos - 1].idx)}
            disabled={!canPrev}
            title="ArrowLeft / ArrowUp"
          >
            ← Prev
          </button>
          <button
            onClick={() => canNext && setSelectedIdx(events[selectedPos + 1].idx)}
            disabled={!canNext}
            title="ArrowRight / ArrowDown"
          >
            Next →
          </button>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {selectedPos >= 0 ? `${selectedPos + 1} / ${events.length}` : ""}
            {loading ? "  (Loading…)" : ""}
          </div>

          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>
            Tip: ↑↓ / ←→ で前後移動
          </div>
        </div>

        {err && (
          <pre
            style={{
              color: "crimson",
              background: "#fff5f5",
              padding: 10,
              borderRadius: 8,
              border: "1px solid #ffd6d6",
              marginTop: 12,
            }}
          >
            {err}
          </pre>
        )}

        {!detail ? (
          <div style={{ marginTop: 12 }}>Select an event.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 6 }}>Event</h3>
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              <div>
                <b>ts</b>: {detail.ts}
              </div>
              <div>
                <b>user</b>: {detail.user_id} / {detail.username}
              </div>
              <div>
                <b>task</b>: {detail.task}
              </div>
              <div>
                <b>event</b>: {detail.event}
              </div>
            </div>

            <h3 style={{ marginTop: 16, marginBottom: 6 }}>
              Code（変更行は緑で強調）
            </h3>
            <CodeViewer code={detail.code} addedLineSet={addedLineSet} />

            <h3 style={{ marginTop: 16, marginBottom: 6 }}>
              Diff (prev → current)（+/- を色付け）
            </h3>
            <div
              style={{
                background: "#fff",
                padding: 12,
                borderRadius: 8,
                border: "1px solid #eee",
              }}
            >
              <DiffViewer text={diff} />
            </div>

            {(detail.stdout || detail.stderr) && (
              <>
                <h3 style={{ marginTop: 16, marginBottom: 6 }}>Run Output</h3>
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>stdout</div>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#f6f8fa",
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid #eee",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 13,
                      }}
                    >
                      {fmt(detail.stdout)}
                    </pre>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>stderr</div>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#fff5f5",
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid #ffd6d6",
                        color: "#b00020",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 13,
                      }}
                    >
                      {fmt(detail.stderr)}
                    </pre>
                  </div>
                </div>
              </>
            )}

            {(detail.estimated_stage ||
              detail.next_stage ||
              detail.advice ||
              detail.processing_structure) && (
              <>
                <h3 style={{ marginTop: 16, marginBottom: 6 }}>AI Help</h3>
                <div style={{ fontSize: 13, opacity: 0.95 }}>
                  <div>
                    <b>estimated_stage</b>: {fmt(detail.estimated_stage)}
                  </div>
                  <div>
                    <b>next_stage</b>: {fmt(detail.next_stage)}
                  </div>
                </div>

                {detail.advice && (
                  <>
                    <h4 style={{ marginTop: 10, marginBottom: 6 }}>Advice</h4>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#f6f8fa",
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid #eee",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 13,
                      }}
                    >
                      {JSON.stringify(detail.advice, null, 2)}
                    </pre>
                  </>
                )}

                {detail.processing_structure && (
                  <>
                    <h4 style={{ marginTop: 10, marginBottom: 6 }}>
                      Processing Structure
                    </h4>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#f6f8fa",
                        padding: 10,
                        borderRadius: 8,
                        border: "1px solid #eee",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 13,
                      }}
                    >
                      {JSON.stringify(detail.processing_structure, null, 2)}
                    </pre>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
