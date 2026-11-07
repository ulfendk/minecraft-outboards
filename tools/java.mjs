// Generates the Java edition's resources (java/src/generated/resources) from the same
// specs as the Bedrock packs. GeckoLib reads the Bedrock geometry and animation formats
// directly, so the motorboat models and animations are shared; the blocks get Java block
// models converted from the same geometry.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { NS } from '../src/lib/constants.mjs';
import { BOAT_MASS, initial, scanRaft, step, vessel } from '../src/lib/water.mjs';
import { javaId } from '../src/ids.mjs';
import { MOTORS, motorById, motorRecord } from '../src/motors.mjs';
import { FACINGS, javaBlockModel } from '../src/blocks.mjs';
import { seatPositions } from '../src/lib/behavior.mjs';

async function write(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n');
}

/**
 * Runs through the JavaScript water model with scripted inputs, tick by tick, so the Java
 * model can be checked against it (OutboardGameTests.waterMatchesJs).
 */
export function waterFixtures() {
  const out = [];
  const cases = [
    ...MOTORS.map((m) => ({ id: `boat ${m.id}`, motors: [m], mass: BOAT_MASS })),
    { id: 'raft 40 two large', motors: [MOTORS[2], MOTORS[2]], mass: 44 },
    { id: 'raft 120 medium', motors: [MOTORS[1]], mass: 124 },
    { id: 'ship 3000 two inboard', motors: [motorById('inboard_engine'), motorById('inboard_engine')], mass: 3004 },
  ];
  for (const c of cases) {
    const v = vessel(c.motors, c.mass);
    let s = initial(30);
    const ticks = [];
    for (let t = 0; t < 200; t++) {
      const input = { fwd: t < 100 ? 1 : t < 140 ? 0 : -1, side: t >= 60 && t < 90 ? 1 : t >= 90 && t < 110 ? -1 : 0 };
      const env = { afloat: !(t >= 170 && t < 180), fuel: t < 190 };
      s = step(s, input, v, env);
      ticks.push({ input, env, state: s });
    }
    out.push({ id: c.id, vessel: v, ticks });
  }
  return out;
}

/** A small raft on a pond, for the Java scanner to agree with the JavaScript one. */
export function scanFixtures() {
  const world = new Map();
  const set = (x, y, z, id) => world.set(`${x},${y},${z}`, id);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) { set(x, 0, z, 'minecraft:water'); set(x, -1, z, 'minecraft:sand'); }
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 2; z++) set(x, 0, z, 'minecraft:oak_planks');
  set(0, 1, 0, 'minecraft:chest');
  set(0, 0, 3, `${NS}:small_motor_mounted`);
  const get = (x, y, z) => world.get(`${x},${y},${z}`) ?? 'minecraft:air';
  return { world: [...world.entries()], start: [0, 0, 3], result: scanRaft(get, [0, 0, 3]) };
}

function javaRecipe(item) {
  return {
    type: 'minecraft:crafting_shaped',
    category: 'misc',
    pattern: item.recipe.pattern,
    key: Object.fromEntries(Object.entries(item.recipe.key).map(([k, v]) => [k, javaId(v)])),
    result: { id: `${NS}:${item.id}`, count: 1 },
  };
}

const Y_ROT = { north: 0, east: 90, south: 180, west: 270 };

