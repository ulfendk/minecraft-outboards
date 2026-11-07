// Rafts: any blocks joined together on the water, with a motor (or several) clamped on, or
// ships of up to 4,096 blocks with an inboard engine inside. Right-click a motor (or a ship's
// wheel) to cast off: the raft is found by scanning the connected blocks (water.js
// scanVessel, the same as the Java edition), the driver sits down on an invisible seat, and
// every time the raft has gone a block the whole thing is copied one block on with
// structures (blocks, chests and all; one per 64x64 tile, the most a structure holds), and the
// players and animals on the deck are moved with it. Holding A or D long enough turns it a
// quarter turn.
import { BlockPermutation, StructureRotation, StructureSaveMode, system, world } from '@minecraft/server';
import {
  MAX_RAFT, REVERSE, rotateQuarter, scanVessel, SHIP_STEP_LIMIT, STEP_LIMIT, step, vectorOf, vessel, waterLevel, WATERY, initial, yawOf,
} from './water.js';
import { isFuel, refuel } from './fuel.js';
import {
  blockAt, driverOf, isHelm, kmh, LOG, motorOfBlock, NS, percent, readInput, ridersOf, sound, tell,
} from './util.js';

const FACINGS = ['north', 'east', 'south', 'west'];
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const turnFacing = (f, q) => FACINGS[(FACINGS.indexOf(f) + q + 4) % 4];
const key = (p) => `${p.x},${p.y},${p.z}`;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
/** Structures hold at most 64 blocks across: bigger rafts are copied in tiles this size. */
const TILE = 64;
/** Blocks that hang on others: taken away first, so that nothing pops off as an item. */
const HANGING = /(torch|lantern|ladder|sign|banner|button|lever|carpet|rail|redstone_wire|tripwire|pressure_plate|flower_pot|candle|vine|frame|bell|chain|skull|head|bed|door|trapdoor|_pane|bars|fence|wall|scaffolding|lily_pad)/;

/** seat entity id -> raft */
const rafts = new Map();
let structureCount = 0;

const idAt = (dim) => (x, y, z) => {
  try {
    return dim.getBlock({ x, y, z })?.typeId;
  } catch {
    return undefined;
  }
};

export const raftCount = () => rafts.size;
export const raftOf = (seat) => rafts.get(seat.id);
/** Is this block part of a raft someone is driving? */
const busy = (dim, p) => [...rafts.values()].some((r) => r.dim.id === dim.id && r.set.has(key(p)));

function motorFuel(block) {
  try {
    return block.permutation.getState(`${NS}:fuel`) ?? 0;
  } catch {
    return 0;
  }
}

function setState(dim, p, state, value) {
  try {
    const b = dim.getBlock(p);
    b.setPermutation(b.permutation.withState(state, value));
  } catch {}
}

/**
 * Casts off: scans the raft the block belongs to and puts the player (or, in the selftest,
 * nobody) at the helm. Returns the raft, or a reason it can't go.
 */
