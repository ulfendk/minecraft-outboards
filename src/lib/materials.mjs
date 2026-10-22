// Material recipes: painted and glossy surfaces, bare metal, rubber,
// glass, fabric, wicker and flames. Each returns a { base, layers } material for paintTexture().
import { hex, mottle, shade, fur } from './texture.mjs';

export const PALETTE = {
  yellow: '#f2b705',
  orange: '#e8771e',
  red: '#c8261b',
  white: '#e9e6dc',
  green: '#3f7a35',
  blue: '#2f5d9a',
  steel: '#7d848a',
  dark: '#2c2e30',
  black: '#1b1c1d',
};

/** Darkens edges and corners of each face a little: chipped, dusty paint. */
const wear = (amount = 0.12) => (c, { i, j, fw, fh }) => {
  const edge = Math.min(i, j, fw - 1 - i, fh - 1 - j);
  return edge === 0 && fw > 2 && fh > 2 ? shade(c, 1 - amount) : c;
};

export const paint = (color, { wearAmount = 0.08 } = {}) => ({
  base: color,
  layers: [mottle(0.04, { scale: 8 }), fur(0.02), wear(wearAmount)],
});

/** Smooth, glossy paint (composite gliders, the jet). */
export const gloss = (color) => ({ base: color, layers: [fur(0.015)], shading: 0.2 });

export const metal = (color = PALETTE.steel) => ({ base: color, layers: [fur(0.06), mottle(0.05)], shading: 0.18 });

export const chrome = () => ({ base: '#c9d0d4', layers: [fur(0.05)], shading: 0.25 });

export const rubber = (color = '#262626') => ({ base: color, layers: [fur(0.05)], shading: 0.1 });

// Both faces of a pane are drawn (the materials don't cull back faces), so the alpha counts twice:
// 0x48 per face is about 50% opaque through the pane.
export const glass = () => ({ base: '#b4dcec48', layers: [(c, { i, j }) => ((i + j) % 7 === 0 ? shade(c, 1.25) : c)], shading: 0.05 });

/** Tyre with tread blocks across the rolling surface and a darker side wall. */
export const tyre = () => ({
  base: '#2a2a2a',
  shading: 0.1,
  layers: [
    (c, { face, j }) => (face === 'left' || face === 'right' ? shade(c, 0.85) : j % 2 === 0 ? shade(c, 0.7) : c),
    fur(0.04),
  ],
});

/** A coloured cheat line along the fuselage, between heights y0 and y1 (model pixels). */
export const livery = (color, stripe, { y0, y1, second, y2, y3 }) => ({
  base: color,
  shading: 0.18,
  layers: [(c, { p }) => (p[1] >= y0 && p[1] < y1 ? hex(stripe) : second && p[1] >= y2 && p[1] < y3 ? hex(second) : c), fur(0.015)],
});

/** Fabric in gores (balloon envelopes, parachutes), coloured round the y axis or across x. */
export const gores = (colors, { n = 12, around = true, cx = 0, cz = 0 } = {}) => ({
  base: colors[0],
  shading: 0.12,
  layers: [(c, { p }) => {
    const t = around ? (Math.atan2(p[2] - cz, p[0] - cx) + Math.PI) / (2 * Math.PI) : (p[0] + 1000) / 6;
    return hex(colors[Math.floor(t * (around ? n : 1)) % colors.length]);
  }, fur(0.02)],
});

/** Paraglider cells: colour bands across the span, a darker underside. */
export const cells = (colors, width = 8) => ({
  base: colors[0],
  shading: 0.15,
  layers: [(c, { p, face }) => {
    const band = hex(colors[(((Math.floor(p[0] / width) % colors.length) + colors.length) % colors.length)]);
    return face === 'bottom' ? shade(band, 0.75) : band;
  }, fur(0.02)],
});

/** Woven wicker (the balloon basket). */
export const wicker = () => ({
  base: '#a8763e',
  shading: 0.1,
  layers: [(c, { p }) => ((Math.floor(p[1]) + Math.floor(p[0] + p[2])) % 2 ? shade(c, 0.82) : c), fur(0.06)],
});

/** The burner flame: white-yellow core, orange towards the top. */
export const flame = () => ({
  base: '#fff3a0',
  shading: 0,
  layers: [(c, { p, cube }) => {
    const t = Math.min(1, (p[1] - cube.origin[1]) / Math.max(1, cube.size[1]));
    return t < 0.3 ? hex('#cfe6ff') : t < 0.55 ? hex('#fff6c8') : t < 0.8 ? hex('#ffc23a') : hex('#ff7a1a');
  }],
});

export const rope = () => ({ base: '#e9e2cf', shading: 0.05 });

export const lamp = (color = '#fff1b0') => ({ base: color, shading: 0 });

export const seat = () => ({ base: '#3b3b3b', layers: [fur(0.06)], shading: 0.15 });

/** The materials every model shares; each adds its own paint. */
export function commonMaterials(main = PALETTE.white, { second = PALETTE.dark } = {}) {
  return {
    paint: paint(main),
    paint2: paint(second),
    metal: metal(),
    dark: metal('#3a3d40'),
    chrome: chrome(),
    rubber: rubber(),
    tyre: tyre(),
    glass: glass(),
    frame: metal('#202224'),
    seat: seat(),
    lamp: lamp(),
    nav_red: lamp('#e0261b'),
    nav_green: lamp('#2bd14a'),
    strobe: lamp('#ffffff'),
    prop: metal('#2b2b2b'),
    blade: metal('#33363a'),
    rope: rope(),
    flame: flame(),
  };
}