export async function buildJava({ geos, anims, textures, boats, blocks, blockArt, items, langs, icon, OUT }) {
  await rm(OUT, { recursive: true, force: true });
  const A = join(OUT, 'assets', NS);
  const D = join(OUT, 'data', NS);

  for (const b of boats) {
    await write(join(A, 'geckolib', 'models', 'entity', `${b.id}.geo.json`), geos[b.id]);
    await write(join(A, 'geckolib', 'animations', 'entity', `${b.id}.animation.json`), anims[b.id]);
    await write(join(A, 'textures', 'entity', `${b.id}.png`), textures[b.id]);
  }
  await write(join(OUT, NS, 'motors.json'), MOTORS.map(motorRecord));
  await write(join(OUT, NS, 'boats.json'), boats.map((b) => ({ id: b.id, wood: b.wood, item: b.item, raft: b.raft, seats: seatPositions(b.seats) })));
  await write(join(OUT, NS, 'water_fixtures.json'), waterFixtures());
  await write(join(OUT, NS, 'scan_fixture.json'), scanFixtures());

  for (const block of blocks) {
    const { geo, texture, slices } = blockArt[block.id];
    if (slices) {
      // The inboard engine: a model per block of it, picked by its part (px, py, pz).
      for (const sl of slices) {
        await write(join(A, 'textures', 'block', `${sl.id}.png`), sl.texture);
        await write(join(A, 'models', 'block', `${sl.id}.json`), javaBlockModel({ id: sl.id }, sl.geo));
      }
      await write(join(A, 'textures', 'block', `${block.id}.png`), slices[0].texture);
      await write(join(A, 'models', 'block', `${block.id}.json`), javaBlockModel({ id: slices[0].id }, slices[0].geo));
      await write(join(A, 'blockstates', `${block.id}.json`), {
        variants: Object.fromEntries(FACINGS.flatMap((f) => slices.map((sl) => [
          `facing=${f},px=${sl.part[0]},py=${sl.part[1]},pz=${sl.part[2]}`,
          { model: `${NS}:block/${sl.id}`, ...(Y_ROT[f] ? { y: Y_ROT[f] } : {}) },
        ]))),
      });
    } else {
      await write(join(A, 'textures', 'block', `${block.id}.png`), texture);
      await write(join(A, 'models', 'block', `${block.id}.json`), javaBlockModel(block, geo));
      await write(join(A, 'blockstates', `${block.id}.json`), {
        variants: Object.fromEntries(FACINGS.map((f) => [`facing=${f}`, { model: `${NS}:block/${block.id}`, ...(Y_ROT[f] ? { y: Y_ROT[f] } : {}) }])),
      });
    }
    await write(join(D, 'loot_table', 'blocks', `${block.id}.json`), {
      type: 'minecraft:block',
      pools: block.loot ? [{ rolls: 1, entries: [{ type: 'minecraft:item', name: `${NS}:${block.loot}` }], conditions: [{ condition: 'minecraft:survives_explosion' }] }] : [],
    });
  }
  await write(join(OUT, 'data', 'minecraft', 'tags', 'block', 'mineable', 'pickaxe.json'), { replace: false, values: blocks.filter((b) => b.motor || b.propeller).map((b) => `${NS}:${b.id}`) });
  await write(join(OUT, 'data', 'minecraft', 'tags', 'block', 'mineable', 'axe.json'), { replace: false, values: blocks.filter((b) => b.helm).map((b) => `${NS}:${b.id}`) });

  for (const item of items) {
    await write(join(A, 'textures', 'item', `${item.id}.png`), item.icon);
    await write(join(A, 'models', 'item', `${item.id}.json`), { parent: 'minecraft:item/generated', textures: { layer0: `${NS}:item/${item.id}` } });
    await write(join(A, 'items', `${item.id}.json`), { model: { type: 'minecraft:model', model: `${NS}:item/${item.id}` } });
    if (item.recipe) await write(join(D, 'recipe', `${item.id}.json`), javaRecipe(item));
  }
  await write(join(D, 'recipe', 'outboard_handbook.json'), {
    type: 'minecraft:crafting_shapeless', category: 'misc',
    ingredients: ['minecraft:book', 'minecraft:iron_ingot'], result: { id: `${NS}:outboard_handbook`, count: 1 },
  });

  // Language files: Bedrock keys -> Java keys.
  for (const [locale, entries] of Object.entries(langs)) {
    const out = {};
    for (const [k, v] of entries) {
      let m;
      if ((m = k.match(new RegExp(`^entity\\.${NS}:(.+)\\.name$`)))) out[`entity.${NS}.${m[1]}`] = v;
      else if ((m = k.match(new RegExp(`^item\\.${NS}:(.+)\\.name$`)))) out[`item.${NS}.${m[1]}`] = v;
      else if ((m = k.match(new RegExp(`^tile\\.${NS}:(.+)\\.name$`)))) out[`block.${NS}.${m[1]}`] = v;
      else if (k.startsWith(`${NS}.`) || k.startsWith('key.')) out[k] = v;
    }
    out[`entity.${NS}.raft`] = locale === 'da_DK' ? 'Flåde' : 'Raft';
    out[`itemGroup.${NS}`] = locale === 'da_DK' ? 'Påhængsmotorer' : 'Outboards';
    await write(join(A, 'lang', `${locale.toLowerCase()}.json`), out);
  }

  await write(join(A, 'icon.png'), icon);
}
