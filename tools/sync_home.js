#!/usr/bin/env node
// 홈·조회수 동기화 , **새 가이드 페이지를 만들 때마다 이걸 한 번 돌린다.**
//   node tools/sync_home.js          점검만(무엇이 빠졌는지 찍는다)
//   node tools/sync_home.js --write  실제로 고친다
//
// 하는 일 셋:
//   ①조회수 카운터 주입 , 모든 <slug>/index.html 의 </body> 앞에 view 핑 한 줄. page 값 = 폴더명.
//     ★2026-09-08 실측: 67개 중 21개에 빠져 있었다(최근에 만든 페이지 대부분). 홈 카드에 조회수가
//       안 뜨던 이유가 이것이다 , 카드는 워커에 page 이름으로 물어보는데 그 페이지가 한 번도 안 찍었다.
//   ②홈 카드 누락 점검 , 폴더는 있는데 index.html 에 data-page 카드가 없는 페이지를 찾아
//     <title>·<meta description> 으로 카드를 만들어 해당 그룹 끝에 넣는다.
//   ③홈에 남은 유령 카드 점검 , 카드는 있는데 폴더가 없는 것(오타·삭제)을 경고한다.
// ★홈 화면은 조회수 상위 5 + 최신 5 만 펴고 나머지는 '전체 보기' 뒤에 둔다(index.html 의 __KWFOLD).
//   그러니 카드를 추가해도 홈이 길어지지 않는다. DM 자동매핑(ig_autolink)은 CAPTION.md 를 보므로 무관하다.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const SKIP = new Set(["assets", "tools", "commands", "design", "docs", "certs", "guide", "blog", "link-test", "telegram", "token"]);
const PING = (slug) => `<script>fetch("https://instagram.verification-app.workers.dev/api/view",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({page:"${slug}"})}).catch(()=>{});</script>`;

