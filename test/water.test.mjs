import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOAT_MASS, initial, MAX_RAFT, rotateQuarter, scanRaft, step, topSpeed, vessel, waterLevel, dirOf, yawOf,
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
