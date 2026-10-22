// Clamping a motor onto a raft: use the motor on the side of a deck block and it is
// mounted in the water there, its propeller pointing away from the raft. (Using it on a boat
// is handled in boat.js.)
import { BlockPermutation, system } from '@minecraft/server';
import { dirOf } from './water.js';
import { consume, NS, sound, tell } from './util.js';

const FACES = { North: [0, 0, -1, 'north'], South: [0, 0, 1, 'south'], East: [1, 0, 0, 'east'], West: [-1, 0, 0, 'west'], Up: [0, 1, 0], Down: [0, -1, 0] };
const OPEN = /^minecraft:(air|water|flowing_water|seagrass|tall_seagrass)$/;
const lastUse = new Map();

export function mountMotor(dim, at, motorId, facing) {
  dim.getBlock(at).setPermutation(BlockPermutation.resolve(`${NS}:${motorId}_mounted`, { [`${NS}:facing`]: facing, [`${NS}:fuel`]: 0 }));
}

export function registerMotorItem(itemComponentRegistry) {
  itemComponentRegistry.registerCustomComponent(`${NS}:motor_item`, {
    onUseOn(e) {
      const player = e.source;
      if (player?.typeId !== 'minecraft:player') return;
      // Holding the button down repeats the event: only the first one counts.
      const now = system.currentTick;
      if (now - (lastUse.get(player.id) ?? -99) < 8) return;
      lastUse.set(player.id, now);
      const motorId = e.itemStack.typeId.split(':')[1];
      const [dx, dy, dz, faceDir] = FACES[e.blockFace] ?? FACES.Up;
      const at = { x: e.block.location.x + dx, y: e.block.location.y + dy, z: e.block.location.z + dz };
      // The propeller points away from the block it is clamped to; on top of a block, the way you look.
      const facing = faceDir ?? dirOf(player.getRotation().y);
      system.run(() => {
        try {
          const target = player.dimension.getBlock(at);
          if (!target || !OPEN.test(target.typeId)) return;
          mountMotor(player.dimension, at, motorId, facing);
        } catch {
          return;
        }
        sound(player.dimension, 'random.anvil_use', at, 0.5, 1.4);
        tell(player, `${NS}.attached`);
        consume(player);
      });
    },
  });
}
