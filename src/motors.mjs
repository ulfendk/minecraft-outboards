// The motors: four outboards and the inboard ship's engine. What they do, what they burn,
// their recipe, icon and model. An outboard's model is built by addMotor(), once on the stern
// of every motorboat and once as the block that clamps onto a raft; the inboard engine is a
// block that goes inside a ship's hull (src/blocks.mjs) and never on a boat.
import { commonMaterials, metal, paint, gloss, lamp } from './lib/materials.mjs';

/**
 * thrust: push at full throttle (see src/lib/water.mjs: a 2 hp motor on a boat does 25 km/h).
 * maxSpeed: blocks/tick, whatever it is fitted to. burn: tank units per tick at full throttle.
 * fuels: item -> tank units. tank: how many units it holds.
 */
const COMBUSTION = { coal: 3, charcoal: 3, blaze_rod: 6 };
const BATTERY = { redstone: 1, redstone_block: 9 };
const HEAVY = { coal_block: 12, lava_bucket: 12, blaze_rod: 4 };

export const MOTORS = [
  {
    id: 'small_motor', name: 'Outboard Motor (2 hp)', hp: 2, kind: 'combustion',
    thrust: 1, maxSpeed: 0.35, burn: 1 / 1000, tank: 12, fuels: COMBUSTION,
    info: 'A little two-stroke for a rowing boat or a small raft. It sips fuel: a lump of coal lasts two and a half minutes at full throttle.',
    recipe: { pattern: ['IFI', ' I ', ' T '], key: { I: 'iron_ingot', F: 'furnace', T: 'iron_trapdoor' } },
    look: { cowl: '#e9e6dc', stripe: '#c8261b', head: [6, 7, 8], shaft: [2, 13], prop: 4, tiller: 8 },
  },
  {
    id: 'medium_motor', name: 'Outboard Motor (15 hp)', hp: 15, kind: 'combustion',
    thrust: 3, maxSpeed: 0.65, burn: 1 / 600, tank: 12, fuels: COMBUSTION,
    info: 'A proper four-stroke. It makes a boat plane over the water, and it pushes a raft of a few dozen blocks at a good pace.',
    recipe: { pattern: ['IRI', 'IBI', ' T '], key: { I: 'iron_ingot', R: 'redstone', B: 'blast_furnace', T: 'iron_trapdoor' } },
    look: { cowl: '#1f5fa8', stripe: '#e9e6dc', head: [7, 9, 10], shaft: [3, 14], prop: 5, tiller: 9 },
  },
  {
    id: 'large_motor', name: 'Outboard Motor (90 hp)', hp: 90, kind: 'combustion',
    thrust: 8, maxSpeed: 1, burn: 1 / 400, tank: 12, fuels: COMBUSTION,
    info: 'A big V4 for speed boats and big rafts. Very fast on a boat, and the one to fit to a raft of a hundred blocks or more. Thirsty: bring blaze rods.',
    recipe: { pattern: ['NRN', 'NBN', 'PTP'], key: { N: 'iron_block', R: 'redstone_block', B: 'blast_furnace', P: 'piston', T: 'iron_trapdoor' } },
    look: { cowl: '#202224', stripe: '#c9d0d4', head: [9, 12, 12], shaft: [4, 15], prop: 6 },
  },
  {
    id: 'electric_motor', name: 'Electric Trolling Motor', hp: 1, kind: 'electric',
    thrust: 1.5, maxSpeed: 0.3, burn: 1 / 700, tank: 12, fuels: BATTERY, silent: true,
    info: 'A quiet electric motor on a long shaft, charged with redstone. Slow but silent: fish and animals on the shore don’t hear you coming.',
    recipe: { pattern: ['CRC', ' I ', ' T '], key: { C: 'copper_ingot', R: 'redstone_block', I: 'iron_ingot', T: 'iron_trapdoor' } },
    look: { cowl: '#2c2e30', stripe: '#f2b705', head: [4, 5, 6], shaft: [2, 17], prop: 3, tiller: 10, battery: true },
  },
  {
    id: 'inboard_engine', name: 'Inboard Engine (20,000 hp)', hp: 20000, kind: 'inboard', inboard: true,
    thrust: 300, maxSpeed: 0.5, burn: 1 / 300, tank: 12, fuels: HEAVY,
    info: 'A ship’s diesel the size of a block. Place it inside the hull, facing the way the ship should go: it pushes ships of up to 4,096 blocks. It burns coal blocks, lava and blaze rods, and a full tank lasts three minutes at full throttle. Too big for a boat.',
    recipe: { pattern: ['NPN', 'BRB', 'NCN'], key: { N: 'iron_block', P: 'piston', B: 'blast_furnace', R: 'redstone_block', C: 'copper_block' } },
    look: { cowl: '#7a1f1a', stripe: '#c9d0d4' },
  },
];

