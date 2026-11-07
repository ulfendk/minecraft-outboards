import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOAT_MASS, ENGINE, engineCells, engineOrigin, initial, MAX_RAFT, MAX_SHIP, rotateQuarter, scanRaft, scanVessel, step, topSpeed, vessel, waterLevel, dirOf, yawOf,
} from '../src/lib/water.mjs';
import { MOTORS, motorById } from '../src/motors.mjs';

const run = (v, ticks, input = { fwd: 1, side: 0 }, env = { afloat: true, fuel: true }, s = initial(0)) => {
  for (let t = 0; t < ticks; t++) s = step(s, input, v, env);
  return s;
};
const kmh = (bpt) => Math.round(bpt * 72);

test('a 2 hp motor pushes a boat at about 25 km/h', () => {
  const v = vessel([motorById('small_motor')], BOAT_MASS);
  const s = run(v, 400);
  assert.ok(Math.abs(kmh(s.speed) - 25) <= 2, `${kmh(s.speed)} km/h`);
  assert.ok(Math.abs(s.speed - topSpeed(v)) < 0.01);
});

test('bigger motors are faster, and none is faster than its top speed', () => {
  const speeds = ['electric_motor', 'small_motor', 'medium_motor', 'large_motor'].map((id) => run(vessel([motorById(id)], BOAT_MASS), 400).speed);
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1], `${speeds}`);
  for (const m of MOTORS) assert.ok(run(vessel([m], BOAT_MASS), 600).speed <= m.maxSpeed + 1e-9);
});

test('a heavy raft is slower, and two motors push harder than one', () => {
  const large = motorById('large_motor');
  const one = run(vessel([large], 4 + 120), 800).speed;
  const two = run(vessel([large, large], 4 + 120), 800).speed;
  const small = run(vessel([large], 4 + 16), 800).speed;
  assert.ok(small > one);
  assert.ok(two > one * 1.5);
});

test('it turns left on A (side +1) and turns slower when heavy', () => {
  const boat = run(vessel([motorById('medium_motor')], BOAT_MASS), 10, { fwd: 1, side: 1 }, undefined, initial(90));
  assert.ok(boat.yaw < 90, `yaw ${boat.yaw}`);
  const raft = run(vessel([motorById('medium_motor')], 200), 10, { fwd: 1, side: 1 }, undefined, initial(90));
  assert.ok(raft.yaw > boat.yaw);
});

test('S slows down and then reverses, at half the throttle', () => {
  const v = vessel([motorById('medium_motor')], BOAT_MASS);
  let s = run(v, 200);
  s = run(v, 300, { fwd: -1, side: 0 }, undefined, s);
  assert.ok(s.speed < 0);
  assert.equal(s.throttle, -0.5);
});

test('without fuel the motor winds down and the boat coasts to a stop', () => {
  const v = vessel([motorById('small_motor')], BOAT_MASS);
  let s = run(v, 200);
  s = run(v, 400, { fwd: 1, side: 0 }, { afloat: true, fuel: false }, s);
  assert.equal(s.throttle, 0);
  assert.equal(s.speed, 0);
  assert.equal(s.burn, 0);
});

test('aground, it stops quickly and does not push', () => {
  const v = vessel([motorById('large_motor')], BOAT_MASS);
  let s = run(v, 200);
  s = run(v, 20, { fwd: 1, side: 0 }, { afloat: false, fuel: true }, s);
  assert.ok(s.speed < 0.001);
});

test('fuel lasts as long as the handbook says', () => {
  const minutes = (m) => (m.tank / m.burn) / 20 / 60;
  assert.ok(Math.abs(minutes(motorById('small_motor')) - 10) < 0.5);
  assert.ok(Math.abs(minutes(motorById('medium_motor')) - 6) < 0.5);
  assert.ok(Math.abs(minutes(motorById('large_motor')) - 4) < 0.5);
});

// ------------------------------------------------------------ rafts

function pond() {
  const w = new Map();
  const set = (x, y, z, id) => w.set(`${x},${y},${z}`, id);
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
    for (let y = -2; y <= 0; y++) set(x, y, z, 'minecraft:water');
    set(x, -3, z, 'minecraft:sand');
  }
  return { set, get: (x, y, z) => w.get(`${x},${y},${z}`) ?? 'minecraft:air' };
}

test('a raft is every block joined to the motor', () => {
  const { set, get } = pond();
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) set(x, 0, z, 'minecraft:oak_planks');
  set(1, 1, 1, 'minecraft:chest');
  set(1, 2, 1, 'minecraft:lantern');
  set(1, 0, 3, 'outboards:small_motor_mounted');
  set(8, 0, 8, 'minecraft:oak_planks'); // another raft, not joined
  const r = scanRaft(get, [1, 0, 3]);
  assert.ok(r.ok, r.reason);
  assert.equal(r.cells.length, 12);
  assert.equal(waterLevel(get, r.cells), 0);
});

