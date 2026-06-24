/* 빌드 없는 단일 파일 앱을 위한 경량 점검:
   - manifest.webmanifest 가 올바른 JSON 인가
   - sw.js 가 문법적으로 유효한가
   - index.html 인라인 스크립트가 문법적으로 유효한가
   - 인라인 스크립트에 디버그 console.log 가 남아있지 않은가
*/
import fs from "node:fs";
import vm from "node:vm";

let ok = true;
const pass = (m) => console.log("✓", m);
const fail = (m) => { console.error("✗", m); ok = false; };

// 1) manifest JSON
try {
  JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
  pass("manifest.webmanifest is valid JSON");
} catch (e) {
  fail("manifest.webmanifest: " + e.message);
}

// 2) sw.js 문법
try {
  new vm.Script(fs.readFileSync("sw.js", "utf8"), { filename: "sw.js" });
  pass("sw.js parses");
} catch (e) {
  fail("sw.js: " + e.message);
}

// 3) index.html 인라인 스크립트 문법 + console.log 검사
const html = fs.readFileSync("index.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  fail("no inline <script> found in index.html");
} else {
  try {
    new vm.Script(m[1], { filename: "index.inline.js" });
    pass("index.html inline script parses");
  } catch (e) {
    fail("index.html inline script: " + e.message);
  }
  if (/console\.log/.test(m[1])) fail("debug console.log left in index.html inline script");
  else pass("no debug console.log in index.html");
}

process.exit(ok ? 0 : 1);
