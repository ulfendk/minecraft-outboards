// Builds the GitHub Pages site into build/site/ (English, and Danish in da/).
// The latest release is looked up in the browser (GitHub API), with the version
// from package.json as the fallback, so the page stays current between deploys.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { build } from './build.mjs';
import { render } from './render.mjs';
import { MOTOR_VARS } from './build.mjs';
import { boatAnimation } from '../src/lib/anim.mjs';
import { NS } from '../src/lib/constants.mjs';
import { BOAT_MASS, topSpeed, vessel } from '../src/lib/water.mjs';
import { MOTORS, OUTBOARDS } from '../src/motors.mjs';
import { CONTROLS } from '../src/lang.mjs';
import { LANGUAGES, STRINGS } from '../src/i18n.mjs';

const OUT = 'build/site';
const RP = 'build/resource_pack';
const repo = process.env.GITHUB_REPOSITORY ?? process.env.SITE_REPO ?? 'ulfendk/minecraft-outboards';
const [owner, name] = repo.split('/');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function upscale(buf, k) {
  const src = PNG.sync.read(buf);
  const out = new PNG({ width: src.width * k, height: src.height * k });
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const s = ((Math.floor(y / k) * src.width) + Math.floor(x / k)) * 4;
      out.data.set(src.data.subarray(s, s + 4), (y * out.width + x) * 4);
    }
  return PNG.sync.write(out);
}

const { boats, blocks, items, version } = await build({ quiet: true });
await mkdir(join(OUT, 'img', 'motors'), { recursive: true });
await mkdir(join(OUT, 'img', 'items'), { recursive: true });
await mkdir(join(OUT, 'img', 'boats'), { recursive: true });
const oak = boats.find((b) => b.wood === 'oak');
const load = async (dir, id) => ({
  geo: JSON.parse(await readFile(join(RP, dir === 'blocks' ? 'models/blocks' : 'models/entity', `${id}.geo.json`), 'utf8')),
  tex: await readFile(join(RP, dir === 'blocks' ? `textures/blocks/${NS}` : `textures/entity/${NS}`, `${id}.png`)),
});
{
  const { geo, tex } = await load('entity', oak.id);
  const anim = Object.values(boatAnimation(oak, 'preview').animations)[0];
  for (const m of MOTORS) {
    const block = await load('blocks', `${m.id}_mounted`);
    await writeFile(join(OUT, 'img', 'motors', `${m.id}.png`), render(block.geo, block.tex, { yaw: 150, pitch: 15, size: 320 }));
    if (m.inboard) continue;
    await writeFile(join(OUT, 'img', 'motors', `${m.id}_boat.png`), render(geo, tex, { anim, vars: MOTOR_VARS(OUTBOARDS.indexOf(m), true), yaw: 140, pitch: 25, size: 320 }));
  }
}
// The boats of every wood, for the boat section.
for (const b of boats) {
  const { geo, tex } = await load('entity', b.id);
  const anim = Object.values(boatAnimation(b, 'preview').animations)[0];
  await writeFile(join(OUT, 'img', 'boats', `${b.id}.png`), render(geo, tex, { anim, vars: MOTOR_VARS(b.raft ? 3 : boats.indexOf(b) % 3, true), yaw: 135, pitch: 25, size: 160 }));
}
{
  const helm = await load('blocks', 'helm');
  await writeFile(join(OUT, 'img', 'helm.png'), render(helm.geo, helm.tex, { yaw: 150, pitch: 15, size: 320 }));
}
for (const item of items) await writeFile(join(OUT, 'img', 'items', `${item.id}.png`), upscale(item.icon, 4));
await copyFile(join(RP, 'pack_icon.png'), join(OUT, 'img', 'icon.png'));
await copyFile(join(RP, 'pack_icon.png'), join(OUT, 'favicon.png'));

const releases = `https://github.com/${repo}/releases`;
const dl = (file) => `${releases}/latest/download/${file}`;

const ROOT_URL = `https://${owner}.github.io/${name}/`;
// The index of all our mods, which every mod's site links back to.
const INDEX_URL = `https://${owner}.github.io/minecraft-index/`;

