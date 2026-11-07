// Blocks: a mounted motor of every size (what a motor item becomes when you clamp it onto
// a raft), the inboard engine (placed inside a ship's hull) and the ship's wheel. Each is modelled once; the build writes it as Bedrock block
// geometry and as a Java block model (javaBlockModel()).
import { NS } from './lib/constants.mjs';
import { buildGeometry } from './lib/model.mjs';
import { Model } from './lib/parts.mjs';
import { paintTexture } from './lib/texture.mjs';
import { commonMaterials, metal, paint } from './lib/materials.mjs';
import { addMotor, motorMaterials, MOTORS } from './motors.mjs';
import { ENGINE } from './lib/water.mjs';

/** Facing = where the propeller points (away from the raft); the raft is pushed the other way. */
export const FACINGS = ['north', 'east', 'south', 'west'];
/** Bedrock block rotation for each facing (the model's propeller points north). */
const ROTATION = { north: 0, west: 90, south: 180, east: -90 };

/** Bedrock block states hold at most 16 values: 0..12 covers a full tank. */
export const FUEL_MAX = 12;

/**
 * Mounted motor in block space: x and z from -8 to 8, y from 0 (the cell sits in the water
 * beside the raft's deck). The clamp hooks over the deck block to the south (+z); the
 * propeller points north.
 */
function motorBlockModel(motor) {
  const m = new Model();
  m.bone('root', null, [0, 0, 0]);
  // The clamp sits on the deck's edge (y 17); the propeller must stay above the bottom of the
  // cell (Bedrock doesn't draw block geometry below it), so long legs are shortened.
  const y0 = Math.max(17 - motor.look.shaft[1], Math.ceil(motor.look.prop - 2.5));
  addMotor(m, 'root', motor, { z0: 8, dir: -1, y0, shaft: 17 - y0, name: 'motor', maxTiller: 6 });
  return m.build();
}

/**
 * The inboard engine, whole: a V-engine 2 blocks wide, 2 high and 6 long (x -16..16, y 0..32,
 * z -48..48 pixels), on two bearers. The gearbox and the shaft coupling are at the aft end
 * (north, -z, towards the propeller), the turbochargers and exhaust stacks at the front. It is
 * symmetric left to right, so the blocks it is cut into line up on both editions.
 */
function inboardModel(motor) {
  const m = new Model();
  const b = m.bone('root', null, [0, 0, 0]);
  const cowl = `m_${motor.id}_cowl`, stripe = `m_${motor.id}_stripe`;
  for (const x of [-14, 10]) b.box([x, 0, -46], [4, 3, 92], 'leg'); // bearers
  b.box([-12, 3, -36], [24, 17, 76], cowl); // crankcase and block
  b.box([-12, 12, -36], [24, 1, 76], stripe, { inflate: 0.05 });
  for (const x of [-13, 4]) {
    b.box([x, 20, -32], [9, 6, 68], 'leg'); // cylinder banks
    for (let z = -30; z < 34; z += 8) b.box([x + 1, 26, z], [7, 2, 6], 'chrome'); // rocker covers
  }
  b.box([-3, 20, -30], [6, 4, 64], 'chrome'); // intake manifold
  b.box([-10, 3, -44], [20, 18, 8], 'leg'); // flywheel housing
  b.box([-6, 3, -48], [12, 10, 4], 'leg'); // reduction gear
  b.box([-2, 5, -48], [4, 4, 1], 'propeller', { inflate: 0.1 }); // shaft coupling
  b.box([-11, 3, 40], [22, 15, 6], 'grip'); // coolers at the front
  for (const x of [-10, 3]) b.box([x, 20, 38], [7, 6, 7], 'chrome'); // turbochargers
  for (const x of [-9, 6]) b.box([x, 26, 39], [3, 6, 3], 'grip'); // exhaust stacks
  return m.build();
}

/**
 * One block of the engine: the cubes of the whole model inside the block whose corner (in the
 * model's pixels) is x0, y0, z0, moved into block space.
 */
