// The Outboard Handbook: how to fit motors to boats, rafts and ships, fuel, and a page per motor.
import { ItemStack, system, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { MOTORS } from './data.js';
import { BOAT_MASS, topSpeed, vessel } from './water.js';
import { NS } from './util.js';

const GIVEN = `${NS}:handbook_given`;
const PAGES = ['boat', 'raft', 'ship', 'fuel'];

function openIndex(player) {
  const form = new ActionFormData().title({ translate: `${NS}.handbook.title` }).body({ translate: `${NS}.handbook.intro` });
  for (const p of PAGES) form.button({ translate: `${NS}.handbook.${p}` });
  for (const m of MOTORS) form.button({ translate: `item.${NS}:${m.id}.name` }, `textures/ui/${NS}/${m.id}`);
  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection < PAGES.length) {
      const p = PAGES[res.selection];
      const body = [{ translate: `${NS}.handbook.${p}_text` }];
      if (p !== 'fuel') body.push({ text: '\n\n§2' }, { translate: `${NS}.controls.${p === 'ship' ? 'raft' : p}` });
      return back(player, { translate: `${NS}.handbook.${p}` }, body);
    }
    const m = MOTORS[res.selection - PAGES.length];
    back(player, { translate: `item.${NS}:${m.id}.name` }, [
      { translate: `${NS}.info.${m.id}` }, { text: '\n\n' },
      m.inboard
        ? { translate: `${NS}.handbook.ship_speed`, with: [String(Math.round(topSpeed(vessel([m], 4 + 2000)) * 72))] }
        : { translate: `${NS}.handbook.speed`, with: [String(Math.round(topSpeed(vessel([m], BOAT_MASS)) * 72))] },
    ]);
  });
}

function back(player, title, body) {
  new ActionFormData().title(title).body({ rawtext: body }).button({ translate: `${NS}.handbook.back` }).show(player).then((res) => {
    if (!res.canceled) openIndex(player);
  });
}

export function setupManual() {
  world.afterEvents.itemUse.subscribe(({ itemStack, source }) => {
    if (itemStack?.typeId !== `${NS}:outboard_handbook`) return;
    source.playSound('item.book.page_turn');
    system.run(() => openIndex(source));
  });
  // Everyone gets a handbook the first time they join a world with the add-on.
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn || player.getDynamicProperty(GIVEN)) return;
    player.setDynamicProperty(GIVEN, true);
    system.runTimeout(() => {
      try {
        player.getComponent('minecraft:inventory')?.container?.addItem(new ItemStack(`${NS}:outboard_handbook`, 1));
        player.sendMessage({ translate: `${NS}.handbook.welcome` });
      } catch {
        // Player left before the timeout.
      }
    }, 60);
  });
}
