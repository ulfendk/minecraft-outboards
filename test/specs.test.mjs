import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTORS, OUTBOARDS } from '../src/motors.mjs';
import { WOODS } from '../src/boats.mjs';
import { BLOCKS, FUEL_MAX } from '../src/blocks.mjs';
import { items, recipes } from '../src/items.mjs';
import { STRINGS } from '../src/i18n.mjs';
import { CONTROLS, langEntries, LOCALES } from '../src/lang.mjs';
import { boats } from '../tools/build.mjs';

test('every motor has what the game needs', () => {
  for (const m of MOTORS) {
    for (const k of ['id', 'name', 'hp', 'kind', 'thrust', 'maxSpeed', 'burn', 'tank', 'fuels', 'recipe', 'icon', 'info']) assert.ok(m[k] !== undefined, `${m.id}: ${k}`);
    assert.ok(m.tank <= FUEL_MAX, `${m.id}: the tank must fit the block state`);
    assert.ok(Object.values(m.fuels).every((u) => u > 0 && u <= m.tank));
  }
});

test('every wood makes a motorboat, from the right vanilla boat', () => {
  const list = boats();
  assert.equal(list.length, WOODS.length);
  assert.deepEqual([...new Set(WOODS.map((w) => w.variant))].length, WOODS.length);
  for (const b of list) assert.ok(b.item.endsWith('_boat') || b.item.endsWith('_raft'));
});

test('everything has a Danish name, and every in-game text a Danish translation', () => {
  const da = STRINGS.da;
  for (const m of MOTORS) {
    assert.ok(da.names[m.id], m.id);
    assert.ok(da.info[m.id], m.id);
  }
  for (const b of boats()) assert.ok(da.names[b.id], b.id);
  for (const it of items()) assert.ok(da.names[it.id], it.id);
  const ctx = { motors: MOTORS, boats: boats(), blocks: BLOCKS, items: items(), description: 'x', version: '0' };
  const [en, dk] = LOCALES.map((l) => new Map(langEntries(l, ctx)));
  assert.deepEqual([...en.keys()], [...dk.keys()]);
  for (const [k, v] of dk) assert.ok(v, `${k} is empty in Danish`);
  for (const c of Object.values(CONTROLS)) for (const pair of c) assert.equal(pair.length, 2);
});

test('the site texts exist in both languages', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.da).filter((k) => !['names', 'info'].includes(k)).sort());
});

test('every motor and the wheel can be crafted, and recipes only use real ingredients', () => {
  const list = items();
  const rs = recipes(list);
  for (const id of [...MOTORS.map((m) => m.id), 'propeller', 'helm', 'outboard_handbook']) {
    assert.ok(rs.some((r) => Object.values(r)[0].result.item === `outboards:${id}`), id);
  }
  for (const r of rs) {
    const body = Object.values(r)[0];
    for (const row of body.pattern ?? []) for (const ch of row) if (ch !== ' ') assert.ok(body.key[ch], `${body.description.identifier}: ${ch}`);
  }
});

test('boats keep their four outboards in the same order, and the inboard engine is a full block', () => {
  assert.deepEqual(OUTBOARDS.map((m) => m.id), ['small_motor', 'medium_motor', 'large_motor', 'electric_motor']);
  const engine = BLOCKS.find((b) => b.motor === 'inboard_engine');
  assert.ok(engine?.inboard);
  assert.deepEqual(engine.box, { origin: [-8, 0, -8], size: [16, 16, 16] });
  // One model per block of it, every one with something in it, all inside the block.
  assert.equal(engine.slices.length, 24);
  for (const sl of engine.slices) {
    const cubes = sl.model.bones.flatMap((b) => b.cubes ?? []);
    assert.ok(cubes.length, sl.id);
    for (const c of cubes) {
      assert.ok(c.origin[0] >= -8 && c.origin[2] >= -8 && c.origin[1] >= 0, `${sl.id} ${c.origin}`);
      assert.ok(c.origin[0] + c.size[0] <= 8 && c.origin[2] + c.size[2] <= 8 && c.origin[1] + c.size[1] <= 16, `${sl.id} ${c.origin} ${c.size}`);
    }
  }
  assert.ok(BLOCKS.some((b) => b.propeller));
  for (const id of ['coal_block', 'lava_bucket', 'blaze_rod']) assert.ok(MOTORS.find((m) => m.inboard).fuels[id], id);
});
