import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
p.on("pageerror", e => console.log("PAGEERROR", e.message));
await p.goto("http://127.0.0.1:5178/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
console.log("title", await p.title());
console.log("lightbox-css", await p.evaluate(() => {
  const n = document.createElement("div"); n.className = "lightbox";
  const img = document.createElement("img");
  n.appendChild(img); document.body.appendChild(n);
  const cs = getComputedStyle(n), is = getComputedStyle(img);
  const o = { pad: cs.padding, rows: cs.gridTemplateRows, cols: cs.gridTemplateColumns, maxW: is.maxWidth, maxH: is.maxHeight, objFit: is.objectFit };
  n.remove(); return JSON.stringify(o);
}));
await b.close();
