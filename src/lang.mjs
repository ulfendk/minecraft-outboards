// In-game texts (.lang files on Bedrock; tools/java.mjs converts them for Java).
import { NS } from './lib/constants.mjs';
import { STRINGS } from './i18n.mjs';

export const LOCALES = ['en_US', 'da_DK'];

/** How to drive: [Bedrock, Java] x [en, da]. */
export const CONTROLS = {
  boat: [
    ['W: throttle · S: slow down and reverse · A/D: steer · Sneak: get out',
      'W: gas · S: sænk farten og bak · A/D: styr · Snig: stig ud'],
    ['W: throttle · S: slow down and reverse · A/D: steer · Shift: get out',
      'W: gas · S: sænk farten og bak · A/D: styr · Shift: stig ud'],
  ],
  raft: [
    ['W: throttle · S: slow down and reverse · hold A/D: turn a quarter turn · Sneak: stop and moor',
      'W: gas · S: sænk farten og bak · hold A/D: drej en kvart omgang · Snig: stop og fortøj'],
    ['W: throttle · S: slow down and reverse · A/D: steer · Shift: stop and moor',
      'W: gas · S: sænk farten og bak · A/D: styr · Shift: stop og fortøj'],
  ],
};

/** Messages and HUD texts: key -> [English, Danish]. %s / %1$s are filled in at runtime. */
const UI = {
  [`action.interact.${NS}.board`]: ['Board', 'Stig om bord'],
  [`${NS}.hud`]: ['%1$s km/h · throttle %2$s · fuel %3$s', '%1$s km/t · gas %2$s · brændstof %3$s'],
  [`${NS}.hud.electric`]: ['%1$s km/h · throttle %2$s · battery %3$s', '%1$s km/t · gas %2$s · batteri %3$s'],
  [`${NS}.hud.raft`]: ['%1$s km/h · throttle %2$s · fuel %3$s · %4$s blocks', '%1$s km/t · gas %2$s · brændstof %3$s · %4$s blokke'],
  [`${NS}.hud.reverse`]: ['reverse', 'bak'],
  [`${NS}.empty`]: [
    'Out of fuel! Right-click the motor with coal, charcoal or blaze rods (electric motors: redstone).',
    'Løbet tør for brændstof! Højreklik på motoren med kul, trækul eller blazestave (elmotorer: redstone).',
  ],
  [`${NS}.refuel`]: ['Fuel: %s', 'Brændstof: %s'],
  [`${NS}.tank_full`]: ['The tank is full', 'Tanken er fuld'],
  [`${NS}.wrong_fuel.combustion`]: ['This motor runs on coal, charcoal or blaze rods', 'Denne motor kører på kul, trækul eller blazestave'],
  [`${NS}.wrong_fuel.electric`]: ['The electric motor is charged with redstone', 'Elmotoren lades op med redstone'],
  [`${NS}.attached`]: ['Motor fitted! Fill it up, get in and press W.', 'Motoren er sat på! Fyld den op, stig om bord og tryk W.'],
  [`${NS}.detached`]: ['Motor taken off', 'Motoren er taget af'],
  [`${NS}.chest_boat`]: ['Motors only fit boats and bamboo rafts without a chest', 'Motorer passer kun på både og bambusflåder uden kiste'],
  [`${NS}.mount_hint`]: ['Clamp the motor onto the side of a raft, at the water line', 'Sæt motoren på siden af en flåde, ved vandlinjen'],
  [`${NS}.raft.too_big`]: ['This raft is too big (more than 256 blocks), or it is part of the shore', 'Denne flåde er for stor (mere end 256 blokke), eller den hænger sammen med kysten'],
  [`${NS}.raft.grounded`]: ['This raft is stuck on the shore or the bottom', 'Denne flåde sidder fast på kysten eller bunden'],
  [`${NS}.raft.not_afloat`]: ['This raft is not in the water', 'Denne flåde er ikke i vandet'],
  [`${NS}.raft.no_motor`]: ['There is no motor on this raft', 'Der er ingen motor på denne flåde'],
  [`${NS}.raft.busy`]: ['Someone is already driving this raft', 'Der er allerede en, der styrer denne flåde'],
  [`${NS}.raft.start`]: ['Cast off! A raft of %1$s blocks with %2$s.', 'Kast los! En flåde på %1$s blokke med %2$s.'],
  [`${NS}.raft.blocked`]: ['Bump! Something is in the way', 'Bump! Der er noget i vejen'],
  [`${NS}.raft.aground`]: ['Aground! Steer back into open water', 'På grund! Styr tilbage ud på åbent vand'],
  [`${NS}.raft.moored`]: ['The raft is moored', 'Flåden er fortøjet'],
  [`${NS}.motors.one`]: ['1 motor', '1 motor'],
  [`${NS}.motors.many`]: ['%s motors', '%s motorer'],
  [`${NS}.handbook.title`]: ['Outboard Handbook', 'Håndbog for påhængsmotorer'],
  [`${NS}.handbook.intro`]: [
    'Outboard motors go on boats and on rafts you build yourself. They need fuel: right-click a motor with coal, charcoal or blaze rods, or an electric motor with redstone.',
    'Påhængsmotorer kan sættes på både og på flåder, du selv bygger. De skal have brændstof: Højreklik på en motor med kul, trækul eller blazestave, eller på en elmotor med redstone.',
  ],
  [`${NS}.handbook.boat`]: ['On a boat', 'På en båd'],
  [`${NS}.handbook.boat_text`]: [
    'Use a motor on a boat or a bamboo raft in the water to clamp it on. Right-click the motorboat with fuel to fill it up, then get in. Sneak and right-click it with an empty hand to take the motor off again; hit it a few times to break it, and you get both the boat and the motor back.',
    'Brug en motor på en båd eller en bambusflåde i vandet for at sætte den på. Højreklik på motorbåden med brændstof for at fylde den op, og stig så om bord. Snig og højreklik med tom hånd for at tage motoren af igen; slå den et par gange for at ødelægge den, så får du både båden og motoren tilbage.',
  ],
  [`${NS}.handbook.raft`]: ['On a raft', 'På en flåde'],
  [`${NS}.handbook.raft_text`]: [
    'Build a raft of any blocks on the water, up to 256 of them, with water all round it. Clamp a motor onto its side at the water line (use the motor on the side of a raft block), fill it up and right-click it, or a ship\'s wheel on the deck, to cast off. Every motor on the raft pushes: a big raft needs big motors, or several. Sneak to stop and moor.',
    'Byg en flåde af hvilke som helst blokke på vandet, op til 256 af dem, med vand hele vejen rundt. Sæt en motor på siden af den ved vandlinjen (brug motoren på siden af en flådeblok), fyld den op, og højreklik på den, eller på et skibsrat på dækket, for at kaste los. Alle motorer på flåden skubber: En stor flåde skal have store motorer, eller flere. Snig for at stoppe og fortøje.',
  ],
  [`${NS}.handbook.fuel`]: ['Fuel', 'Brændstof'],
  [`${NS}.handbook.fuel_text`]: [
    'A full tank holds 12 units. Coal and charcoal give 3, a blaze rod 6. Electric motors take redstone dust (1) or a block of redstone (9). The bigger the motor, the faster it burns: at full throttle a full tank lasts about 10 minutes in the small motor, 6 in the 15 hp and 4 in the 90 hp.',
    'En fuld tank rummer 12 enheder. Kul og trækul giver 3, en blazestav 6. Elmotorer tager redstonestøv (1) eller en redstoneblok (9). Jo større motor, jo hurtigere bruger den det: Ved fuld gas holder en fuld tank omkring 10 minutter i den lille motor, 6 i 15 hk og 4 i 90 hk.',
  ],
  [`${NS}.handbook.back`]: ['Back', 'Tilbage'],
  [`${NS}.handbook.speed`]: ['Top speed on a boat: %s km/h', 'Tophastighed på en båd: %s km/t'],
  [`${NS}.handbook.welcome`]: [
    '§6You received an Outboard Handbook!§r Use it to see how to fit motors to boats and rafts.',
    '§6Du har fået en håndbog for påhængsmotorer!§r Brug den til at se, hvordan du sætter motorer på både og flåder.',
  ],
};

