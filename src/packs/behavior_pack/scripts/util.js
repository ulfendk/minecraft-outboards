import { GameMode, world } from '@minecraft/server';
import { BOATS, MOTORS } from './data.js';

export const NS = 'outboards';
export const LOG = '[Outboards]';
export const MOTOR_BY_ID = Object.fromEntries(MOTORS.map((m) => [m.id, m]));
export const BOAT_BY_TYPE = Object.fromEntries(BOATS.map((b) => [`${NS}:${b.id}`, b]));
export const boatOf = (entity) => BOAT_BY_TYPE[entity?.typeId];
/** The motor a mounted-motor block holds ('outboards:small_motor_mounted' -> small motor). */
export const motorOfBlock = (typeId) => MOTOR_BY_ID[typeId?.startsWith(`${NS}:`) ? typeId.slice(NS.length + 1).replace(/_mounted$/, '') : ''];
export const isMotorBlock = (typeId) => !!motorOfBlock(typeId);
export const isHelm = (typeId) => typeId === `${NS}:helm`;

/** Entities of a family (or type) near at least one player (cheap enough to poll). */
export function nearPlayers({ families, type }, radius = 96) {
  const out = new Map();
  for (const player of world.getPlayers()) {
    let found;
    try {
      found = player.dimension.getEntities({ families, type, location: player.location, maxDistance: radius });
    } catch {
      continue;
    }
    for (const e of found) out.set(e.id, e);
  }
  return [...out.values()];
}

export function ridersOf(entity) {
  try {
    return entity.getComponent('minecraft:rideable')?.getRiders() ?? [];
  } catch {
    return [];
  }
}

/** Who drives: the first rider, if it is a player. */
export function driverOf(entity) {
  const r = ridersOf(entity)[0];
  return r?.typeId === 'minecraft:player' ? r : undefined;
}

export function vehicleOf(player) {
  try {
    return player.getComponent('minecraft:riding')?.entityRidingOn;
  } catch {
    return undefined;
  }
}

export function blockAt(dim, x, y, z) {
  try {
    return dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
  } catch {
    return undefined;
  }
}

export const isWater = (b) => b?.typeId === 'minecraft:water' || b?.typeId === 'minecraft:flowing_water';

/**
 * The top of the water a hull at (x, y, z) floats in: the y of the water's surface, or
 * undefined when there is no water there (aground, or in the air).
 */
export function waterSurface(dim, x, y, z) {
  let top;
  for (let by = Math.floor(y + 0.6); by >= Math.floor(y - 1); by--) {
    if (isWater(blockAt(dim, x, by, z))) { top = by; break; }
  }
  if (top === undefined) return undefined;
  for (let i = 0; i < 4 && isWater(blockAt(dim, x, top + 1, z)); i++) top++;
  return top + 1;
}

export function readInput(player) {
  if (!player) return { fwd: 0, side: 0 };
  try {
    const mv = player.inputInfo.getMovementVector();
    return { fwd: Math.abs(mv.y) < 0.3 ? 0 : Math.sign(mv.y), side: Math.abs(mv.x) < 0.3 ? 0 : Math.sign(mv.x) };
  } catch {
    return { fwd: 0, side: 0 };
  }
}

export const heldItem = (player) => {
  try {
    return player.getComponent('minecraft:inventory').container.getItem(player.selectedSlotIndex);
  } catch {
    return undefined;
  }
};

export const isCreative = (player) => {
  try {
    return player.getGameMode() === GameMode.Creative;
  } catch {
    return false;
  }
};

/** Uses up one of the item in the player's hand (not in creative). */
export function consume(player) {
  try {
    if (isCreative(player)) return;
    const inv = player.getComponent('minecraft:inventory').container;
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (!item) return;
    if (item.amount > 1) {
      item.amount -= 1;
      inv.setItem(slot, item);
    } else {
      inv.setItem(slot);
    }
  } catch {}
}

export function sound(dim, id, location, volume = 1, pitch = 1) {
  try {
    dim.playSound(id, location, { volume, pitch });
  } catch {}
}

export const tell = (player, key, args) => {
  try {
    player.onScreenDisplay.setActionBar(args ? { translate: key, with: args } : { translate: key });
  } catch {}
};

export const kmh = (blocksPerTick) => Math.round(Math.abs(blocksPerTick) * 72);
export const percent = (fuel, tank) => `${Math.round((100 * Math.max(0, fuel)) / tank)}%`;
