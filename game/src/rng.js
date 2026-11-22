// rng.js — seeded random numbers. Port Azura is generated from a seed so the
// city, its traffic and its crowds are the same on every visit, and so the
// screenshot modes (?shot=...&seed=1) render reproducible scenes.

/** mulberry32: a small, fast, well-distributed PRNG. Returns a function. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A friendly wrapper around mulberry32 with the helpers the game uses. */
export class Rng {
  constructor(seed = 7) {
    this.nextFloat = mulberry32(seed >>> 0);
  }

  /** Float in [0, 1). */
  next() {
    return this.nextFloat();
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + (max - min) * this.nextFloat();
  }

  /** Integer in [min, max], both ends included. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** One element of an array. */
  pick(list) {
    return list[Math.floor(this.nextFloat() * list.length) % list.length];
  }

  /** True with probability p. */
  chance(p) {
    return this.nextFloat() < p;
  }

  /** -1 or +1. */
  sign() {
    return this.nextFloat() < 0.5 ? -1 : 1;
  }
}