function sliceModel(model, [x0, y0, z0]) {
  const m = new Model();
  const b = m.bone('root', null, [0, 0, 0]);
  const at = [x0, y0, z0];
  for (const bone of model.bones) {
    for (const c of bone.cubes ?? []) {
      const lo = c.origin.map((o, i) => Math.max(o, at[i]));
      const hi = c.origin.map((o, i) => Math.min(o + c.size[i], at[i] + 16));
      if (hi.some((h, i) => h <= lo[i])) continue;
      b.box([lo[0] - x0 - 8, lo[1] - y0, lo[2] - z0 - 8], hi.map((h, i) => h - lo[i]), c.mat, c.inflate ? { inflate: c.inflate } : {});
    }
  }
  return m.build();
}

/**
 * The engine's blocks, by part (px, py, pz: across, up, from the aft end forwards). Bedrock
 * draws block geometry mirrored left to right, so part px shows the other half of the model.
 */
function inboardSlices(motor, full) {
  const out = [];
  for (let px = 0; px < ENGINE[0]; px++)
    for (let py = 0; py < ENGINE[1]; py++)
      for (let pz = 0; pz < ENGINE[2]; pz++) {
        const cx = ENGINE[0] - 1 - px;
        out.push({ part: [px, py, pz], id: `${motor.id}_mounted_${px}_${py}_${pz}`, model: sliceModel(full, [cx * 16 - 16, py * 16, pz * 16 - 48]) });
      }
  return out;
}

/**
 * Propeller and shaft, clamped on below the stern: the stern tube comes out of the hull to the
 * south (+z), the shaft runs north to a bronze four-bladed propeller, with the rudder behind it.
 */
function propellerModel() {
  const m = new Model();
  const b = m.bone('root', null, [0, 0, 0]);
  b.box([-3, 11, 2], [6, 6, 6], 'leg'); // stern tube
  b.box([-1, 13, -8], [2, 2, 10], 'chrome'); // shaft
  b.box([-2, 12, -10], [4, 4, 3], 'bronze'); // hub
  b.box([-1, 13, -11], [2, 2, 1], 'bronze');
  // Blades, broad at the hub and narrower at the tips.
  b.box([-2, 16, -9], [4, 6, 1], 'bronze').box([-1, 22, -9], [2, 6, 1], 'bronze');
  b.box([-2, 6, -9], [4, 6, 1], 'bronze').box([-1, 1, -9], [2, 5, 1], 'bronze');
  b.box([2, 12, -9], [6, 4, 1], 'bronze').box([8, 13, -9], [6, 2, 1], 'bronze');
  b.box([-8, 12, -9], [6, 4, 1], 'bronze').box([-14, 13, -9], [6, 2, 1], 'bronze');
  b.box([-1, 3, -15], [2, 24, 4], 'leg'); // rudder
  return m.build();
}

/** Ship's wheel on a pedestal, facing north: the driver stands behind it (south). */
function helmModel() {
  const m = new Model();
  const b = m.bone('root', null, [0, 0, 0]);
  b.box([-3, 0, -1], [6, 2, 6], 'post'); // foot
  b.box([-1.5, 2, 0.5], [3, 11, 3], 'post'); // pedestal
  b.box([-1, 13, -1], [2, 2, 2], 'brass'); // hub
  const w = m.bone('wheel', 'root', [0, 14, -1.5]);
  // The rim: a ring of 1-pixel boxes, 12 across, and eight spokes reaching past it as handles.
  w.box([-5, 19, -2], [10, 1, 1], 'wood').box([-5, 8, -2], [10, 1, 1], 'wood');
  w.box([-6, 9, -2], [1, 10, 1], 'wood').box([5, 9, -2], [1, 10, 1], 'wood');
  w.box([-0.5, 7, -2], [1, 14, 1], 'wood').box([-7, 13.5, -2], [14, 1, 1], 'wood');
  w.box([-1, 21, -2], [2, 1, 1], 'wood').box([-1, 5, -2], [2, 1, 1], 'wood');
  w.box([-8, 13.5, -2], [1, 1, 1], 'wood').box([7, 13.5, -2], [1, 1, 1], 'wood');
  return m.build();
}

