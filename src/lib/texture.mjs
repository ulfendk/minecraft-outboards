// Procedural texture painter. Every texel is painted from its 3D position on the
// model (see forEachTexel), so patterns such as stripes and rosettes continue
// across cube edges instead of being cut at UV seams.
import { PNG } from 'pngjs';
import { forEachTexel } from './model.mjs';

// ---------------------------------------------------------------- colours

/** '#rgb', '#rrggbb' or '#rrggbbaa' (alpha 00 = transparent, e.g. for rounded ear corners). */
export function hex(c) {
  if (Array.isArray(c)) return c;
  let s = c.replace('#', '');
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  const n = parseInt(s.slice(0, 6), 16);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export const TRANSPARENT = '#00000000';

/** True for the texels in the corners of a face (for rounding off flat parts like ears). */
export const corner = (r = 2) => ({ i, j, fw, fh }) => {
  const dx = Math.min(i, fw - 1 - i), dy = Math.min(j, fh - 1 - j);
  return dx + dy < r - 1 || (dx < r - 1 && dy < r - 1 && dx + dy < r);
};

export function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [0, 1, 2, 3].map((k) => Math.round(a[k] + (b[k] - a[k]) * t));
}

export function shade(c, f) {
  return [c[0] * f, c[1] * f, c[2] * f].map((v) => Math.max(0, Math.min(255, Math.round(v)))).concat(c[3]);
}

// ---------------------------------------------------------------- noise

function hash(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1). */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  let out = 0;
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++)
      for (let dz = 0; dz < 2; dz++) {
        const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
        out += w * hash(xi + dx, yi + dy, zi + dz, seed);
      }
  return out;
}

export function fbm(x, y, z, seed = 0, octaves = 3) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Cellular noise: distances to the nearest and second-nearest jittered points. */
export function worley(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = Infinity, d2 = Infinity, id = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const px = cx + hash(cx, cy, cz, seed);
        const py = cy + hash(cx, cy, cz, seed + 1);
        const pz = cz + hash(cx, cy, cz, seed + 2);
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = hash(cx, cy, cz, seed + 3);
        } else if (d < d2) d2 = d;
      }
  return { d1, d2, id };
}

// ---------------------------------------------------------------- layers
// A layer is (color, ctx) => color. ctx has p:[x,y,z], face, i, j, fw, fh, cube.
// Most layers accept `where(ctx)` to restrict them to part of the model.

const gate = (where, fn) => (c, ctx) => (where && !where(ctx) ? c : fn(c, ctx));

/** Per-texel brightness jitter that reads as fur. */
export const fur = (amount = 0.08, { seed = 7, where } = {}) =>
  gate(where, (c, { p }) => shade(c, 1 + (hash(Math.floor(p[0] * 2), Math.floor(p[1] * 2), Math.floor(p[2] * 2), seed) - 0.5) * 2 * amount));

/** Soft large-scale tone variation. */
export const mottle = (amount = 0.12, { scale = 6, seed = 3, where } = {}) =>
  gate(where, (c, { p }) => shade(c, 1 + (fbm(p[0] / scale, p[1] / scale, p[2] / scale, seed) - 0.5) * 2 * amount));

/** Blend towards `color` below height y (bellies, lighter undersides). */
export const underside = (color, { y, soft = 3, where } = {}) =>
  gate(where, (c, ctx) => {
    const t = ctx.face === 'bottom' ? 1 : (y - ctx.p[1]) / soft + 0.5;
    return mix(c, hex(color), t);
  });

/** Linear blend along an axis between two coordinates. */
export const gradient = (color, { axis = 1, from, to, where } = {}) =>
  gate(where, (c, { p }) => mix(c, hex(color), (p[axis] - from) / (to - from)));

/**
 * Organic stripes (zebra, tiger). Stripes run perpendicular to `axis`, are
 * `period` pixels apart and wobble by `warp` pixels.
 */
export const stripes = (color, { axis = 2, period = 4, width = 0.45, warp = 2.5, warpScale = 5, seed = 11, where } = {}) =>
  gate(where, (c, { p }) => {
    const w = (fbm(p[0] / warpScale, p[1] / warpScale, p[2] / warpScale, seed) - 0.5) * 2 * warp;
    const phase = ((p[axis] + w) / period) % 1;
    const t = phase < 0 ? phase + 1 : phase;
    return t < width ? hex(color) : c;
  });

/** Solid spots (cheetah, hyena). */
export const spots = (color, { size = 3, radius = 0.32, seed = 21, where } = {}) =>
  gate(where, (c, { p }) => {
    const { d1 } = worley(p[0] / size, p[1] / size, p[2] / size, seed);
    return d1 < radius ? hex(color) : c;
  });

/** Leopard rosettes: dark ring with a slightly darker-than-base centre. */
export const rosettes = (ring, { size = 4, inner = 0.2, outer = 0.36, centre, seed = 31, where } = {}) =>
  gate(where, (c, { p }) => {
    const { d1 } = worley(p[0] / size, p[1] / size, p[2] / size, seed);
    if (d1 < inner) return centre ? hex(centre) : c;
    if (d1 < outer) return hex(ring);
    return c;
  });

/**
 * Pixel-art rosettes laid out per face: 3x3 broken rings with a darker centre,
 * on a staggered grid of `cell` x `cell` blocks. Crisper than `rosettes` at low resolution.
 */
