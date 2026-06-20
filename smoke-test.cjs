const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const filePath = path.normalize(path.join(root, cleanPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const executablePath = fs.existsSync(chromePath) ? chromePath : fs.existsSync(edgePath) ? edgePath : undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`);
  const initialTierSections = await page.locator(".tier-section").count();
  const commandoCard = page.locator('[data-perk-id="commando"]');
  await commandoCard.getByRole("button", { name: "+", exact: true }).click();
  await page.getByLabel("Perk points").fill("1");
  const cappedIncreaseDisabled = await commandoCard.getByRole("button", { name: "+", exact: true }).isDisabled();
  await page.getByLabel("Perk points").fill("");
  const unlimitedIncreaseEnabled = await commandoCard.getByRole("button", { name: "+", exact: true }).isEnabled();
  await page.locator("#exportLoadoutButton").click();
  const exportedLoadout = await page.locator("#loadoutText").inputValue();
  await page.locator("#closeLoadoutDialog").click();
  await page.locator("#resetButton").click();
  await page.locator("#importLoadoutButton").click();
  await page.locator("#loadoutText").fill(exportedLoadout);
  await page.locator("#applyLoadoutButton").click();
  const equippedTitle = await page.locator("#categoryTitle").textContent();
  const equippedCards = await page.locator(".perk-card").count();
  const equippedHasCommando = (await page.locator('[data-perk-id="commando"]').count()) === 1;

  const result = await page.evaluate(() => ({
    title: document.title,
    cards: document.querySelectorAll(".perk-card").length,
    tabs: document.querySelectorAll(".tab-button").length,
    tierSections: document.querySelectorAll(".tier-section").length,
    pointInput: document.querySelector("#pointLimitInput").value,
    pointSummary: document.querySelector("#categoryBreakdown").textContent.trim(),
    stats: document.querySelector("#statSummary").textContent.trim(),
    hasOptimizer: Boolean(document.querySelector("#optimizerResult, #optimizeButton, #goalButtons")),
    overflowingButtons: [...document.querySelectorAll("button")].filter((button) => {
      if (!button.textContent.trim()) return false;
      return button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1;
    }).map((button) => button.textContent.trim()),
    overflow: document.body.scrollWidth > window.innerWidth + 2,
  }));
  result.initialTierSections = initialTierSections;
  result.equippedTitle = equippedTitle;
  result.equippedCards = equippedCards;
  result.equippedHasCommando = equippedHasCommando;
  result.loadoutCodeLength = exportedLoadout.length;
  await page.setViewportSize({ width: 390, height: 900 });
  result.mobileOverflow = await page.evaluate(() => ({
    page: document.body.scrollWidth > window.innerWidth + 2,
    buttons: [...document.querySelectorAll("button")].filter((button) => {
      if (!button.textContent.trim()) return false;
      return button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1;
    }).map((button) => button.textContent.trim()),
  }));
  result.cappedIncreaseDisabled = cappedIncreaseDisabled;
  result.unlimitedIncreaseEnabled = unlimitedIncreaseEnabled;

  await browser.close();
  server.close();

  if (
    errors.length ||
    result.hasOptimizer ||
    result.overflowingButtons.length ||
    result.mobileOverflow.page ||
    result.mobileOverflow.buttons.length ||
    result.tabs !== 6 ||
    result.initialTierSections !== 4 ||
    result.equippedTitle !== "Equipped Perks" ||
    result.equippedCards !== 1 ||
    !result.equippedHasCommando ||
    result.loadoutCodeLength < 20 ||
    !result.cappedIncreaseDisabled ||
    !result.unlimitedIncreaseEnabled
  ) {
    console.error(JSON.stringify({ result, errors }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ result, errors }, null, 2));
}

run().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
