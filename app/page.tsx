"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [classCode, setClassCode] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const router = useRouter();

  const start = () => {
    if (!classCode || !studentNo) return;
    router.push(`/study?class=${classCode}&no=${studentNo}`);
  };

  return (
    <main style={{ padding: 40 }}>
      <h1>算数語彙トレーニング</h1>

      <div>
        <input
          placeholder="学級コード"
          value={classCode}
          onChange={(e) => setClassCode(e.target.value)}
        />
      </div>

      <div>
        <input
          placeholder="出席番号"
          value={studentNo}
          onChange={(e) => setStudentNo(e.target.value)}
        />
      </div>

      <button onClick={start}>はじめる</button>
    </main>
  );
}
