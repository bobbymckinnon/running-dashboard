// Dev-only: builds the browser harness, loads test-data/vault into it and saves screenshots.
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const root = path.resolve("test-data/vault");
const files = {};
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files[path.relative(root, p).split(path.sep).join("/")] = { b64: fs.readFileSync(p).toString("base64"), mtime: Math.floor(fs.statSync(p).mtimeMs) };
  }
};
walk(root);
const out = "preview/out";
fs.mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: ["scripts/preview-entry.ts"], bundle: true, outfile: `${out}/app.js`, format: "iife", platform: "browser", target: "es2020", logLevel: "warning" });
const theme = (dark) => `body{margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;
--background-primary:${dark ? "#1e1e1e" : "#ffffff"};--background-secondary:${dark ? "#161616" : "#f6f6f7"};
--background-modifier-border:${dark ? "#333" : "#e3e3e6"};--text-normal:${dark ? "#dcddde" : "#222"};--text-muted:${dark ? "#999" : "#6b6b76"};}`;
const css = fs.readFileSync("styles.css", "utf8");
const today = process.argv[2] || "2026-11-02";
for (const dark of [false, true]) {
  fs.writeFileSync(`${out}/${dark ? "dark" : "light"}.html`, `<!doctype html><meta charset="utf-8"><style>${theme(dark)}${css}</style>
<body></body><script>window.__FILES=${JSON.stringify(files)};window.__TODAY=${JSON.stringify(today)};</script><script src="app.js"></script>`);
}
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => { console.log("DIALOG OPENED (XSS?)", d.message()); d.dismiss(); });
  await page.goto("file://" + path.resolve(`${out}/${mode}.html`));
  await page.waitForFunction(() => window.__RESULT !== undefined, null, { timeout: 60000 });
  if (mode === "light") console.log(JSON.stringify(await page.evaluate(() => window.__RESULT), null, 1));
  await page.screenshot({ path: `${out}/${mode}.png`, fullPage: true });
  await page.close();
}
await browser.close();
