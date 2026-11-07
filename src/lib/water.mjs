// How a boat or raft with outboard motors moves on the water, one tick at a time. The same
// code runs in the build (site numbers, tests), in the Bedrock scripts (copied as
// scripts/water.js) and, line for line, in the Java mod (Water.java). Units are blocks and
// ticks; yaw is Minecraft's (0 = south, 90 = west).

/** Thrust to acceleration: a 2 hp motor on a boat tops out at about 0.35 blocks/tick. */
export const K = 0.105;
/** Water drag per tick. Terminal speed = K * thrust / (mass * DRAG). */
export const DRAG = 0.05;
/** A boat weighs about as much as 6 blocks of raft. */
export const BOAT_MASS = 6;
/** Throttle change per tick (motors spool up and down). */
export const SPOOL = 0.04;
/** How far back the throttle goes in reverse. */
export const REVERSE = 0.5;
/** Raft size limit (blocks), on both editions. */
export const MAX_RAFT = 256;
/** With an inboard engine aboard, a ship may be this big. */
export const MAX_SHIP = 4096;
/** Bedrock rafts move a whole block at a time: at most this fast (blocks/tick). */
export const STEP_LIMIT = 0.25;
/** ... and ships bigger than MAX_RAFT at most this fast, so every step has time to finish. */
export const SHIP_STEP_LIMIT = 0.15;

export const NO_INPUT = { fwd: 0, side: 0 };

export const initial = (yaw = 0) => ({ speed: 0, yaw, throttle: 0, vx: 0, vz: 0, burn: 0 });

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toward = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));
const r6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * What a hull with these motors can do.
 * motors: list of motor records ({ thrust, maxSpeed, burn }); mass in blocks.
 */
export function vessel(motors, mass) {
  const thrust = motors.reduce((s, m) => s + m.thrust, 0);
  const maxSpeed = motors.length ? Math.max(...motors.map((m) => m.maxSpeed)) : 0;
  return {
    thrust,
    mass,
    maxSpeed,
    // Big rafts turn slowly.
    turn: r6(clamp(4 / Math.sqrt(mass / BOAT_MASS), 0.6, 4)),
  };
}

/** Top speed (blocks/tick) of a vessel at full throttle. */
export const topSpeed = (v) => Math.min(v.maxSpeed, (K * v.thrust) / (v.mass * DRAG));

/**
 * One tick. input: { fwd: -1..1, side: -1..1 (+1 = left) }.
 * env: { afloat: on (or in) water, fuel: the motors have fuel }.
 * Returns the new state; burn is how much of a full throttle-tick of fuel was used.
 */
export function step(s, input, v, env) {
  const target = !env.fuel ? 0 : input.fwd > 0 ? 1 : input.fwd < 0 ? -REVERSE : 0;
  const throttle = toward(s.throttle, target, SPOOL);
  let speed = s.speed;
  if (env.afloat) {
    speed += (K * v.thrust * throttle) / v.mass - DRAG * speed;
    speed = clamp(speed, -v.maxSpeed * REVERSE, v.maxSpeed);
  } else {
    // Aground: the propeller is in the air, and the hull scrapes to a stop.
    speed *= 0.5;
  }
  if (Math.abs(speed) < 1e-4 && throttle === 0) speed = 0;
  // Rudder: it only bites when the boat moves (or the propeller pushes water past it).
  const bite = clamp(0.25 + Math.abs(speed) / 0.25, 0, 1) * (env.afloat ? 1 : 0.2);
  let yaw = s.yaw - input.side * v.turn * bite;
  yaw = ((yaw % 360) + 360) % 360;
  const rad = (yaw * Math.PI) / 180;
  return {
    speed: r6(speed),
    yaw: r6(yaw),
    throttle: r6(throttle),
    vx: r6(-Math.sin(rad) * speed),
    vz: r6(Math.cos(rad) * speed),
    burn: r6(Math.abs(throttle)),
  };
}

// ------------------------------------------------------------ rafts

/** Blocks that count as open water (a raft floats through them). */
export const WATERY = /^minecraft:(water|flowing_water|seagrass|tall_seagrass|kelp|kelp_plant|bubble_column)$/;
/** Natural terrain: touching it means the raft is part of the shore, not a raft. */
export const TERRAIN = /^minecraft:(bedrock|stone|deepslate|dirt|coarse_dirt|grass_block|podzol|mycelium|rooted_dirt|mud|clay|sand|red_sand|gravel|sandstone|red_sandstone|granite|diorite|andesite|tuff|calcite|netherrack|end_stone|ice|packed_ice|blue_ice|snow_block|terracotta|.*_terracotta|.*_ore|dirt_path|farmland|suspicious_sand|suspicious_gravel|magma)$/;

/** The six neighbours. */
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const key = (x, y, z) => `${x},${y},${z}`;