const helmMaterials = () => ({
  ...commonMaterials(),
  post: paint('#6b4a2b'),
  wood: paint('#8a5a2e'),
  brass: metal('#c9a44a'),
});

export const BLOCKS = [
  ...MOTORS.map((motor) => ({
    id: `${motor.id}_mounted`, motor: motor.id, name: motor.name, materials: motorMaterials(), loot: motor.id, sound: 'metal',
    ...(motor.inboard
      ? (() => {
        const model = inboardModel(motor);
        // No loot: breaking any block of it takes the whole engine away and gives back one item.
        return { model, slices: inboardSlices(motor, model), box: { origin: [-8, 0, -8], size: [16, 16, 16] }, inboard: true, loot: undefined };
      })()
      : { model: motorBlockModel(motor), box: { origin: [-4, 0, -2], size: [8, 16, 10] } }),
  })),
  {
    id: 'propeller_mounted', name: 'Propeller and Shaft', model: propellerModel(), materials: { ...motorMaterials(), bronze: metal('#c9a44a') }, propeller: true,
    box: { origin: [-7, 0, -8], size: [14, 16, 16] }, loot: 'propeller', sound: 'metal',
  },
  {
    id: 'helm', name: "Ship's Wheel", model: helmModel(), materials: helmMaterials(), helm: true,
    box: { origin: [-6, 0, -3], size: [12, 16, 8] }, loot: 'helm', sound: 'wood',
    recipe: { pattern: [' S ', 'SIS', ' S '], key: { S: 'stick', I: 'iron_ingot' } },
    icon: {
      rows: [
        '.......ww.......',
        '.....wwwwww.....',
        '....w..ww..w....',
        '...w...ww...w...',
        '..w.w..ww..w.w..',
        '..w..w.ww.w..w..',
        'wwwwwwwbbwwwwwww',
        '..w..w.ww.w..w..',
        '..w.w..ww..w.w..',
        '...w...pp...w...',
        '....w..pp..w....',
        '.....wwppww.....',
        '.......pp.......',
        '.......pp.......',
        '.....pppppp.....',
        '................',
      ],
      palette: { w: '#8a5a2e', b: '#c9a44a', p: '#6b4a2b' },
    },
  },
];

/** Geometry and texture of a block (the texture is square: Java block textures must be). */
export function blockArt(block) {
  const geo = buildGeometry(`geometry.${NS}.${block.id}`, block.model);
  const size = Math.max(geo.width, geo.height);
  geo.width = geo.height = size;
  const d = geo.geometry['minecraft:geometry'][0].description;
  d.texture_width = d.texture_height = size;
  delete d.visible_bounds_width;
  delete d.visible_bounds_height;
  delete d.visible_bounds_offset;
  return { geo, texture: paintTexture(geo, block.materials) };
}

const facingCondition = (state, value) => `q.block_state('${state}') == '${value}'`;

