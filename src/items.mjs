// Items: the motors, the propeller and shaft for ships, the ship's wheel (a block) and the
// Outboard Handbook.
import { NS } from './lib/constants.mjs';
import { pixelIcon } from './lib/texture.mjs';
import { bedrockId } from './ids.mjs';
import { MOTORS } from './motors.mjs';
import { BLOCKS } from './blocks.mjs';

const HANDBOOK_ICON = pixelIcon([
  '................',
  '..kkkkkkkkkkk...',
  '..kbbbbbbbbbbk..',
  '..kbbbbwwbbbbk..',
  '..kbbbbwwbbbbk..',
  '..kbbbwwwwbbbk..',
  '..kbbbbwwbbbbk..',
  '..kbbbbwwbbbbk..',
  '..kbwbbwwbbwbk..',
  '..kbbwwwwwwbbk..',
  '..kbbbbbbbbbbk..',
  '..kbwwbwwbwwbk..',
  '..kwwwwwwwwwwk..',
  '..kkkkkkkkkkk...',
  '................',
  '................',
], { k: '#222222', b: '#0b5e7a', w: '#f4ecd8' });

const PROPELLER_ICON = pixelIcon([
  '................',
  '.......pp.......',
  '.......pp.......',
  '.......pp.......',
  '.......pp.......',
  '.......pp.......',
  '.pppppphhpppppp.',
  '.pppppphhpppppp.',
  '.......pp.sssss.',
  '.......pp.......',
  '.......pp.......',
  '.......pp.......',
  '.......pp.......',
  '................',
  '................',
  '................',
], { p: '#c9a44a', h: '#b9c0c6', s: '#7d848a' });

/** Items as { id, name, icon, stack, motor?, place?, block?, recipe? }. */
export function items() {
  const out = MOTORS.map((m) => ({
    id: m.id, name: m.name, icon: pixelIcon(m.icon.rows, m.icon.palette), stack: 1, motor: m.id, recipe: m.recipe,
  }));
  // The propeller is clamped on by the script, like the motors (scripts/place.js).
  out.push({
    id: 'propeller', name: 'Propeller and Shaft', icon: PROPELLER_ICON, stack: 16, place: 'propeller_mounted',
    recipe: { pattern: [' C ', 'CIC', ' C '], key: { C: 'copper_ingot', I: 'iron_block' } },
  });
  for (const b of BLOCKS.filter((b) => b.helm)) {
    out.push({ id: b.id, name: b.name, icon: pixelIcon(b.icon.rows, b.icon.palette), stack: 16, block: true, recipe: b.recipe });
  }
  out.push({ id: 'outboard_handbook', name: 'Outboard Handbook', icon: HANDBOOK_ICON, stack: 1 });
  return out;
}

export function buildItem(item) {
  const components = {
    'minecraft:icon': `${NS}_${item.id}`,
    'minecraft:display_name': { value: `item.${NS}:${item.id}.name` },
    'minecraft:max_stack_size': item.stack ?? 64,
  };
  // Motors are clamped onto a boat or a raft by the script (scripts/place.js).
  if (item.motor || item.place) components[`${NS}:motor_item`] = {};
  return {
    format_version: '1.21.90',
    'minecraft:item': {
      description: { identifier: `${NS}:${item.id}`, menu_category: { category: item.motor || item.place ? 'items' : 'equipment' } },
      components,
    },
  };
}

/** Recipes (Bedrock format; tools/java.mjs converts them). */
export function recipes(itemList) {
  const out = [];
  for (const item of itemList) {
    if (!item.recipe) continue;
    out.push({
      'minecraft:recipe_shaped': {
        description: { identifier: `${NS}:${item.id}` },
        tags: ['crafting_table'],
        pattern: item.recipe.pattern,
        key: Object.fromEntries(Object.entries(item.recipe.key).map(([k, v]) => [k, { item: bedrockId(v) }])),
        result: { item: `${NS}:${item.id}`, count: 1 },
        unlock: [{ item: bedrockId(Object.values(item.recipe.key)[0]) }],
      },
    });
  }
  out.push({
    'minecraft:recipe_shapeless': {
      description: { identifier: `${NS}:outboard_handbook` },
      tags: ['crafting_table'],
      ingredients: [{ item: 'minecraft:book' }, { item: 'minecraft:iron_ingot' }],
      result: { item: `${NS}:outboard_handbook`, count: 1 },
      unlock: [{ item: 'minecraft:book' }],
    },
  });
  return out;
}