/**
 * Finds the raft a block belongs to: every block connected to it (sides, top and bottom),
 * except water and air. get(x, y, z) returns a block id ('minecraft:air' ...).
 * Returns { ok: true, cells: [[x,y,z]...], min, max } or { ok: false, reason }, where reason is
 * 'too_big' (more than MAX_RAFT blocks: probably the shore), 'grounded' (touches terrain or
 * rests on the bottom) or 'not_afloat' (no water under it).
 */
export function scanRaft(get, start, { max = MAX_RAFT } = {}) {
  const seen = new Set([key(...start)]);
  const cells = [];
  const queue = [start];
  while (queue.length) {
    const c = queue.shift();
    const id = get(...c);
    if (TERRAIN.test(id)) return { ok: false, reason: 'grounded' };
    cells.push(c);
    if (cells.length > max) return { ok: false, reason: 'too_big' };
    for (const [dx, dy, dz] of N6) {
      const n = [c[0] + dx, c[1] + dy, c[2] + dz];
      const k = key(...n);
      if (seen.has(k)) continue;
      seen.add(k);
      const nid = get(...n);
      if (nid === 'minecraft:air' || nid === undefined || WATERY.test(nid)) continue;
      queue.push(n);
    }
  }
  const min = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  const max3 = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i])));
  // Afloat: water right under (or around) the lowest block of most columns.
  const bottoms = new Map();
  for (const c of cells) {
    const k = `${c[0]},${c[2]}`;
    if (!bottoms.has(k) || bottoms.get(k)[1] > c[1]) bottoms.set(k, c);
  }
  let wet = 0;
  for (const [x, y, z] of bottoms.values()) if (WATERY.test(get(x, y - 1, z) ?? '')) wet++;
  if (wet === 0) return { ok: false, reason: 'not_afloat' };
  if (wet < bottoms.size / 2) return { ok: false, reason: 'grounded' };
  return { ok: true, cells, min, max: max3 };
}

/**
 * Finds the raft or ship a block belongs to: up to MAX_RAFT blocks, or up to MAX_SHIP when an
 * inboard engine is aboard (isInboard(id) says which blocks are one).
 */
export function scanVessel(get, start, isInboard) {
  const r = scanRaft(get, start, { max: MAX_SHIP });
  if (r.ok && r.cells.length > MAX_RAFT && !r.cells.some((c) => isInboard(get(...c)))) return { ok: false, reason: 'too_big' };
  return r;
}

/** The water level a raft floats at: the highest water block next to or under it. */
export function waterLevel(get, cells) {
  let level = -Infinity;
  const inRaft = new Set(cells.map((c) => key(...c)));
  for (const [x, y, z] of cells) {
    for (const [dx, dy, dz] of [...N6, [0, -1, 0]]) {
      const n = [x + dx, y + dy, z + dz];
      if (inRaft.has(key(...n))) continue;
      const id = get(...n);
      if (id && /^minecraft:(water|flowing_water)$/.test(id)) level = Math.max(level, n[1]);
    }
  }
  return Number.isFinite(level) ? level : Math.min(...cells.map((c) => c[1])) - 1;
}

/** Turns a horizontal offset by quarter turns clockwise (seen from above: east -> south). */
export function rotateQuarter([x, y, z], quarters) {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return [x, y, z];
  if (q === 1) return [-z, y, x];
  if (q === 2) return [-x, y, -z];
  return [z, y, -x];
}

// ------------------------------------------------------------ the inboard engine

/** The inboard engine is built of blocks: 2 wide, 2 high and 6 long. */
export const ENGINE = [2, 2, 6];
/** Quarter turns from north (the way the models' propellers point). */
export const QUARTER = { north: 0, east: 1, south: 2, west: 3 };

/**
 * The blocks of an inboard engine whose part 0,0,0 (aft, bottom, one side) is at `at`, its
 * propeller end pointing `facing`: [{ pos: [x, y, z], part: [px, py, pz] }]. pz counts from
 * the aft end forwards.
 */
export function engineCells([x, y, z], facing) {
  const out = [];
  for (let px = 0; px < ENGINE[0]; px++)
    for (let py = 0; py < ENGINE[1]; py++)
      for (let pz = 0; pz < ENGINE[2]; pz++) {
        const [dx, dy, dz] = rotateQuarter([px, py, pz], QUARTER[facing]);
        out.push({ pos: [x + dx, y + dy, z + dz], part: [px, py, pz] });
      }
  return out;
}

/** Where part 0,0,0 of the engine is, from one of its blocks. */
export function engineOrigin([x, y, z], part, facing) {
  const [dx, dy, dz] = rotateQuarter(part, QUARTER[facing]);
  return [x - dx, y - dy, z - dz];
}

/** Compass direction of a yaw, and back. */
export const DIRS = ['south', 'west', 'north', 'east'];
export const yawOf = (dir) => DIRS.indexOf(dir) * 90;
export const dirOf = (yaw) => DIRS[Math.round((((yaw % 360) + 360) % 360) / 90) % 4];
export const vectorOf = (dir) => ({ south: [0, 0, 1], west: [-1, 0, 0], north: [0, 0, -1], east: [1, 0, 0] }[dir]);
