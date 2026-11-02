"use strict";
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const out = path.join(root, "review/ui-release-20261102");
const site = JSON.parse(fs.readFileSync(path.join(out, "build.json"))).artifact;
const results = [], errors = [];
const server = http.createServer((req, res) => {
  const file = path.join(site, decodeURIComponent(new URL(req.url, "http://local").pathname.slice(7)));
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file;
  if (!req.url.startsWith("/agent/") || !fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", /\.(m?js)$/.test(target) ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/html");
  res.end(fs.readFileSync(target));
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  for (const [name, executablePath] of [["chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"], ["edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]]) {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      for (const width of [375, 768, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 960 } });
        page.on("pageerror", error => errors.push(error.message));
        page.on("response", response => { if (response.url().includes("/agent/") && response.status() >= 400) errors.push(response.url()); });
        await page.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.origin === base && url.pathname.startsWith("/agent/")) return route.continue();
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "MOCK_UNAVAILABLE" } }) });
        });
        await page.goto(base + "/agent/");
        await page.locator('a[href="./risk-workbench/"]').click();
        await page.locator("#task-observer").waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.reload(); await page.locator("#task-observer").waitFor();
        await page.screenshot({ path: path.join(out, name + "-standalone-" + width + ".png"), fullPage: true });
        results.push({ name, version: browser.version(), width, layer: "LOCAL_STATIC_BUILD / MOCK API 503", result: "PASS" });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors, []);
})().catch(error => { errors.push(error.stack); process.exitCode = 1; }).finally(() => {
  server.close(); fs.writeFileSync(path.join(out, "standalone-browser.json"), JSON.stringify({ results, errors }, null, 2));
});
