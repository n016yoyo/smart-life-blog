#!/usr/bin/env node
// jev_script_check.js , 릴스 대본을 제브(Jev, TypeSafe)에게 한 줄씩 판정시킨다. 문장은 안 만들고 답만 찍는다.
//   줄마다 세 가지: ①뜻 반복(앞 줄에 이미 있는 말인가) ②근거 없는 수치(분모 없는 숫자인가) ③약속(시청자에게 주겠다고 한 것 → 직접 돌려볼 것)
//   첫 줄은 훅 유형(상태 진단·통념 반박·권위 수치·완주 유도)과 스테이크(시청자 본인의 돈·한도·시간)를 더 본다.
// 준비: Node 18+ , OpenRouter 키(https://openrouter.ai/keys). 웨이트리스트 없이 typesafe/jev-1.13 이 바로 된다.
// 사용:
//   OPENROUTER_API_KEY=sk-or-... node jev_script_check.js script.txt        (한 줄에 대사 한 줄)
//   OPENROUTER_API_KEY=sk-or-... node jev_script_check.js script.json       ([{id,text}, ...] 또는 {lines:[...]})
// 비용: 18줄 대본 = 호출 18번 · 약 1.5초 · $0.0008 (출력 무료, 입력 $0.042/백만 토큰)
const fs = require("fs");
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY 환경변수가 필요합니다"); process.exit(2); }
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error("사용: node jev_script_check.js <script.txt | script.json>"); process.exit(2); }
const MODEL = "typesafe/jev-1.13", URL = "https://openrouter.ai/api/alpha/decisions";

function load() {
  const raw = fs.readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const j = JSON.parse(raw);
    return (j.lines || j).map((l, i) => ({ id: l.id || `l${i + 1}`, text: String(l.text || "").trim() })).filter(l => l.text);
  }
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((text, i) => ({ id: `l${i + 1}`, text }));
}
const usage = { calls: 0, ms: 0, cost: 0 };
async function jev(state, questions) {
  const t0 = Date.now(); usage.calls++;
  const r = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions }) });
  const j = await r.json(); const ms = Date.now() - t0; usage.ms += ms;
  if (!j.answers) return { error: j.error || j, ms };
  usage.cost += j.usage?.cost || 0;
  return { answers: j.answers, ms };
}
const HOOK = { status_diagnosis: "상태 진단", belief_rebuttal: "통념 반박", authority_number: "권위 수치", completion_lure: "완주 유도", none: "네 유형 밖" };
(async () => {
  const lines = load();
  const all = lines.map((l, i) => `${i + 1}. ${l.text}`).join("\n");
  console.log(`[jev] ${file} ${lines.length}줄 → ${MODEL}\n`);
  const res = await Promise.all(lines.map(async (l, i) => {
    const prev = lines.slice(0, i).map((p, k) => `${k + 1}. ${p.text}`).join("\n") || "(none)";
    const state = { script_so_far: prev, this_line_number: i + 1, this_line: l.text, full_script: all };
    const q = {
      new_info: { type: "noul", instructions: "this_line adds at least one piece of information (a fact, number, named thing, action or turn of argument) that is NOT already stated in script_so_far. A line that only rephrases, restates or summarizes earlier lines does not add information." },
      number_no_basis: { type: "noul", instructions: "this_line states a count, amount, ratio or percentage, and the line itself does not say what was measured or counted to get it (no denominator, no 'out of', no named measurement)." },
      promise: { type: "noul", instructions: "this_line promises the viewer something they can obtain, run or repeat themselves (a file, script, guide link, step-by-step procedure, 'I will give you')." },
    };
    if (i === 0) {
      q.hook_type = { type: "choice", instructions: "Which hook pattern does this opening line of a short vertical video use?", criteria: {
        status_diagnosis: "Diagnoses the viewer's current state or habit", belief_rebuttal: "Rebuts a common belief or reveals a misunderstanding",
        authority_number: "Leads with a concrete measured number", completion_lure: "Promises a payoff at the end", none: "None of the above" } };
      q.stake = { type: "noul", instructions: "The line names something the viewer personally has at stake: their own money, subscription fee, usage limit, time, or a concrete number about it." };
    }
    return { l, r: await jev(state, q) };
  }));
  let warn = 0;
  for (const { l, r } of res) {
    if (r.error) { console.log(`❌ ${l.id.padEnd(4)} ${JSON.stringify(r.error).slice(0, 100)}`); continue; }
    const a = r.answers, ni = a.new_info?.noul, nb = a.number_no_basis?.noul, pr = a.promise?.noul, m = [];
    if (ni < 0.5) m.push(`뜻 반복 ${ni.toFixed(2)}`);
    if (nb >= 0.5) m.push(`근거 없는 수치 ${nb.toFixed(2)}`);
    if (pr >= 0.5) m.push(`약속 ${pr.toFixed(2)} → 주겠다고 한 것을 직접 돌려볼 것`);
    if (a.hook_type) m.push(`훅=${HOOK[a.hook_type.choice] || a.hook_type.choice} ${(a.hook_type.probabilities?.[a.hook_type.choice] ?? 0).toFixed(2)} · 스테이크 ${(a.stake?.noul ?? 0).toFixed(2)}`);
    const tag = (ni < 0.5 || nb >= 0.5) ? "⚠️" : m.length ? "·" : "✓"; if (tag === "⚠️") warn++;
    console.log(`${tag} ${l.id.padEnd(4)} ${String(r.ms).padStart(4)}ms  ${l.text}`); if (m.length) console.log(`      ${m.join(" · ")}`);
  }
  console.log(`\n⚠️ ${warn}줄 · 호출 ${usage.calls}회 · 합계 ${usage.ms}ms(병렬이라 벽시계는 더 짧음) · 비용 $${usage.cost.toFixed(5)}`);
  console.log("⚠️ 는 참고다. 뜻 반복·분모 없는 수치는 사람이 읽고 정하고, 픽셀(원·가림·크롭)은 제브가 못 본다.");
})();