export function startRaft(dim, at, player, { test } = {}) {
  if (busy(dim, at)) return fail(player, 'busy');
  const get = idAt(dim);
  const found = scanVessel(get, [at.x, at.y, at.z], (id) => !!motorOfBlock(id)?.inboard);
  if (!found.ok) return fail(player, found.reason);
  const cells = found.cells.map(([x, y, z]) => ({ x, y, z }));
  const motors = [];
  const containers = [];
  let helm;
  for (const c of cells) {
    const block = dim.getBlock(c);
    const motor = motorOfBlock(block.typeId);
    if (motor) motors.push({ pos: c, motor, facing: block.permutation.getState(`${NS}:facing`) ?? 'north', fuel: motorFuel(block) });
    else if (isHelm(block.typeId)) helm = { pos: c, facing: block.permutation.getState('minecraft:cardinal_direction') ?? 'north' };
    try { if (block.getComponent('minecraft:inventory')) containers.push(c); } catch {}
  }
  if (!motors.length) return fail(player, 'no_motor');
  // The raft goes where its first motor pushes it: the opposite way to its propeller.
  const heading = OPPOSITE[motors[0].facing];
  const water = waterLevel(get, found.cells);
  // The driver stands behind the wheel, or on the deck in front of the motor.
  const seatAt = helm
    ? add(helm.pos, vectorToPos(OPPOSITE[helm.facing]))
    : add(motors[0].pos, { ...vectorToPos(heading), y: 1 });
  const seat = dim.spawnEntity(`${NS}:raft_seat`, { x: seatAt.x + 0.5, y: seatAt.y, z: seatAt.z + 0.5 });
  seat.setRotation({ x: 0, y: yawOf(helm ? helm.facing : heading) });
  const raft = {
    dim, cells, set: new Set(cells.map(key)), motors, containers, helm, heading, water, seat, test,
    s: { ...initial(yawOf(heading)) }, progress: 0, turn: 0, blockedAt: -99,
  };
  rafts.set(seat.id, raft);
  if (player) {
    seat.getComponent('minecraft:rideable').addRider(player);
    raft.driver = player;
    const n = motors.length;
    try {
      player.onScreenDisplay.setActionBar({
        translate: `${NS}.raft.start`,
        with: { rawtext: [{ text: String(cells.length) }, n === 1 ? { translate: `${NS}.motors.one` } : { translate: `${NS}.motors.many`, with: [String(n)] }] },
      });
      player.sendMessage({ rawtext: [{ text: '§e' }, { translate: `${NS}.handbook.raft` }, { text: ':§r ' }, { translate: `${NS}.controls.raft` }] });
    } catch {}
  }
  sound(dim, 'random.anvil_use', at, 0.4, 1.6);
  return raft;
}

function vectorToPos(dir) {
  const [x, y, z] = vectorOf(dir);
  return { x, y, z };
}

function fail(player, reason) {
  if (player) tell(player, `${NS}.raft.${reason}`);
  return { failed: reason };
}

/** The driver got off (or the selftest is done): the raft stays where it is, as blocks. */
export function moor(raft) {
  rafts.delete(raft.seat.id);
  for (const m of raft.motors) setState(raft.dim, m.pos, `${NS}:fuel`, Math.ceil(Math.max(0, m.fuel)));
  try {
    for (const r of ridersOf(raft.seat)) tell(r, `${NS}.raft.moored`);
    raft.seat.remove();
  } catch {}
  if (raft.driver) tell(raft.driver, `${NS}.raft.moored`);
}

// ------------------------------------------------------------ moving the blocks

/** Where every cell would go: moved by d, or turned q quarter turns round the pivot. */
function plan(raft, { d, q }) {
  if (d) return { map: (p) => add(p, d) };
  // Turn round the middle of the raft (a block centre, so the cells stay on the grid).
  const xs = raft.cells.map((c) => c.x), zs = raft.cells.map((c) => c.z);
  const px = Math.floor((Math.min(...xs) + Math.max(...xs)) / 2), pz = Math.floor((Math.min(...zs) + Math.max(...zs)) / 2);
  return {
    pivot: { x: px, z: pz },
    map: (p) => {
      const [x, , z] = rotateQuarter([p.x - px, 0, p.z - pz], q);
      return { x: px + x, y: p.y, z: pz + z };
    },
  };
}

/** Is there room where the raft would go, and water under it? 'ok', 'blocked' or 'aground'. */
function check(raft, map) {
  const get = idAt(raft.dim);
  const next = new Set();
  for (const c of raft.cells) next.add(key(map(c)));
  for (const c of raft.cells) {
    const n = map(c);
    if (raft.set.has(key(n))) continue;
    const id = get(n.x, n.y, n.z);
    if (id === undefined) return 'blocked';
    if (id !== 'minecraft:air' && !WATERY.test(id)) return 'blocked';
  }
  // The bottom of every column must still be over (or in) water.
  let bottoms = 0, wet = 0;
  for (const c of raft.cells) {
    const n = map(c);
    const below = { x: n.x, y: n.y - 1, z: n.z };
    if (next.has(key(below))) continue;
    bottoms++;
    if (WATERY.test(get(below.x, below.y, below.z) ?? '')) wet++;
  }
  return wet >= bottoms / 2 ? 'ok' : 'aground';
}

