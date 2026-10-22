// A small model builder plus the parts models are made of: wheels, round tubes along
// either axis (fuselages, envelopes, engines), wings, cabs and seats. Units are model
// pixels; the model faces -z (+x is its left).

const r = (n) => Math.round(n * 100) / 100;

export class Model {
  constructor() {
    this.bones = [];
  }

  /** Adds a bone; returns a handle with box() for adding cubes. */
  bone(name, parent, pivot, { rotation } = {}) {
    if (this.bones.some((b) => b.name === name)) throw new Error(`Duplicate bone ${name}`);
    const bone = { name, ...(parent ? { parent } : {}), pivot: pivot.map(r), cubes: [] };
    if (rotation) bone.rotation = rotation;
    this.bones.push(bone);
    return this.handle(bone);
  }

  get(name) {
    const bone = this.bones.find((b) => b.name === name);
    if (!bone) throw new Error(`No bone ${name}`);
    return this.handle(bone);
  }

  has(name) {
    return this.bones.some((b) => b.name === name);
  }

  handle(bone) {
    const h = {
      name: bone.name,
      /** origin and size in pixels; sizes are rounded to whole pixels (box UV needs them). */
      box(origin, size, mat, opts = {}) {
        const cube = { origin: origin.map(r), size: size.map((n) => Math.max(0, Math.round(n))), mat };
        if (opts.inflate) cube.inflate = opts.inflate;
        if (opts.rotation) {
          cube.rotation = opts.rotation;
          cube.pivot = (opts.pivot ?? origin.map((o, i) => o + size[i] / 2)).map(r);
        }
        bone.cubes.push(cube);
        return h;
      },
    };
    return h;
  }

  build() {
    return { bones: this.bones.map(({ cubes, ...b }) => (cubes.length ? { ...b, cubes } : b)) };
  }
}

/**
 * A wheel on its own bone (so it can spin and steer). (x, y, z) is the hub centre;
 * x > 0 puts the wheel's outer face at x + w/2.
 */
export function wheel(m, name, parent, { x, y, z, r: radius, w, hub = 'metal' }) {
  const b = m.bone(name, parent, [x, y, z]);
  b.box([x - w / 2, y - radius, z - radius], [w, 2 * radius, 2 * radius], 'tyre');
  const hubR = Math.max(1, Math.round(radius * 0.55));
  const out = x >= 0 ? x + w / 2 : x - w / 2 - 1;
  b.box([out, y - hubR, z - hubR], [1, 2 * hubR, 2 * hubR], hub);
  return b;
}

/**
 * A cab with a roof, corner posts, glass on the open sides and a solid wall at the back.
 * open: which sides get glass ('front', 'left', 'right', 'back').
 */
export function cab(b, { x0, y0, z0, w, h, d, open = ['front', 'left', 'right'], wall = 'paint', roof = 'paint' }) {
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  b.box([x0, y1 - 1, z0], [w, 1, d], roof); // roof
  b.box([x0 - 0.5, y1, z0 - 0.5], [w + 1, 1, d + 1], roof);
  for (const [px, pz] of [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]) b.box([px, y0, pz], [1, h - 1, 1], 'frame');
  const glassOr = (side, glassBox, wallBox) => (open.includes(side) ? b.box(...glassBox, 'glass') : b.box(...wallBox, wall));
  glassOr('front', [[x0 + 1, y0 + 2, z0], [w - 2, h - 3, 1]], [[x0 + 1, y0, z0], [w - 2, h - 1, 1]]);
  glassOr('back', [[x0 + 1, y0 + 2, z1 - 1], [w - 2, h - 3, 1]], [[x0 + 1, y0, z1 - 1], [w - 2, h - 1, 1]]);
  glassOr('left', [[x1 - 1, y0 + 2, z0 + 1], [1, h - 3, d - 2]], [[x1 - 1, y0, z0 + 1], [1, h - 1, d - 2]]);
  glassOr('right', [[x0, y0 + 2, z0 + 1], [1, h - 3, d - 2]], [[x0, y0, z0 + 1], [1, h - 1, d - 2]]);
  // Lower panels under the glass.
  for (const side of open) {
    if (side === 'front') b.box([x0 + 1, y0, z0], [w - 2, 2, 1], wall);
    if (side === 'back') b.box([x0 + 1, y0, z1 - 1], [w - 2, 2, 1], wall);
    if (side === 'left') b.box([x1 - 1, y0, z0 + 1], [1, 2, d - 2], wall);
    if (side === 'right') b.box([x0, y0, z0 + 1], [1, 2, d - 2], wall);
  }
}

/** Operator seat with a backrest; (x, z) is the seat centre, y the floor. Returns the seat surface y. */
export function operatorSeat(b, { x, y, z }) {
  b.box([x - 2, y, z - 2], [4, 3, 4], 'seat');
  b.box([x - 2, y + 3, z + 1], [4, 5, 1], 'seat');
  return y + 3;
}

/**
 * A round tube along y, centred on (x, z): a square with its corners cut off (three boxes
 * that don't overlap, so no faces fight). r is the radius in pixels.
 */
