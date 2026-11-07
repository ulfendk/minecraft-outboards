// Clamping a motor onto a raft: use the motor on the side of a deck block and it is
// mounted in the water there, its propeller pointing away from the raft. A propeller and
// shaft goes on the same way, below a ship's stern. The inboard engine is built of 2 x 2 x 6
// blocks in a ship's hull, reaching ahead of the player, its propeller end at the back; break
// any of its blocks and the whole engine comes away. (Using a motor on a boat is handled in
// boat.js.)
import { BlockPermutation, ItemStack, system, world } from '@minecraft/server';
import { dirOf, DIRS, engineCells, engineOrigin } from './water.js';
import { consume, ENGINE_ID, isCreative, MOTOR_BY_ID, NS, sound, tell } from './util.js';

const FACES = { North: [0, 0, -1, 'north'], South: [0, 0, 1, 'south'], East: [1, 0, 0, 'east'], West: [-1, 0, 0, 'west'], Up: [0, 1, 0], Down: [0, -1, 0] };
const OPEN = /^minecraft:(air|water|flowing_water|seagrass|tall_seagrass)$/;
const BEHIND = (dir) => DIRS[(DIRS.indexOf(dir) + 2) % 4];
const PART = ['px', 'py', 'pz'].map((k) => `${NS}:${k}`);
const lastUse = new Map();

export function mountMotor(dim, at, motorId, facing) {
  dim.getBlock(at).setPermutation(BlockPermutation.resolve(`${NS}:${motorId}_mounted`, { [`${NS}:facing`]: facing, [`${NS}:fuel`]: 0 }));
}

export function mountPropeller(dim, at, facing) {
  dim.getBlock(at).setPermutation(BlockPermutation.resolve(`${NS}:propeller_mounted`, { [`${NS}:facing`]: facing }));
}

/** Which part of the engine a block of it is: [px, py, pz]. */
export const partOf = (permutation) => PART.map((s) => permutation.getState(s) ?? 0);

/** The engine's first block (part 0,0,0: where its fuel is kept) from any of its blocks. */
export function engineHead(location, permutation) {
  const [x, y, z] = engineOrigin([location.x, location.y, location.z], partOf(permutation), permutation.getState(`${NS}:facing`) ?? 'north');
  return { x, y, z };
}

/** Builds an inboard engine with its part 0,0,0 at `at`; false (and nothing built) when there is no room. */
export function placeEngine(dim, at, facing) {
  const cells = engineCells([at.x, at.y, at.z], facing).map(({ pos: [x, y, z], part }) => ({ pos: { x, y, z }, part }));
  for (const c of cells) {
    const b = dim.getBlock(c.pos);
    if (!b || !OPEN.test(b.typeId)) return false;
  }
  for (const c of cells) {
    const states = { [`${NS}:facing`]: facing, [`${NS}:fuel`]: 0 };
    c.part.forEach((v, i) => { states[PART[i]] = v; });
    dim.getBlock(c.pos).setPermutation(BlockPermutation.resolve(ENGINE_ID, states));
  }
  return true;
}

/** Breaking one block of an engine takes the rest away too, and gives back one engine. */
function breakEngine({ block, brokenBlockPermutation: perm, player, dimension }) {
  if (perm.type.id !== ENGINE_ID) return;
  const head = engineHead(block.location, perm);
  const air = BlockPermutation.resolve('minecraft:air');
  for (const { pos: [x, y, z] } of engineCells([head.x, head.y, head.z], perm.getState(`${NS}:facing`) ?? 'north')) {
    try {
      const b = dimension.getBlock({ x, y, z });
      if (b?.typeId === ENGINE_ID) b.setPermutation(air);
    } catch {}
  }
  if (!isCreative(player)) dimension.spawnItem(new ItemStack(ENGINE_ID.replace(/_mounted$/, ''), 1), block.location);
}

export function setupPlacing() {
  world.afterEvents.playerBreakBlock.subscribe((e) => {
    try { breakEngine(e); } catch {}
  });
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
      const id = e.itemStack.typeId.split(':')[1];
      const [dx, dy, dz, faceDir] = FACES[e.blockFace] ?? FACES.Up;
      const at = { x: e.block.location.x + dx, y: e.block.location.y + dy, z: e.block.location.z + dz };
      const inboard = MOTOR_BY_ID[id]?.inboard;
      const look = dirOf(player.getRotation().y);
      system.run(() => {
        const dim = player.dimension;
        try {
          if (inboard) {
            // The engine reaches ahead of you; its propeller end is at your end.
            if (!placeEngine(dim, at, BEHIND(look))) return tell(player, `${NS}.engine_no_room`);
          } else {
            const target = dim.getBlock(at);
            if (!target || !OPEN.test(target.typeId)) return;
            // The propeller points away from the block it is clamped to; on top of a block, the way you look.
            if (id === 'propeller') mountPropeller(dim, at, faceDir ?? look);
            else mountMotor(dim, at, id, faceDir ?? look);
          }
        } catch {
          return;
        }
        sound(dim, 'random.anvil_use', at, 0.5, inboard ? 0.7 : 1.4);
        tell(player, inboard ? `${NS}.inboard_placed` : id === 'propeller' ? `${NS}.propeller_fitted` : `${NS}.attached`);
        consume(player);
      });
    },
  });
}
