import { ItemStack, system, world } from '@minecraft/server';
import { ITEMS } from './data.js';
import { fuelOf, setFuel, testDrive } from './boat.js';
import { mountMotor } from './place.js';
import { moor, startRaft } from './raft.js';
import { LOG, NS } from './util.js';

const at = (ticks, fn) => new Promise((resolve) => system.runTimeout(() => { try { fn(); } catch (e) { console.warn(`${LOG} selftest ${e}`); } resolve(); }, ticks));

/**
 * Used by tools/bds-test.sh: checks that every motorboat and item exists, then drives a
 * motorboat across a pond, and sends a raft (with a chest on it) forward and round a corner.
 * Message = space-separated expected entity ids.
 */
export async function selfTest(message) {
  const expected = message.split(/\s+/).filter(Boolean);
  const dim = world.getDimension('overworld');
  const problems = [];
  const counts = {};
  for (const e of dim.getEntities()) if (e.typeId.startsWith(`${NS}:`)) counts[e.typeId] = (counts[e.typeId] ?? 0) + 1;
  for (const id of expected) if (!counts[`${NS}:${id}`]) problems.push(id);
  for (const id of ITEMS) {
    try { new ItemStack(id, 1); } catch { problems.push(id); }
  }
  console.log(`${LOG} selftest found ${JSON.stringify(counts)}`);

  // A pond, three blocks deep, in the flat world (grass at y -61).
  dim.runCommand('fill -50 -63 -20 50 -61 -60 water');

  // 1. A motorboat with a 15 hp motor and some fuel drives off north-east.
  const boat = dim.spawnEntity(`${NS}:motorboat_oak`, { x: -40.5, y: -60.3, z: -40.5 });
  boat.setProperty(`${NS}:motor`, 2);
  boat.setRotation({ x: 0, y: 180 });
  setFuel(boat, 8);
  testDrive(boat, { fwd: 1, side: 0 });
  const start = { ...boat.location };

  // 2. A 3x4 raft of planks with a log at one corner and a chest, and a small motor on the
  //    south side pointing south (so it pushes the raft north).
  const P = { x: 20, y: -61, z: -30 };
  dim.runCommand(`fill ${P.x} ${P.y} ${P.z} ${P.x + 2} ${P.y} ${P.z + 3} oak_planks`);
  dim.runCommand(`setblock ${P.x} ${P.y + 1} ${P.z} oak_log`);
  dim.runCommand(`setblock ${P.x + 1} ${P.y + 1} ${P.z + 2} chest`);
  dim.getBlock({ x: P.x + 1, y: P.y + 1, z: P.z + 2 }).getComponent('minecraft:inventory').container.addItem(new ItemStack('minecraft:diamond', 3));
  const motorAt = { x: P.x + 1, y: P.y, z: P.z + 4 };
  mountMotor(dim, motorAt, 'small_motor', 'south');
  const mb = dim.getBlock(motorAt);
  mb.setPermutation(mb.permutation.withState(`${NS}:fuel`, 12));
  let raft;

  await at(5, () => {
    raft = startRaft(dim, motorAt, null, { test: { fwd: 1, side: 0 } });
    if (!raft || raft.failed) problems.push(`raft did not start (${raft?.failed})`);
    else if (raft.cells.length !== 15) problems.push(`raft has ${raft.cells.length} blocks, expected 15`);
  });

  await at(120, () => {
    const moved = Math.hypot(boat.location.x - start.x, boat.location.z - start.z);
    if (moved < 8) problems.push(`motorboat drove ${moved.toFixed(2)} blocks`);
    if (Math.abs(boat.location.y - -60.3) > 0.25) problems.push(`motorboat not floating (y ${boat.location.y.toFixed(2)})`);
    if (!(fuelOf(boat) < 8)) problems.push('motorboat burnt no fuel');
    testDrive(boat, { fwd: 0, side: 0 });
    if (!raft || raft.failed) return;
    const log = raft.cells.find((c) => dim.getBlock(c).typeId === 'minecraft:oak_log');
    if (!log) problems.push('raft lost its log');
    else if (log.z >= P.z - 1) problems.push(`raft did not move north (log at z ${log.z})`);
    else if (dim.getBlock({ x: P.x, y: P.y + 1, z: P.z }).typeId !== 'minecraft:air') problems.push('raft left its log behind');
    console.log(`${LOG} selftest raft moved to ${JSON.stringify(log)}`);
    raft.test = { fwd: 1, side: -1 }; // turn right (clockwise)
  });

  let before;
  await at(10, () => {
    if (!raft || raft.failed) return;
    before = raft.cells.map((c) => ({ ...c, id: dim.getBlock(c).typeId }));
  });

  // Wait for the first quarter turn, then let go.
  for (let t = 0; t < 200 && raft && !raft.failed && raft.heading === 'north'; t++) await at(1, () => {});
  if (raft && !raft.failed) raft.test = { fwd: 0, side: 0 };
  await at(10, () => {
    if (!raft || raft.failed) return;
    if (raft.heading !== 'east') problems.push(`raft did not turn (heading ${raft.heading})`);
    // Where the log should be after a quarter turn clockwise round the middle.
    const logNow = raft.cells.filter((c) => dim.getBlock(c).typeId === 'minecraft:oak_log');
    const chest = raft.cells.find((c) => dim.getBlock(c).typeId === 'minecraft:chest');
    const motor = raft.cells.find((c) => dim.getBlock(c).typeId === `${NS}:small_motor_mounted`);
    console.log(`${LOG} selftest raft turned: log ${JSON.stringify(logNow)} chest ${JSON.stringify(chest)} motor ${JSON.stringify(motor)} ${motor ? dim.getBlock(motor).permutation.getState(`${NS}:facing`) : ''}`);
    if (logNow.length !== 1) problems.push(`after turning, ${logNow.length} logs where the raft says`);
    if (!chest) problems.push('after turning, the chest is not where the raft says');
    else {
      const items = dim.getBlock(chest).getComponent('minecraft:inventory').container;
      let diamonds = 0;
      for (let i = 0; i < items.size; i++) if (items.getItem(i)?.typeId === 'minecraft:diamond') diamonds += items.getItem(i).amount;
      if (diamonds !== 3) problems.push(`chest has ${diamonds} diamonds after the trip`);
    }
    if (!motor) problems.push('after turning, the motor is not where the raft says');
    else if (dim.getBlock(motor).permutation.getState(`${NS}:facing`) !== 'west') problems.push('motor did not turn with the raft');
    // Nothing of the raft is left where it was before the turn, unless the raft is there now.
    const set = new Set(raft.cells.map((c) => `${c.x},${c.y},${c.z}`));
    const left = before?.filter((c) => !set.has(`${c.x},${c.y},${c.z}`) && dim.getBlock(c).typeId === c.id) ?? [];
    if (left.length) problems.push(`raft left ${left.length} blocks behind when turning`);
    moor(raft);
  });

  await at(10, () => {
    console.log(problems.length ? `${LOG} selftest FAIL: ${problems.join('; ')}` : `${LOG} selftest PASS`);
  });
}
