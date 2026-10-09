// Records the REAL NONON window (current build, real services, real local AI) doing the lead demo.
// Output: E:\nonon-dev\demo\raw\*.webm and E:\nonon-dev\demo\markers.json (event times in seconds since launch).
// Recording aids only: a small orange cursor dot is injected into the page so mouse moves are visible.
// Nothing in the app's results is scripted or edited; the folder is created off camera because the native dialog cannot be filmed.
import { _electron as electron } from "playwright-core";
import { mkdirSync, rmSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const APP = "E:\\New Claude\\Nonon\\app";
const DEMO = "E:\\nonon-dev\\demo";
const DATA = `${DEMO}\\data`;
const WS = `${DEMO}\\Print shop books`;
const RAW = `${DEMO}\\raw`;
const UD = `${DEMO}\\ud`;
for (const d of [DATA, WS, RAW, UD]) rmSync(d, { recursive: true, force: true });
mkdirSync(WS, { recursive: true });
mkdirSync(RAW, { recursive: true });

const W = 1600, H = 900;
const app = await electron.launch({
  executablePath: `${APP}\\node_modules\\electron\\dist\\electron.exe`,
  args: [APP, `--user-data-dir=${UD}`],
  env: { ...process.env, NONON_DATA_DIR: DATA, NONON_MODEL_DIR: "E:\\nonon-dev\\install-test", ELECTRON_CACHE: "E:\\electron-cache" },
  recordVideo: { dir: RAW, size: { width: W, height: H } },
});
const T0 = Date.now();
const pid = app.process().pid;
console.log("electron main pid", pid);
const markers = [];
const mark = (name, extra = {}) => { const t = +((Date.now() - T0) / 1000).toFixed(2); markers.push({ name, t, ...extra }); console.log("MARK", name, t); };
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: W, height: H });
  const call = (ch, arg) => page.evaluate(([c, a]) => window.nonon.call(c, a), [ch, arg]);
  const sleep = (ms) => page.waitForTimeout(ms);
  const installCursor = () => page.evaluate(() => {
    if (document.getElementById("rec-cursor")) return;
    const d = document.createElement("div");
    d.id = "rec-cursor";
    d.style.cssText = "position:fixed;left:-50px;top:-50px;width:22px;height:22px;border-radius:50%;background:rgba(244,123,50,.85);border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)";
    document.body.append(d);
    addEventListener("mousemove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }, true);
  });
  let mx = W / 2, my = H / 2;
  const moveTo = async (x, y, steps = 24) => { await page.mouse.move(x, y, { steps }); mx = x; my = y; };
  const clickEl = async (loc) => {
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    const b = await loc.boundingBox();
    await moveTo(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(350);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  const typeSlow = async (text) => { for (const ch of text) { await page.keyboard.type(ch); await sleep(34); } };

  await sleep(2500);
  // Off camera: the first-run flow and the native folder dialog. Same calls the app makes after a folder is picked.
  await call("settings:update", { modelId: "qwen3.5-4b", onboarded: true });
  const ws = await call("workspace:create", { name: "Print shop books", folder: WS, pack: "bookkeeping" });
  await call("workspace:add-samples", { id: ws.id });
  await call("settings:update", { activeWorkspaceId: ws.id });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await sleep(2500);
  await installCursor();
  await moveTo(W / 2, H / 2, 2);
  mark("home_ready");
  await sleep(2500);

  await clickEl(page.locator(".sidebar").getByText("Print shop books").first());
  await sleep(1800);
  mark("project_open");
  const box = page.getByPlaceholder(/Tell Non/i).first();
  await clickEl(box);
  await sleep(600);
  mark("typing_start");
  await typeSlow("Compare expense-report-may-2026.csv with bank-export-may-2026.csv");
  await sleep(900);
  mark("typing_end");
  await page.keyboard.press("Enter");
  mark("sent");
  const cont = page.getByRole("button", { name: /^Continue$/ }).first();
  await cont.waitFor({ state: "visible", timeout: 120000 });
  mark("questions_visible");
  await page.locator(".timeline").evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => undefined);
  await sleep(5500);
  await clickEl(cont);
  mark("continue_clicked");

  const t0 = Date.now();
  let task;
  for (;;) {
    await sleep(1000);
    task = (await call("task:list", { workspaceId: ws.id }))[0];
    if (task && ["running", "validating"].includes(task.state) && !markers.find((m) => m.name === "running")) mark("running");
    if (task && !["inspecting", "running", "validating", "applying", "clarifying", "waiting"].includes(task.state)) break;
    if (Date.now() - t0 > 300000) break;
  }
  mark("task_done", { state: task?.state, seconds: +((Date.now() - t0) / 1000).toFixed(1) });
  console.log("SUMMARY", String(task.summary).split("\n").join(" / "));
  console.log("CHECKS", task.checks.map((c) => c.status + ":" + c.label).join(" | "));
  const proposals = await call("change:list", { workspaceId: ws.id });
  const target = proposals[0].target;
  const shaBefore = sha(target);
  console.log("TARGET", target, shaBefore, "status", proposals[0].status);

  await sleep(3500);
  mark("results_visible");
  const dockOpen = await page.locator(".results-dock").count();
  console.log("dock auto-open:", dockOpen);
  await sleep(2500);
  const tabs = await page.locator(".sheet-tab").allInnerTexts();
  console.log("SHEET TABS", tabs.join(" | "));
  mark("sheets_start", { tabs });
  for (let i = 1; i < Math.min(tabs.length, 4); i++) {
    await clickEl(page.locator(".sheet-tab").nth(i));
    await sleep(2800);
    mark("sheet_" + i, { tab: tabs[i] });
  }
  await clickEl(page.locator(".sheet-tab").nth(0));
  await sleep(1800);

  const shaOpened = sha(target);
  await clickEl(page.getByRole("button", { name: /Changes to check/ }).first());
  await sleep(1500);
  mark("review_open");
  await sleep(4500);
  console.log("original untouched while waiting for OK:", sha(target) === shaBefore);
  const apply = page.getByRole("button", { name: /Make the change/ }).first();
  await clickEl(apply);
  mark("apply_clicked");
  await sleep(3500);
  mark("applied_shown");
  const shaApplied = sha(target);
  console.log("file changed after OK:", shaApplied !== shaBefore);
  const undo = page.getByRole("button", { name: /Undo this change/ }).first();
  await clickEl(undo);
  await sleep(1200);
  mark("undo_confirm_shown");
  const yes = page.getByRole("button", { name: /^Yes, undo it/ }).first();
  await clickEl(yes);
  await sleep(3500);
  mark("undone_shown");
  const shaUndone = sha(target);
  console.log("byte-identical after undo:", shaUndone === shaBefore);
  await moveTo(W * 0.3, 71, 30);
  await sleep(3500);
  mark("end_hold");

  const proof = { target, shaBefore, shaOpened, shaApplied, shaUndone, taskState: task.state, taskSeconds: +((Date.now() - t0) / 1000).toFixed(1) };
  writeFileSync(`${DEMO}\\proof.json`, JSON.stringify(proof, null, 2));
  writeFileSync(`${DEMO}\\markers.json`, JSON.stringify(markers, null, 2));
  console.log("PROOF", JSON.stringify(proof));
} catch (e) {
  console.log("FAILED", e);
  writeFileSync(`${DEMO}\\markers.json`, JSON.stringify(markers, null, 2));
} finally {
  await app.close().catch(() => undefined);
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
  console.log(readdirSync(RAW));
}
