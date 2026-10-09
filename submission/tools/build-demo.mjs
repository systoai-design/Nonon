// Builds submission/demo-1min.mp4 from the raw Playwright recording of the real app.
// Usage: node build-demo.mjs   (raw file: E:\nonon-dev\demo\raw\*.webm)
// Editing is limited to: trimming, hard cuts of idle time, scaling, burned-in captions, title and end cards,
// and one zoomed inset cropped from the same recorded frames. Nothing is sped up. No app pixels are drawn by us.
import { chromium } from "file:///E:/nonon-dev/e2e/node_modules/playwright-core/index.mjs";
import { readdirSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FF = "C:\\Users\\Kyle\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe";
const REPO = "E:\\New Claude\\Nonon";
const OUT = `${REPO}\\submission`;
const WORK = "E:\\nonon-dev\\demo\\build";
const RAWDIR = "E:\\nonon-dev\\demo\\raw";
const RAW = `${RAWDIR}\\${readdirSync(RAWDIR).find((f) => f.endsWith(".webm"))}`;
const FONT = pathToFileURL(`${REPO}\\site\\public\\fonts\\nunito-latin-wght-normal.woff2`).href;
const NON = pathToFileURL(`${REPO}\\app\\src\\renderer\\src\\assets\\non\\non-rest.png`).href;
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const base = `
@font-face{font-family:Nunito;src:url("${FONT}");font-weight:200 1000}
*{box-sizing:border-box;margin:0}
body{font-family:Nunito,sans-serif;color:#fff}
b{color:#F47B32;font-weight:800}
`;
const captionHtml = (text) => `<style>${base}
body{width:1920px;height:120px;background:#0b0b0b;display:flex;align-items:center;padding:0 60px 0 0}
.bar{width:12px;height:120px;background:#F47B32;margin-right:44px;flex:none}
.t{font-size:41px;font-weight:700;line-height:1.2;flex:1}
.tag{font-size:20px;color:#8a8a8a;font-weight:600;margin-left:30px;text-align:right;flex:none;line-height:1.3}
</style><div class="bar"></div><div class="t">${text}</div><div class="tag">Real app recording<br>Windows 11</div>`;
const titleHtml = `<style>${base}
body{width:1920px;height:1080px;background:#0b0b0b;display:flex;flex-direction:column;align-items:center;justify-content:center}
img{width:210px;margin-bottom:34px}
h1{font-size:150px;font-weight:900;letter-spacing:.34em;padding-left:.34em}
.rule{width:140px;height:8px;background:#F47B32;margin:34px 0 40px}
p{font-size:50px;font-weight:600;color:#e8e8e8}
p.s{font-size:34px;color:#9a9a9a;margin-top:18px}
</style><img src="${NON}"><h1>NONON</h1><div class="rule"></div><p>Finish everyday file work with an <b>AI on your computer</b></p><p class="s">Compare spreadsheets. Check every change. Undo anything.</p>`;
const endHtml = `<style>${base}
body{width:1920px;height:1080px;background:#0b0b0b;display:flex;flex-direction:column;align-items:center;justify-content:center}
img{width:170px;margin-bottom:26px}
h1{font-size:120px;font-weight:900;letter-spacing:.3em;padding-left:.3em}
.rule{width:140px;height:8px;background:#F47B32;margin:30px 0 36px}
.u{font-size:92px;font-weight:800;color:#F47B32}
p{font-size:48px;font-weight:600;color:#e8e8e8;margin-top:22px}
p.s{font-size:28px;color:#8a8a8a;margin-top:44px}
</style><img src="${NON}"><h1>NONON</h1><div class="rule"></div><div class="u">trynonon.xyz</div><p>Windows and Mac</p><p class="s">Local AI: llama.cpp and Qwen3.5. Reuses Pragma (Apache-2.0).</p>`;

const segs = [
  { id: "s1", ss: 3.6, d: 3.9, cap: "<b>Pick a folder</b> of your files." },
  { id: "s2", ss: 8.5, d: 5.7, cap: "<b>Ask in plain words.</b> Name the two files." },
  { id: "s3a", ss: 16.0, d: 4.5, cap: "Non asks a few quick questions, with <b>suggested answers</b> ready." },
  { id: "s3b", ss: 22.4, d: 1.5, cap: "Non asks a few quick questions, with <b>suggested answers</b> ready." },
  { id: "s4", ss: 24.0, d: 5.5, cap: "The answer appears <b>inside the app</b>. Nothing sped up." },
  { id: "s5", ss: 30.8, d: 8.0, cap: "Every row is accounted for. The totals are <b>added up by code</b>, not guessed by the AI." },
  { id: "s6", ss: 41.8, d: 5.4, cap: "<b>Changes to check:</b> two new columns. Nothing changes until you say OK." },
  { id: "s7", ss: 47.2, d: 3.0, cap: "Make the change." },
  { id: "s8", ss: 50.3, d: 4.7, cap: "<b>Undo.</b> The file is back the way it was." },
  { id: "s9", ss: 54.3, d: 5.0, cap: "<b>Works offline after setup.</b> The AI runs on your computer.", zoom: true },
];

const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const render = async (html, file, h) => {
  const f = `${WORK}\\${file}.html`;
  writeFileSync(f, `<!doctype html><meta charset="utf-8">${html}`);
  await page.goto(pathToFileURL(f).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${WORK}\\${file}.png`, clip: { x: 0, y: 0, width: 1920, height: h } });
};
await render(titleHtml, "title", 1080);
await render(endHtml, "end", 1080);
for (const s of segs) await render(captionHtml(s.cap), `cap-${s.id}`, 120);
await browser.close();

const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", "30"];
const run = (args) => execFileSync(FF, ["-v", "error", "-y", ...args], { stdio: "inherit" });
const parts = [];
const card = (id, d) => {
  run(["-loop", "1", "-t", String(d), "-i", `${WORK}\\${id}.png`, "-vf", `fade=t=in:st=0:d=0.6,fade=t=out:st=${d - 0.6}:d=0.6,format=yuv420p`, ...enc, `${WORK}\\${id}.mp4`]);
  parts.push(id);
};
card("title", 5);
for (const s of segs) {
  const frame = `[0:v]fps=30,scale=1707:960:flags=lanczos[a];color=c=0x0b0b0b:s=1920x1080:r=30:d=${s.d}[bg];[bg][a]overlay=107:0[b]`;
  const fc = s.zoom
    ? `${frame};[0:v]fps=30,crop=330:30:252:98,scale=632:58:flags=lanczos,pad=648:74:8:8:color=0xF47B32[z];[b][z]overlay=636:310[b2];[b2][1:v]overlay=0:960[c]`
    : `${frame};[b][1:v]overlay=0:960[c]`;
  run(["-ss", String(s.ss), "-t", String(s.d), "-i", RAW, "-loop", "1", "-t", String(s.d), "-i", `${WORK}\\cap-${s.id}.png`, "-filter_complex", fc, "-map", "[c]", ...enc, "-t", String(s.d), `${WORK}\\${s.id}.mp4`]);
  parts.push(s.id);
}
card("end", 6);

const list = parts.map((p) => `file '${(WORK + "\\" + p + ".mp4").replace(/\\/g, "/")}'`).join("\n");
writeFileSync(`${WORK}\\list.txt`, list);
run(["-f", "concat", "-safe", "0", "-i", `${WORK}\\list.txt`, "-c", "copy", `${WORK}\\silent.mp4`]);
run(["-i", `${WORK}\\silent.mp4`, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", `${OUT}\\demo-1min.mp4`]);

// Poster: the results frame with its caption, from the final video.
run(["-ss", "23.5", "-i", `${OUT}\\demo-1min.mp4`, "-frames:v", "1", `${OUT}\\demo-1min-poster.png`]);

// 15 s teaser: typing, answer, changes, undo, end card. Cut from the part files, so it is the same footage.
const tz = (id, d, ss = 0) => ({ id, d, ss });
const teaserParts = [tz("s2", 3, 2.5), tz("s4", 3.5), tz("s6", 3), tz("s8", 2.5, 1.2)];
const tl = [];
let n = 0;
for (const t of teaserParts) {
  const f = `${WORK}\\tz${n++}.mp4`;
  run(["-ss", String(t.ss), "-t", String(t.d), "-i", `${WORK}\\${t.id}.mp4`, ...enc, f]);
  tl.push(f);
}
run(["-ss", "0.6", "-t", "3", "-i", `${WORK}\\end.mp4`, ...enc, `${WORK}\\tzend.mp4`]);
tl.push(`${WORK}\\tzend.mp4`);
writeFileSync(`${WORK}\\tlist.txt`, tl.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
run(["-f", "concat", "-safe", "0", "-i", `${WORK}\\tlist.txt`, "-c", "copy", `${WORK}\\tz-silent.mp4`]);
run(["-i", `${WORK}\\tz-silent.mp4`, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", `${OUT}\\demo-teaser.mp4`]);
console.log("done");