/** Lang entries for one locale as [key, value] pairs. */
export function langEntries(locale, { motors, boats, blocks, items, description, version }) {
  const i = Math.max(0, LOCALES.indexOf(locale));
  const da = locale === 'da_DK' ? STRINGS.da : null;
  const pick = (pair) => pair[i] ?? pair[0];
  const out = [];
  out.push(['pack.description', da
    ? `Påhængsmotorer til både og til flåder, du bygger af blokke (v${version})`
    : `${description} (v${version})`]);
  for (const b of boats) out.push([`entity.${NS}:${b.id}.name`, da?.names[b.id] ?? b.name]);
  out.push([`entity.${NS}:raft_seat.name`, da ? 'Flådens førerplads' : 'Raft Helm']);
  for (const m of motors) out.push([`${NS}.info.${m.id}`, da?.info[m.id] ?? m.info]);
  for (const b of blocks) out.push([`tile.${NS}:${b.id}.name`, da?.names[b.id] ?? da?.names[b.motor] ?? b.name]);
  for (const item of items) out.push([`item.${NS}:${item.id}.name`, da?.names[item.id] ?? item.name]);
  for (const [k, c] of Object.entries(CONTROLS)) {
    out.push([`${NS}.controls.${k}`, pick(c[0])]);
    out.push([`${NS}.controls.java.${k}`, pick(c[1])]);
  }
  for (const [key, pair] of Object.entries(UI)) out.push([key, pick(pair)]);
  return out;
}
