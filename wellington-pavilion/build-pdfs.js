// Builds print-ready PDFs from the menu pages.
// Run: NODE_PATH=$(npm root -g) node wellington-pavilion/build-pdfs.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DIR = __dirname;
const OUT = path.join(DIR, "pdf");
const MENUS = [
  { file: "menus.html", key: "A", label: "Menu A" },
  { file: "menus-b.html", key: "B", label: "Menu B" },
];

function loadData(file) {
  const html = fs.readFileSync(path.join(DIR, file), "utf8");
  const js = html.split("<script>")[1].split("let venue=")[0];
  return new Function(js + ";return {PB, V};")();
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const exG = (PB, id) => (PB[id].g ? PB[id].p / 1.15 : PB[id].p);
const cost = (PB, d) => {
  const total = d.c.reduce((a, [id, q]) => a + exG(PB, id) * q, 0) + d.o;
  const net = d.pn / 1.15;
  return { total, net, fc: (total / net) * 100, est: d.c.some(([id]) => PB[id].s === "est") };
};
const band = fc => (fc <= 28 ? "good" : fc <= 34 ? "warn" : "bad");
const money = x => "$" + x.toFixed(2);

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">`;
const BASE = `
:root{--ink:#1d2925;--muted:#5d6a64;--rule:#cfd6d1;--sea:#2c5a78;--ochre:#9a6b1c;--good:#2f7a4f;--warn:#a4661a;--bad:#a63a2e;
--display:"Instrument Serif",Georgia,serif;--body:"Figtree","Liberation Sans",sans-serif;--mono:"IBM Plex Mono","DejaVu Sans Mono",monospace}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font:9.5pt/1.4 var(--body);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.eyebrow{font:500 7pt var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
h1{font:400 34pt/1 var(--display);margin:4px 0 0}
h1 em{font-style:italic;color:var(--accent)}
.page{break-after:page;padding:0}
.page:last-child{break-after:auto}
`;

// Guest-facing menu: no costings, two columns, one venue per page
function guestHTML(data, m) {
  const venues = [
    ["dining", "Dining Room", "var(--sea)"],
    ["pub", "Public Bar", "var(--ochre)"],
  ];
  const pages = venues.map(([k, name, accent]) => {
    const v = data.V[k];
    const courses = v.courses.map(c => `
      <section><h2>${esc(c.h)}</h2>${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}
      ${c.items.map(d => `<div class="dish"><div class="row"><span class="n">${esc(d.n)}${d.t ? `<span class="tags">${d.t}</span>` : ""}</span><span class="dots"></span><span class="p">${esc(d.p)}</span></div>${d.d ? `<div class="d">${esc(d.d)}</div>` : ""}</div>`).join("")}
      </section>`).join("");
    return `<div class="page" style="--accent:${accent}">
      <header><div class="eyebrow">Wellington Pavilion · ${m.label}</div><h1><em>${name}</em></h1></header>
      <div class="cols">${courses}</div>
      <footer>V vegetarian · VG vegan · GF gluten free · DF dairy free · Prices in NZD incl. GST · Please tell your server about any allergies</footer>
    </div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}
  @page{size:A4;margin:16mm 15mm 14mm}
  .page{height:267mm;display:flex;flex-direction:column;overflow:hidden}
  header{text-align:center;border-bottom:1px solid var(--rule);padding-bottom:6px;margin-bottom:8px}
  header h1{font-size:34pt}
  .cols{flex:1}
  .cols{column-count:2;column-gap:12mm}
  section{break-inside:avoid-column;margin-bottom:6px}
  h2{font:400 15pt/1.1 var(--display);margin:0 0 2px;color:var(--accent)}
  .note{font-style:italic;color:var(--muted);font-size:8pt;margin:0 0 4px}
  .dish{break-inside:avoid;padding:2px 0;font-size:9pt}
  .row{display:flex;align-items:baseline;gap:4px}
  .n{font-weight:600}
  .dots{flex:1;border-bottom:1px dotted var(--rule);transform:translateY(-3px)}
  .p{font:500 8.5pt var(--mono);white-space:nowrap}
  .tags{font:500 6.5pt var(--mono);color:var(--accent);margin-left:5px;letter-spacing:.05em}
  .d{color:var(--muted);font-size:8pt;line-height:1.25}
  footer{margin-top:6px;border-top:1px solid var(--rule);padding-top:6px;text-align:center;font:7pt var(--mono);color:var(--muted)}
  </style></head><body>${pages}</body></html>`;
}

// Internal costing pack: every dish with plate cost and FC%, plus the price book
function costingHTML(data, m) {
  const { PB, V } = data;
  const venue = (k, name) => {
    let C = 0, N = 0;
    const rows = V[k].courses.map(c => {
      const lines = c.items.map(d => {
        const x = cost(PB, d); C += x.total; N += x.net;
        return `<tr><td>${esc(d.n)}${x.est ? ` <span class="estf">est</span>` : ""}</td><td class="r">${esc(d.p)}</td><td class="r">${money(x.net)}</td><td class="r">${money(x.total)}</td><td class="r"><span class="pill ${band(x.fc)}">${x.fc.toFixed(1)}%</span></td><td class="r">${(100 - x.fc).toFixed(1)}%</td></tr>`;
      }).join("");
      return `<tr class="sec"><td colspan="6">${esc(c.h)}</td></tr>${lines}`;
    }).join("");
    const bl = (C / N) * 100;
    return `<section class="venue"><h2>${name}</h2>
      <div class="concept">${V[k].concept.map(([a, b]) => `<div><b>${a}</b>${esc(b)}</div>`).join("")}<div><b>Blended FC, one of each</b><span class="pill ${band(bl)}">${bl.toFixed(1)}%</span></div></div>
      <table><thead><tr><th>Dish</th><th class="r">Menu price</th><th class="r">Net ex GST</th><th class="r">Plate cost</th><th class="r">Food cost</th><th class="r">GP</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  };
  const book = Object.values(PB).sort((a, b) => (a.s > b.s ? -1 : 1)).map(i =>
    `<tr><td>${esc(i.n)}</td><td class="r">$${i.p.toFixed(2)}/${i.u}${i.g ? "" : " ex GST"}</td><td class="r">${money(i.g ? i.p / 1.15 : i.p)}</td><td>${i.s === "src" ? `<span class="chip good">Sourced</span>` : `<span class="chip warn">Needs quote</span>`}</td><td class="src">${esc(i.ref)}${i.url ? `<br><span class="url">${esc(i.url)}</span>` : ""}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}
  @page{size:A4;margin:14mm 13mm}
  body{--accent:var(--sea)}
  .lede{color:var(--muted);max-width:170mm;margin:6px 0 12px}
  h2{font:400 22pt var(--display);margin:6px 0}
  .venue{break-after:page}
  .concept{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px;font-size:8.5pt}
  .concept b{display:block;font:500 6.5pt var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:7.8pt;font-variant-numeric:tabular-nums}
  th{font:500 6.5pt var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--ink);padding:4px}
  td{padding:1.5px 4px;border-bottom:1px solid var(--rule);vertical-align:top}
  tr{break-inside:avoid}
  .r{text-align:right;white-space:nowrap}
  tr.sec td{font:400 11pt var(--display);color:var(--accent);border-bottom:none;padding-top:5px}
  .pill,.chip{font:500 7pt var(--mono);padding:0 5px;border:1px solid currentColor;border-radius:3px;white-space:nowrap}
  .good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}
  .estf{font:500 6.5pt var(--mono);color:var(--warn);text-transform:uppercase}
  .src{font-size:7.5pt;color:var(--muted)}.url{font:6.5pt var(--mono);word-break:break-all}
  .notes{font-size:8pt;color:var(--muted);display:grid;gap:4px;margin-top:10px}
  </style></head><body>
  <div class="eyebrow">Wellington Pavilion · ${m.label} · Internal costing pack · Not for guests</div>
  <h1>${m.label} <em>costings</em></h1>
  <p class="lede">Plate cost = main ingredients by weight from the price book, plus an estimated allowance for sauce, garnish, bread and oil. Food cost % = plate cost ÷ (menu price ÷ 1.15). Dishes marked EST use at least one estimated ingredient price. Green ≤28%, amber 29–34%, red 35%+.</p>
  ${venue("dining", "Dining Room · 95 seats")}
  ${venue("pub", "Public Bar · 180 seats")}
  <section><h2>Price book</h2>
  <table><thead><tr><th>Ingredient</th><th class="r">Price found</th><th class="r">Ex GST</th><th>Status</th><th>Source</th></tr></thead><tbody>${book}</tbody></table>
  <div class="notes"><span>Sourced prices are mostly published retail or online seafood-merchant prices researched in September 2026. Trade accounts (Bidfood, Gilmours, Service Foods, Solander Wholesale) should come in 10–20% lower.</span><span>Get "Needs quote" items quoted before locking the menu. Re-run food cost against POS sales mix after 4 weeks of trade.</span></div>
  </section></body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  for (const m of MENUS) {
    const data = loadData(m.file);
    for (const [kind, html] of [["Guest-Menu", guestHTML(data, m)], ["Costing-Pack", costingHTML(data, m)]]) {
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(OUT, `Wellington-Pavilion-${m.label.replace(" ", "-")}-${kind}.pdf`);
      await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
      console.log("wrote", path.relative(DIR, out));
    }
  }
  await browser.close();
})();