const kmh = (blocksPerTick) => Math.round(blocksPerTick * 72);

/** The numbers shown on each motor's card. */
function stats(m, t) {
  if (m.inboard) {
    return [
      [t.stats.ship1000, `${kmh(topSpeed(vessel([m], 4 + 1000)))} ${t.stats.kmh}`],
      [t.stats.ship4096, `${kmh(topSpeed(vessel([m], 4 + 4096)))} ${t.stats.kmh}`],
      [t.stats.tank, `${Math.round(m.tank / m.burn / 1200)} ${t.stats.min}`],
      [t.stats.fuel, t.fuelNames[m.kind]],
    ];
  }
  return [
    [t.stats.boat, `${kmh(topSpeed(vessel([m], BOAT_MASS)))} ${t.stats.kmh}`],
    [t.stats.raft16, `${kmh(topSpeed(vessel([m], 4 + 16)))} ${t.stats.kmh}`],
    [t.stats.raft64, `${kmh(topSpeed(vessel([m], 4 + 64)))} ${t.stats.kmh}`],
    [t.stats.tank, `${Math.round(m.tank / m.burn / 1200)} ${t.stats.min}`],
    [t.stats.fuel, t.fuelNames[m.kind]],
  ];
}

/** Builds the page for one language. Pages for other languages live in a subfolder. */
function page(lang) {
  const L = LANGUAGES[lang];
  const t = STRINGS[lang];
  const i = lang === 'da' ? 1 : 0;
  const up = L.dir ? '../' : '';
  const link = (href) => (text) => `<a href="${href}">${esc(text)}</a>`;
  const home = `${INDEX_URL}${L.dir ? L.dir + '/' : ''}`;
  const nameOf = (id, fallback) => t.names?.[id] ?? fallback;

  const cards = MOTORS.map((m) => `
      <article class="card">
        <div class="portrait"><img src="${up}img/motors/${m.id}.png"${m.inboard ? '' : ` data-fly="${up}img/motors/${m.id}_boat.png"`} alt="${esc(nameOf(m.id, m.name))}" loading="lazy" width="320" height="320"></div>
        <div class="card-body">
          <span class="group">${m.hp > 1 ? `${m.hp.toLocaleString(L.dateLocale)} ${lang === 'da' ? 'hk' : 'hp'}` : '⚡'}</span>
          <h3>${esc(nameOf(m.id, m.name))}</h3>
          <p>${esc(t.info?.[m.id] ?? m.info)}</p>
          <dl class="stats">${stats(m, t).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        </div>
      </article>`).join('');

  const boatHtml = boats.map((b) => `<figure><img src="${up}img/boats/${b.id}.png" alt="" width="160" height="160" loading="lazy"><figcaption>${esc(nameOf(b.id, b.name))}</figcaption></figure>`).join('');

  const controlRows = Object.keys(CONTROLS).map((k) => `
        <tr><th>${esc(t.controlNames[k])}</th><td>${esc(CONTROLS[k][0][i])}</td><td>${esc(CONTROLS[k][1][i])}</td></tr>`).join('');

  const itemHtml = items.map((it) => `
        <li><img src="${up}img/items/${it.id}.png" alt="" width="48" height="48"><span>${esc(nameOf(it.id, it.name))}</span></li>`).join('');

  const switcher = Object.entries(LANGUAGES)
    .filter(([code]) => code !== lang)
    .map(([code, other]) => `<a class="lang" href="${up}${other.dir ? other.dir + '/' : ''}" hreflang="${other.htmlLang}" lang="${other.htmlLang}">${esc(other.label)}</a>`)
    .join('');
  const alternates = Object.values(LANGUAGES)
    .map((other) => `<link rel="alternate" hreflang="${other.htmlLang}" href="${ROOT_URL}${other.dir ? other.dir + '/' : ''}">`)
    .join('\n');

  return `<!doctype html>
<html lang="${L.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
${alternates}
<link rel="icon" href="${up}favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #eef6f7; --surface: #ffffff; --ink: #122228; --muted: #50666d; --line: #d0e3e7;
  --accent: #0b7a8f; --accent-ink: #fff; --chip: #dcedf0; --hero-from: #0b5e7a; --hero-to: #5cc3d6; --sky: #cdeef3;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0c1619; --surface: #142328; --ink: #e4f1f3; --muted: #9bb3b9; --line: #24393f;
    --accent: #7fd3e0; --accent-ink: #0e141c; --chip: #1f3439; --hero-from: #06303f; --hero-to: #1b6f80; --sky: #173840;
  }
}
:root[data-theme="dark"] {
  --bg: #0c1619; --surface: #142328; --ink: #e4f1f3; --muted: #9bb3b9; --line: #24393f;
  --accent: #7fd3e0; --accent-ink: #0e141c; --chip: #1f3439; --hero-from: #06303f; --hero-to: #1b6f80; --sky: #173840;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
img { image-rendering: pixelated; max-width: 100%; }
a { color: var(--accent); }
h1, h2, h3 { font-family: "Pixelify Sans", system-ui, sans-serif; font-weight: 500; line-height: 1.15; letter-spacing: .01em; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
header.hero { color: #fff; background: linear-gradient(180deg, var(--hero-from), var(--hero-to)); padding: 48px 0 56px; position: relative; overflow: hidden; }
header.hero::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 26px; background: radial-gradient(circle at 10% 100%, var(--bg) 18px, transparent 19px) 0 0 / 90px 26px repeat-x; }
.hero .wrap { display: grid; grid-template-columns: auto 1fr; gap: 32px; align-items: center; }
.hero img.icon { width: 160px; height: 160px; border-radius: 12px; box-shadow: 0 8px 30px rgb(0 0 0 / .3); }
.hero h1 { font-size: clamp(2.2rem, 6vw, 3.6rem); margin: 0 0 8px; }
.hero p { margin: 0 0 20px; font-size: 1.15rem; max-width: 56ch; color: #eef6ff; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 10px; font-weight: 700; text-decoration: none; background: #ffd36b; color: #2b1d0e; box-shadow: 0 3px 0 #b8862c; }
.btn:hover { transform: translateY(-1px); }
.btn.ghost { background: transparent; color: #fff; box-shadow: inset 0 0 0 2px rgb(255 255 255 / .65); }
.version { font-size: .95rem; color: #eef6ff; }
.version strong { color: #fff; }
.which { margin: 16px 0 6px; background: rgb(0 0 0 / .18); border: 1px solid rgb(255 255 255 / .35); border-radius: 10px; padding: 10px 14px; max-width: 62ch; font-size: .95rem; color: #fff; }
.which b { color: #fff; }
.hero .langs { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: -28px; margin-bottom: 8px; }
.hero .langs a { color: #fff; font-weight: 600; text-decoration: none; padding: 4px 12px; border-radius: 999px; box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .6); font-size: .9rem; }
.hero .langs a:hover { background: rgb(255 255 255 / .14); }
main section { padding: 48px 0 8px; }
h2 { font-size: 2rem; margin: 0 0 8px; }
.lede { color: var(--muted); margin: 0 0 24px; max-width: 70ch; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 0; list-style: none; counter-reset: s; }
.steps li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 16px 16px 56px; position: relative; }
.steps li::before { counter-increment: s; content: counter(s); position: absolute; left: 16px; top: 14px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; font-weight: 700; }
.note { color: var(--muted); font-size: .92rem; }
h3.edition { margin: 18px 0 10px; font: 700 1.15rem/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; align-items: center; }
.filters span { color: var(--muted); margin-right: 4px; }
.chip { border: 0; background: var(--chip); color: var(--ink); border-radius: 999px; padding: 6px 14px; font: inherit; cursor: pointer; }
.chip.on { background: var(--accent); color: var(--accent-ink); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
.card[hidden] { display: none; }
.portrait { aspect-ratio: 1; display: grid; place-items: center; background: linear-gradient(180deg, #9fd8ef 0, var(--sky) 62%, #2f8fb5 62%, #1d6f93 100%); cursor: pointer; }
.portrait img { width: 100%; height: auto; }
.card-body { padding: 14px 16px 16px; }
.group { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.card h3 { margin: 2px 0 6px; font: 700 1.3rem/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
.card p { margin: 0 0 10px; }
.stats { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; font-size: .9rem; }
.stats div { display: flex; gap: 6px; }
.stats dt { color: var(--muted); }
.stats dd { margin: 0; font-weight: 600; }
.table-wrap { overflow-x: auto; }
table.controls { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; font-size: .95rem; }
table.controls th, table.controls td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
table.controls thead th { background: var(--chip); }
table.controls tbody th { white-space: nowrap; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.feature { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.feature h3 { margin: 0 0 6px; font: 700 1.1rem/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
.feature p { margin: 0; color: var(--muted); }
.items { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; padding: 0; }
.items li { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px 8px 8px; }
.boats { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin: 18px 0 0; }
.boats figure { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 6px 6px 10px; text-align: center; font-size: .85rem; color: var(--muted); }
.boats img { width: 100%; height: auto; }
.split { display: grid; grid-template-columns: 1fr 220px; gap: 24px; align-items: start; }
.split img { width: 100%; height: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
footer { margin-top: 56px; padding: 28px 0 40px; border-top: 1px solid var(--line); color: var(--muted); font-size: .9rem; }
@media (max-width: 640px) {
  .hero .wrap { grid-template-columns: 1fr; text-align: center; justify-items: center; }
  .hero img.icon { width: 112px; height: 112px; }
  .split { grid-template-columns: 1fr; }
  .split img { max-width: 220px; }
  .actions { justify-content: center; }
  table.controls tbody th { white-space: normal; }
}
</style>
</head>
<body>
<header class="hero">
  <nav class="langs wrap"><a class="home" href="${home}">← ${esc(t.allMods)}</a><span>${switcher}</span></nav>
  <div class="wrap">
    <img class="icon" src="${up}img/icon.png" alt="" width="160" height="160">
    <div>
      <h1>${lang === 'da' ? 'Påhængsmotorer' : 'Outboards'}</h1>
      <p>${esc(t.tagline)}</p>
      <div class="actions">
        <a class="btn" id="download" href="${dl('Outboards.mcaddon')}">⬇ ${esc(t.download)}</a>
        <a class="btn" href="${dl('Outboards-fabric.jar')}">⬇ ${esc(t.downloadJava)}</a>
        <a class="btn ghost" href="${releases}">${esc(t.allVersions)}</a>
      </div>
      <p class="which">${t.which}</p>
      <p class="version" id="version">${esc(t.latestVersion)}: <strong>${esc(version)}</strong></p>
    </div>
  </div>
</header>
<main class="wrap">
  <section id="install">
    <h2>${esc(t.install)}</h2>
    <h3 class="edition">${esc(t.bedrockTitle)}</h3>
    <ol class="steps">
${t.steps(`<a href="${dl('Outboards.mcaddon')}">Outboards.mcaddon</a>`).map((step) => `      <li>${step}</li>`).join('\n')}
    </ol>
    <p class="note">${t.serverNote(link(dl('Outboards_BP.mcpack')), link(dl('Outboards_RP.mcpack')))}</p>
    <h3 class="edition">${esc(t.javaTitle)}</h3>
    <ol class="steps">
${t.javaSteps(
    `<a href="${dl('Outboards-fabric.jar')}">Outboards-fabric.jar</a>`,
    '<a href="https://fabricmc.net/use/installer/">Fabric Loader</a>',
    '<a href="https://modrinth.com/mod/fabric-api">Fabric API</a>',
    '<a href="https://modrinth.com/mod/geckolib">GeckoLib</a>',
  ).map((step) => `      <li>${step}</li>`).join('\n')}
    </ol>
    <h3 class="edition">${esc(t.upgradeTitle)}</h3>
    <ol class="steps">
${t.upgradeSteps.map((step) => `      <li>${step}</li>`).join('\n')}
    </ol>
    <p class="note">${t.upgradeServer}</p>
    <p>${t.upgradeJava}</p>
  </section>

  <section id="motors">
    <h2>${esc(t.motorsTitle)}</h2>
    <p class="lede">${esc(t.motorsLede)}</p>
    <div class="grid">${cards}
    </div>
  </section>

  <section id="boats">
    <h2>${esc(t.boatTitle)}</h2>
    <ol class="steps">
${t.boatSteps.map((step) => `      <li>${step}</li>`).join('\n')}
    </ol>
    <div class="boats">${boatHtml}</div>
  </section>

  <section id="rafts">
    <h2>${esc(t.raftTitle)}</h2>
    <div class="split">
      <div>
        <p class="lede">${esc(t.raftLede)}</p>
        <ol class="steps">
${t.raftSteps.map((step) => `          <li>${step}</li>`).join('\n')}
        </ol>
        <p class="note">${esc(t.raftNote)}</p>
      </div>
      <img src="${up}img/helm.png" alt="${esc(nameOf('helm', "Ship's Wheel"))}" width="220" height="220" loading="lazy">
    </div>
  </section>

  <section id="controls">
    <h2>${esc(t.controlsTitle)}</h2>
    <p class="lede">${esc(t.controlsLede)}</p>
    <div class="table-wrap">
    <table class="controls">
      <thead><tr><th></th><th>${esc(t.controlsBedrock)}</th><th>${esc(t.controlsJava)}</th></tr></thead>
      <tbody>${controlRows}
      </tbody>
    </table>
    </div>
  </section>

  <section id="features">
    <h2>${esc(t.featuresTitle)}</h2>
    <div class="features">
${t.features.map(([title, text]) => `      <div class="feature"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`).join('\n')}
    </div>
  </section>

  <section id="items">
    <h2>${esc(t.itemsTitle)}</h2>
    <ul class="items">${itemHtml}
    </ul>
  </section>
</main>
<footer>
  <div class="wrap">
    <p>${t.footerSource(link(`https://github.com/${repo}`), link(`https://github.com/${repo}/issues`))}</p>
    <p>${esc(t.footerLegal)}</p>
    <p>${link(home)(`← ${t.allMods}`)}</p>
  </div>
</footer>
<script>
// Hover (or tap) a picture to see the motor on a boat
document.querySelectorAll('.portrait img[data-fly]').forEach((img) => {
  const still = img.src, fly = img.dataset.fly;
  new Image().src = fly;
  const show = (on) => { img.src = on ? fly : still; };
  img.parentElement.addEventListener('mouseenter', () => show(true));
  img.parentElement.addEventListener('mouseleave', () => show(false));
  img.parentElement.addEventListener('click', () => show(img.src === still));
});

// Latest release from GitHub
fetch('https://api.github.com/repos/${owner}/${name}/releases/latest')
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    if (!rel || !rel.tag_name) return;
    const date = new Date(rel.published_at).toLocaleDateString('${L.dateLocale}', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('version').innerHTML = '${t.latestVersion}: <strong>' + rel.tag_name.replace(/^v/, '') + '</strong> · ${t.released} ' + date;
  })
  .catch(() => {});