export const rosettePixels = (ring, { centre, cell = 4, gaps = 0.25, seed = 51, where } = {}) =>
  gate(where, (c, { i, j, face: f, cube }) => {
    const fi = ['right', 'front', 'left', 'back', 'top', 'bottom'].indexOf(f);
    const key = (cube.origin[0] * 31 + cube.origin[1] * 17 + cube.origin[2] * 7 + fi * 101) | 0;
    for (let ci = Math.floor(i / cell) - 1; ci <= Math.floor(i / cell) + 1; ci++)
      for (let cj = Math.floor(j / cell) - 1; cj <= Math.floor(j / cell) + 1; cj++) {
        // Staggered grid: rings never touch, alternate rows shift by half a cell.
        const cx = ci * cell + 1 + (Math.abs(cj) % 2 ? Math.floor(cell / 2) : 0);
        const cy = cj * cell + 1;
        if (hash(ci, cj, key, seed) < 0.12) continue; // the odd missing rosette
        const dx = i - cx, dy = j - cy;
        if (dx === 0 && dy === 0) return centre ? hex(centre) : c;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === 1 && hash(i, j, key, seed + 2) > gaps) return hex(ring);
      }
    return c;
  });

/** Giraffe patches: large cells of `color` separated by lines of the base colour. */
export const patches = (color, { size = 5, line = 0.12, vary = 0.15, seed = 41, where } = {}) =>
  gate(where, (c, { p }) => {
    const { d1, d2, id } = worley(p[0] / size, p[1] / size, p[2] / size, seed);
    return d2 - d1 < line ? c : shade(hex(color), 1 + (id - 0.5) * vary);
  });

/** Paint whole faces (e.g. dark hooves on the bottom only). */
export const faces = (color, names) => (c, ctx) => (names.includes(ctx.face) ? hex(color) : c);

/** Arbitrary region fill. */
export const region = (color, where) => (c, ctx) => (where(ctx) ? hex(color) : c);

// ---------------------------------------------------------------- painter

/**
 * Paint a texture for a laid-out model.
 * materials: { [name]: { base: color, layers?: layer[] } | color }
 * Cubes may carry `marks: [{ face, x, y, w?, h?, color }]` in face-local texels
 * (x from the left, y from the top as seen from outside), used for eyes, nostrils, etc.
 */
/**
 * Baked shading that gives cubes volume: lighter towards the top of each side,
 * darker towards the bottom and underneath. Applied before marks (eyes stay crisp).
 */
function bakedShade(c, ctx, amount) {
  if (!amount) return c;
  const { face, j, fh } = ctx;
  if (face === 'top') return shade(c, 1 + amount * 0.35);
  if (face === 'bottom') return shade(c, 1 - amount * 0.8);
  const t = fh > 1 ? j / (fh - 1) : 0.5; // 0 at the top of the face, 1 at the bottom
  return shade(c, 1 + amount * (0.45 - t));
}

export function paintTexture({ width, height, layout }, materials, { shading = 0.14 } = {}) {
  const png = new PNG({ width, height });
  png.data.fill(0);
  for (const cube of layout) {
    const mat = typeof materials[cube.mat] === 'string' ? { base: materials[cube.mat] } : materials[cube.mat];
    if (!mat) throw new Error(`Unknown material "${cube.mat}" on bone "${cube.bone}"`);
    const base = hex(mat.base);
    forEachTexel(cube, (px, py, ctx) => {
      let c = base;
      for (const layer of mat.layers ?? []) c = layer(c, ctx);
      c = bakedShade(c, ctx, mat.shading ?? shading);
      for (const m of cube.marks ?? []) {
        if (m.face === ctx.face && ctx.i >= m.x && ctx.i < m.x + (m.w ?? 1) && ctx.j >= m.y && ctx.j < m.y + (m.h ?? 1)) {
          c = hex(m.color);
        }
      }
      const k = (py * width + px) * 4;
      png.data[k] = c[0];
      png.data[k + 1] = c[1];
      png.data[k + 2] = c[2];
      png.data[k + 3] = c[3] ?? 255;
    });
  }
  return PNG.sync.write(png);
}

/** 16x16 spawn-egg style icon in two colours (used for item textures). */
export function eggIcon(baseColor, spotColor, seed = 1) {
  const png = new PNG({ width: 16, height: 16 });
  png.data.fill(0);
  const base = hex(baseColor), spot = hex(spotColor), outline = shade(base, 0.45);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      // Egg: narrower at the top.
      const nx = (x - 7.5) / 6.2, ny = (y - 8.5) / 7.2;
      const r = nx * nx * (ny < 0 ? 1.35 : 1) + ny * ny;
      if (r > 1) continue;
      let c = base;
      if (r > 0.78) c = outline;
      else if (worley(x / 3, y / 3, 0.5, seed).d1 < 0.3) c = spot;
      else if (x < 7 && y < 7 && r < 0.4) c = shade(base, 1.15);
      const k = (y * 16 + x) * 4;
      png.data.set(c, k);
    }
  return PNG.sync.write(png);
}

/** Small 16x16 pixel-art icon from a string map: rows of chars mapped through a palette. */
export function pixelIcon(rows, palette) {
  const png = new PNG({ width: 16, height: 16 });
  png.data.fill(0);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ' || !palette[ch]) return;
      png.data.set(hex(palette[ch]), (y * 16 + x) * 4);
    });
  });
  return PNG.sync.write(png);
}
