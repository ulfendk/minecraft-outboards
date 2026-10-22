// Static checks for build/. The dedicated server validates the behavior pack (tools/bds-test.sh);
// this mostly covers the resource pack, which only clients load, and the Java resources.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const BP = 'build/behavior_pack';
const RP = 'build/resource_pack';
const JAVA = 'java/src/generated/resources';
const errors = [];
const err = (msg) => errors.push(msg);

async function files(dir, ext) {
  const out = [];
  async function walk(d) {
    let names;
    try { names = await readdir(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      if ((await stat(p)).isDirectory()) await walk(p);
      else if (!ext || n.endsWith(ext)) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

async function json(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    err(`${path}: invalid JSON (${e.message})`);
    return null;
  }
}

const exists = (p) => stat(p).then(() => true, () => false);

// ------------------------------------------------------------ load everything
const bpEntities = new Map();
for (const f of await files(join(BP, 'entities'), '.json')) {
  const j = await json(f);
  if (j) bpEntities.set(j['minecraft:entity'].description.identifier, { file: f, json: j });
}

const geometries = new Map();
for (const f of await files(join(RP, 'models'), '.json')) {
  const j = await json(f);
  for (const g of j?.['minecraft:geometry'] ?? []) geometries.set(g.description.identifier, { file: f, g });
}

const animations = new Map();
for (const f of await files(join(RP, 'animations'), '.json')) {
  const j = await json(f);
  for (const [k, v] of Object.entries(j?.animations ?? {})) animations.set(k, v);
}

const renderControllers = new Map();
for (const f of await files(join(RP, 'render_controllers'), '.json')) {
  const j = await json(f);
  for (const [k, v] of Object.entries(j?.render_controllers ?? {})) renderControllers.set(k, v);
}

const readLang = async (file) => new Map(
  (await readFile(file, 'utf8')).split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const lang = await readLang(join(RP, 'texts', 'en_US.lang'));

const customItems = new Map();
for (const f of await files(join(BP, 'items'), '.json')) {
  const j = await json(f);
  if (j) customItems.set(j['minecraft:item'].description.identifier, j);
}
for (const f of await files(join(BP, 'blocks'), '.json')) {
  const j = await json(f);
  if (j) customItems.set(j['minecraft:block'].description.identifier, j);
}

// ------------------------------------------------------------ checks
function balanced(expr, where) {
  if (typeof expr !== 'string') return;
  let depth = 0;
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) err(`${where}: unbalanced parentheses in Molang "${expr}"`);
}

async function checkTexture(path, where, size) {
  const file = `${join(RP, path)}.png`;
  if (!(await exists(file))) return err(`${where}: missing texture ${file}`);
  const png = PNG.sync.read(await readFile(file));
  if (size && (png.width !== size[0] || png.height !== size[1])) {
    err(`${where}: texture ${file} is ${png.width}x${png.height}, geometry expects ${size[0]}x${size[1]}`);
  }
}

/** Every q.property / v.* a Molang expression reads must exist. */
function checkMolang(expr, where, props, vars) {
  if (typeof expr !== 'string') return;
  balanced(expr, where);
  for (const [, p] of expr.matchAll(/q(?:uery)?\.property\('([^']+)'\)/g)) if (!props.has(p)) err(`${where}: reads undeclared property ${p}`);
  for (const [, v] of expr.matchAll(/\bv(?:ariable)?\.([a-z_0-9]+)/g)) if (!vars.has(v)) err(`${where}: reads v.${v}, which pre_animation never sets`);
}

const clientIds = new Set();
for (const f of await files(join(RP, 'entity'), '.json')) {
  const j = await json(f);
  if (!j) continue;
  const d = j['minecraft:client_entity'].description;
  const where = `${f} (${d.identifier})`;
  clientIds.add(d.identifier);
  const bp = bpEntities.get(d.identifier);
  if (!bp) err(`${where}: no behavior entity with this identifier`);
  const props = new Map(Object.entries(bp?.json['minecraft:entity'].description.properties ?? {}));
  if (props.size > 32) err(`${where}: ${props.size} properties (at most 32)`);

  const g = geometries.get(d.geometry.default)?.g;
  if (!g) err(`${where}: unknown geometry ${d.geometry.default}`);
  const bones = new Set(g?.bones.map((b) => b.name) ?? []);
  const texSize = g ? [g.description.texture_width, g.description.texture_height] : null;
  for (const t of Object.values(d.textures)) await checkTexture(t, where, texSize);

  if (g) {
    for (const b of g.bones) {
      if (b.parent && !bones.has(b.parent)) err(`${where}: bone ${b.name} has unknown parent ${b.parent}`);
      for (const c of b.cubes ?? []) {
        const [w, h, dd] = c.size;
        const [u, v] = c.uv;
        if (u + 2 * (w + dd) > texSize[0] || v + dd + h > texSize[1]) err(`${where}: cube in bone ${b.name} has UVs outside the texture`);
      }
    }
  }

  // Variables set by pre_animation, then every animation expression.
  const vars = new Set();
  for (const line of d.scripts?.pre_animation ?? []) {
    balanced(line, `${where}: pre_animation`);
    const m = line.match(/^v(?:ariable)?\.([a-z_0-9]+)\s*=/);
    if (m) vars.add(m[1]);
    for (const [, p] of line.matchAll(/q(?:uery)?\.property\('([^']+)'\)/g)) if (!props.has(p)) err(`${where}: pre_animation reads undeclared property ${p}`);
  }
  for (const [short, full] of Object.entries(d.animations ?? {})) {
    const anim = animations.get(full);
    if (!anim) { err(`${where}: unknown animation ${full} (${short})`); continue; }
    for (const [bone, channels] of Object.entries(anim.bones ?? {})) {
      if (!bones.has(bone)) err(`${where}: animation ${full} moves bone "${bone}" that the model does not have`);
      for (const values of Object.values(channels)) for (const e of [values].flat()) checkMolang(e, `${where}: ${full}.${bone}`, props, vars);
    }
  }
  for (const a of d.scripts?.animate ?? []) {
    const n = typeof a === 'string' ? a : Object.keys(a)[0];
    if (!d.animations?.[n]) err(`${where}: scripts.animate uses unknown animation "${n}"`);
  }
  for (const name of d.render_controllers ?? []) {
    if (!renderControllers.has(typeof name === 'string' ? name : Object.keys(name)[0])) err(`${where}: unknown render controller ${name}`);
  }
  if (!lang.has(`entity.${d.identifier}.name`)) err(`${where}: missing lang key entity.${d.identifier}.name`);
}
for (const id of bpEntities.keys()) if (!clientIds.has(id)) err(`${id}: behavior entity has no client entity`);

// Behavior entities: rideable seats, events for every component group, loot.
for (const [id, { json: j }] of bpEntities) {
  const e = j['minecraft:entity'];
  const seats = e.components['minecraft:rideable']?.seats ?? [];
  if (!seats.length) err(`${id}: no seats`);
  for (const [name, ev] of Object.entries(e.events ?? {})) {
    for (const g of [...(ev.add?.component_groups ?? []), ...(ev.remove?.component_groups ?? [])]) {
      if (!e.component_groups?.[g]) err(`${id}: event ${name} uses unknown component group ${g}`);
    }
  }
  for (const [name, p] of Object.entries(e.description.properties ?? {})) {
    if (p.type === 'float' && (p.range[0] > p.range[1])) err(`${id}: property ${name} has an empty range`);
  }
}

// Loot tables (blocks drop their motor or the wheel) only drop items that exist.
for (const f of await files(join(BP, 'loot_tables'), '.json')) {
  const lt = await json(f);
  for (const pool of lt?.pools ?? []) for (const entry of pool.entries ?? []) {
    if (entry.type === 'item' && !entry.name.startsWith('minecraft:') && !customItems.has(entry.name)) err(`${f}: drops unknown item ${entry.name}`);
  }
}

// Items and blocks: icon textures and names
const itemAtlas = (await json(join(RP, 'textures', 'item_texture.json')))?.texture_data ?? {};
const terrainAtlas = (await exists(join(RP, 'textures', 'terrain_texture.json'))) ? (await json(join(RP, 'textures', 'terrain_texture.json')))?.texture_data ?? {} : {};
for (const [id, j] of customItems) {
  if (j['minecraft:block']) {
    const c = j['minecraft:block'].components;
    const tex = c['minecraft:material_instances']?.['*']?.texture;
    const g = geometries.get(c['minecraft:geometry'])?.g;
    if (!g) err(`${id}: unknown geometry ${c['minecraft:geometry']}`);
    if (!terrainAtlas[tex]) err(`${id}: texture "${tex}" is not in terrain_texture.json`);
    else await checkTexture(terrainAtlas[tex].textures, id, g ? [g.description.texture_width, g.description.texture_height] : null);
    // Bedrock only draws block geometry inside 30x30x30 pixels: x and z within -15..15, y within 0..30.
    for (const b of g?.bones ?? []) for (const cube of b.cubes ?? []) {
      const [x, y, z] = cube.origin, [w, h, d] = cube.size;
      if (x < -15 || z < -15 || y < 0 || x + w > 15 || z + d > 15 || y + h > 30) err(`${id}: cube at [${cube.origin}] size [${cube.size}] is outside the block geometry limits`);
    }
    for (const box of ['minecraft:collision_box', 'minecraft:selection_box']) {
      const bx = c[box];
      if (bx && (bx.origin[0] < -8 || bx.origin[2] < -8 || bx.origin[1] < 0 || bx.origin[0] + bx.size[0] > 8 || bx.origin[2] + bx.size[2] > 8 || bx.origin[1] + bx.size[1] > 16)) err(`${id}: ${box} reaches outside the block`);
    }
    const states = j['minecraft:block'].description.states ?? {};
    for (const [name, v] of Object.entries(states)) {
      const n = Array.isArray(v) ? v.length : v.values ? v.values.max - v.values.min + 1 : 0;
      if (n > 16) err(`${id}: state ${name} has ${n} values (at most 16)`);
    }
    if (!lang.has(`tile.${id}.name`)) err(`${id}: missing lang key tile.${id}.name`);
    continue;
  }
  const key = j['minecraft:item'].components['minecraft:icon'];
  if (!itemAtlas[key]) err(`${id}: icon "${key}" is not in item_texture.json`);
  else await checkTexture(itemAtlas[key].textures, id, [16, 16]);
  if (!lang.has(`item.${id}.name`)) err(`${id}: missing lang key item.${id}.name`);
}

// Recipes only use items that exist.
for (const f of await files(join(BP, 'recipes'), '.json')) {
  const j = await json(f);
  const body = Object.values(j).find((v) => v && typeof v === 'object');
  const refs = [...Object.values(body.key ?? {}).map((k) => k.item), ...(body.ingredients ?? []).map((i) => i.item), body.result?.item];
  for (const id of refs) if (id?.startsWith('outboards:') && !customItems.has(id)) err(`${f}: unknown item ${id}`);
}

// Languages: every locale has exactly the keys English has, all non-empty; and the
// keys the scripts and the manual build from motor data exist.
const locales = (await json(join(RP, 'texts', 'languages.json'))) ?? [];
for (const locale of locales) {
  for (const pack of [BP, RP]) {
    const file = join(pack, 'texts', `${locale}.lang`);
    if (!(await exists(file))) { err(`${file}: missing`); continue; }
    const l = await readLang(file);
    for (const k of lang.keys()) if (!l.get(k)) err(`${file}: missing or empty "${k}"`);
    for (const k of l.keys()) if (!lang.has(k)) err(`${file}: "${k}" is not in en_US.lang`);
  }
}
const dataSrc = await readFile(join(BP, 'scripts', 'data.js'), 'utf8');
const motors = JSON.parse(dataSrc.match(/export const MOTORS = (.*);/)[1]);
const boats = JSON.parse(dataSrc.match(/export const BOATS = (.*);/)[1]);
for (const m of motors) {
  for (const k of [`outboards.info.${m.id}`, `item.outboards:${m.id}.name`, `tile.outboards:${m.id}_mounted.name`]) if (!lang.has(k)) err(`${m.id}: missing lang key ${k}`);
  if (!(await exists(join(RP, 'textures', 'ui', 'outboards', `${m.id}.png`)))) err(`${m.id}: missing handbook portrait`);
  if (!customItems.has(`outboards:${m.id}_mounted`)) err(`${m.id}: no mounted block`);
  if (m.tank > 12) err(`${m.id}: the tank (${m.tank}) is bigger than the fuel block state holds`);
}
for (const k of ['outboards.controls.boat', 'outboards.controls.raft', 'outboards.controls.java.boat', 'outboards.controls.java.raft']) if (!lang.has(k)) err(`missing lang key ${k}`);
for (const f of ['water.js', 'data.js']) if (!(await exists(join(BP, 'scripts', f)))) err(`missing scripts/${f}`);

// Java: the same lang keys in both languages, a model, animation and texture per motorboat,
// a model and blockstate per block.
const javaEn = await json(join(JAVA, 'assets', 'outboards', 'lang', 'en_us.json'));
const javaDa = await json(join(JAVA, 'assets', 'outboards', 'lang', 'da_dk.json'));
for (const k of Object.keys(javaEn ?? {})) if (!javaDa?.[k]) err(`Java da_dk.json: missing "${k}"`);
for (const k of Object.keys(javaDa ?? {})) if (!javaEn?.[k]) err(`Java en_us.json: missing "${k}"`);
for (const b of boats) {
  for (const p of [`geckolib/models/entity/${b.id}.geo.json`, `geckolib/animations/entity/${b.id}.animation.json`, `textures/entity/${b.id}.png`]) {
    if (!(await exists(join(JAVA, 'assets', 'outboards', p)))) err(`Java: missing ${p}`);
  }
  if (!javaEn?.[`entity.outboards.${b.id}`]) err(`Java: missing name for ${b.id}`);
}
for (const id of [...customItems.keys()].filter((id) => customItems.get(id)['minecraft:block'])) {
  const name = id.split(':')[1];
  for (const p of [`models/block/${name}.json`, `blockstates/${name}.json`, `textures/block/${name}.png`]) {
    if (!(await exists(join(JAVA, 'assets', 'outboards', p)))) err(`Java: missing ${p}`);
  }
  if (!javaEn?.[`block.outboards.${name}`]) err(`Java: missing name for block ${name}`);
  const model = await json(join(JAVA, 'assets', 'outboards', 'models', 'block', `${name}.json`));
  for (const e of model?.elements ?? []) {
    if ([...e.from, ...e.to].some((n) => n < -16 || n > 32)) err(`Java: block ${name} has an element outside -16..32`);
    for (const f of Object.values(e.faces)) if (f.uv.some((n) => n < 0 || n > 16)) err(`Java: block ${name} has a face UV outside the texture`);
  }
  const tex = PNG.sync.read(await readFile(join(JAVA, 'assets', 'outboards', 'textures', 'block', `${name}.png`)));
  if (tex.width !== tex.height) err(`Java: block texture ${name} is not square (${tex.width}x${tex.height})`);
}
for (const item of [...customItems.keys()]) {
  const name = item.split(':')[1];
  if (!javaEn?.[`item.outboards.${name}`] && !javaEn?.[`block.outboards.${name}`]) err(`Java: missing name for ${name}`);
}
for (const f of ['motors.json', 'boats.json', 'water_fixtures.json', 'scan_fixture.json']) if (!(await exists(join(JAVA, 'outboards', f)))) err(`Java: missing outboards/${f}`);

// Manifests
for (const pack of [BP, RP]) {
  const m = await json(join(pack, 'manifest.json'));
  if (m && (!m.header?.uuid || !Array.isArray(m.header.version))) err(`${pack}/manifest.json: bad header`);
}

if (errors.length) {
  console.error(`${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`OK: ${bpEntities.size} entities, ${geometries.size} models, ${animations.size} animations, ${customItems.size} items and blocks`);