// Reload when a new release has been published. The site is redeployed with every release
// and writes version.json; compare it with the version this page was built with.
const PAGE_VERSION = '${version}';
let reloading = false;
function checkForUpdate() {
  if (reloading || document.hidden) return;
  fetch('${up}version.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
      if (!v || !v.version || v.version === PAGE_VERSION) return;
      // Reload once per new version: if the cached page is still the old one, don't loop.
      let tried = null;
      try { tried = sessionStorage.getItem('outboards-reloaded-for'); } catch {}
      if (tried === v.version) return;
      try { sessionStorage.setItem('outboards-reloaded-for', v.version); } catch {}
      reloading = true;
      location.reload();
    })
    .catch(() => {});
}
setInterval(checkForUpdate, 10 * 60 * 1000);
checkForUpdate();
document.addEventListener('visibilitychange', checkForUpdate);
</script>
</body>
</html>
`;
}

for (const [lang, L] of Object.entries(LANGUAGES)) {
  const dir = join(OUT, L.dir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), page(lang));
}
await writeFile(join(OUT, '.nojekyll'), '');
await writeFile(join(OUT, 'version.json'), JSON.stringify({ version }) + '\n');
console.log(`Site written to ${OUT}/ (${Object.keys(LANGUAGES).join(' + ')}, repo ${repo})`);