/** Bedrock block definition. Motors keep their fuel and facing in block states. */
export function bedrockBlock(block) {
  const faced = block.motor || block.propeller;
  const states = block.motor
    ? { [`${NS}:facing`]: FACINGS, [`${NS}:fuel`]: { values: { min: 0, max: FUEL_MAX } } }
    : block.propeller ? { [`${NS}:facing`]: FACINGS } : undefined;
  // The engine's blocks know which part of it they are.
  if (block.slices) for (const [i, k] of ['px', 'py', 'pz'].entries()) states[`${NS}:${k}`] = { values: { min: 0, max: ENGINE[i] - 1 } };
  const facingState = faced ? `${NS}:facing` : 'minecraft:cardinal_direction';
  const look = (id) => ({
    'minecraft:geometry': `geometry.${NS}.${id}`,
    'minecraft:material_instances': { '*': { texture: `${NS}_${id}`, render_method: 'alpha_test', ambient_occlusion: false, face_dimming: true } },
  });
  const components = {
    ...look(block.slices ? block.slices[0].id : block.id),
    'minecraft:collision_box': block.box,
    'minecraft:selection_box': block.box,
    'minecraft:light_dampening': 0,
    'minecraft:destructible_by_mining': { seconds_to_destroy: block.inboard ? 1.5 : 0.6 },
    'minecraft:destructible_by_explosion': { explosion_resistance: 3 },
    'minecraft:loot': `loot_tables/blocks/${block.id}.json`,
    'minecraft:map_color': '#5a5d60',
    'minecraft:display_name': `tile.${NS}:${block.id}.name`,
  };
  // Right-click: refuel it, or set off on the raft (scripts/raft.js).
  if (block.motor || block.helm) components[`${NS}:${block.motor ? 'motor' : 'helm'}`] = {};
  const parts = (block.slices ?? []).map((sl) => ({
    condition: sl.part.map((v, i) => `q.block_state('${NS}:${['px', 'py', 'pz'][i]}') == ${v}`).join(' && '),
    components: look(sl.id),
  }));
  return {
    format_version: '1.21.90',
    'minecraft:block': {
      description: {
        identifier: `${NS}:${block.id}`,
        menu_category: { category: faced ? 'none' : 'items', is_hidden_in_commands: false },
        ...(states ? { states } : {}),
        ...(block.helm ? { traits: { 'minecraft:placement_direction': { enabled_states: ['minecraft:cardinal_direction'] } } } : {}),
      },
      components,
      permutations: [
        ...FACINGS.map((f) => ({
          condition: facingCondition(facingState, f),
          components: { 'minecraft:transformation': { rotation: [0, ROTATION[f], 0] } },
        })),
        ...parts,
      ],
    },
  };
}

/**
 * Java block model from the Bedrock geometry: one element per cube, with the box-UV
 * rectangles as face UVs (in sixteenths of the square texture). Bedrock geometry has x
 * mirrored against the world, so x is flipped.
 */
export function javaBlockModel(block, geo) {
  const s = 16 / geo.width;
  const elements = [];
  const bones = geo.geometry['minecraft:geometry'][0].bones;
  for (const bone of bones) {
    for (const c of bone.cubes ?? []) {
      const [w, h, d] = c.size;
      if (!w || !h || !d) continue;
      const inf = c.inflate ?? 0;
      const [x, y, z] = c.origin;
      const from = [8 - (x + w) - inf, y - inf, z + 8 - inf];
      const to = [8 - x + inf, y + h + inf, z + 8 + d + inf];
      const [u, v] = c.uv;
      const rect = (u0, v0, uw, vh) => [u0 * s, v0 * s, (u0 + uw) * s, (v0 + vh) * s].map((n) => Math.round(n * 1000) / 1000);
      const tex = '#t';
      elements.push({
        from: from.map((n) => Math.round(n * 1000) / 1000),
        to: to.map((n) => Math.round(n * 1000) / 1000),
        faces: {
          north: { uv: rect(u + d, v + d, w, h), texture: tex },
          south: { uv: rect(u + 2 * d + w, v + d, w, h), texture: tex },
          // Flipped x: the cube's Bedrock "left" side (+x) is the world's west.
          west: { uv: rect(u + d + w, v + d, d, h), texture: tex },
          east: { uv: rect(u, v + d, d, h), texture: tex },
          up: { uv: rect(u + d, v, w, d), texture: tex },
          down: { uv: rect(u + d + w, v, w, d), texture: tex },
        },
      });
    }
  }
  return {
    textures: { t: `${NS}:block/${block.id}`, particle: `${NS}:block/${block.id}` },
    elements,
    display: {
      gui: { rotation: [30, 225, 0], translation: [0, -2, 0], scale: [0.55, 0.55, 0.55] },
      ground: { translation: [0, 2, 0], scale: [0.4, 0.4, 0.4] },
      fixed: { scale: [0.6, 0.6, 0.6] },
      thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
      firstperson_righthand: { rotation: [0, 45, 0], scale: [0.4, 0.4, 0.4] },
    },
  };
}
