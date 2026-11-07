// Generates the behavior pack and resource pack into build/, and the Java edition's
// resources into java/src/generated/resources (tools/java.mjs).
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { boatAnimation } from '../src/lib/anim.mjs';
import { buildBoatEntity, buildSeatEntity, floatJson } from '../src/lib/behavior.mjs';
import { buildClientEntity, buildRenderController } from '../src/lib/client.mjs';
import { MIN_ENGINE, NS, PACK_NAME, SCRIPT_SERVER_VERSION, SCRIPT_UI_VERSION } from '../src/lib/constants.mjs';
import { packIcon } from '../src/lib/icon.mjs';
import { buildGeometry } from '../src/lib/model.mjs';
import { Model } from '../src/lib/parts.mjs';
import { paintTexture } from '../src/lib/texture.mjs';
import { langEntries, LOCALES } from '../src/lang.mjs';
import { buildItem, items as itemsFor, recipes as recipesFor } from '../src/items.mjs';
import { MOTORS, motorRecord, OUTBOARDS } from '../src/motors.mjs';
import { boatMaterials, boatModel, boatName, boatVisuals, SEATS, WOODS } from '../src/boats.mjs';
import { bedrockBlock, blockArt, BLOCKS } from '../src/blocks.mjs';
import { seatPositions } from '../src/lib/behavior.mjs';
import { render } from './render.mjs';
import { buildJava } from './java.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build');
const BP = join(OUT, 'behavior_pack');
const RP = join(OUT, 'resource_pack');

const UUID = {
  bpHeader: '4ce3865e-c811-4740-a329-662b04594142',
  bpData: '53790c11-7122-4d76-a41c-b52c34d0f55e',
  bpScript: '0ab53443-ef73-445b-ae68-eb809f73789a',
  rpHeader: '45e83937-3e8f-42a1-bfc0-1791adedef38',
  rpResources: '26f752ef-5549-482d-96be-9ddce2ad2d0c',
};

async function write(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n');
}

function manifests(version) {
  const v = version.split('.').map(Number);
  const meta = { authors: ['Outboards contributors'], license: 'MIT' };
  const bp = {
    format_version: 2,
    header: { name: `${PACK_NAME} v${version} (Behavior)`, description: 'pack.description', uuid: UUID.bpHeader, version: v, min_engine_version: MIN_ENGINE },
    modules: [
      { type: 'data', uuid: UUID.bpData, version: v },
      { type: 'script', language: 'javascript', uuid: UUID.bpScript, version: v, entry: 'scripts/main.js' },
    ],
    dependencies: [
      { uuid: UUID.rpHeader, version: v },
      { module_name: '@minecraft/server', version: SCRIPT_SERVER_VERSION },
      { module_name: '@minecraft/server-ui', version: SCRIPT_UI_VERSION },
    ],
    metadata: meta,
  };
  const rp = {
    format_version: 2,
    header: { name: `${PACK_NAME} v${version} (Resources)`, description: 'pack.description', uuid: UUID.rpHeader, version: v, min_engine_version: MIN_ENGINE },
    modules: [{ type: 'resources', uuid: UUID.rpResources, version: v }],
    dependencies: [{ uuid: UUID.bpHeader, version: v }],
    metadata: meta,
  };
  return { bp, rp };
}

/** The motorboats: one per kind of wood. */
export function boats() {
  return WOODS.map((wood) => {
    const { model, props } = boatModel(wood);
    return {
      id: `motorboat_${wood.id}`, name: boatName(wood), wood: wood.id, item: wood.item, variant: wood.variant, raft: !!wood.raft,
      scale: 1, seats: SEATS, model, materials: boatMaterials(wood), visuals: boatVisuals(props),
    };
  });
}

/** The invisible seat a raft's driver sits on: a model with nothing in it. */
const seat = { id: 'raft_seat', scale: 1, model: (() => { const m = new Model(); m.bone('root', null, [0, 0, 0]); return m.build(); })(), materials: {}, visuals: [] };

/** Picture of a motor for the handbook and the site: on an oak boat, from the side. */
export const MOTOR_VARS = (i, running = false) => ({ motor: i + 1, spin: running ? 30 : 0, rotor: running ? 1 : 0, steer: running ? -12 : 0, time: 0 });

