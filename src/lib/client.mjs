// Boat spec -> Bedrock resource-pack client entity and render controller.
import { NS } from './constants.mjs';

/**
 * Smooths the synced motor state on the client: the propeller spins up and down with the
 * throttle, and the motor swings round as the boat is steered.
 */
function preAnimation() {
  const p = (name) => `q.property('${NS}:${name}')`;
  return [
    `v.rotor = (v.rotor ?? 0) + (${p('rotor')} - (v.rotor ?? 0)) * 0.1;`,
    `v.steer = (v.steer ?? 0) + (${p('steer')} - (v.steer ?? 0)) * 0.2;`,
    'v.spin = math.mod((v.spin ?? 0) + q.delta_time * 2160 * v.rotor, 360);',
  ];
}

export function buildClientEntity(m, { simple = false } = {}) {
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${NS}:${m.id}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: `textures/entity/${NS}/${m.id}` },
        geometry: { default: `geometry.${NS}.${m.id}` },
        animations: { move: `animation.${NS}.${m.id}.move` },
        scripts: {
          ...(simple ? {} : { pre_animation: preAnimation() }),
          animate: ['move'],
          ...(m.scale !== 1 ? { scale: String(m.scale) } : {}),
        },
        render_controllers: [`controller.render.${NS}.${m.id}`],
        enable_attachables: false,
      },
    },
  };
}

export function buildRenderController(m) {
  return {
    format_version: '1.8.0',
    render_controllers: {
      [`controller.render.${NS}.${m.id}`]: {
        geometry: 'Geometry.default',
        materials: [{ '*': 'Material.default' }],
        textures: ['Texture.default'],
      },
    },
  };
}
