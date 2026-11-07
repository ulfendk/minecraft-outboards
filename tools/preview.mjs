// Renders the motorboats (an oak boat with each motor, then every wood) and the blocks
// into build/preview/, plus a contact sheet: build/preview/sheet.png.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build, MOTOR_VARS } from './build.mjs';
import { boatAnimation } from '../src/lib/anim.mjs';
import { NS } from '../src/lib/constants.mjs';
import { MOTORS, OUTBOARDS } from '../src/motors.mjs';
import { render, sheet } from './render.mjs';

const RP = 'build/resource_pack';
const OUT = 'build/preview';

const { boats, blocks } = await build({ quiet: true });
await mkdir(OUT, { recursive: true });
const load = async (kind, id) => ({
  geo: JSON.parse(await readFile(join(RP, kind === 'block' ? 'models/blocks' : 'models/entity', `${id}.geo.json`), 'utf8')),
  tex: await readFile(join(RP, kind === 'block' ? `textures/blocks/${NS}` : `textures/entity/${NS}`, `${id}.png`)),
});

const thumbs = [];
const oak = boats.find((b) => b.wood === 'oak');
const { geo, tex } = await load('entity', oak.id);
const anim = Object.values(boatAnimation(oak, 'preview').animations)[0];
for (const [i, motor] of OUTBOARDS.entries()) {
  const views = [
    render(geo, tex, { anim, vars: MOTOR_VARS(i), yaw: 35 }),
    render(geo, tex, { anim, vars: MOTOR_VARS(i, true), yaw: 145, pitch: 10 }),
    render(geo, tex, { anim, vars: MOTOR_VARS(i), yaw: 90, pitch: 0 }),
  ];
  await writeFile(join(OUT, `${motor.id}.png`), sheet(views, { cols: 3 }));
  thumbs.push(views[1]);
}
for (const b of boats) {
  if (b === oak) continue;
  const art = await load('entity', b.id);
  const a = Object.values(boatAnimation(b, 'preview').animations)[0];
  thumbs.push(render(art.geo, art.tex, { anim: a, vars: MOTOR_VARS(b.raft ? 3 : 1), yaw: 145, pitch: 20 }));
}
for (const block of blocks) {
  const art = await load('block', block.id);
  const views = [render(art.geo, art.tex, { yaw: 35, pitch: 20 }), render(art.geo, art.tex, { yaw: 150, pitch: 20 })];
  await writeFile(join(OUT, `${block.id}.png`), sheet(views, { cols: 2 }));
  thumbs.push(views[0]);
}
await writeFile(join(OUT, 'sheet.png'), sheet(thumbs, { cols: 5 }));
console.log(`Wrote previews of ${MOTORS.length} motors, ${boats.length} boats and ${blocks.length} blocks to ${OUT}/`);