function bounds(cells) {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of cells) for (const k of ['x', 'y', 'z']) { min[k] = Math.min(min[k], c[k]); max[k] = Math.max(max[k], c[k]); }
  return { min, max };
}

const ROTATIONS = [StructureRotation.None, StructureRotation.Rotate90, StructureRotation.Rotate180, StructureRotation.Rotate270];

/**
 * The raft cut into tiles of at most TILE x TILE columns: each tile's bounds (round its own
 * cells) and the cells in that box that are not part of the raft (left out of the copy).
 * Kept until the raft turns; moving it on just moves the tiles.
 */
function tilesOf(raft) {
  if (raft.tiles) return raft.tiles;
  const { min } = bounds(raft.cells);
  const groups = new Map();
  for (const c of raft.cells) {
    const k = `${Math.floor((c.x - min.x) / TILE)},${Math.floor((c.z - min.z) / TILE)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  raft.tiles = [...groups.values()].map((cells) => {
    const b = bounds(cells);
    const voids = [];
    for (let x = b.min.x; x <= b.max.x; x++)
      for (let y = b.min.y; y <= b.max.y; y++)
        for (let z = b.min.z; z <= b.max.z; z++) {
          if (!raft.set.has(key({ x, y, z }))) voids.push({ x: x - b.min.x, y: y - b.min.y, z: z - b.min.z });
        }
    return { ...b, voids };
  });
  return raft.tiles;
}

/** Takes the raft's blocks away (hanging things first, then from the top down). */
function clear(raft, cells) {
  const dim = raft.dim;
  const order = [...cells].sort((a, b) => {
    const ha = HANGING.test(blockAt(dim, a.x, a.y, a.z)?.typeId ?? '') ? 0 : 1;
    const hb = HANGING.test(blockAt(dim, b.x, b.y, b.z)?.typeId ?? '') ? 0 : 1;
    return ha - hb || b.y - a.y;
  });
  const waterPerm = BlockPermutation.resolve('minecraft:water');
  const airPerm = BlockPermutation.resolve('minecraft:air');
  for (const c of order) {
    try { dim.getBlock(c).setPermutation(c.y <= raft.water ? waterPerm : airPerm); } catch {}
  }
}

/** Moves the raft's blocks (and everyone on it) one block on, or a quarter turn round. */
function shift(raft, move) {
  const { map } = plan(raft, move);
  const result = check(raft, map);
  if (result !== 'ok') return result;
  const dim = raft.dim;
  const sm = world.structureManager;
  const { min, max } = bounds(raft.cells);

  // Copy every tile first: only the raft's own blocks go along, everything else in the box
  // is left as it is.
  const tiles = tilesOf(raft);
  const copies = tiles.map((t) => {
    const name = `${NS}:raft_${structureCount++ % 1024}`;
    try { sm.delete(name); } catch {}
    const structure = sm.createFromWorld(name, dim, t.min, t.max, { includeEntities: false, includeBlocks: true, saveMode: StructureSaveMode.Memory });
    for (const v of t.voids) structure.setBlockPermutation(v, undefined);
    return { t, name, structure };
  });

  // Who is on board (standing on the deck, or in the box over it).
  const passengers = [];
  try {
    for (const e of dim.getEntities({ location: { x: min.x - 0.3, y: min.y, z: min.z - 0.3 }, volume: { x: max.x - min.x + 1.6, y: max.y - min.y + 3, z: max.z - min.z + 1.6 } })) {
      if (e.id === raft.seat.id || e.typeId === `${NS}:raft_seat`) continue;
      try { if (e.getComponent('minecraft:riding')) continue; } catch {}
      passengers.push(e);
    }
  } catch {}

  // The copies hold what is in the chests: empty them before their blocks are replaced, or
  // the old ones spill their contents.
  for (const c of raft.containers) {
    try { dim.getBlock(c).getComponent('minecraft:inventory').container.clearAll(); } catch {}
  }

  const moved = raft.cells.map(map);
  const movedSet = new Set(moved.map(key));
  const q = move.q ? ((move.q % 4) + 4) % 4 : 0;
  // Turning, the whole raft is taken away and put down again. Going straight on, the copy is
  // put down over the raft (block for block), and only the cells it has left are cleared:
  // for a big ship, a slice instead of the whole thing.
  if (q) clear(raft, raft.cells);
  for (const { t, name, structure } of copies) {
    const a = map(t.min), b = map(t.max);
    const at = { x: Math.min(a.x, b.x), y: t.min.y, z: Math.min(a.z, b.z) };
    sm.place(structure, dim, at, { rotation: ROTATIONS[q], includeEntities: false, waterlogged: false });
    try { sm.delete(name); } catch {}
  }
  if (!q) clear(raft, raft.cells.filter((c) => !movedSet.has(key(c))));
  if (q) raft.tiles = undefined;
  else for (const t of raft.tiles) { t.min = map(t.min); t.max = map(t.max); }

  // The motors and the wheel turn with the raft.
  for (const m of raft.motors) {
    m.pos = map(m.pos);
    if (q) {
      m.facing = turnFacing(m.facing, q);
      setState(dim, m.pos, `${NS}:facing`, m.facing);
    }
  }
  if (raft.helm) {
    raft.helm.pos = map(raft.helm.pos);
    if (q) {
      raft.helm.facing = turnFacing(raft.helm.facing, q);
      setState(dim, raft.helm.pos, 'minecraft:cardinal_direction', raft.helm.facing);
    }
  }
  raft.containers = raft.containers.map(map);
  raft.cells = moved;
  raft.set = movedSet;
  if (q) raft.heading = turnFacing(raft.heading, q);

  // Everyone on board goes along.
  const carry = (e) => {
    const l = e.location;
    const fx = l.x - Math.floor(l.x), fz = l.z - Math.floor(l.z);
    let to;
    if (move.d) to = add(l, move.d);
    else {
      const cell = map({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
      const [rx, , rz] = rotateQuarter([fx - 0.5, 0, fz - 0.5], q);
      to = { x: cell.x + 0.5 + rx, y: l.y, z: cell.z + 0.5 + rz };
    }
    const rot = e.getRotation();
    e.teleport(to, { rotation: { x: rot.x, y: rot.y + q * 90 } });
  };
  for (const e of passengers) try { carry(e); } catch {}
  const driver = raft.driver;
  try { carry(raft.seat); } catch {}
  if (driver) {
    system.run(() => {
      try {
        if (!raft.seat.isValid || ridersOf(raft.seat).some((r) => r.id === driver.id)) return;
        driver.teleport(raft.seat.location);
        raft.seat.getComponent('minecraft:rideable').addRider(driver);
      } catch {}
    });
  }
  return 'ok';
}

// ------------------------------------------------------------ driving

function hud(raft, driver, fuel, tank) {
  const s = raft.s;
  const throttle = s.throttle < -0.01 ? [{ translate: `${NS}.hud.reverse` }] : [{ text: `${Math.round(s.throttle * 100)}%` }];
  try {
    driver.onScreenDisplay.setActionBar({
      translate: `${NS}.hud.raft`,
      with: { rawtext: [{ text: String(kmh(s.speed)) }, { rawtext: throttle }, { text: percent(fuel, tank) }, { text: String(raft.cells.length) }] },
    });
  } catch {}
}

function drive(raft, now) {
  const driver = driverOf(raft.seat);
  if (!raft.test) {
    if (!driver) return moor(raft);
    raft.driver = driver;
  }
  const input = raft.test ?? readInput(driver);
  const fuelled = raft.motors.filter((m) => m.fuel > 0);
  const v = vessel(fuelled.map((m) => m.motor), 4 + raft.cells.length);
  const yaw0 = yawOf(raft.heading);
  const s = step({ ...raft.s, yaw: yaw0 }, input, v, { afloat: true, fuel: fuelled.length > 0 });
  const limit = raft.cells.length > MAX_RAFT ? SHIP_STEP_LIMIT : STEP_LIMIT;
  s.speed = Math.max(-limit * REVERSE, Math.min(limit, s.speed));
  // Quarter turns: count up how far it would have turned.
  const dy = ((s.yaw - yaw0 + 540) % 360) - 180;
  raft.turn = input.side ? raft.turn + dy : raft.turn * 0.8;
  s.yaw = yaw0;
  raft.s = s;
  for (const m of fuelled) {
    const before = Math.ceil(m.fuel);
    m.fuel = Math.max(0, m.fuel - s.burn * m.motor.burn);
    if (Math.ceil(m.fuel) !== before) setState(raft.dim, m.pos, `${NS}:fuel`, Math.ceil(m.fuel));
    if (m.fuel <= 0 && driver) {
      tell(driver, `${NS}.empty`);
      raft.hudAfter = now + 60;
    }
  }

  let result = 'ok';
  if (Math.abs(raft.turn) >= 90) {
    result = shift(raft, { q: raft.turn > 0 ? 1 : -1 });
    raft.turn = 0;
  } else {
    raft.progress += s.speed;
    if (Math.abs(raft.progress) >= 1) {
      const sign = Math.sign(raft.progress);
      const [x, , z] = vectorOf(raft.heading);
      result = shift(raft, { d: { x: x * sign, y: 0, z: z * sign } });
      raft.progress -= sign;
    }
  }
  if (result !== 'ok') {
    raft.progress = 0;
    raft.s = { ...raft.s, speed: 0 };
    if (now - raft.blockedAt > 30) {
      raft.blockedAt = now;
      sound(raft.dim, 'random.door_close', raft.seat.location, 0.8, 0.6);
      if (driver) {
        tell(driver, `${NS}.raft.${result}`);
        raft.hudAfter = now + 40;
      }
    }
  }

  const running = fuelled.length > 0 && Math.abs(s.throttle) > 0.01;
  if (running && now % 6 === 0 && fuelled.some((m) => !m.motor.silent)) {
    // An inboard engine is a deep, loud rumble.
    const big = fuelled.some((m) => m.motor.inboard);
    const t = Math.abs(s.throttle);
    sound(raft.dim, 'mob.bee.loop', raft.motors[0].pos, big ? 0.8 + 0.6 * t : 0.3 + 0.5 * t, big ? 0.2 + 0.25 * t : 0.4 + 0.5 * t);
  }
  if (driver && now % 5 === 0 && !(raft.hudAfter > now)) {
    const tank = raft.motors.reduce((t, m) => t + m.motor.tank, 0);
    hud(raft, driver, raft.motors.reduce((t, m) => t + m.fuel, 0), tank);
  }
}

function tick() {
  const now = system.currentTick;
  for (const raft of [...rafts.values()]) {
    if (!raft.seat.isValid) {
      rafts.delete(raft.seat.id);
      continue;
    }
    try {
      drive(raft, now);
    } catch (err) {
      if (now % 100 === 0) console.warn(`${LOG} raft: ${err}`);
    }
  }
  // Seats left over from before a restart (their raft is just blocks now).
  if (now % 100 === 50) {
    for (const p of world.getPlayers()) {
      try {
        for (const seat of p.dimension.getEntities({ type: `${NS}:raft_seat`, location: p.location, maxDistance: 96 })) {
          if (!rafts.has(seat.id)) seat.remove();
        }
      } catch {}
    }
  }
}

// ------------------------------------------------------------ motor and wheel blocks

function interactMotor(e) {
  const { player, block } = e;
  if (!player) return;
  const motor = motorOfBlock(block.typeId);
  const item = player.getComponent('minecraft:inventory')?.container?.getItem(player.selectedSlotIndex);
  if (item && isFuel(item.typeId)) {
    const next = refuel(player, motor, motorFuel(block));
    if (next !== undefined) setState(block.dimension, block.location, `${NS}:fuel`, Math.floor(next));
    return;
  }
  if (motorFuel(block) <= 0) {
    tell(player, `${NS}.empty`);
    return;
  }
  startRaft(block.dimension, block.location, player);
}

export function setupRafts() {
  system.runInterval(tick, 1);
}

/** Registered at startup (custom block components). */
export function registerRaftBlocks(blockComponentRegistry) {
  blockComponentRegistry.registerCustomComponent(`${NS}:motor`, { onPlayerInteract: (e) => interactMotor(e) });
  blockComponentRegistry.registerCustomComponent(`${NS}:helm`, {
    onPlayerInteract: ({ player, block }) => {
      if (player) startRaft(block.dimension, block.location, player);
    },
  });
}

