// Motorboats: a vanilla boat (or bamboo raft) with a motor clamped to its stern. Using a
// motor on a boat turns it into one of these; breaking it gives the boat and the motor back.
// One entity per kind of wood, all sharing one model: the hull, and all four motors, of
// which only the fitted one is shown.
import { Model } from './lib/parts.mjs';
import { mottle, fur, shade } from './lib/texture.mjs';
import { addMotor, motorMaterials, MOTORS } from './motors.mjs';

/** variant: the vanilla Bedrock boat's minecraft:variant. item: the Java/Bedrock boat item. */
export const WOODS = [
  { id: 'oak', name: 'Oak', variant: 0, item: 'oak_boat', planks: '#a2834f' },
  { id: 'spruce', name: 'Spruce', variant: 1, item: 'spruce_boat', planks: '#725232' },
  { id: 'birch', name: 'Birch', variant: 2, item: 'birch_boat', planks: '#c4b17b' },
  { id: 'jungle', name: 'Jungle', variant: 3, item: 'jungle_boat', planks: '#a0734f' },
  { id: 'acacia', name: 'Acacia', variant: 4, item: 'acacia_boat', planks: '#a8592f' },
  { id: 'dark_oak', name: 'Dark Oak', variant: 5, item: 'dark_oak_boat', planks: '#4a3018' },
  { id: 'mangrove', name: 'Mangrove', variant: 6, item: 'mangrove_boat', planks: '#773636' },
  { id: 'bamboo', name: 'Bamboo', variant: 7, item: 'bamboo_raft', planks: '#c9b450', raft: true },
  { id: 'cherry', name: 'Cherry', variant: 8, item: 'cherry_boat', planks: '#e3b3ac' },
  { id: 'pale_oak', name: 'Pale Oak', variant: 9, item: 'pale_oak_boat', planks: '#e4dad6' },
];

/** The model faces -z; the stern (where the motor goes) is at +z. */
export const STERN = 14;
/** Hull bottom; the entity floats with it a little under the surface. */
const HULL = { len: 28, w: 20, wall: 2, depth: 9 };

/** Where riders sit (model pixels): the driver at the tiller, a passenger in the bow. */
export const SEATS = [[0, 5, 8], [0, 5, -5]];

function hull(m, raft) {
  const b = m.bone('hull', 'root', [0, 0, 0]);
  const { len, w, wall, depth } = HULL;
  const z0 = -len / 2;
  if (raft) {
    // Bamboo raft: a flat deck of poles with a low rail.
    for (let x = -w / 2; x < w / 2; x += 4) b.box([x, 0, z0], [4, 3, len], 'planks');
    b.box([-w / 2, 3, z0], [w, 1, 2], 'planks').box([-w / 2, 3, len / 2 - 2], [w, 1, 2], 'planks');
    b.box([-w / 2, 3, z0 + 2], [1, 2, len - 4], 'planks').box([w / 2 - 1, 3, z0 + 2], [1, 2, len - 4], 'planks');
    return;
  }
  b.box([-w / 2 + wall, 0, z0 + wall], [w - 2 * wall, 3, len - 2 * wall], 'planks'); // bottom
  b.box([-w / 2, 1, z0 + wall], [wall, depth - 1, len - 2 * wall], 'planks'); // sides
  b.box([w / 2 - wall, 1, z0 + wall], [wall, depth - 1, len - 2 * wall], 'planks');
  b.box([-w / 2 + wall, 1, z0], [w - 2 * wall, depth - 2, wall], 'planks'); // bow
  b.box([-w / 2, 1, len / 2 - wall], [w, depth - 1, wall], 'planks'); // transom
  b.box([-w / 2 + wall, 4, -3], [w - 2 * wall, 1, 4], 'planks'); // thwart (bench)
  b.box([-w / 2 + wall, 4, 7], [w - 2 * wall, 1, 4], 'planks');
}

export function boatModel(wood) {
  const m = new Model();
  m.bone('root', null, [0, 0, 0]);
  hull(m, wood.raft);
  const transomTop = wood.raft ? 5 : HULL.depth;
  const props = {};
  for (const motor of MOTORS) {
    // The leg reaches down through the water; the clamp sits on the transom.
    const len = motor.look.shaft[1];
    props[motor.id] = addMotor(m, 'root', motor, { z0: STERN + 1, dir: 1, y0: transomTop + 3 - len });
  }
  return { model: m.build(), props };
}

/** Wood planks with board lines along the hull. */
function planks(color) {
  return {
    base: color,
    shading: 0.14,
    layers: [
      (c, { p, face }) => (face === 'top' || face === 'bottom' ? (Math.floor(p[0] + 100) % 4 === 0 ? shade(c, 0.82) : c)
        : Math.floor(p[1] + 100) % 3 === 0 ? shade(c, 0.85) : c),
      mottle(0.06, { scale: 5 }),
      fur(0.05),
    ],
  };
}

export const boatMaterials = (wood) => ({ ...motorMaterials(), planks: planks(wood.planks) });

/** A visual per motor: shown (scale 1) only when it is the one fitted, its propeller spinning. */
export function boatVisuals(props) {
  const out = [];
  MOTORS.forEach((motor, i) => {
    out.push({ bone: motor.id, prop: 'scale', axis: -1, expr: `1 - math.min(1, math.abs($motor - ${i + 1}))` });
    out.push({ bone: props[motor.id], prop: 'rotation', axis: 2, expr: '$spin' });
  });
  // The motor turns with the rudder.
  for (const motor of MOTORS) out.push({ bone: motor.id, prop: 'rotation', axis: 1, expr: '$steer' });
  return out;
}

export const boatName = (wood) => (wood.raft ? `${wood.name} Motor Raft` : `${wood.name} Motorboat`);

