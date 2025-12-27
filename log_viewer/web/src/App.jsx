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

  // 例: [{level:1,text:"..."}, ...]
  if (Array.isArray(advice)) {
    for (const a of advice) {
      const lv = Number(a?.level);
      const text = (a?.text ?? "").toString().trim();
      if (lv >= 1 && lv <= 3 && text) res[lv].push(text);
    }
    return res;
  }

  // 例: { level1: "...", level2:"...", level3:"..." }
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

// ---------- TAB / INDENT FIX ----------
const TAB_SIZE = 4;

// ① \t（実タブ）も ② \\t（文字列の \t）も両方スペースに展開
function expandTabsAny(s = "") {
  return String(s)
    .replace(/\\t/g, " ".repeat(TAB_SIZE)) // 文字列 "\t"
    .replace(/\t/g, " ".repeat(TAB_SIZE)); // 実タブ
}

// highlight前の「生テキスト」で先頭スペースをNBSPにする（=必ず見える）
function leadingSpacesToNbsp(text = "") {
  const t = String(text);
  const m = t.match(/^ +/);
  if (!m) return t;
  return "\u00A0".repeat(m[0].length) + t.slice(m[0].length);
}

// どんな値でも “コード文字列” を取り出す（ログ形式が違っても拾う）
function extractCode(ev) {
  if (!ev) return "";
  // よくある候補を順に見る
  const candidates = [
    ev.code,
    ev.current_code,
    ev.curr_code,
    ev.source,
    ev.program,
    ev.input?.code,
    ev.payload?.code,
    ev.data?.code,
    ev.raw?.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  // objectだったら JSONとして一応表示できるように（ただし基本は空でOK）
  if (typeof ev.code === "object" && ev.code) return safeText(ev.code);
  return "";
}

// stdout/stderr も形式違い吸収
function extractStdout(ev) {
  if (!ev) return "";
  const candidates = [ev.stdout, ev.run_stdout, ev.output, ev.exec?.stdout, ev.result?.stdout, ev.raw?.stdout];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return "";
}
function extractStderr(ev) {
  if (!ev) return "";
  const candidates = [ev.stderr, ev.run_stderr, ev.error, ev.exec?.stderr, ev.result?.stderr, ev.raw?.stderr];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return "";
}

// timeline でイベント種別に色付け
function timelineStyleFor(evName) {
  const e = String(evName ?? "").toLowerCase();
  if (e.includes("ai-help") || e.includes("ai_help") || e.includes("aihelp")) {
    return { bg: "#f5f3ff", border: "#ddd6fe", dot: "#6d28d9" }; // purple
  }
  if (e === "run" || e.includes("run")) {
    return { bg: "#eff6ff", border: "#bfdbfe", dot: "#1d4ed8" }; // blue
  }
  return { bg: "#fff", border: "#eee", dot: "#94a3b8" };
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
  const prev = useMemo(
    () => (selectedIdx > 0 ? timeline?.[selectedIdx - 1] : null),
    [timeline, selectedIdx]
  );

  // code: 形式違いに強く拾う
  const currCodeText = useMemo(() => extractCode(current), [current]);
  const prevCodeText = useMemo(() => extractCode(prev), [prev]);

  const mergedCodeRows = useMemo(() => diffLinesLCS(prevCodeText, currCodeText), [prevCodeText, currCodeText]);

  const highlightedRows = useMemo(() => {
    const grammar = Prism.languages.c || Prism.languages.clike;
    return mergedCodeRows.map((r) => {
      const raw = expandTabsAny(r.line ?? "");
      const fixed = leadingSpacesToNbsp(raw);
      return {
        ...r,
        html: Prism.highlight(fixed, grammar, "c"),
      };
    });
  }, [mergedCodeRows]);

  const adviceLevels = useMemo(() => toAdviceLevels(current?.advice), [current?.advice]);
  const processingStructure = useMemo(
    () => normalizeProcessingStructure(current?.processing_structure),
    [current?.processing_structure]
  );

  const stdoutText = useMemo(() => extractStdout(current), [current]);
  const stderrText = useMemo(() => extractStderr(current), [current]);

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
    overflow: "hidden", // 内部スクロール
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

  // main を「上段ヘッダー + Event + Code + Bottom」で固定
  const mainLayout = {
    height: "100%",
    display: "grid",
    gridTemplateRows: "44px 120px 1fr 240px", // Header / Event / Code / Bottom
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
    fontSize: 12.2,
    lineHeight: 1.45,
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

  // 下段は “スクロールしないで見える” を優先：文字小さめ＆折返し
  const compactText = {
    fontSize: 11.5,
    lineHeight: 1.35,
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
                const st = timelineStyleFor(ev.event);
                const isSelected = i === selectedIdx;

                return (
                  <button
                    key={ev.idx ?? i}
                    onClick={() => setSelectedIdx(i)}
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",          // ←小さく
                      borderRadius: 10,
                      border: `1px solid ${st.border}`,
                      background: isSelected ? "#eef2ff" : st.bg,
                      cursor: "pointer",
                      position: "relative",
                      lineHeight: 1.15,
                    }}
                    title={`${fmtTs(ev.ts)} / idx:${ev.idx}`} // ←スクロール無しの代わりに hover で詳細
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: st.dot,
                          display: "inline-block",
                          flex: "0 0 auto",
                        }}
                      />
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: 11.5,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          flex: 1,
                        }}
                      >
                        {String(ev.event ?? "(no event)")}
                      </div>

                      <div
                        style={{
                          fontSize: 10.5,
                          color: "#94a3b8",
                          flex: "0 0 auto",
                        }}
                      >
                        {ev.idx ?? i}
                      </div>
                    </div>

                    {/* ts は “全体表示優先” で基本非表示にして title に寄せる */}
                    {/* どうしても欲しければ次の行を復活させてOK */}
                    {/* <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 2 }}>{fmtTs(ev.ts)}</div> */}
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
                  <div style={{ fontWeight: 800, color: "#4f46e5" }}>
                    {current?.next_stage ?? "---"}
                  </div>
                </div>
              </div>
            )}

            {/* Code */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={cardTitle}>Code（シンタックス + diff 統合）</div>
                <div style={{ fontSize: 12, color: "#777" }}>緑=追加 / 赤=削除（取り消し線）</div>
              </div>

              {/* “TAB(ヘッダー行)” を復活：table header っぽい見た目 */}
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

                        {/* ここが “tab/インデント死ぬ” ことが多いので code 自体に強制 */}
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
                            style={{
                              whiteSpace: "pre",
                              tabSize: TAB_SIZE,
                              MozTabSize: TAB_SIZE,
                              fontFamily: monoFont,
                            }}
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

                {/* スクロール無しを優先：小さめ＆折返し */}
                <div style={{ height: "calc(100% - 30px)", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateRows: "1fr 1fr 1fr", gap: 8, height: "100%" }}>
                    {[1, 2, 3].map((lv) => (
                      <div
                        key={lv}
                        style={{
                          border: "1px solid #ddd6fe",
                          borderRadius: 12,
                          padding: 8,
                          background: "#ffffff",
                          overflow: "hidden",
                          display: "grid",
                          gridTemplateRows: "18px 1fr",
                        }}
                      >
                        <div style={{ fontWeight: 800, color: "#5b21b6", fontSize: 12 }}>
                          Level {lv}
                        </div>

                        <div style={{ overflow: "hidden" }}>
                          {adviceLevels[lv]?.length ? (
                            <ul style={{ margin: 0, paddingLeft: 18, ...compactText }}>
                              {adviceLevels[lv].slice(0, 8).map((t, i) => (
                                <li
                                  key={i}
                                  style={{
                                    marginBottom: 4,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {t}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div style={{ color: "#888", ...compactText }}>(なし)</div>
                          )}
                        </div>
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

                {/* スクロール無し優先：preをやめて “折返し + 小さめ” */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: "1fr 1fr",
                    gap: 8,
                    height: "calc(100% - 30px)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#1d4ed8" }}>stdout</div>
                    <div
                      style={{
                        ...monoBox,
                        ...compactText,
                        background: "#ffffff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 12,
                        padding: 8,
                        overflow: "hidden",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {stdoutText ? stdoutText : ""}
                    </div>
                  </div>

                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#1d4ed8" }}>stderr</div>
                    <div
                      style={{
                        ...monoBox,
                        ...compactText,
                        background: "#ffffff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 12,
                        padding: 8,
                        overflow: "hidden",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {stderrText ? stderrText : ""}
                    </div>
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
                    gap: 8,
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
                        padding: 8,
                        overflow: "hidden",
                        fontSize: 12,
                      }}
                    >
                      {processingStructure.length === 0 ? (
                        <div style={{ color: "#888" }}>構造を抽出できませんでした。</div>
                      ) : (
                        processingStructure.slice(0, 14).map((it, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              gap: 8,
                              padding: "2px 0",
                              marginLeft: (Math.max(1, it.level) - 1) * 12,
                              fontSize: 11.5,
                            }}
                          >
                            <span style={{ width: 10, color: "#94a3b8" }}>•</span>
                            <span style={{ color: "#111", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {it.text}
                            </span>
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>({it.status})</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Raw */}
                  <div style={{ overflow: "hidden", display: "grid", gridTemplateRows: "18px 1fr" }}>
                    <div style={{ fontSize: 12, color: "#666" }}>Raw Event JSON</div>
                    <div
                      style={{
                        ...monoBox,
                        ...compactText,
                        background: "#f8fafc",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 8,
                        overflow: "hidden",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {safeText(current?.raw)}
                    </div>
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