/** The motors that fit a boat, numbered 1..4 on the motorboat in this order. */
export const OUTBOARDS = MOTORS.filter((m) => !m.inboard);

export const motorById = (id) => MOTORS.find((m) => m.id === id);

/** Motor materials: m_<id>_cowl and m_<id>_stripe, plus the shared metal parts. */
export function motorMaterials() {
  const out = {
    ...commonMaterials(),
    leg: metal('#3a3d40'),
    propeller: metal('#b9c0c6'),
    grip: metal('#202224'),
    battery: gloss('#2b2b2b'),
    terminal: lamp('#c8261b'),
  };
  for (const m of MOTORS) {
    out[`m_${m.id}_cowl`] = gloss(m.look.cowl);
    out[`m_${m.id}_stripe`] = paint(m.look.stripe);
  }
  return out;
}

/**
 * Adds a motor to a model. The clamp bracket sits at z = z0, on the transom; the motor
 * reaches back from there in the direction `dir` (+1: towards +z, -1: towards -z). y0 is the
 * bottom of the leg (just under the propeller). Returns the propeller bone's name, which
 * spins round z.
 */
export function addMotor(model, parent, motor, { z0, dir, y0, name = motor.id, maxTiller = 99, shaft }) {
  const L = motor.look;
  const [hw, hh, hd] = L.head;
  const sw = L.shaft[0];
  const len = shaft ?? L.shaft[1];
  const b = model.bone(name, parent, [0, y0, z0]);
  // A box from t to t + d behind the transom.
  const Z = (t, d) => (dir > 0 ? z0 + t : z0 - t - d);
  const top = y0 + len;
  // Clamp bracket over the transom, with the screw handles on the inside.
  b.box([-sw / 2 - 1, top - 4, Z(-1, 3)], [sw + 2, 5, 3], 'leg');
  b.box([-2, top - 3, Z(-2, 1)], [1, 2, 1], 'grip').box([1, top - 3, Z(-2, 1)], [1, 2, 1], 'grip');
  // Leg (shaft) down into the water, the gearbox and the skeg under the propeller.
  b.box([-sw / 2, y0 + 2, Z(2, sw)], [sw, len - 2, sw], 'leg');
  b.box([-sw / 2, y0 + 1, Z(1, sw + 3)], [sw, 3, sw + 3], 'leg');
  b.box([-0.5, y0, Z(2, sw)], [1, 1, sw], 'leg');
  // Anti-ventilation plate over the propeller.
  b.box([-sw / 2 - 1, y0 + 5, Z(1, sw + 4)], [sw + 2, 1, sw + 4], 'leg');
  // Engine head (cowl) on top, with a coloured band.
  const hz = Math.max(0, Math.round((hd - sw) / 2) - 1);
  const head = top - 1;
  if (L.battery) {
    // Trolling motor: a small round motor down by the propeller, and the battery box up top.
    b.box([-2, y0 + 1, Z(1, sw + 5)], [4, 4, sw + 5], `m_${motor.id}_cowl`);
    b.box([-hw / 2, head, Z(0, hd)], [hw, hh, hd], 'battery');
    b.box([-1.5, head + hh, Z(1, 1)], [1, 1, 1], 'terminal').box([0.5, head + hh, Z(1, 1)], [1, 1, 1], 'grip');
    b.box([-hw / 2, head + 1, Z(0, hd)], [hw, 1, hd], `m_${motor.id}_stripe`, { inflate: 0.05 });
  } else {
    b.box([-hw / 2, head, Z(hz - hd / 2 + sw, hd)], [hw, hh, hd], `m_${motor.id}_cowl`);
    b.box([-hw / 2, head + Math.round(hh * 0.45), Z(hz - hd / 2 + sw, hd)], [hw, 1, hd], `m_${motor.id}_stripe`, { inflate: 0.05 });
    // Cowl top a little narrower.
    b.box([-hw / 2 + 1, head + hh, Z(hz - hd / 2 + sw + 1, hd - 2)], [hw - 2, 1, hd - 2], `m_${motor.id}_cowl`);
  }
  // Tiller handle forward over the transom (the big motor is steered from a console).
  const tiller = Math.min(L.tiller ?? 0, maxTiller);
  if (tiller) {
    b.box([-1, head + 1, Z(-tiller, tiller)], [2, 2, tiller], 'grip');
  }
  // Propeller: a hub and two blades on its own bone.
  const pz = Z(sw + 3, 1);
  const prop = model.bone(`${name}_prop`, name, [0, y0 + 2.5, pz + 0.5]);
  prop.box([-1, y0 + 2.5 - L.prop, pz], [2, 2 * L.prop, 1], 'propeller');
  prop.box([-1, y0 + 1.5, dir > 0 ? pz + 1 : pz - 1], [2, 2, 1], 'chrome');
  return `${name}_prop`;
}

