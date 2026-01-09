"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../lib/firebase";

type Item = {
  word: string;
  definition: string;
  example: string;
  choices: string[];
  answer: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function StudyPage() {
  const params = useSearchParams();

  // URLパラメータ
  const classCode = params.get("class") ?? "unknown";
  const studentNo = params.get("no") ?? "unknown";
  const grade = params.get("grade") ?? "unknown";

  // mode=flash / test
  const initialMode = (params.get("mode") ?? "flash").toLowerCase();
  const [mode, setMode] = useState<"flash" | "test">(initialMode === "test" ? "test" : "flash");

  // flash設定
  const speedParam = Number(params.get("speed"));
  const initialSpeed = Number.isFinite(speedParam) ? clamp(speedParam, 0.8, 6) : 2.0; // 秒
  const [autoPlay, setAutoPlay] = useState(true);
  const [secondsPerCard, setSecondsPerCard] = useState(initialSpeed);

  // 効果音ON/OFF
  const [soundOn, setSoundOn] = useState(true);

  // セッションID
  const [sessionId] = useState(() => crypto.randomUUID());

  // ★ 自動で次へ進む時間：正解0.9秒／誤答0.7秒
  const AUTO_NEXT_CORRECT_MS = 900;
  const AUTO_NEXT_WRONG_MS = 700;

  // デモ語彙（後で100語に差し替えOK）
  const items: Item[] = useMemo(
    () => [
      {
        word: "割合",
        definition: "もとに対する大きさ",
        example: "全体の30％",
        choices: ["2つの量の関係", "もとに対する大きさ", "同じに分けた1つ分", "いくつ分か"],
        answer: "もとに対する大きさ",
      },
      {
        word: "平均",
        definition: "同じに分けた1つ分",
        example: "合計を人数で割る",
        choices: ["同じに分けた1つ分", "もとに対する大きさ", "いくつ分か", "広さを表す量"],
        answer: "同じに分けた1つ分",
      },
      {
        word: "比",
        definition: "2つの量の関係",
        example: "3：2",
        choices: ["2つの量の関係", "1あたりの量", "最大と最小の差", "広さを表す量"],
        answer: "2つの量の関係",
      },
      {
        word: "倍",
        definition: "いくつ分かを表す",
        example: "2倍、3倍",
        choices: ["広さを表す量", "いくつ分かを表す", "最大と最小の差", "1あたりの量"],
        answer: "いくつ分かを表す",
      },
      {
        word: "速さ",
        definition: "1あたりの量",
        example: "時速60km",
        choices: ["1あたりの量", "かさを表す量", "角の大きさ", "2つの量の関係"],
        answer: "1あたりの量",
      },
      {
        word: "面積",
        definition: "広さを表す量",
        example: "たて×よこ",
        choices: ["広さを表す量", "かさを表す量", "角の大きさ", "2つの量の関係"],
        answer: "広さを表す量",
      },
      {
        word: "体積",
        definition: "かさを表す量",
        example: "箱の中身の量",
        choices: ["かさを表す量", "広さを表す量", "もとに対する大きさ", "いくつ分か"],
        answer: "かさを表す量",
      },
      {
        word: "単位量あたり",
        definition: "1あたりの量",
        example: "1Lあたり100円",
        choices: ["1あたりの量", "2つの量の関係", "同じに分けた1つ分", "もとに対する大きさ"],
        answer: "1あたりの量",
      },
      {
        word: "比例",
        definition: "一方が増えると他方も同じ割合で増える関係",
        example: "時間が2倍→道のりも2倍",
        choices: [
          "一方が増えると他方も同じ割合で増える関係",
          "2つの量の関係",
          "もとに対する大きさ",
          "同じに分けた1つ分",
        ],
        answer: "一方が増えると他方も同じ割合で増える関係",
      },
      {
        word: "反比例",
        definition: "一方が増えると他方が同じ割合で減る関係",
        example: "人数が2倍→1人分は半分",
        choices: [
          "一方が増えると他方が同じ割合で減る関係",
          "2つの量の関係",
          "いくつ分か",
          "広さを表す量",
        ],
        answer: "一方が増えると他方が同じ割合で減る関係",
      },
    ],
    []
  );

  const total = items.length;

  // 進行
  const [index, setIndex] = useState(0);

  // test用
  const [selected, setSelected] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  // ★ 誤答時に正解を強調するためのフラグ
  const [showCorrectHint, setShowCorrectHint] = useState(false);

  // アニメ用
  const [fx, setFx] = useState<"none" | "correct" | "wrong">("none");

  const item = items[index];

  // flash用
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [remainingMs, setRemainingMs] = useState<number>(Math.round(secondsPerCard * 1000));
  const timerRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // 自動遷移タイマー
  const autoNextTimerRef = useRef<number | null>(null);

  const progressPct = Math.round(((index + 1) / total) * 100);

  // ===== 効果音（音源ファイル不要）=====
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ensureAudio = async () => {
    if (!soundOn) return null;
    if (!audioCtxRef.current) {
      // @ts-ignore
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    return ctx;
  };

  const playTone = async (freq: number, durationMs: number, type: OscillatorType, gainValue: number) => {
    const ctx = await ensureAudio();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationMs / 1000);
  };

  const sfxCorrect = async () => {
    await playTone(880, 90, "sine", 0.12);
    setTimeout(() => playTone(1175, 110, "sine", 0.12), 90);
  };

  const sfxWrong = async () => {
    await playTone(220, 180, "square", 0.07);
    setTimeout(() => playTone(180, 160, "square", 0.06), 120);
  };

  const fireFx = async (kind: "correct" | "wrong") => {
    setFx(kind);
    if (soundOn) {
      if (kind === "correct") sfxCorrect();
      else sfxWrong();
    }
    window.setTimeout(() => setFx("none"), 550);
  };

  // ===== 進行関数 =====
  const clearAutoNextTimer = () => {
    if (autoNextTimerRef.current) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
  };

  const resetForCurrent = () => {
    clearAutoNextTimer();
    setStage(0);
    setSelected(null);
    setSaveStatus("idle");
    setSaveError("");
    setFx("none");
    setShowCorrectHint(false);
    setRemainingMs(Math.round(secondsPerCard * 1000));
  };

  const next = () => setIndex((i) => (i + 1 < total ? i + 1 : 0));
  const prev = () => setIndex((i) => (i - 1 >= 0 ? i - 1 : total - 1));

  useEffect(() => {
    resetForCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode]);

  useEffect(() => {
    setRemainingMs((ms) => clamp(ms, 0, Math.round(secondsPerCard * 1000)));
  }, [secondsPerCard]);

  // flash：自動送り
  useEffect(() => {
    if (mode !== "flash") return;
    if (!autoPlay) return;

    if (timerRef.current) window.clearInterval(timerRef.current);

    lastTickRef.current = Date.now();
    timerRef.current = window.setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;

      setRemainingMs((ms) => {
        const nextMs = ms - delta;
        if (nextMs <= 0) {
          setStage((s) => {
            if (s === 0) return 1;
            if (s === 1) return 2;
            next();
            return 0;
          });
          return Math.round(secondsPerCard * 1000);
        }
        return nextMs;
      });
    }, 100);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, secondsPerCard, mode]);

  // キーボード
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (mode === "flash") setAutoPlay((v) => !v);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
      if (e.key === "Enter") {
        if (mode === "flash") setStage((s) => (s === 0 ? 1 : s === 1 ? 2 : 2));
      }
      if (e.key === "Escape") {
        if (mode === "test") resetForCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ===== Firestore保存（test）=====
  const saveAttempt = async (payload: { word: string; choices: string[]; answer: string; selected: string }) => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      await addDoc(collection(db, "attempts"), {
        classCode,
        studentNo,
        grade,
        sessionId,
        mode,
        word: payload.word,
        selected: payload.selected,
        correct: payload.selected === payload.answer,
        choices: payload.choices,
        timestamp: new Date(),
      });
      setSaveStatus("saved");
    } catch (e: any) {
      setSaveStatus("error");
      setSaveError(e?.message ?? String(e));
    }
  };

  // ★ 回答→演出→（正解0.9/誤答0.7）秒後に自動で次へ
  const choose = async (choice: string) => {
    if (selected) return;

    await ensureAudio();

    const snapshot = { word: item.word, choices: item.choices, answer: item.answer, selected: choice };

    setSelected(choice);

    const correct = choice === item.answer;
    setShowCorrectHint(!correct); // ③ 誤答時だけ正解を強調
    fireFx(correct ? "correct" : "wrong");

    // 保存は非同期
    saveAttempt(snapshot);

    const waitMs = correct ? AUTO_NEXT_CORRECT_MS : AUTO_NEXT_WRONG_MS;

    clearAutoNextTimer();
    autoNextTimerRef.current = window.setTimeout(() => {
      next();
    }, waitMs);
  };

  const remainingPct = Math.round((remainingMs / (secondsPerCard * 1000)) * 100);

  const fxCard =
    fx === "correct"
      ? "ring-2 ring-emerald-300 animate-pop"
      : fx === "wrong"
      ? "ring-2 ring-rose-300 animate-shake"
      : "";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* アニメ用CSS（追加ファイル不要） */}
      <style jsx global>{`
        @keyframes pop {
          0% { transform: scale(1); }
          35% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        @keyframes shake {
          0% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
          100% { transform: translateX(0); }
        }
        .animate-pop { animation: pop 420ms ease-out; }
        .animate-shake { animation: shake 380ms ease-in-out; }
      `}</style>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Top bar */}
        <header className="mb-4 flex flex-col gap-3 rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">算数語彙トレーニング</h1>
              <p className="mt-1 text-sm text-slate-600">
                学級 <span className="font-medium text-slate-900">{classCode}</span> ／ 出席番号{" "}
                <span className="font-medium text-slate-900">{studentNo}</span> ／ 学年{" "}
                <span className="font-medium text-slate-900">{grade}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  setMode("flash");
                  setAutoPlay(true);
                }}
                className={[
                  "rounded-2xl px-3 py-2 text-sm font-semibold shadow-sm transition",
                  mode === "flash" ? "bg-slate-900 text-white" : "border bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                フラッシュ
              </button>
              <button
                onClick={() => {
                  setMode("test");
                  setAutoPlay(false);
                }}
                className={[
                  "rounded-2xl px-3 py-2 text-sm font-semibold shadow-sm transition",
                  mode === "test" ? "bg-slate-900 text-white" : "border bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                テスト
              </button>

              <button
                onClick={async () => {
                  await ensureAudio();
                  setSoundOn((v) => !v);
                }}
                className="rounded-2xl border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50"
                title="効果音"
              >
                {soundOn ? "🔊 ON" : "🔇 OFF"}
              </button>
            </div>
          </div>

          {/* progress */}
          <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
            <span>
              {index + 1} / {total}（{progressPct}%）
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">
              session: {sessionId.slice(0, 8)}…
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-slate-900" style={{ width: `${progressPct}%` }} />
          </div>

          {/* flash controls */}
          {mode === "flash" && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setAutoPlay((v) => !v)}
                className="rounded-2xl border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50"
              >
                {autoPlay ? "⏸ 一時停止" : "▶ 再生"}
              </button>

              <button
                onClick={() => setStage((s) => (s === 0 ? 1 : s === 1 ? 2 : 2))}
                className="rounded-2xl border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50"
                title="EnterでもOK"
              >
                ＋表示（意味/例）
              </button>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-600">速さ</span>
                <button
                  onClick={() => setSecondsPerCard((s) => clamp(Number((s - 0.2).toFixed(1)), 0.8, 6))}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50"
                >
                  −
                </button>
                <span className="min-w-[56px] text-center text-sm font-semibold text-slate-900">
                  {secondsPerCard.toFixed(1)}s
                </span>
                <button
                  onClick={() => setSecondsPerCard((s) => clamp(Number((s + 0.2).toFixed(1)), 0.8, 6))}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50"
                >
                  ＋
                </button>
              </div>

              <div className="mt-2 w-full">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>自動送り</span>
                  <span>
                    残り {Math.ceil(remainingMs / 1000)} 秒（{remainingPct}%）
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${clamp(remainingPct, 0, 100)}%` }}
                  />
                </div>
              </div>

              <div className="w-full text-xs text-slate-500">
                ショートカット：<span className="font-medium">Space</span>=再生/停止　
                <span className="font-medium">←→</span>=前/次　
                <span className="font-medium">Enter</span>=表示を進める
              </div>
            </div>
          )}
        </header>

        {/* Card */}
        <section className={["rounded-3xl border bg-white p-6 shadow-sm transition", fxCard].join(" ")}>
          <div className="text-sm text-slate-600 text-center">
            {mode === "flash"
              ? "フラッシュ表示"
              : "4択テスト（正解→0.9秒／誤答→0.7秒で自動で次へ）"}
          </div>

          <div className="mt-6">
            {/* ① 語彙は中央寄せ */}
            <div className="text-center text-5xl font-extrabold tracking-tight text-slate-900">{item.word}</div>

            {/* FLASH */}
            {mode === "flash" && (
              <div className="mt-5 space-y-3">
                <div className={["rounded-2xl border p-4 text-lg text-center", stage >= 1 ? "bg-slate-50" : "bg-white"].join(" ")}>
                  <div className="text-slate-500 text-sm">意味</div>
                  <div className={stage >= 1 ? "mt-1 font-semibold text-slate-900" : "mt-1 text-slate-300"}>
                    {stage >= 1 ? item.definition : "（Enterで表示）"}
                  </div>
                </div>

                <div className={["rounded-2xl border p-4 text-lg text-center", stage >= 2 ? "bg-slate-50" : "bg-white"].join(" ")}>
                  <div className="text-slate-500 text-sm">例</div>
                  <div className={stage >= 2 ? "mt-1 font-semibold text-slate-900" : "mt-1 text-slate-300"}>
                    {stage >= 2 ? item.example : "（もう一度Enterで表示）"}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900 text-center">
                  ここはフラッシュです（保存しません）。テストモードにすると回答ログが保存されます。
                </div>
              </div>
            )}

            {/* TEST */}
            {mode === "test" && (
              <div className="mt-6">
                {/* ① ヒントも中央寄せ */}
                <div className="rounded-2xl border bg-slate-50 p-4 text-center">
                  <div className="text-sm text-slate-600">意味（ヒント）</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{item.definition}</div>
                  <div className="mt-2 text-sm text-slate-600">例</div>
                  <div className="mt-1 text-base font-medium text-slate-900">{item.example}</div>
                </div>

                <div className="mt-4 grid gap-3">
                  {item.choices.map((c) => {
                    const chosen = selected === c;
                    const isCorrectAnswer = c === item.answer;

                    const correctChoice = selected && isCorrectAnswer;
                    const wrongChoice = selected && chosen && !isCorrectAnswer;

                    // ③ 誤答時だけ、正解選択肢を「強調」する（ハイライト＆リング＆少し大きく）
                    const emphasizeCorrectOnWrong =
                      selected && showCorrectHint && isCorrectAnswer;

                    return (
                      <button
                        key={c}
                        onClick={() => choose(c)}
                        disabled={selected !== null}
                        className={[
                          // ① 選択肢は中央寄せ
                          "w-full rounded-2xl border px-4 py-4 text-center text-base font-semibold shadow-sm transition",
                          "hover:-translate-y-[1px] hover:shadow-md active:translate-y-0",
                          "disabled:cursor-not-allowed disabled:opacity-95",

                          // 通常色
                          !selected ? "bg-white" : "",

                          // 正誤の色
                          correctChoice ? "border-emerald-300 bg-emerald-50" : "",
                          wrongChoice ? "border-rose-300 bg-rose-50" : "",

                          // ③ 誤答時の「正解強調」
                          emphasizeCorrectOnWrong
                            ? "ring-2 ring-emerald-400 bg-emerald-50 scale-[1.01]"
                            : "",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span>{c}</span>

                          {/* 正解/不正解の記号も中央寄せで横に */}
                          {selected && (
                            <span className="text-sm">
                              {correctChoice ? "✅" : wrongChoice ? "❌" : emphasizeCorrectOnWrong ? "⭐" : ""}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* （表示は最小限） */}
                {selected && (
                  <div className="mt-4 text-center text-sm text-slate-600">
                    {saveStatus === "saving" && "記録中…"}
                    {saveStatus === "saved" && "✅ 記録しました"}
                    {saveStatus === "error" && (
                      <span className="text-rose-700 break-all">❌ 保存エラー：{saveError}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="mt-6 text-center text-xs text-slate-500">
          先生ページ：<span className="font-medium">/teacher</span>
        </footer>
      </div>
    </main>
  );
}
