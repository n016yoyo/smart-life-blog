#!/usr/bin/env node
// 전 페이지 전수조사 , **실제 브라우저로 열어** 화면이 비어 있는 페이지를 잡는다.
//   node tools/page_audit.js            로컬 파일 기준
//   node tools/page_audit.js --live     배포본 기준
//
// ★왜 태그 세기만으로는 부족한가(2026-09-08 사장님이 잡으신 건):
//   claude-cache-bill 은 HTTP 200 이고 <title> 도 정상인데 **본문이 통째로 안 보였다.**
//   `</style>` 하나가 빠져서 브라우저가 body 전체를 CSS 로 먹었기 때문이다.
//   HTTP 코드·링크 검사로는 절대 안 걸린다. 그려진 픽셀(본문 높이·글자 수)로 판정해야 한다.
//   같은 날 만든 claude-memory-count 에는 `</style>` 이 하나 더 있었다(복사 실수 한 쌍).
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const LIVE = process.argv.includes("--live");
// --only a/index.html b/index.html , 바뀐 페이지만 본다(커밋 훅에서 쓴다)
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i < 0 ? null : process.argv.slice(i + 1).filter(a => !a.startsWith("--")); })();
const BASE = "https://n016yoyo.github.io/smart-life-blog/";
const SKIP = new Set(["assets", "tools", "commands", "certs", "docs"]);
const CHR = process.env.CHR || require("child_process").execSync("ls /nix/store/*/bin/chromium | head -1").toString().trim();
const { chromium } = require(require.resolve("playwright-core", { paths: ["/home/user/template/docs/_engine"] }));

const PAIRS = ["style", "script", "head", "body", "html", "table", "ul", "ol"];
function tagCheck(html) {
  const bad = [];
  for (const t of PAIRS) {
    const o = (html.match(new RegExp(`<${t}(\\s|>)`, "gi")) || []).length;
    const c = (html.match(new RegExp(`</${t}>`, "gi")) || []).length;
    if (o !== c) bad.push(`<${t}> ${o} ≠ </${t}> ${c}`);
  }
  if (!/<\/body>/i.test(html)) bad.push("</body> 없음");
  return bad;
}

(async () => {
  const pages = ["index.html", ...fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_") && !SKIP.has(d.name))
    .map(d => d.name + "/index.html").filter(f => fs.existsSync(path.join(ROOT, f)))].sort()
    .filter(f => !ONLY || ONLY.includes(f));
  if (!pages.length) { console.log("검사할 페이지 없음"); process.exit(0); }

  const b = await chromium.launch({ executablePath: CHR, headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: 430, height: 900 } });
  let bad = 0;
  for (const f of pages) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    const tags = tagCheck(html);
    const url = LIVE ? BASE + f.replace(/index\.html$/, "") : "file://" + path.join(ROOT, f);
    let r = { h: 0, len: 0, title: "" }, err = "";
    try {
      await p.goto(url, { waitUntil: "load", timeout: 25000 });
      await p.waitForTimeout(500);
      r = await p.evaluate(() => ({ h: document.body ? document.body.scrollHeight : 0,
        len: document.body ? document.body.innerText.trim().length : 0, title: document.title }));
    } catch (e) { err = e.message.split("\n")[0].slice(0, 70); }
    // 판정 , 본문 높이 300px 미만이거나 글자 80자 미만이면 "안 그려진 것"으로 본다
    const blank = !err && (r.h < 300 || r.len < 80);
    if (err || blank || tags.length) {
      bad++;
      console.log(`❌ ${f}`);
      if (err) console.log(`     로드 실패: ${err}`);
      if (blank) console.log(`     빈 화면 , 본문 높이 ${r.h}px · 글자 ${r.len}자 (제목은 "${r.title}")`);
      if (tags.length) console.log(`     태그 짝: ${tags.join(" · ")}`);
    }
  }
  await b.close();
  console.log(`\n${pages.length}개 검사 · 문제 ${bad}개`);
  console.log(bad ? "=> ❌ 위 페이지를 고치고 다시 돌린다" : "=> ✅ 전부 정상(브라우저에서 본문이 그려진다)");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error("실패:", e.message); process.exit(1); });
