"use client";

import { useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";

type Attempt = {
  classCode: string;
  studentNo: string;
  grade?: string;
  sessionId?: string;
  word: string;
  selected: string;
  correct: boolean;
  choices: string[];
  timestamp: any;
};

function toDateMs(ts: any) {
  try {
    return ts?.toMillis ? ts.toMillis() : new Date(ts).getTime();
  } catch {
    return 0;
  }
}

function escapeCsv(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export default function TeacherPage() {
  const [classCode, setClassCode] = useState("test");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all"); // all / 4 / 5 / 6 / unknown
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const q = query(collection(db, "attempts"), where("classCode", "==", classCode));
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => d.data() as Attempt);
      // 新しい順
      rows.sort((a, b) => toDateMs(b.timestamp) - toDateMs(a.timestamp));
      setAttempts(rows);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  // ③ 期間 + 学年フィルタ（アプリ側で確実に絞る）
  const filtered = useMemo(() => {
    const fromMs = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
    const toMs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : null;

    return attempts.filter((a) => {
      const ms = toDateMs(a.timestamp);
      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;

      if (gradeFilter !== "all") {
        const g = (a.grade ?? "unknown").toString();
        if (g !== gradeFilter) return false;
      }
      return true;
    });
  }, [attempts, dateFrom, dateTo, gradeFilter]);

  // 語彙別正答率
  const vocabStats = useMemo(() => {
    const map = new Map<string, { total: number; correct: number }>();
    for (const a of filtered) {
      const key = a.word ?? "";
      if (!key) continue;
      const cur = map.get(key) ?? { total: 0, correct: 0 };
      cur.total += 1;
      if (a.correct) cur.correct += 1;
      map.set(key, cur);
    }
    const arr = Array.from(map.entries()).map(([word, v]) => ({
      word,
      total: v.total,
      correct: v.correct,
      rate: v.total ? v.correct / v.total : 0,
    }));
    arr.sort((a, b) => a.rate - b.rate || b.total - a.total);
    return arr;
  }, [filtered]);

  // 誤答パターン
  const wrongPatterns = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const a of filtered) {
      if (a.correct) continue;
      const w = a.word ?? "";
      const sel = a.selected ?? "";
      if (!w || !sel) continue;
      if (!m.has(w)) m.set(w, new Map());
      const inner = m.get(w)!;
      inner.set(sel, (inner.get(sel) ?? 0) + 1);
    }

    const rows: { word: string; selected: string; count: number }[] = [];
    for (const [w, inner] of m.entries()) {
      for (const [sel, c] of inner.entries()) rows.push({ word: w, selected: sel, count: c });
    }
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [filtered]);

  const downloadAttemptsCsv = () => {
    const header = [
      "timestamp",
      "classCode",
      "studentNo",
      "grade",
      "sessionId",
      "word",
      "correct",
      "selected",
      "choices",
    ];
    const lines = [header.join(",")];

    for (const a of filtered) {
      const iso = a.timestamp?.toDate?.().toISOString?.() ?? "";
      lines.push(
        [
          iso,
          a.classCode,
          a.studentNo,
          a.grade ?? "unknown",
          a.sessionId ?? "",
          a.word,
          a.correct,
          a.selected,
          (a.choices ?? []).join("|"),
        ].map(escapeCsv).join(",")
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attempts_${classCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadVocabCsv = () => {
    const header = ["word", "total", "correct", "rate"];
    const lines = [header.join(",")];
    for (const r of vocabStats) {
      lines.push([r.word, r.total, r.correct, r.rate.toFixed(4)].map(escapeCsv).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vocab_stats_${classCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadWrongCsv = () => {
    const header = ["word", "selected", "count"];
    const lines = [header.join(",")];
    for (const r of wrongPatterns) lines.push([r.word, r.selected, r.count].map(escapeCsv).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wrong_patterns_${classCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">先生用ダッシュボード</h1>
          <p className="text-sm text-slate-600">期間・学年で絞り込み → CSV / 正答率 / 誤答パターン</p>
        </header>

        <section className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-12 md:items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-600">学級コード</label>
              <input
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="例：test"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-600">期間（開始）</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-600">期間（終了）</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600">学年</label>
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="all">全て</option>
                <option value="4">4年</option>
                <option value="5">5年</option>
                <option value="6">6年</option>
                <option value="unknown">不明</option>
              </select>
            </div>

            <div className="md:col-span-1">
              <button
                onClick={load}
                disabled={loading}
                className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? "…" : "読込"}
              </button>
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              エラー：{error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
              取得：{attempts.length}件
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
              表示（フィルタ後）：{filtered.length}件
            </span>

            <div className="ml-auto flex flex-wrap gap-2">
              <button
                onClick={downloadAttemptsCsv}
                disabled={filtered.length === 0}
                className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                attempts CSV
              </button>
              <button
                onClick={downloadVocabCsv}
                disabled={vocabStats.length === 0}
                className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                正答率 CSV
              </button>
              <button
                onClick={downloadWrongCsv}
                disabled={wrongPatterns.length === 0}
                className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                誤答 CSV
              </button>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">語彙別 正答率（低い順）</h2>
            <p className="mt-1 text-sm text-slate-600">つまずきやすい語彙を優先して指導できます。</p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="border-b px-2 py-2">語彙</th>
                    <th className="border-b px-2 py-2 text-right">件数</th>
                    <th className="border-b px-2 py-2 text-right">正解</th>
                    <th className="border-b px-2 py-2 text-right">正答率</th>
                  </tr>
                </thead>
                <tbody>
                  {vocabStats.map((r) => (
                    <tr key={r.word} className="hover:bg-slate-50">
                      <td className="border-b px-2 py-2 font-medium">{r.word}</td>
                      <td className="border-b px-2 py-2 text-right">{r.total}</td>
                      <td className="border-b px-2 py-2 text-right">{r.correct}</td>
                      <td className="border-b px-2 py-2 text-right">{(r.rate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                  {vocabStats.length === 0 && (
                    <tr>
                      <td className="px-2 py-6 text-slate-500" colSpan={4}>
                        まだデータがありません（上で「読込」を押してください）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">誤答パターン（多い順）</h2>
            <p className="mt-1 text-sm text-slate-600">誤概念（選びがちな誤答）を見つけられます。</p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="border-b px-2 py-2">語彙</th>
                    <th className="border-b px-2 py-2">誤答</th>
                    <th className="border-b px-2 py-2 text-right">回数</th>
                  </tr>
                </thead>
                <tbody>
                  {wrongPatterns.slice(0, 50).map((r, idx) => (
                    <tr key={`${r.word}-${r.selected}-${idx}`} className="hover:bg-slate-50">
                      <td className="border-b px-2 py-2 font-medium">{r.word}</td>
                      <td className="border-b px-2 py-2">{r.selected}</td>
                      <td className="border-b px-2 py-2 text-right">{r.count}</td>
                    </tr>
                  ))}
                  {wrongPatterns.length === 0 && (
                    <tr>
                      <td className="px-2 py-6 text-slate-500" colSpan={3}>
                        誤答がまだありません（誤答が出ると表示されます）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-slate-500">※ 表示は上位50件。CSVは全件出ます。</p>
          </section>
        </div>

        <footer className="mt-8 text-center text-xs text-slate-500">
          学習ページ例：<span className="font-medium">/study?class=test&no=1&grade=4</span>
        </footer>
      </div>
    </main>
  );
}
