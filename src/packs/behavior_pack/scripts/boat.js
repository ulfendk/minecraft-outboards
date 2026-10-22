// Motorboats: a vanilla boat with a motor clamped on. Using a motor on a boat swaps the boat
// for one of these; every tick the script reads the driver's input, runs the shared water
// model (water.js, the same as the Java edition's Water.java) and moves the boat.
import { ItemStack, system, world } from '@minecraft/server';
import { BOATS, MOTORS } from './data.js';
import { BOAT_MASS, initial, step, vessel } from './water.js';
import { isFuel, refuel } from './fuel.js';
import {
  blockAt, boatOf, driverOf, isCreative, kmh, LOG, MOTOR_BY_ID, nearPlayers, NS, percent, readInput,
  ridersOf, sound, tell, waterSurface, consume,
} from './util.js';

const STATE = `${NS}:state`;
const FUEL = `${NS}:fuel`;
/** boat id -> { s, vy, fuel, savedAt, props, tutorial, hits, hitAt, warned } */
const boats = new Map();
let tracked = [];
/** Boats driven without a player (the selftest): id -> input. */
const testInput = new Map();

export function motorOf(e) {
  let i = 1;
  try { i = e.getProperty(`${NS}:motor`) ?? 1; } catch {}
  return MOTORS[Math.max(0, Math.min(MOTORS.length - 1, i - 1))];
}

function stateOf(e) {
  let b = boats.get(e.id);
  if (b) return b;
  let s, fuel = 0;
  try {
    const saved = e.getDynamicProperty(STATE);
    if (typeof saved === 'string') s = { ...initial(e.getRotation().y), ...JSON.parse(saved) };
    fuel = Number(e.getDynamicProperty(FUEL) ?? 0) || 0;
  } catch {}
  b = { s: s ?? initial(e.getRotation().y), vy: 0, fuel, savedAt: 0, props: {}, hits: 0, hitAt: -99 };
  boats.set(e.id, b);
  return b;
}

export const boatState = (e) => boats.get(e.id);
export const forgetBoat = (id) => boats.delete(id);

function setProp(e, b, name, value, eps) {
  const old = b.props[name];
  if (old !== undefined && Math.abs(old - value) < eps) return;
  b.props[name] = value;
  try { e.setProperty(`${NS}:${name}`, value); } catch {}
}

function save(e, b) {
  try {
    e.setDynamicProperty(STATE, JSON.stringify({ yaw: b.s.yaw }));
    e.setDynamicProperty(FUEL, b.fuel);
  } catch {}
}

function hud(driver, motor, b) {
  const s = b.s;
  const throttle = s.throttle < -0.01 ? [{ translate: `${NS}.hud.reverse` }] : [{ text: `${Math.round(s.throttle * 100)}%` }];
  try {
    driver.onScreenDisplay.setActionBar({
      translate: motor.kind === 'electric' ? `${NS}.hud.electric` : `${NS}.hud`,
      with: { rawtext: [{ text: String(kmh(s.speed)) }, { rawtext: throttle }, { text: percent(b.fuel, motor.tank) }] },
    });
  } catch {}
}

function drive(e, now) {
  const spec = boatOf(e);
  if (!spec) return;
  const b = stateOf(e);
  const motor = motorOf(e);
  const driver = driverOf(e);
  const { x, y, z } = e.location;
  const surface = waterSurface(e.dimension, x, y, z);
  const afloat = surface !== undefined && y < surface + 0.3;
  const input = driver ? readInput(driver) : testInput.get(e.id) ?? { fwd: 0, side: 0 };

  // Floating at rest with nobody aboard: leave it be.
  const target = surface !== undefined ? surface - 0.3 : undefined;
  if (!driver && !testInput.has(e.id) && b.s.speed === 0 && b.s.throttle === 0 && target !== undefined && Math.abs(target - y) < 0.03) {
    if (!b.asleep) {
      b.asleep = true;
      try { e.clearVelocity(); } catch {}
      setProp(e, b, 'rotor', 0, 0.01);
      setProp(e, b, 'steer', 0, 1);
    }
    return;
  }
  b.asleep = false;

  const hadFuel = b.fuel > 0;
  const s = step(b.s, input, vessel([motor], BOAT_MASS), { afloat, fuel: hadFuel });
  b.s = s;
  b.fuel = Math.max(0, b.fuel - s.burn * motor.burn);
  if (hadFuel && b.fuel <= 0 && driver) {
    tell(driver, `${NS}.empty`);
    b.hudAfter = now + 60;
  }

  // Up and down: held at the surface, a little under it; falls when out of the water.
  if (target !== undefined) b.vy = Math.max(-0.2, Math.min(0.2, (target - y) * 0.3));
  else {
    const below = blockAt(e.dimension, x, y - 0.05, z);
    b.vy = below && !below.isAir && !below.isLiquid ? 0 : Math.max(-0.8, b.vy - 0.04);
  }
  try {
    e.clearVelocity();
    e.applyImpulse({ x: s.vx, y: b.vy, z: s.vz });
    e.setRotation({ x: 0, y: s.yaw });
  } catch {}

  const running = b.fuel > 0 && Math.abs(s.throttle) > 0.01;
  setProp(e, b, 'rotor', running ? Math.min(1, 0.25 + Math.abs(s.throttle)) : 0, 0.03);
  setProp(e, b, 'steer', input.side * 22, 1);
  if (running && !motor.silent && now % 6 === 0) sound(e.dimension, 'mob.bee.loop', e.location, 0.25 + 0.4 * Math.abs(s.throttle), 0.5 + 0.6 * Math.abs(s.throttle));

  if (driver && now % 5 === 0 && !(b.hudAfter > now)) hud(driver, motor, b);
  if (driver && !b.tutorial) {
    b.tutorial = true;
    try { driver.sendMessage({ rawtext: [{ text: '§e' }, { translate: `entity.${e.typeId}.name` }, { text: ':§r ' }, { translate: `${NS}.controls.boat` }] }); } catch {}
  }
  if (!driver) b.tutorial = false;
  if (now - b.savedAt > 40) {
    b.savedAt = now;
    save(e, b);
  }
}