/** 16x16 item icons. */
const ICON = (cowl, stripe) => ({
  rows: [
    '................',
    '.....cccccc.....',
    '....cccccccc....',
    '....ssssssss....',
    '....cccccccc.gg.',
    '.....cccccc.gg..',
    '.......ll.gg....',
    '......kllk......',
    '.......ll.......',
    '.......ll.......',
    '.......ll.......',
    '......llll......',
    '.....wlllll.....',
    '.....wwllll.....',
    '......w.l.......',
    '................',
  ],
  palette: { c: cowl, s: stripe, l: '#3a3d40', k: '#202224', g: '#202224', w: '#b9c0c6' },
});

MOTORS[0].icon = ICON('#e9e6dc', '#c8261b');
MOTORS[1].icon = ICON('#1f5fa8', '#e9e6dc');
MOTORS[2].icon = {
  ...ICON('#202224', '#c9d0d4'),
  rows: [
    '....cccccccc....',
    '...cccccccccc...',
    '...cccccccccc...',
    '...ssssssssss...',
    '...cccccccccc...',
    '....cccccccc....',
    '......llll......',
    '.....kllllk.....',
    '......llll......',
    '......llll......',
    '......llll......',
    '.....llllll.....',
    '....wwllllll....',
    '....wwwlllll....',
    '.....ww.ll......',
    '................',
  ],
};
MOTORS[3].icon = {
  rows: [
    '................',
    '.....bbbbbb.....',
    '.....brbbkb.....',
    '.....bbbbbb.....',
    '.....yyyyyy.gg..',
    '.......ll.gg....',
    '......kllk......',
    '.......ll.......',
    '.......ll.......',
    '.......ll.......',
    '.......ll.......',
    '.......ll.......',
    '....wcccccc.....',
    '....wwcccc......',
    '.....w..........',
    '................',
  ],
  palette: { b: '#2b2b2b', r: '#c8261b', k: '#888888', y: '#f2b705', l: '#3a3d40', g: '#202224', c: '#2c2e30', w: '#b9c0c6' },
};
MOTORS[4].icon = {
  rows: [
    '..........kk....',
    '..........kk....',
    '..........kk....',
    '...ssssssskk....',
    '..shhshhshhhs...',
    '..cccccccccccc..',
    '..cssssssssssc..',
    '..cccccccccccc..',
    'ffcccccccccccc..',
    'ffcccccccccccc..',
    'ffcccccccccccc..',
    '..cccccccccccc..',
    '..llllllllllll..',
    '.l............l.',
    '................',
    '................',
  ],
  palette: { c: '#7a1f1a', s: '#c9d0d4', h: '#3a3d40', k: '#202224', f: '#b9c0c6', l: '#3a3d40' },
};

/** What the scripts and the Java mod need to know about each motor. */
export const motorRecord = (m) => ({
  id: m.id, hp: m.hp, kind: m.kind, thrust: m.thrust, maxSpeed: m.maxSpeed, burn: m.burn, tank: m.tank,
  silent: !!m.silent, inboard: !!m.inboard,
  fuels: Object.fromEntries(Object.entries(m.fuels).map(([k, v]) => [`minecraft:${k}`, v])),
});
