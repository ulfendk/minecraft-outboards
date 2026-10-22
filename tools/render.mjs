// Tiny software renderer for previewing generated models without the game.
// Renders geometry + texture (optionally posed by an animation) to a PNG.
import { PNG } from 'pngjs';

const deg = Math.PI / 180;

// 4x4 matrices, column vectors, row-major arrays.
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const T = ([x, y, z]) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
function Rx(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
function Ry(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
function Rz(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
const apply = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
];

// Bedrock rotations, in geometry space (x = the animal's left), applied x, then y, then z:
// x and z are the opposite of the right-hand rule here, y follows it. This matches
// GeckoLib, which mirrors x on load and then uses (-x, -y, z).
const R = ([x, y, z]) => mul(Rz(-z * deg), mul(Ry(y * deg), Rx(-x * deg)));
const aroundPivot = (pivot, rot) => mul(T(pivot), mul(R(rot), T(pivot.map((v) => -v))));

/**
 * Evaluate a (simple) Molang expression with the animation variables in `vars`
 * (preview animations use $name placeholders, see src/lib/anim.mjs).
 */
export function molang(expr, vars = {}) {
  if (typeof expr === 'number') return expr;
  const js = expr
    .replace(/\$([a-z0-9]+)/g, (m, n) => `(${Number(vars[n] ?? 0)})`)
    .replace(/math\.(sin|cos)\(/g, (m, f) => `__${f}(`)
    .replace(/math\.mod\(/g, '__mod(')
    .replace(/math\.clamp\(/g, '__clamp(')
    .replace(/math\.(min|max|abs|floor|ceil|round|sqrt)\(/g, 'Math.$1(');
  // eslint-disable-next-line no-new-func
  return Function('__sin', '__cos', '__mod', '__clamp', `return (${js});`)(
    (d) => Math.sin((d * Math.PI) / 180), (d) => Math.cos((d * Math.PI) / 180),
    (a, b) => a % b, (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  );
}

let VARS = {};

/** Sample a Bedrock keyframe channel (array or { time: value }) at time t. */
function sample(channel, t) {
  if (!channel) return null;
  if (Array.isArray(channel)) return channel.map((v) => (typeof v === 'number' ? v : molang(v, VARS)));
  const keys = Object.keys(channel).map(Number).sort((a, b) => a - b);
  const val = (k) => {
    const v = channel[Object.keys(channel).find((x) => Number(x) === k)];
    return Array.isArray(v) ? v : v.post ?? v.pre;
  };
  if (t <= keys[0]) return val(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1]) {
      const f = (t - keys[i]) / (keys[i + 1] - keys[i]);
      const a = val(keys[i]), b = val(keys[i + 1]);
      return a.map((v, k) => v + (b[k] - v) * f);
    }
  }
  return val(keys[keys.length - 1]);
}

/**
 * Collect textured quads for every cube, in model space, posed by `anim` at time `t`.
 * Each quad: { p: [4 corners], uv: [4 corners], shade }.
 */
function quads(geometry, anim, t) {
  const g = geometry['minecraft:geometry'][0];
  const W = g.description.texture_width, H = g.description.texture_height;
  const world = {};
  const out = [];
  for (const bone of g.bones) {
    let m = bone.parent ? world[bone.parent] : I();
    const pivot = bone.pivot ?? [0, 0, 0];
    const a = anim?.bones?.[bone.name];
    const rot = (bone.rotation ?? [0, 0, 0]).map((v, i) => v + (sample(a?.rotation, t)?.[i] ?? 0));
    const pos = sample(a?.position, t) ?? [0, 0, 0];
    const scl = sample(a?.scale, t) ?? [1, 1, 1];
    m = mul(m, mul(T(pos), aroundPivot(pivot, rot)));
    // Like Bedrock and GeckoLib, a bone's scale also applies to its children.
    if (scl.some((v) => v !== 1)) m = mul(m, mul(T(pivot), mul([scl[0], 0, 0, 0, 0, scl[1], 0, 0, 0, 0, scl[2], 0, 0, 0, 0, 1], T(pivot.map((v) => -v)))));
    world[bone.name] = m;
    if (scl.some((v) => v === 0)) continue;
    for (const cube of bone.cubes ?? []) {
      let cm = m;
      if (cube.rotation) cm = mul(m, aroundPivot(cube.pivot, cube.rotation));
      const inf = cube.inflate ?? 0;
      const [w, h, d] = cube.size;
      const [x0, y0, z0] = cube.origin.map((v) => v - inf);
      const [x1, y1, z1] = [x0 + w + 2 * inf, y0 + h + 2 * inf, z0 + d + 2 * inf];
      const [u, v] = cube.uv;
      // Same layout as forEachTexel in src/lib/model.mjs.
      const faces = [
        { r: [u, v + d, d, h], c: [[x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [x0, y0, z1]], s: 0.7 },
        { r: [u + d, v + d, w, h], c: [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], s: 0.85 },
        { r: [u + d + w, v + d, d, h], c: [[x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0]], s: 0.7 },
        { r: [u + 2 * d + w, v + d, w, h], c: [[x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [x1, y0, z1]], s: 0.6 },
        { r: [u + d, v, w, d], c: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], s: 1.0 },
        { r: [u + d + w, v, w, d], c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], s: 0.5 },
      ];
      for (const f of faces) {
        const [fu, fv, fw, fh] = f.r;
        if (!fw || !fh) continue;
        out.push({
          p: f.c.map((p) => apply(cm, p)),
          uv: [[fu, fv], [fu + fw, fv], [fu + fw, fv + fh], [fu, fv + fh]].map(([a, b]) => [a / W, b / H]),
          shade: f.s,
        });
      }
    }
  }
  return out;
}

/**
 * Render to an RGBA PNG buffer.
 * opts: { size, yaw, pitch, anim, time, background, hidden: Set<bone> }
 */
export function render(geometry, texturePng, opts = {}) {
  const size = opts.size ?? 256;
  const tex = PNG.sync.read(texturePng);
  const yaw = (opts.yaw ?? 215) * deg, pitch = (opts.pitch ?? 20) * deg;
  // Geometry x is the animal's left; mirror into a right-handed view space.
  const view = mul(Rx(-pitch), mul(Ry(yaw), [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  VARS = opts.vars ?? {};

  let qs = quads(geometry, opts.anim, opts.time ?? 0);
  if (opts.hidden?.size) {
    const g = geometry['minecraft:geometry'][0];
    const hiddenBones = new Set();
    for (const b of g.bones) if (opts.hidden.has(b.name) || (b.parent && hiddenBones.has(b.parent))) hiddenBones.add(b.name);
    qs = quads({ 'minecraft:geometry': [{ ...g, bones: g.bones.map((b) => (hiddenBones.has(b.name) ? { ...b, cubes: [] } : b)) }] }, opts.anim, opts.time ?? 0);
  }
  const proj = qs.map((q) => ({ ...q, s: q.p.map((p) => apply(view, p)) }));

  // Fit to frame.
  let min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const q of proj) for (const p of q.s) {
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])];
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])];
  }
  const span = Math.max(max[0] - min[0], max[1] - min[1]) || 1;
  const scale = opts.scale ?? (size * 0.86) / span;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const toScreen = ([x, y, z]) => [size / 2 + (x - cx) * scale, size / 2 - (y - cy) * scale, z];

  const png = new PNG({ width: size, height: size });
  const bg = opts.background ?? [0, 0, 0, 0];
  for (let i = 0; i < size * size; i++) png.data.set(bg, i * 4);
  const zbuf = new Float32Array(size * size).fill(Infinity);

  const tri = (a, b, c, ta, tb, tc, shade) => {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const k = y * size + x;
        if (z >= zbuf[k]) continue;
        const u = w0 * ta[0] + w1 * tb[0] + w2 * tc[0];
        const v = w0 * ta[1] + w1 * tb[1] + w2 * tc[1];
        const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
        const ty = Math.min(tex.height - 1, Math.max(0, Math.floor(v * tex.height)));
        const ti = (ty * tex.width + tx) * 4;
        if (tex.data[ti + 3] < 128) continue;
        zbuf[k] = z;
        png.data[k * 4] = tex.data[ti] * shade;
        png.data[k * 4 + 1] = tex.data[ti + 1] * shade;
        png.data[k * 4 + 2] = tex.data[ti + 2] * shade;
        png.data[k * 4 + 3] = 255;
      }
  };
  for (const q of proj) {
    const s = q.s.map(toScreen);
    tri(s[0], s[1], s[2], q.uv[0], q.uv[1], q.uv[2], q.shade);
    tri(s[0], s[2], s[3], q.uv[0], q.uv[2], q.uv[3], q.shade);
  }
  return PNG.sync.write(png);
}

/** Lay out PNG buffers in a grid. */
export function sheet(buffers, { cols = 4, cell = 256, cellW = cell, cellH = cell, background = [236, 226, 200, 255] } = {}) {
  const rows = Math.ceil(buffers.length / cols);
  const png = new PNG({ width: cols * cellW, height: rows * cellH });
  for (let i = 0; i < png.width * png.height; i++) png.data.set(background, i * 4);
  buffers.forEach((buf, n) => {
    const img = PNG.sync.read(buf);
    const ox = (n % cols) * cellW, oy = Math.floor(n / cols) * cellH;
    for (let y = 0; y < Math.min(cellH, img.height); y++)
      for (let x = 0; x < Math.min(cellW, img.width); x++) {
        const s = (y * img.width + x) * 4;
        if (img.data[s + 3] < 10) continue;
        const d = ((oy + y) * png.width + ox + x) * 4;
        png.data.set(img.data.subarray(s, s + 4), d);
      }
  });
  return PNG.sync.write(png);
}
