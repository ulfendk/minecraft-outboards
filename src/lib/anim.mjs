// Boat animations for both editions. Moving parts are described as visuals:
//   { bone, prop: 'rotation'|'position'|'scale', axis (0..2, -1 = uniform scale), expr: '...' }
// Expressions use $-variables that each edition maps to its own Molang:
//   $motor (which motor is fitted: 1..4, see src/motors.mjs), $spin (degrees the propeller has
//   turned), $rotor (0..1 how fast it turns), $steer (degrees the motor is turned), $time (seconds)

import { NS } from './constants.mjs';

const BEDROCK = {
  motor: `q.property('${NS}:motor')`, spin: 'v.spin', rotor: 'v.rotor', steer: 'v.steer', time: 'q.life_time',
};
const JAVA = {
  motor: 'variable.o_motor', spin: 'variable.o_spin', rotor: 'variable.o_rotor', steer: 'variable.o_steer', time: 'variable.o_time',
};

/** Variable names for one edition ('bedrock' | 'java' | 'preview'). */
export function variables(edition) {
  if (edition === 'java') return JAVA;
  if (edition === 'preview') return Object.fromEntries(Object.keys(BEDROCK).map((k) => [k, `$${k}`]));
  return BEDROCK;
}


function expr(d, vars) {
  return d.expr.replace(/\$([a-z0-9]+)/g, (m, name) => {
    if (!(name in vars)) throw new Error(`Unknown animation variable ${m}`);
    return vars[name];
  });
}

export const allVisuals = (spec) => spec.visuals ?? [];

/** One looping animation that applies every visual. */
export function boatAnimation(spec, edition) {
  const vars = variables(edition);
  const bones = {};
  // Several visuals may target the same bone channel: sum them per axis (multiply scales).
  const sums = {};
  for (const d of allVisuals(spec)) {
    const key = `${d.bone}|${d.prop}`;
    const entry = (sums[key] ??= { bone: d.bone, prop: d.prop, axes: [[], [], []], uniform: [] });
    if (d.axis === -1) entry.uniform.push(expr(d, vars));
    else entry.axes[d.axis].push(expr(d, vars));
  }
  for (const { bone, prop, axes, uniform } of Object.values(sums)) {
    const b = (bones[bone] ??= {});
    if (prop === 'scale') {
      if (uniform.length) b.scale = [0, 1, 2].map(() => uniform.map((e) => `(${e})`).join(' * '));
      else b.scale = axes.map((list) => (list.length ? list.map((e) => `(${e})`).join(' * ') : 1));
    } else {
      b[prop] = axes.map((list) => (list.length ? list.map((e) => `(${e})`).join(' + ') : 0));
    }
  }
  return {
    format_version: '1.8.0',
    animations: { [`animation.${NS}.${spec.id}.move`]: { loop: true, bones } },
  };
}
