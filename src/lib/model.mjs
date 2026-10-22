// Bone/cube model description -> Bedrock geometry (format 1.12.0, box UV) plus a
// UV layout that the texture painter uses to map every texel back to a 3D point.
//
// Coordinates follow Bedrock geometry: y is up, the animal faces -z (north) and
// +x is the animal's left side. Units are pixels (16 per block).

const POW2 = [16, 32, 64, 128, 256, 512];

/** Box-UV footprint of a cube: [width, height] in texels. */
function footprint([w, h, d]) {
  return [2 * (w + d), d + h];
}

/**
 * Shelf-pack cube footprints into the smallest power-of-two texture.
 * Returns { width, height, placements: Map<cube, [u, v]> }.
 */
function packUVs(cubes) {
  const items = cubes
    .map((cube) => ({ cube, fp: footprint(cube.size) }))
    .sort((a, b) => b.fp[1] - a.fp[1] || b.fp[0] - a.fp[0]);

  let best = null;
  for (const width of POW2) {
    if (items.some((it) => it.fp[0] > width)) continue;
    const placements = new Map();
    let x = 0, y = 0, shelf = 0;
    for (const it of items) {
      if (x + it.fp[0] > width) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      placements.set(it.cube, [x, y]);
      x += it.fp[0];
      shelf = Math.max(shelf, it.fp[1]);
    }
    const used = y + shelf;
    const height = POW2.find((p) => p >= used);
    if (!height) continue;
    const area = width * height;
    // Prefer square-ish textures when areas tie.
    if (!best || area < best.area || (area === best.area && Math.abs(width - height) < Math.abs(best.width - best.height))) {
      best = { width, height, area, placements };
    }
  }
  if (!best) throw new Error('Model too large to pack into a 512x512 texture');
  return best;
}

function validateCube(boneName, cube) {
  for (const n of cube.size) {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Bone "${boneName}": cube sizes must be non-negative integers, got [${cube.size}]`);
    }
  }
  if (!cube.mat) throw new Error(`Bone "${boneName}": cube is missing a material ("mat")`);
}

/**
 * Build geometry from a model spec:
 *   { bones: [{ name, parent?, pivot, rotation?, cubes?: [{ origin, size, mat, inflate?, rotation?, pivot?, marks? }] }] }
 */
export function buildGeometry(identifier, spec) {
  const names = new Set();
  const allCubes = [];
  for (const bone of spec.bones) {
    if (names.has(bone.name)) throw new Error(`Duplicate bone "${bone.name}"`);
    if (bone.parent && !names.has(bone.parent)) {
      throw new Error(`Bone "${bone.name}" must be declared after its parent "${bone.parent}"`);
    }
    names.add(bone.name);
    for (const cube of bone.cubes ?? []) {
      validateCube(bone.name, cube);
      allCubes.push({ ...cube, bone: bone.name });
    }
  }

  const { width, height, placements } = packUVs(allCubes);

  const layout = [];
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];

  const bones = spec.bones.map((bone) => {
    const out = { name: bone.name };
    if (bone.parent) out.parent = bone.parent;
    out.pivot = bone.pivot ?? [0, 0, 0];
    if (bone.rotation) out.rotation = bone.rotation;
    const cubes = allCubes.filter((c) => c.bone === bone.name);
    if (cubes.length) {
      out.cubes = cubes.map((c) => {
        const uv = placements.get(c);
        layout.push({ ...c, uv });
        c.origin.forEach((o, i) => {
          min[i] = Math.min(min[i], o);
          max[i] = Math.max(max[i], o + c.size[i]);
        });
        const cube = { origin: c.origin, size: c.size, uv };
        if (c.inflate) cube.inflate = c.inflate;
        if (c.rotation) {
          cube.rotation = c.rotation;
          cube.pivot = c.pivot ?? c.origin.map((o, i) => o + c.size[i] / 2);
        }
        if (c.mirror) cube.mirror = true;
        return cube;
      });
    }
    return out;
  });

  const extentX = Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2]));
  const geometry = {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier,
          texture_width: width,
          texture_height: height,
          visible_bounds_width: Math.ceil((extentX * 2) / 16) + 1,
          visible_bounds_height: Math.ceil(max[1] / 16) + 1,
          visible_bounds_offset: [0, Math.round((max[1] / 32) * 100) / 100, 0],
        },
        bones,
      },
    ],
  };

  return { geometry, layout, width, height, bounds: { min, max } };
}

/**
 * Enumerate every texel of a laid-out cube with its 3D surface position.
 * Calls fn(px, py, ctx) where ctx = { p:[x,y,z], face, i, j, fw, fh, cube }.
 * (i, j) are face-local texel coords from the top-left of the face's UV rect;
 * faces are named from the animal's point of view (front = -z, left = +x);
 * on the front face, i = 0 is the animal's right side (viewer's left).
 */
export function forEachTexel(cube, fn) {
  const [w, h, d] = cube.size;
  const [x0, y0, z0] = cube.origin;
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  const [u, v] = cube.uv;
  const faces = [
    { face: 'right', u: u, v: v + d, fw: d, fh: h, pos: (i, j) => [x0, y1 - j - 0.5, z1 - i - 0.5] },
    { face: 'front', u: u + d, v: v + d, fw: w, fh: h, pos: (i, j) => [x0 + i + 0.5, y1 - j - 0.5, z0] },
    { face: 'left', u: u + d + w, v: v + d, fw: d, fh: h, pos: (i, j) => [x1, y1 - j - 0.5, z0 + i + 0.5] },
    { face: 'back', u: u + 2 * d + w, v: v + d, fw: w, fh: h, pos: (i, j) => [x1 - i - 0.5, y1 - j - 0.5, z1] },
    { face: 'top', u: u + d, v: v, fw: w, fh: d, pos: (i, j) => [x0 + i + 0.5, y1, z1 - j - 0.5] },
    { face: 'bottom', u: u + d + w, v: v, fw: w, fh: d, pos: (i, j) => [x0 + i + 0.5, y0, z0 + j + 0.5] },
  ];
  for (const f of faces) {
    for (let j = 0; j < f.fh; j++) {
      for (let i = 0; i < f.fw; i++) {
        fn(f.u + i, f.v + j, { p: f.pos(i, j), face: f.face, i, j, fw: f.fw, fh: f.fh, cube });
      }
    }
  }
}