function tick() {
  const now = system.currentTick;
  if (now % 20 === 0) {
    const all = new Map(nearPlayers({ families: ['motorboat'] }, 128).map((e) => [e.id, e]));
    for (const e of tracked) if (e.isValid && testInput.has(e.id)) all.set(e.id, e);
    tracked = [...all.values()];
  }
  for (const e of tracked) {
    if (!e.isValid) continue;
    try {
      drive(e, now);
    } catch (err) {
      if (now % 200 === 0) console.warn(`${LOG} ${err}`);
    }
  }
}

/** Drives a boat with a fixed input although nobody is in it (the selftest). */
export function testDrive(e, input) {
  testInput.set(e.id, input);
  if (!tracked.some((t) => t.id === e.id)) tracked.push(e);
}

// ------------------------------------------------------------ fitting and taking off the motor

/** Swaps a vanilla boat for a motorboat of the same wood, with the motor in the player's hand. */
export function fitMotor(boat, motorId, player) {
  let variant = 0;
  try { variant = boat.getComponent('minecraft:variant')?.value ?? 0; } catch {}
  const spec = BOATS.find((b) => b.variant === variant) ?? BOATS[0];
  const riders = ridersOf(boat);
  const loc = boat.location;
  const yaw = boat.getRotation().y;
  const dim = boat.dimension;
  for (const r of riders) try { boat.getComponent('minecraft:rideable').ejectRider(r); } catch {}
  boat.remove();
  const e = dim.spawnEntity(`${NS}:${spec.id}`, loc);
  e.setRotation({ x: 0, y: yaw });
  e.setProperty(`${NS}:motor`, MOTORS.findIndex((m) => m.id === motorId) + 1);
  e.setDynamicProperty(FUEL, 0);
  e.setDynamicProperty(STATE, JSON.stringify({ yaw }));
  const rideable = e.getComponent('minecraft:rideable');
  for (const r of riders) try { rideable.addRider(r); } catch {}
  if (!tracked.some((t) => t.id === e.id)) tracked.push(e);
  sound(dim, 'random.anvil_use', loc, 0.5, 1.4);
  if (player) tell(player, `${NS}.attached`);
  return e;
}

/** Breaks a motorboat into its boat and its motor. */
export function breakBoat(e) {
  const spec = boatOf(e);
  if (!spec) return;
  const motor = motorOf(e);
  const loc = e.location;
  const dim = e.dimension;
  for (const r of ridersOf(e)) try { e.getComponent('minecraft:rideable').ejectRider(r); } catch {}
  forgetBoat(e.id);
  e.remove();
  dim.spawnItem(new ItemStack(`minecraft:${spec.item}`, 1), { x: loc.x, y: loc.y + 0.5, z: loc.z });
  dim.spawnItem(new ItemStack(`${NS}:${motor.id}`, 1), { x: loc.x, y: loc.y + 0.5, z: loc.z });
  sound(dim, 'dig.wood', loc, 1, 0.8);
}

export function setupBoats() {
  system.runInterval(tick, 1);

  world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
    const { player, target, itemStack } = ev;
    const spec = boatOf(target);
    if (spec) {
      if (itemStack && isFuel(itemStack.typeId)) {
        ev.cancel = true;
        system.run(() => {
          if (!target.isValid) return;
          const b = stateOf(target);
          const next = refuel(player, motorOf(target), b.fuel);
          if (next !== undefined) {
            b.fuel = next;
            save(target, b);
          }
        });
      } else if (!itemStack && player.isSneaking) {
        ev.cancel = true;
        system.run(() => {
          if (!target.isValid) return;
          breakBoat(target);
          tell(player, `${NS}.detached`);
        });
      }
      if (!ev.cancel && !tracked.some((t) => t.id === target.id)) tracked.push(target);
      return;
    }
    const motor = itemStack && MOTOR_BY_ID[itemStack.typeId.replace(`${NS}:`, '')];
    if (!motor || !itemStack.typeId.startsWith(`${NS}:`)) return;
    if (target.typeId === 'minecraft:boat') {
      ev.cancel = true;
      system.run(() => {
        if (!target.isValid) return;
        fitMotor(target, motor.id, player);
        consume(player);
      });
    } else if (target.typeId === 'minecraft:chest_boat') {
      ev.cancel = true;
      system.run(() => tell(player, `${NS}.chest_boat`));
    }
  });

  // A few hits break it (one in creative), and give back the boat and the motor.
  world.afterEvents.entityHitEntity.subscribe(({ damagingEntity, hitEntity }) => {
    if (damagingEntity?.typeId !== 'minecraft:player' || !boatOf(hitEntity)) return;
    if (ridersOf(hitEntity).some((r) => r.id === damagingEntity.id)) return;
    const b = stateOf(hitEntity);
    const now = system.currentTick;
    b.hits = now - b.hitAt > 60 ? 1 : b.hits + 1;
    b.hitAt = now;
    sound(hitEntity.dimension, 'hit.wood', hitEntity.location, 1, 1);
    if (isCreative(damagingEntity) || b.hits >= 3) breakBoat(hitEntity);
  });
}

/** For the selftest. */
export const fuelOf = (e) => stateOf(e).fuel;
export function setFuel(e, fuel) {
  stateOf(e).fuel = fuel;
}