// 카테고리 추론 , 홈 탭(claude/auto/video/demo/etc)에 맞춘다. 애매하면 etc 로 두고 사람이 고친다.
const APPS = new Set(["fridgi", "giftwallet", "harubrief", "restocky", "restocky-install", "wc-tracker", "birthday-candle", "fireworks", "blackhole", "stretch", "sign-swap", "design-canvas", "app-words", "vote"]);
const guessCat = (slug, title) => {
  if (APPS.has(slug)) return "demo";                       // 앱·데모 착지 페이지(쇼케이스는 스토어로만 링크된다)
  const t = (slug + " " + title).toLowerCase();
  if (/claude|클로드|opus|prompt|프롬프트/.test(t)) return "claude";
  if (/reel|릴스|video|영상|dub|더빙|hairline|fx|effect|조회수/.test(t)) return "video";
  if (/auto|자동|bot|봇|naver|네이버|coupang|쿠팡|blog|블로그|keyword|키워드/.test(t)) return "auto";
  return "etc";
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHEV = '<svg class="kw-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_") && !SKIP.has(d.name))
  .map(d => d.name).filter(n => fs.existsSync(path.join(ROOT, n, "index.html"))).sort();

let home = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const injected = [], added = [], ghosts = [];

// ── ① 조회수 카운터
for (const slug of dirs) {
  const f = path.join(ROOT, slug, "index.html");
  let h = fs.readFileSync(f, "utf8");
  if (h.includes("/api/view")) continue;
  injected.push(slug);
  if (!WRITE) continue;
  h = h.includes("</body>") ? h.replace(/<\/body>/i, PING(slug) + "</body>") : h + "\n" + PING(slug) + "\n";
  fs.writeFileSync(f, h);
}

// ── ② 홈 카드 누락
for (const slug of dirs) {
  if (home.includes(`data-page="${slug}"`)) continue;
  const h = fs.readFileSync(path.join(ROOT, slug, "index.html"), "utf8");
  const title = (h.match(/<title>([^<]*)<\/title>/i) || [, slug])[1].split("|")[0].trim();
  const desc = (h.match(/<meta name="description" content="([^"]*)"/i) || [, ""])[1].trim();
  const cat = guessCat(slug, title);
  // ★날짜는 git 최초 커밋일이다. mtime 을 쓰면 카운터를 주입한 날로 바뀌어 옛 페이지가 '최신'을 독점한다(2026-09-08 실측).
  let date = "";
  try {
    date = require("child_process").execSync(
      `git log --diff-filter=A --format=%ad --date=short -- ${JSON.stringify(slug + "/index.html")} | tail -1`,
      { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {}
  if (!date) date = new Date(fs.statSync(path.join(ROOT, slug, "index.html")).mtime).toISOString().slice(0, 10);
  const card = `          <a class="kw-card" data-cat="${cat}" data-page="${slug}" href="${slug}/"><span class="kw-mark"></span><span class="kw-tx"><span class="kw-t">${esc(title)}</span><span class="kw-s">${esc(desc)}</span></span><span class="kw-views" data-date="${date}" data-views="${slug}"></span>${CHEV}</a>\n`;
  added.push(`${slug} [${cat}] ${title}`);
  if (!WRITE) continue;
  // 같은 카테고리 마지막 카드 뒤에 넣는다(그룹 라벨 순서를 지킨다)
  const re = new RegExp(`(          <a class="kw-card" data-cat="${cat}"[\\s\\S]*?</a>\\n)(?![\\s\\S]*          <a class="kw-card" data-cat="${cat}")`);
  home = re.test(home) ? home.replace(re, `$1${card}`) : home.replace(/(        <\/div>\n        <div style="text-align:center">)/, `${card}$1`);
}

// ── ②b 외부 페이지 카드(pages.json, 2026-09-13) , 블로그 폴더 밖 착지 페이지(봇 대시보드 등)는 대장에서 읽는다.
//   카드는 data-page 대신 data-ext="<key>" 로 표시하고, 조회수 키(data-views)는 key 다(그 페이지가 /api/view 에 같은 key 로 찍는다).
//   ★홈 "최신 5" 는 data-date 순이라 대장의 date 가 곧 노출 순서다.
const addedExt = [];
let ext = [];
try { ext = JSON.parse(fs.readFileSync(path.join(ROOT, "pages.json"), "utf8")).external || []; } catch {}
for (const e of ext) {
  if (!e.key || !e.url) continue;
  if (home.includes(`data-ext="${e.key}"`)) {
    // 이미 있으면 제목·설명·날짜만 대장 기준으로 맞춘다(대장이 정본)
    const re = new RegExp(`          <a class="kw-card" data-cat="[^"]*" data-ext="${e.key}"[\s\S]*?</a>\n`);
    const cur = (home.match(re) || [""])[0];
    const card = extCard(e);
    if (cur && cur !== card && WRITE) home = home.replace(re, card);
    continue;
  }
  addedExt.push(`${e.key} [${e.cat || "etc"}] ${e.title}`);
  if (!WRITE) continue;
  const cat = e.cat || "etc", card = extCard(e);
  const re = new RegExp(`(          <a class="kw-card" data-cat="${cat}"[\s\S]*?</a>\n)(?![\s\S]*          <a class="kw-card" data-cat="${cat}")`);
  home = re.test(home) ? home.replace(re, `$1${card}`) : home.replace(/(        <\/div>\n        <div style="text-align:center">)/, `${card}$1`);
}
function extCard(e) {
  return `          <a class="kw-card" data-cat="${e.cat || "etc"}" data-ext="${e.key}" href="${e.url}" target="_blank" rel="noopener"><span class="kw-mark"></span><span class="kw-tx"><span class="kw-t">${esc(e.title)}</span><span class="kw-s">${esc(e.desc || "")}</span></span><span class="kw-views" data-date="${e.date || ""}" data-views="${e.key}"></span>${CHEV}</a>\n`;
}

// ── ③ 유령 카드
for (const m of home.matchAll(/data-page="([^"]+)"/g))
  if (!dirs.includes(m[1]) && !SKIP.has(m[1]) && !fs.existsSync(path.join(ROOT, m[1]))) ghosts.push(m[1]);

if (WRITE && (added.length || addedExt.length || ext.length)) fs.writeFileSync(path.join(ROOT, "index.html"), home);

const say = (t, arr) => { console.log(`${t}: ${arr.length}건`); arr.forEach(x => console.log("   " + x)); };
console.log(`가이드 페이지 ${dirs.length}개 · 홈 카드 ${(home.match(/class="kw-card"/g) || []).length}개`);
say("조회수 카운터 없음", injected);
say("홈 카드 없음", added);
say("외부 페이지 카드 없음(pages.json)", addedExt);
say("유령 카드(폴더 없음)", ghosts);
console.log(WRITE ? "\n✅ 반영했다. link_check 로 확인하고 커밋할 것." : "\n점검만 했다. 고치려면 --write");
