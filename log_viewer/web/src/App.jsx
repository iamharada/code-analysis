import React, { useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-c";
import "prismjs/themes/prism.css";

/**
 * 行単位の LCS diff（小さめコード想定）
 * 返り値: [{type:'same'|'add'|'del', line:string}]
 */
function diffLinesLCS(prevText = "", currText = "") {
  const a = (prevText ?? "").split("\n");
  const b = (currText ?? "").split("\n");

  const n = a.length;
  const m = b.length;

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", line: a[i] });
      i++;
    } else {
      out.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", line: a[i++] });
  while (j < m) out.push({ type: "add", line: b[j++] });

  return out;
}

function fmtTs(ts) {
  if (!ts) return "---";
  return String(ts);
}

function safeText(x) {
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function toAdviceLevels(advice) {
  const res = { 1: [], 2: [], 3: [] };
  if (!advice) return res;

  if (Array.isArray(advice)) {
    for (const a of advice) {
      const lv = Number(a?.level);
      const text = (a?.text ?? "").toString().trim();
      if (lv >= 1 && lv <= 3 && text) res[lv].push(text);
    }
    return res;
  }

  if (typeof advice === "object") {
    const l1 = advice.level1 ?? advice.Level1 ?? advice["1"];
    const l2 = advice.level2 ?? advice.Level2 ?? advice["2"];
    const l3 = advice.level3 ?? advice.Level3 ?? advice["3"];
    if (l1) res[1].push(String(l1));
    if (l2) res[2].push(String(l2));
    if (l3) res[3].push(String(l3));
    return res;
  }

  res[1].push(String(advice));
  return res;
}

function normalizeProcessingStructure(ps) {
  if (!ps) return [];
  if (Array.isArray(ps)) {
    return ps
      .map((it) => ({
        level: Number(it?.level ?? 1),
        text: String(it?.text ?? it?.label ?? "").trim(),
        status: String(it?.status ?? "unknown"),
      }))
      .filter((it) => it.text);
  }
  if (typeof ps === "string") return [{ level: 1, text: ps, status: "unknown" }];
  return [];
}

const monoFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export default function App() {
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [err, setErr] = useState("");

  const codeRef = useRef(null);

  const apiBase = ""; // vite proxy で /api -> api

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${r.status} ${r.statusText} ${t}`);
    }
    return await r.json();
  }

  // users
  useEffect(() => {
    (async () => {
      try {
        setErr("");
        setLoadingUsers(true);
        const list = await fetchJson(`${apiBase}/api/users`);
        setUsers(list);
        if (list?.length) setSelectedUser(list[0]);
      } catch (e) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, []);

  // tasks
  useEffect(() => {
    if (!selectedUser) return;
    (async () => {
      try {
        setErr("");
        setLoadingTasks(true);
        setTasks([]);
        setSelectedTask(null);
        setTimeline([]);
        setSelectedIdx(0);

        const list = await fetchJson(`${apiBase}/api/users/${selectedUser}/tasks`);
        setTasks(list);
        if (list?.length) setSelectedTask(list[0]);
      } catch (e) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoadingTasks(false);
      }
    })();
  }, [selectedUser]);

  // timeline
  useEffect(() => {
    if (!selectedUser || selectedTask === null || selectedTask === undefined) return;
    (async () => {
      try {
        setErr("");
        setLoadingTimeline(true);
        setTimeline([]);
        setSelectedIdx(0);

        const data = await fetchJson(
          `${apiBase}/api/users/${selectedUser}/tasks/${selectedTask}/events`
        );
        const evs = data?.events ?? [];
        setTimeline(evs);
        setSelectedIdx(0);
      } catch (e) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoadingTimeline(false);
      }
    })();
  }, [selectedUser, selectedTask]);

  const current = useMemo(() => timeline?.[selectedIdx] ?? null, [timeline, selectedIdx]);
  const prev = useMemo(() => (selectedIdx > 0 ? timeline?.[selectedIdx - 1] : null), [timeline, selectedIdx]);

  const mergedCodeRows = useMemo(() => {
    const prevCode = prev?.code ?? "";
    const currCode = current?.code ?? "";
    return diffLinesLCS(prevCode, currCode);
  }, [prev?.code, current?.code]);

  const highlightedRows = useMemo(() => {
    const grammar = Prism.languages.c || Prism.languages.clike;
    return mergedCodeRows.map((r) => ({
      ...r,
      html: Prism.highlight(r.line ?? "", grammar, "c"),
    }));
  }, [mergedCodeRows]);

  const adviceLevels = useMemo(() => toAdviceLevels(current?.advice), [current?.advice]);
  const processingStructure = useMemo(
    () => normalizeProcessingStructure(current?.processing_structure),
    [current?.processing_structure]
  );

  function clampIdx(i) {
    const max = Math.max(0, (timeline?.length ?? 0) - 1);
    return Math.min(max, Math.max(0, i));
  }
  function goPrev() {
    setSelectedIdx((i) => clampIdx(i - 1));
  }
  function goNext() {
    setSelectedIdx((i) => clampIdx(i + 1));
  }

  // keyboard
  useEffect(() => {
    function onKeyDown(e) {
      const tag = (e.target?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [timeline?.length]);

  useEffect(() => {
    if (codeRef.current) codeRef.current.scrollTop = 0;
  }, [selectedIdx]);

  // ---------- styles ----------
  const shell = {
    height: "100vh",
    overflow: "hidden", // ページ全体スクロールなし
    fontFamily:
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
    background: "#fff",
  };

  const grid = {
    display: "grid",
    gridTemplateColumns: "220px 120px 240px 1fr",
    height: "100%",
  };

  const side = {
    borderRight: "1px solid #eee",
    padding: 10,
    overflow: "hidden", // ここは内部スクロールで対応
  };

  const sideList = {
    overflow: "auto",
    height: "calc(100% - 28px)",
    paddingRight: 6,
  };

  const main = {
    height: "100%",
    overflow: "hidden",
    padding: 14,
  };

  // main を「上段ヘッダー + 残りを縦3段」で固定
  const mainLayout = {
    height: "100%",
    display: "grid",
    gridTemplateRows: "44px 120px 1fr clamp(220px, 28vh, 360px)",
    gap: 10,
    overflow: "hidden",
  };

  const headerBar = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  };

  const card = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 12,
    overflow: "hidden",
  };

  const cardTitle = { fontWeight: 800, marginBottom: 8 };

  // AIHELP 紫
  const cardPurple = {
    ...card,
    background: "#f5f3ff",
    border: "1px solid #ddd6fe",
  };

  // Run 青
  const cardBlue = {
    ...card,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
  };

  const monoBox = {
    fontFamily: monoFont,
    fontSize: 12.5,
    lineHeight: 1.55,
  };

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    color: "#555",
  };

  // ---------- render ----------
  return (
    <div style={shell}>
      <div style={grid}>
        {/* Users */}
        <div style={side}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Users</div>
          {loadingUsers && <div style={{ color: "#666", fontSize: 12 }}>loading…</div>}
          <div style={sideList}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {users.map((u) => (
                <button
                  key={u}
                  onClick={() => setSelectedUser(u)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid transparent",
                    background: u === selectedUser ? "#eef2ff" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tasks */}
        <div style={side}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Tasks</div>
          {loadingTasks && <div style={{ color: "#666", fontSize: 12 }}>loading…</div>}
          <div style={sideList}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tasks.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTask(t)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid transparent",
                    background: t === selectedTask ? "#eef2ff" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={side}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Timeline</div>
          {loadingTimeline && <div style={{ color: "#666", fontSize: 12 }}>loading…</div>}
          <div style={{ color: "#777", fontSize: 12, marginBottom: 6 }}>
            {timeline.length} events（Tip: ↑/↓/←/→）
          </div>
          <div style={sideList}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {timeline.map((ev, i) => {
                  const kind = String(ev?.event ?? "").toLowerCase();
                  const isAiHelp = kind === "ai-help" || kind === "ai_help";
                  const isRun = kind === "run";

                  const baseBg = i === selectedIdx ? "#eef2ff" : "#fff";
                  const bg = isAiHelp ? "#f5f3ff" : isRun ? "#eff6ff" : baseBg;
                  const border = isAiHelp ? "1px solid #ddd6fe" : isRun ? "1px solid #bfdbfe" : "1px solid #eee";

                  return (
                    <button
                      key={ev.idx ?? i}
                      onClick={() => setSelectedIdx(i)}
                      style={{
                        textAlign: "left",
                        padding: "10px 10px",
                        borderRadius: 12,
                        border,
                        background: bg,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{ev.event ?? "(no event)"}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>{fmtTs(ev.ts)}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>idx: {ev.idx}</div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={main}>
          <div style={mainLayout}>
            {/* Header */}
            <div style={headerBar}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <h1 style={{ margin: 0, fontSize: 22 }}>Log Viewer</h1>
                <span style={pill}>
                  {selectedUser ?? "---"} / task {selectedTask ?? "---"}
                </span>
                <span style={{ ...pill, borderStyle: "dashed" }}>
                  {timeline.length ? `${selectedIdx + 1} / ${timeline.length}` : "0 / 0"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={goPrev}
                  disabled={selectedIdx <= 0}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  ← Prev
                </button>
                <button
                  onClick={goNext}
                  disabled={selectedIdx >= timeline.length - 1}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Next →
                </button>
              </div>
            </div>

            {/* Error (ヘッダー下に出す) */}
            {err ? (
              <div
                style={{
                  ...card,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#991b1b",
                  whiteSpace: "pre-wrap",
                }}
              >
                {err}
              </div>
            ) : (
              // Event
              <div style={card}>
                <div style={cardTitle}>Event</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr 90px 1fr",
                    rowGap: 6,
                    columnGap: 10,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ color: "#666" }}>ts</div>
                  <div>{fmtTs(current?.ts)}</div>
                  <div style={{ color: "#666" }}>event</div>
                  <div>{current?.event ?? "---"}</div>

                  <div style={{ color: "#666" }}>user</div>
                  <div>{current?.user ?? selectedUser ?? "---"}</div>
                  <div style={{ color: "#666" }}>task</div>
                  <div>{current?.task ?? selectedTask ?? "---"}</div>

                  <div style={{ color: "#666" }}>現在</div>
                  <div style={{ fontWeight: 800 }}>{current?.estimated_stage ?? "---"}</div>
                  <div style={{ color: "#666" }}>次</div>
                  <div style={{ fontWeight: 800, color: "#4f46e5" }}>{current?.next_stage ?? "---"}</div>
                </div>
              </div>
            )}

            {/* Code */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={cardTitle}>Code（シンタックス + diff 統合）</div>
                <div style={{ fontSize: 12, color: "#777" }}>緑=追加 / 赤=削除（取り消し線）</div>
              </div>

              <div
                style={{
                  marginTop: 8,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  overflow: "hidden",
                  height: "calc(100% - 34px)", // タイトル分を引いて内部スクロール
                  display: "grid",
                  gridTemplateRows: "30px 1fr",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr",
                    background: "#f9fafb",
                    borderBottom: "1px solid #e5e7eb",
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "#666",
                    alignItems: "center",
                  }}
                >
                  <div>line</div>
                  <div>code</div>
                </div>

                <div ref={codeRef} style={{ overflow: "auto" }}>
                  {highlightedRows.map((r, i) => {
                    const isAdd = r.type === "add";
                    const isDel = r.type === "del";
                    const bg = isAdd ? "#ecfdf5" : isDel ? "#fef2f2" : "#fff";
                    const borderLeft = isAdd
                      ? "3px solid #22c55e"
                      : isDel
                      ? "3px solid #ef4444"
                      : "3px solid transparent";
                    const textDecoration = isDel ? "line-through" : "none";
                    const opacity = isDel ? 0.85 : 1;

                    return (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "56px 1fr",
                          borderBottom: "1px solid #f1f5f9",
                          background: bg,
                          borderLeft,
                        }}
                      >
                        <div
                          style={{
                            ...monoBox,
                            padding: "6px 10px",
                            color: "#94a3b8",
                            userSelect: "none",
                            textAlign: "right",
                          }}
                        >
                          {i + 1}
                        </div>
                        <div
                          style={{
                            ...monoBox,
                            padding: "6px 10px",
                            whiteSpace: "pre",
                            textDecoration,
                            opacity,
                          }}
                        >
                          <code
                            className="language-c"
                            dangerouslySetInnerHTML={{ __html: r.html || "" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom: 3カラム（AIHELP / Run / Processing+Raw） */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1.1fr 1.1fr",
                gap: 10,
                overflow: "hidden",
              }}
            >
              {/* AI HELP (Purple) */}
              <div style={cardPurple}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={cardTitle}>AI HELP（Level 1–3 一括）</div>
                  <div style={{ fontSize: 12, color: "#6d28d9" }}>紫</div>
                </div>

                <div style={{ height: "calc(100% - 30px)", overflow: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                    {[1, 2, 3].map((lv) => (
                      <div
                        key={lv}
                        style={{
                          border: "1px solid #ddd6fe",
                          borderRadius: 12,
                          padding: 10,
                          background: "#ffffff",
                        }}
                      >
                        <div style={{ fontWeight: 800, marginBottom: 6, color: "#5b21b6" }}>
                          Level {lv}
                        </div>
                        {adviceLevels[lv]?.length ? (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {adviceLevels[lv].map((t, i) => (
                              <li key={i} style={{ marginBottom: 6, whiteSpace: "pre-wrap" }}>
                                {t}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div style={{ color: "#888" }}>(なし)</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Run (Blue) */}
              <div style={cardBlue}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={cardTitle}>実行結果</div>
                  <div style={{ fontSize: 12, color: "#1d4ed8" }}>青</div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: "1fr 1fr",
                    gap: 10,
                    height: "calc(100% - 30px)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#1f4ed8" }}>stdout</div>
                    <pre
                      style={{
                        ...monoBox,
                        background: "#ffffff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 12,
                        padding: 10,
                        overflow: "auto",
                        margin: 0,
                      }}
                    >
{safeText(current?.stdout)}
                    </pre>
                  </div>

                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#1f4ed8" }}>stderr</div>
                    <pre
                      style={{
                        ...monoBox,
                        background: "#ffffff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 12,
                        padding: 10,
                        overflow: "auto",
                        margin: 0,
                      }}
                    >
{safeText(current?.stderr)}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Processing + Raw */}
              <div style={card}>
                <div style={cardTitle}>処理構造 / Raw</div>

                <div
                  style={{
                    height: "calc(100% - 30px)",
                    overflow: "hidden",
                    display: "grid",
                    gridTemplateRows: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  {/* Processing */}
                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#666" }}>処理構造</div>
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        background: "#fafafa",
                        padding: 10,
                        overflow: "auto",
                        fontSize: 12.5,
                      }}
                    >
                      {processingStructure.length === 0 ? (
                        <div style={{ color: "#888" }}>構造を抽出できませんでした。</div>
                      ) : (
                        processingStructure.map((it, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              gap: 8,
                              padding: "3px 0",
                              marginLeft: (Math.max(1, it.level) - 1) * 14,
                            }}
                          >
                            <span style={{ width: 10, color: "#94a3b8" }}>•</span>
                            <span style={{ color: "#111" }}>{it.text}</span>
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>({it.status})</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Raw */}
                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#666" }}>Raw Event JSON</div>
                    <pre
                      style={{
                        ...monoBox,
                        background: "#f8fafc",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 10,
                        overflow: "auto",
                        margin: 0,
                      }}
                    >
{safeText(current?.raw)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>{/* mainLayout */}
        </div>
      </div>
    </div>
  );
}