test('a raft that touches the shore or is too big does not go', () => {
  const { set, get } = pond();
  set(0, 0, 0, 'minecraft:oak_planks');
  set(0, 0, 1, 'minecraft:dirt');
  assert.equal(scanRaft(get, [0, 0, 0]).reason, 'grounded');
  const big = pond();
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) big.set(x, 0, z, 'minecraft:oak_planks');
  assert.equal(scanRaft(big.get, [0, 0, 0]).reason, 'too_big');
  assert.ok(19 * 19 > MAX_RAFT);
});

/** A wide sea with a rectangular barge of planks at y 0. */
function barge(w, d) {
  const w2 = new Map();
  const set = (x, y, z, id) => w2.set(`${x},${y},${z}`, id);
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) set(x, 0, z, 'minecraft:oak_planks');
  const get = (x, y, z) => w2.get(`${x},${y},${z}`) ?? (y <= 0 ? 'minecraft:water' : 'minecraft:air');
  return { set, get };
}
const isInboard = (id) => id === 'outboards:inboard_engine_mounted';

test('more than 256 blocks is a ship: it needs an inboard engine, and 4,096 blocks at most', () => {
  const raft = barge(30, 10);
  raft.set(5, 1, 5, 'outboards:large_motor_mounted');
  assert.equal(scanVessel(raft.get, [0, 0, 0], isInboard).reason, 'too_big');
  const ship = barge(30, 10);
  ship.set(5, 1, 5, 'outboards:inboard_engine_mounted');
  const r = scanVessel(ship.get, [0, 0, 0], isInboard);
  assert.ok(r.ok, r.reason);
  assert.equal(r.cells.length, 301);
  const small = barge(4, 4);
  assert.ok(scanVessel(small.get, [0, 0, 0], isInboard).ok);
  const huge = barge(80, 64);
  huge.set(5, 1, 5, 'outboards:inboard_engine_mounted');
  assert.ok(80 * 64 > MAX_SHIP);
  assert.equal(scanVessel(huge.get, [0, 0, 0], isInboard).reason, 'too_big');
});

test('one inboard engine drives a ship of a thousand blocks at full speed, two a ship of 4,096 at over 20 km/h', () => {
  const inboard = motorById('inboard_engine');
  assert.equal(kmh(topSpeed(vessel([inboard], 4 + 1000))), kmh(inboard.maxSpeed));
  const one = topSpeed(vessel([inboard], 4 + MAX_SHIP));
  const two = topSpeed(vessel([inboard, inboard], 4 + MAX_SHIP));
  assert.ok(kmh(one) >= 10, `${kmh(one)} km/h`);
  assert.ok(kmh(two) > 20, `${kmh(two)} km/h`);
  assert.ok(Math.abs((inboard.tank / inboard.burn) / 1200 - 3) < 0.5);
});

test('the inboard engine is 2 wide, 2 high and 6 long, reaching ahead of its propeller end', () => {
  assert.deepEqual(ENGINE, [2, 2, 6]);
  for (const [facing, ahead] of [['north', [0, 0, 1]], ['east', [-1, 0, 0]], ['south', [0, 0, -1]], ['west', [1, 0, 0]]]) {
    const cells = engineCells([10, 5, -3], facing);
    assert.equal(new Set(cells.map((c) => c.pos.join())).size, 24);
    const xs = cells.map((c) => c.pos[0]), zs = cells.map((c) => c.pos[2]), ys = cells.map((c) => c.pos[1]);
    const span = (v) => Math.max(...v) - Math.min(...v) + 1;
    assert.deepEqual([span(xs) * span(zs), span(ys)], [12, 2], facing);
    // The last part is 5 blocks ahead of the first (the way the ship goes).
    const last = cells.find((c) => c.part.join() === '0,0,5').pos;
    assert.deepEqual([last[0] - 10, last[1] - 5, last[2] + 3].map((n) => n + 0), ahead.map((n) => n * 5), facing);
    for (const c of cells) assert.deepEqual(engineOrigin(c.pos, c.part, facing).map((n) => n + 0), [10, 5, -3]);
  }
});

test('a raft on dry land is not afloat', () => {
  const get = (x, y, z) => (y === 0 && x === 0 && z === 0 ? 'minecraft:oak_planks' : 'minecraft:air');
  assert.equal(scanRaft(get, [0, 0, 0]).reason, 'not_afloat');
});

test('quarter turns go clockwise and come back round', () => {
  assert.deepEqual(rotateQuarter([1, 0, 0], 1), [-0, 0, 1]); // east -> south
  assert.deepEqual(rotateQuarter([0, 0, 1], 1), [-1, 0, 0]); // south -> west
  assert.deepEqual(rotateQuarter([2, 5, 3], 4), [2, 5, 3]);
  assert.deepEqual(rotateQuarter(rotateQuarter([2, 5, 3], 1), -1), [2, 5, 3]);
  assert.equal(dirOf(0), 'south');
  assert.equal(dirOf(-90), 'east');
  assert.equal(yawOf('north'), 180);
});
