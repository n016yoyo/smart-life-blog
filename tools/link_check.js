#!/usr/bin/env node
// 홈 배포 전/후 링크 전수 점검.
//
// ★왜(2026-08-10): 인스타 프로필로 들어온 사장님이 스토어 버튼을 눌렀는데 아무 반응이 없었다.
//   원인을 네 번 헛짚었고, 넷 다 "일반 브라우저에서는 멀쩡"했다. 실기기·인앱을 안 봤기 때문이다.
//   그래서 **인앱 브라우저 흉내까지** 자동으로 본다.
//
// 보는 것
//   A 내부 링크가 실제 파일로 존재하는가
//   B 외부 링크가 살아 있는가(4xx/5xx 아님)
//   C 인앱 대응 스크립트가 그대로 있는가(회귀 방지)
//   D 환경별 동작 , 인스타 iOS(안내 시트) · 인스타 안드(market 스킴) · 일반(새 탭)
//   E JS 오류 없음 / 링크를 가리는 요소 없음
//
// 쓰는 법
//   node tools/link_check.js            (로컬 파일 기준)
//   node tools/link_check.js --live     (배포된 주소 기준)
const fs = require("fs"), path = require("path");
const { chromium } = require(require.resolve("playwright", { paths: ["/home/user/template/docs/_engine"] }));
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LIVE = process.argv.includes("--live");
const URL = LIVE ? "https://n016yoyo.github.io/smart-life-blog/?v=" + Date.now()
                 : "file://" + path.join(ROOT, "index.html");
const CHR = execSync("ls /nix/store/*/bin/chromium | head -1").toString().trim();

const UAS = {
  "인스타 iOS": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0",
  "인스타 안드": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143 Mobile Safari/537.36 Instagram 340.0",
  "사파리 일반": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

let bad = 0;
const ng = m => { bad++; console.log("❌ " + m); };
const ok = m => console.log("✅ " + m);

(async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  // ── C 회귀 방지: 인앱 대응이 통째로 사라지지 않았는지
  const must = ["inApp", "isiOS", "isAos", "openHelp", "googlechrome://", "market://"];
  const miss = must.filter(k => !html.includes(k));
  miss.length ? ng("인앱 대응 코드 사라짐: " + miss.join(", ")) : ok("인앱 대응 코드 살아 있음");

  const b = await chromium.launch({ headless: true, executablePath: CHR, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  // ── A·B·E 링크 전수 + 가림 + JS 오류 (일반 브라우저 기준)
  {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: UAS["사파리 일반"], locale: "ko-KR", isMobile: true, hasTouch: true });
    const p = await c.newPage();
    const errs = []; p.on("pageerror", e => errs.push(String(e).slice(0, 70)));
    await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(2500);
    errs.length ? ng("JS 오류: " + errs[0]) : ok("JS 오류 없음");

    const links = await p.$$eval("a[href]", as => as.map(a => a.getAttribute("href")));
    const ext = [...new Set(links.filter(h => /^https?:/i.test(h)))];
    const int = [...new Set(links.filter(h => h && !/^(https?:|mailto:|tel:|#|javascript:)/i.test(h)))];
    ok(`링크 ${links.length}개 (외부 ${ext.length} · 내부 ${int.length})`);

    for (const h of int) {
      const rel = h.replace(/[?#].*$/, "").replace(/\/$/, "/index.html");
      const f = path.join(ROOT, rel);
      fs.existsSync(f) ? null : ng(`내부 링크 파일 없음: ${h}`);
    }
    ok("내부 링크 파일 확인 끝");

    // 화면에 보이는 링크가 실제로 눌리는가(가리는 요소 없나)
    const blocked = await p.$$eval("a[href]", as => as.filter(a => {
      const r = a.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
      const hit = document.elementFromPoint(cx, cy);
      return !(hit && hit.closest && hit.closest("a") === a);
    }).map(a => (a.textContent || "").trim().slice(0, 20)));
    blocked.length ? ng("가려진 링크: " + blocked.join(", ")) : ok("보이는 링크 전부 탭 가능");

    // 외부 링크 생사 (스토어는 UA 따라 스킴 리디렉션이라 3xx 도 정상)
    for (const u of ext) {
      let code = 0;
      try { code = parseInt(execSync(`curl -s -o /dev/null -w "%{http_code}" -m 12 -A "Mozilla/5.0" ${JSON.stringify(u)}`).toString(), 10); } catch { code = 0; }
      if (code >= 400 || code === 0) ng(`외부 링크 ${code || "연결실패"}: ${u.slice(0, 60)}`);
    }
    ok("외부 링크 생사 확인 끝");
    await c.close();
  }

  // ── D 환경별 동작
  for (const [name, ua] of Object.entries(UAS)) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, locale: "ko-KR", isMobile: true, hasTouch: true });
    const p = await c.newPage();
    await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(1800);
    const r = await p.evaluate(() => {
      const a = document.querySelector('a.badge[data-store="ios"]');
      if (!a) return { err: "iOS 배지 없음" };
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      const h = document.getElementById("openHelp");
      return { prevented: ev.defaultPrevented, sheet: !!h,
        chrome: h && h.querySelector("#opChrome") ? h.querySelector("#opChrome").getAttribute("href") : "",
        target: a.getAttribute("target") || "(없음)" };
    });
    if (r.err) { ng(`${name}: ${r.err}`); await c.close(); continue; }
    if (name === "인스타 iOS") {
      (r.sheet && /^googlechrome:/.test(r.chrome)) ? ok(`${name} , 안내 시트 + 크롬 버튼`) : ng(`${name} , 안내 시트가 안 뜬다(아이폰은 이게 유일한 길이다)`);
    } else if (name === "인스타 안드") {
      r.target === "(없음)" ? ok(`${name} , target 제거됨(새 탭 못 여는 웹뷰 대응)`) : ng(`${name} , target=_blank 가 남아 있다(눌러도 무반응이 된다)`);
    } else {
      r.target === "_blank" ? ok(`${name} , 새 탭 유지`) : ng(`${name} , 일반 브라우저에서 새 탭이 아니다`);
    }
    await c.close();
  }

  await b.close();
  console.log(bad ? `\n=> ❌ ${bad}건 , 고치고 다시 돌린다` : "\n=> ✅ 전부 통과");
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error("실패:", e.message); process.exit(1); });