export async function build({ quiet = false } = {}) {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  await rm(BP, { recursive: true, force: true });
  await rm(RP, { recursive: true, force: true });
  for (const [from, to] of [['behavior_pack', BP], ['resource_pack', RP]]) {
    if (existsSync(join(ROOT, 'src', 'packs', from))) await cp(join(ROOT, 'src', 'packs', from), to, { recursive: true });
  }

  const { bp, rp } = manifests(pkg.version);
  await write(join(BP, 'manifest.json'), bp);
  await write(join(RP, 'manifest.json'), rp);
  const icon = packIcon();
  await write(join(BP, 'pack_icon.png'), icon);
  await write(join(RP, 'pack_icon.png'), icon);

  const boatList = boats();
  const java = { geos: {}, anims: {}, textures: {} };
  let oak;
  for (const m of [...boatList, seat]) {
    await write(join(BP, 'entities', `${m.id}.json`), floatJson(m === seat ? buildSeatEntity() : buildBoatEntity(m)));
    const geo = buildGeometry(`geometry.${NS}.${m.id}`, m.model);
    const d = geo.geometry['minecraft:geometry'][0].description;
    d.visible_bounds_width = 4;
    d.visible_bounds_height = 3;
    d.visible_bounds_offset = [0, 0.5, 0];
    const texture = paintTexture(geo, m.materials);
    await write(join(RP, 'models', 'entity', `${m.id}.geo.json`), geo.geometry);
    await write(join(RP, 'textures', 'entity', NS, `${m.id}.png`), texture);
    await write(join(RP, 'animations', `${m.id}.animation.json`), boatAnimation(m, 'bedrock'));
    await write(join(RP, 'entity', `${m.id}.entity.json`), buildClientEntity(m, { simple: m === seat }));
    await write(join(RP, 'render_controllers', `${m.id}.render_controllers.json`), buildRenderController(m));
    java.geos[m.id] = geo.geometry;
    java.anims[m.id] = boatAnimation(m, 'java');
    java.textures[m.id] = texture;
    if (m.wood === 'oak') oak = { m, geo, texture };
  }

  // Blocks: mounted motors and the ship's wheel.
  const terrain = {};
  const blockArtById = {};
  for (const block of BLOCKS) {
    const { geo, texture } = blockArt(block);
    blockArtById[block.id] = { geo, texture };
    await write(join(BP, 'blocks', `${block.id}.json`), bedrockBlock(block));
    await write(join(RP, 'models', 'blocks', `${block.id}.geo.json`), geo.geometry);
    await write(join(RP, 'textures', 'blocks', NS, `${block.id}.png`), texture);
    await write(join(BP, 'loot_tables', 'blocks', `${block.id}.json`), {
      pools: [{ rolls: 1, entries: [{ type: 'item', name: `${NS}:${block.loot}`, weight: 1 }] }],
    });
    terrain[`${NS}_${block.id}`] = { textures: `textures/blocks/${NS}/${block.id}` };
  }
  // Handbook portraits: each outboard on an oak boat, the inboard engine on its own.
  const anim = Object.values(boatAnimation(oak.m, 'preview').animations)[0];
  for (const motor of MOTORS) {
    const portrait = motor.inboard
      ? (({ geo, texture }) => render(geo.geometry, texture, { yaw: 150, pitch: 20, size: 64 }))(blockArtById[`${motor.id}_mounted`])
      : render(oak.geo.geometry, oak.texture, { yaw: 120, pitch: 20, size: 64, anim, vars: MOTOR_VARS(OUTBOARDS.indexOf(motor)) });
    await write(join(RP, 'textures', 'ui', NS, `${motor.id}.png`), portrait);
  }
  await write(join(RP, 'textures', 'terrain_texture.json'), { resource_pack_name: NS, texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: terrain });
  await write(join(RP, 'blocks.json'), {
    format_version: '1.21.40',
    ...Object.fromEntries(BLOCKS.map((b) => [`${NS}:${b.id}`, { sound: b.sound }])),
  });

  // Data for the scripts, and the water model they share with the build.
  const itemList = itemsFor();
  await write(join(BP, 'scripts', 'data.js'), [
    '// Generated by tools/build.mjs',
    `export const MOTORS = ${JSON.stringify(MOTORS.map(motorRecord))};`,
    `export const BOATS = ${JSON.stringify(boatList.map((b) => ({ id: b.id, wood: b.wood, item: b.item, variant: b.variant, raft: b.raft, seats: seatPositions(b.seats) })))};`,
    `export const ITEMS = ${JSON.stringify(itemList.map((i) => `${NS}:${i.id}`))};`,
    '',
  ].join('\n'));
  await copyFile(join(ROOT, 'src', 'lib', 'water.mjs'), join(BP, 'scripts', 'water.js'));

  // Items (the ship's wheel is a block, and Bedrock makes its item).
  const itemTextures = {};
  for (const item of itemList) {
    await write(join(RP, 'textures', 'items', NS, `${item.id}.png`), item.icon);
    if (item.block) continue;
    await write(join(BP, 'items', `${item.id}.json`), buildItem(item));
    itemTextures[`${NS}_${item.id}`] = { textures: `textures/items/${NS}/${item.id}` };
  }
  await write(join(RP, 'textures', 'item_texture.json'), { resource_pack_name: NS, texture_name: 'atlas.items', texture_data: itemTextures });

  const recipes = recipesFor(itemList);
  for (const recipe of recipes) {
    const body = Object.values(recipe)[0];
    await write(join(BP, 'recipes', `${body.description.identifier.split(':')[1]}.json`), { format_version: '1.12', ...recipe });
  }

  // Language
  const langs = {};
  for (const locale of LOCALES) {
    const entries = langEntries(locale, { motors: MOTORS, boats: boatList, blocks: BLOCKS, items: itemList, description: pkg.description, version: pkg.version });
    langs[locale] = entries;
    const text = entries.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    for (const pack of [BP, RP]) await write(join(pack, 'texts', `${locale}.lang`), text);
  }
  for (const pack of [BP, RP]) await write(join(pack, 'texts', 'languages.json'), LOCALES);

  await buildJava({
    ...java, boats: boatList, blocks: BLOCKS, blockArt: blockArtById, items: itemList, recipes, langs, icon,
    OUT: join(ROOT, 'java', 'src', 'generated', 'resources'),
  });

  if (!quiet) console.log(`Built ${boatList.length} motorboats, ${BLOCKS.length} blocks, ${itemList.length} items: ${itemList.map((i) => i.id).join(', ')}`);
  return { boats: boatList, blocks: BLOCKS, items: itemList, version: pkg.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
