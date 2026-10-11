'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../cube-model.js');
const solver = require('../short-solver.js');
const layerSolver = require('../layer-solver.js');
const vendor = require('../vendor/nxn-solver/solver.js');
const adapter = require('../solver-engine.js');
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');
const engine = adapter.createEngine(model, Cube);
const unavailableEngine = { solveNearOptimal() { throw new Error('Search unavailable'); } };

function random(initial) {
  let seed = initial;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function scramble(size, seed, count = size * 10) {
  const state = model.solvedState(size), next = random(seed);
  for (let i = 0; i < count; i++) {
    const move = { face: model.FACES[Math.floor(next() * 6)], n: 1 + Math.floor(next() * 3),
      depth: Math.floor(next() * size) };
    model.applyMove(state, move.face, move.n, move.depth);
  }
  return { state };
}

function assertSolved(state, moves) {
  assert.doesNotThrow(() => adapter.verifySolution(state, moves, model));
}

function parity(values) {
  let n = 0;
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    if (values[i] > values[j]) n ^= 1;
  }
  return n;
}

test('short search solves one and two turns on every large size, depth, and rotated color frame', () => {
  for (let size = 4; size <= 10; size++) {
    assert.deepEqual(solver.solve(model.solvedState(size), model, unavailableEngine), []);
    for (const depth of [0, Math.floor(size / 2), size - 1]) {
      for (const face of ['R', 'U', 'B']) {
        const state = model.solvedState(size);
        // Uniformly rotate the initial color scheme, including even cubes without centers.
        for (let layer = 0; layer < size; layer++) model.applyMove(state, 'F', 1, layer);
        model.applyMove(state, face, 3, depth);
        const one = solver.solve(state, model, unavailableEngine);
        assert.equal(one.length, 1);
        assertSolved(state, one);
        model.applyMove(state, 'L', 2, 1);
        const two = solver.solve(state, model, unavailableEngine);
        assert(two.length <= 2);
        assertSolved(state, two);
      }
    }
  }
});

test('optimizer cancels commuting layers and represents a wide turn by its shorter complement', () => {
  assert.deepEqual(solver.optimize([
    { face: 'R', n: 1 }, { face: 'L', n: 1 }, { face: 'R', n: 3 }
  ], 4, model), [{ face: 'L', n: 1, depth: 0 }]);
  const wide = [0, 1, 2].map(depth => ({ face: 'R', n: 1, depth }));
  assert.equal(solver.optimize(wide, 4, model).length, 1);
  const wholeThenUp = [0, 1, 2, 3].map(depth => ({ face: 'R', n: 1, depth }));
  wholeThenUp.push({ face: 'U', n: 1 });
  assert.deepEqual(solver.optimize(wholeThenUp, 4, model), [{ face: 'F', n: 1, depth: 0 }]);
});

test('optimized random slice, wide, and whole-cube solutions remain solved in any final orientation', () => {
  for (let size = 4; size <= 10; size++) for (let seed = 1; seed <= 8; seed++) {
    const next = random(seed), raw = [];
    for (let i = 0; i < 40; i++) {
      const layer = 1 + Math.floor(next() * size), width = 1 + Math.floor(next() * layer);
      raw.push(...layerSolver.movesForTurn(size, model.FACES[Math.floor(next() * 6)],
        1 + Math.floor(next() * 3), layer, width));
    }
    const initial = model.solvedState(size);
    for (const move of raw.slice().reverse()) model.applyMove(initial, move.face, 4 - move.n, move.depth);
    const before = JSON.stringify(raw), optimized = solver.optimize(raw, size, model);
    assert(optimized.length <= raw.length);
    assert.equal(JSON.stringify(raw), before);
    assertSolved(initial, optimized);
  }
});

for (let size = 4; size <= 10; size++) {
  test(`${size}×${size} finds shorter state-based solutions without history`, () => {
    const { state } = scramble(size, 19);
    state.reverse();
    for (const cubie of state) cubie.id += 1000;
    const before = JSON.stringify(state), baseline = layerSolver.solve(state, model);
    let finishes = 0;
    const actualEngine = {
      solveNearOptimal(reduced, progress) { finishes++; return engine.solveNearOptimal(reduced, progress); }
    };
    const moves = solver.solve(state, model, actualEngine);
    assertSolved(state, moves);
    assert(moves.length < baseline.length, `${moves.length} should improve on ${baseline.length}`);
    assert(finishes > 0, 'The state-based candidates must use the shorter 3×3 finish');
    assert.equal(JSON.stringify(state), before);
  });
}

test('even-cube permutation parity is corrected before sending a reduction to the 3×3 engine', () => {
  for (const [size, seed] of [[4, 5], [6, 1], [8, 2], [10, 3]]) {
    const { state } = scramble(size, seed), cube = layerSolver.toCube(state, model);
    vendor.solveCenters(cube);
    vendor.solveEdges(cube);
    const invalid = Cube.fromString(adapter.toFacelets(solver.reducedState(cube, model), model));
    assert.notEqual(parity(invalid.cp), parity(invalid.ep), 'Fixture must require parity correction');
    let calls = 0;
    const checkedEngine = {
      solveNearOptimal(reduced, progress) {
        const valid = Cube.fromString(adapter.toFacelets(reduced, model));
        assert.equal(parity(valid.cp), parity(valid.ep));
        assert.equal(valid.eo.reduce((sum, n) => sum + n, 0) % 2, 0);
        calls++;
        return engine.solveNearOptimal(reduced, progress);
      }
    };
    assertSolved(state, solver.solve(state, model, checkedEngine));
    assert(calls > 0);
  }
});

test('legacy extra arguments are never accessed or used to find a solution', () => {
  const { state } = scramble(4, 817, 30);
  let accesses = 0;
  const poison = new Proxy([], {
    get() { accesses++; throw new Error('Legacy argument must not be read'); },
    ownKeys() { accesses++; throw new Error('Legacy argument must not be enumerated'); }
  });
  assert.equal(solver.solve.length, 4);
  const expected = solver.solve(state, model, unavailableEngine);
  const actual = solver.solve(state, model, unavailableEngine, undefined, poison);
  assertSolved(state, actual);
  assert.deepEqual(actual, expected);
  assert.equal(accesses, 0);
});

test('unavailable shorter finishing retains a verified state-based fallback', () => {
  for (const size of [4, 7, 10]) {
    const { state } = scramble(size, 57), baseline = layerSolver.solve(state, model);
    const moves = solver.solve(state, model, unavailableEngine);
    assertSolved(state, moves);
    assert(moves.length <= baseline.length);
  }
});

test('a failed state-based baseline reports its error', () => {
  const { state } = scramble(4, 913, 12), original = layerSolver.solve;
  layerSolver.solve = () => { throw new Error('Reduction work limit'); };
  try {
    assert.throws(() => solver.solve(state, model, unavailableEngine), /Reduction work limit/);
  } finally { layerSolver.solve = original; }
});

test('unsupported sizes and malformed optimizer moves are rejected', () => {
  for (const size of [2, 3]) assert.throws(() => solver.solve(model.solvedState(size), model, engine), /4×4 through 10×10/);
  for (const moves of [null, [{}], [{ face: 'R', n: 4 }], [{ face: 'U', n: 1, depth: -1 }]]) {
    assert.throws(() => solver.optimize(moves, 4, model), /Invalid/);
  }
  const { state } = scramble(4, 1);
  assert.throws(() => solver.reducedState(layerSolver.toCube(state, model), model), /not reduced|not paired/);
});
