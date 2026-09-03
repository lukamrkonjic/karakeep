// Pins the two gates on copy-to-save: only media-ish content, and only when
// the copy happened in a browser. Getting either wrong means the picker
// interrupts ordinary work, which is the whole reason the gates exist.
const { app, clipboard } = require("electron");
const { classifyClipboard } = require("../dist/main/clipboardWatch.cjs");

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

app.whenReady().then(async () => {
  const kindOf = async (text) => {
    await clipboard.writeText(text);
    const r = await classifyClipboard();
    return r ? r.kind : null;
  };

  // Should fire — the cases this feature exists for.
  check("pinterest image link (Copy Image Link)",
    await kindOf("https://i.pinimg.com/1200x/a1/7c/f7/a17cf7e9807d2596909ee9796dc4bb5a.jpg"), "url");
  check("youtube watch url (Copy video URL)",
    await kindOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "url");
  check("youtube short link", await kindOf("https://youtu.be/dQw4w9WgXcQ"), "url");
  check("youtube shorts", await kindOf("https://www.youtube.com/shorts/abc123"), "url");
  check("pinterest pin page", await kindOf("https://se.pinterest.com/pin/172262754491804152/"), "url");
  check("direct mp4", await kindOf("https://cdn.example.com/clip.mp4"), "url");
  check("image url with a query string", await kindOf("https://ex.com/a.jpg?w=800"), "url");

  // Must stay silent — ordinary copying.
  check("a sentence", await kindOf("just some notes I copied"), null);
  check("a code snippet", await kindOf("const x = await fetch(url);"), null);
  check("an ordinary link", await kindOf("https://news.ycombinator.com/item?id=1"), null);
  check("a github link", await kindOf("https://github.com/karakeep-app/karakeep"), null);
  check("a windows file path", await kindOf("C:\Users\Luka\notes.txt"), null);
  check("a bare domain", await kindOf("https://example.com"), null);
  check("an email address", await kindOf("someone@example.com"), null);

  for (const f of failures) console.error(f);
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  app.exit(failures.length === 0 ? 0 : 1);
});
