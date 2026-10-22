// Motorboat spec -> Bedrock behavior-pack entity, and the invisible seat a raft's driver
// sits on. The scripts (scripts/boat.js, scripts/raft.js) move both.
import { NS } from './constants.mjs';
import { MOTORS } from '../motors.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Bedrock wants float properties written as decimals (0.0, not 0), which JSON.stringify
 * can't do: floats are tagged here and written out by floatJson().
 */
const float = (n) => `F:${Number(n)}`;
export const floatJson = (data) => JSON.stringify(data, null, 2)
  .replace(/"F:(-?[\d.e-]+)"/g, (_, n) => (n.includes('.') ? n : `${n}.0`)) + '\n';

/** Entity properties that carry the motor's state to the client (for the animations). */
export function properties() {
  const f = (lo, hi) => ({ type: 'float', range: [float(lo), float(hi)], default: float(0), client_sync: true });
  return {
    [`${NS}:motor`]: { type: 'int', range: [0, MOTORS.length], default: 1, client_sync: true },
    [`${NS}:rotor`]: f(0, 1),
    [`${NS}:steer`]: f(-40, 40),
  };
}

/** Seat positions in entity space (blocks, +z forward); the model faces -z. */
export const seatPositions = (seats) => seats.map(([x, y, z]) => [r3(x / 16), r3(y / 16 - 0.1), r3(-z / 16)]);

const no = (cause) => ({ cause, deals_damage: 'no' });

const common = () => ({
  'minecraft:physics': { has_gravity: false },
  'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
  'minecraft:knockback_resistance': { value: 1 },
  'minecraft:breathable': { breathes_air: true, breathes_water: true, suffocate_time: 0, total_supply: 15 },
  'minecraft:fire_immune': {},
  'minecraft:conditional_bandwidth_optimization': {
    default_values: { max_optimized_distance: 0, max_dropped_ticks: 0, use_motion_prediction_hints: true },
  },
});

export function buildBoatEntity(boat) {
  const seats = seatPositions(boat.seats).map((position) => ({
    min_rider_count: 0, max_rider_count: boat.seats.length, position, third_person_camera_radius: 6,
  }));
  return {
    format_version: '1.21.90',
    'minecraft:entity': {
      description: { identifier: `${NS}:${boat.id}`, is_spawnable: false, is_summonable: true, properties: properties() },
      components: {
        'minecraft:type_family': { family: ['motorboat', 'boat', 'inanimate'] },
        'minecraft:collision_box': { width: 1.4, height: 0.6 },
        'minecraft:health': { value: 40, max: 40 },
        ...common(),
        'minecraft:nameable': {},
        'minecraft:persistent': {},
        'minecraft:rideable': {
          seat_count: boat.seats.length, crouching_skip_interact: true, pull_in_entities: false,
          family_types: ['player'], interact_text: `action.interact.${NS}.board`, seats,
        },
        // Players break it with a few hits (scripts/boat.js gives back the boat and the motor).
        'minecraft:damage_sensor': { triggers: [no('all')] },
      },
    },
  };
}

/** The driver of a raft sits on this; it is moved along with the raft's blocks. */
export function buildSeatEntity() {
  return {
    format_version: '1.21.90',
    'minecraft:entity': {
      description: { identifier: `${NS}:raft_seat`, is_spawnable: false, is_summonable: true },
      components: {
        'minecraft:type_family': { family: ['raft_seat', 'inanimate'] },
        'minecraft:collision_box': { width: 0.6, height: 0.3 },
        'minecraft:health': { value: 1, max: 1 },
        ...common(),
        'minecraft:physics': { has_gravity: false, has_collision: false },
        'minecraft:damage_sensor': { triggers: [no('all')] },
        'minecraft:rideable': {
          seat_count: 1, crouching_skip_interact: true, pull_in_entities: false, family_types: ['player'],
          seats: [{ position: [0, 0.1, 0], min_rider_count: 0, max_rider_count: 1, third_person_camera_radius: 8 }],
        },
      },
    },
  };
}
