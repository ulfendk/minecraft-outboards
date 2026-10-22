// Filling up a motor: right-click it (on a boat or a raft) with fuel in your hand.
import { MOTORS } from './data.js';
import { consume, heldItem, percent, sound, tell, NS } from './util.js';

const ALL_FUELS = new Set(MOTORS.flatMap((m) => Object.keys(m.fuels)));

/** Is this item fuel for any motor? (Then right-clicking a motor fills it, rather than boarding.) */
export const isFuel = (typeId) => ALL_FUELS.has(typeId);

/**
 * The player puts the fuel in their hand into the motor's tank. Returns the new fuel
 * level, or undefined when nothing was put in (wrong fuel, or the tank is full).
 */
export function refuel(player, motor, fuel) {
  const item = heldItem(player);
  if (!item || !isFuel(item.typeId)) return undefined;
  const units = motor.fuels[item.typeId];
  if (!units) {
    tell(player, `${NS}.wrong_fuel.${motor.kind}`);
    return undefined;
  }
  if (fuel + 0.5 >= motor.tank) {
    tell(player, `${NS}.tank_full`);
    return undefined;
  }
  const next = Math.min(motor.tank, fuel + units);
  consume(player);
  sound(player.dimension, motor.kind === 'electric' ? 'random.orb' : 'bucket.fill', player.location, 0.7, motor.kind === 'electric' ? 1.6 : 0.8);
  tell(player, `${NS}.refuel`, [percent(next, motor.tank)]);
  return next;
}
