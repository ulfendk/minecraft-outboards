import { system, world } from '@minecraft/server';
import { forgetBoat, setupBoats } from './boat.js';
import { setupManual } from './manual.js';
import { registerMotorItem, setupPlacing } from './place.js';
import { registerRaftBlocks, setupRafts } from './raft.js';
import { selfTest } from './selftest.js';
import { boatOf, LOG, NS } from './util.js';

system.beforeEvents.startup.subscribe(({ blockComponentRegistry, itemComponentRegistry }) => {
  registerMotorItem(itemComponentRegistry);
  registerRaftBlocks(blockComponentRegistry);
});

world.afterEvents.worldLoad.subscribe(() => {
  setupBoats();
  setupRafts();
  setupManual();
  setupPlacing();
  console.log(`${LOG} loaded`);
});

world.afterEvents.entityRemove.subscribe(({ removedEntityId, typeId }) => {
  if (boatOf({ typeId })) forgetBoat(removedEntityId);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === `${NS}:selftest`) selfTest(event.message);
});