export function tube(b, { r: radius, y, h, mat, x = 0, z = 0 }) {
  const k = radius >= 3 ? Math.max(1, Math.round(radius * 0.3)) : 0;
  if (!k) return b.box([x - radius, y, z - radius], [2 * radius, h, 2 * radius], mat);
  b.box([x - radius, y, z - radius + k], [2 * radius, h, 2 * radius - 2 * k], mat);
  b.box([x - radius + k, y, z - radius], [2 * radius - 2 * k, h, k], mat);
  b.box([x - radius + k, y, z + radius - k], [2 * radius - 2 * k, h, k], mat);
  return b;
}

/**
 * A round tube along z from z0 to z1 (a fuselage section or an engine nacelle), centred on
 * (x, y), radius rx across and ry up (so it can be oval).
 */
export function tubeZ(b, { rx, ry = rx, x = 0, y, z0, z1, mat }) {
  const len = z1 - z0;
  const k = Math.min(rx, ry) >= 3 ? Math.max(1, Math.round(Math.min(rx, ry) * 0.3)) : 0;
  if (!k) return b.box([x - rx, y - ry, z0], [2 * rx, 2 * ry, len], mat);
  b.box([x - rx, y - ry + k, z0], [2 * rx, 2 * ry - 2 * k, len], mat);
  b.box([x - rx + k, y - ry, z0], [2 * rx - 2 * k, k, len], mat);
  b.box([x - rx + k, y + ry - k, z0], [2 * rx - 2 * k, k, len], mat);
  return b;
}

/**
 * A tapering fuselage along z: `sections` is a list of [z, rx, ry, yCentre] stations from
 * front to back; each span between two stations is a tube with the smaller of their sizes
 * stepped half way.
 */
export function fuselage(b, sections, mat) {
  for (let i = 0; i < sections.length - 1; i++) {
    const [za, rxa, rya, ya] = sections[i];
    const [zb, rxb, ryb, yb] = sections[i + 1];
    const mid = Math.round((za + zb) / 2);
    tubeZ(b, { rx: rxa, ry: rya, y: ya, z0: za, z1: mid, mat });
    tubeZ(b, { rx: rxb, ry: ryb, y: yb, z0: mid, z1: zb, mat });
  }
}

/**
 * A wing (or tailplane) across x from -span/2 to span/2 at height y, leading edge at z0,
 * chord deep and t thick. It is cut into pieces of at most 48 pixels (long cubes waste
 * texture space), and the tips get a narrower chord. dihedral lifts the tips and sweep moves
 * them back (pixels).
 */
export function wing(b, { span, y, z0, chord, t = 1, mat, tipChord = chord, dihedral = 0, sweep = 0, x = 0, gap = 0 }) {
  const half = span / 2;
  const pieces = Math.max(1, Math.ceil((half - gap) / 48));
  for (const side of [1, -1]) {
    for (let i = 0; i < pieces; i++) {
      const a = gap + ((half - gap) * i) / pieces, bb = gap + ((half - gap) * (i + 1)) / pieces;
      const f = (i + 0.5) / pieces;
      const c = Math.round(chord + (tipChord - chord) * f);
      const lift = Math.round(dihedral * f);
      const x0 = side > 0 ? x + a : x - bb;
      b.box([x0, y + lift, z0 + (chord - c) / 2 + Math.round(sweep * f)], [bb - a, t, c], mat);
    }
  }
  return b;
}

/** A fin (vertical tail) at x on the centre line: from y up h pixels, root chord deep at z0, tip chord at the top. */
export function fin(b, { y, h, z0, chord, tipChord = chord, mat, x = 0 }) {
  const low = Math.ceil(h / 2);
  b.box([x - 0.5, y, z0], [1, low, chord], mat);
  b.box([x - 0.5, y + low, z0 + (chord - tipChord)], [1, h - low, tipChord], mat);
  return b;
}

/** A propeller disc on its own bone that spins round z: two blades and a spinner. */
export function propeller(m, name, parent, { x = 0, y, z, r: radius, mat = 'prop', hub = 'chrome' }) {
  const b = m.bone(name, parent, [x, y, z]);
  b.box([x - 1, y - radius, z - 0.5], [2, 2 * radius, 1], mat);
  b.box([x - 1.5, y - 1.5, z - 1.5], [3, 3, 3], hub);
  return b;
}

/** A rotor on its own bone that spins round y: two (or four) long blades and a hub. */
export function rotor(m, name, parent, { x = 0, y, z, r: radius, blades = 2, mat = 'blade', hub = 'dark', w = 2 }) {
  const b = m.bone(name, parent, [x, y, z]);
  // Blades in pieces of up to 48 pixels.
  const pieces = Math.max(1, Math.ceil(radius / 48));
  for (let i = 0; i < pieces; i++) {
    const a = (radius * i) / pieces, c = (radius * (i + 1)) / pieces;
    b.box([x - w / 2, y, z + a], [w, 1, c - a], mat).box([x - w / 2, y, z - c], [w, 1, c - a], mat);
    if (blades === 4) b.box([x + a, y, z - w / 2], [c - a, 1, w], mat).box([x - c, y, z - w / 2], [c - a, 1, w], mat);
  }
  b.box([x - 2, y - 1, z - 2], [4, 3, 4], hub);
  return b;
}

/** A seated figure would be the rider; this is just a small bench seat with a backrest facing -z. */
export function bench(b, { x, y, z, w = 4 }) {
  b.box([x - w / 2, y, z - 2], [w, 2, 4], 'seat');
  b.box([x - w / 2, y + 2, z + 1], [w, 5, 1], 'seat');
  return y + 2;
}
