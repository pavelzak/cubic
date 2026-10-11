'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../cube-model.js');
const reduction = require('../vendor/four-solver/solver.js');
const solver = require('../four-solver.js');
const moveOptimizer = require('../move-optimizer.js');
const shallowSolver = require('../shallow-solver.js');
const adapter = require('../solver-engine.js');
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');
const engine = adapter.createEngine(model, Cube);

function replay(state, moves) {
  const result = model.cloneState(state);
  for (const move of moves) model.applyMove(result, move.face, move.n, move.depth || 0);
  return result;
}

function scramble(seed, length = 40) {
  const state = model.solvedState(4);
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 4294967296 * n);
  };
  for (let i = 0; i < length; i++) model.applyMove(state, model.FACES[random(6)], random(3) + 1, random(4));
  return state;
}

function rotate(state, face, n = 1) {
  const result = model.cloneState(state);
  for (let depth = 0; depth < 4; depth++) model.applyMove(result, face, n, depth);
  return result;
}

function stateKey(state) {
  return state.map(piece => piece.p.join(',') + ':' + Object.entries(piece.s).sort().flat().join('')).sort().join('|');
}

function orientations(state) {
  const queue = [state], seen = new Set([stateKey(state)]);
  for (let i = 0; i < queue.length; i++) for (const face of 'RUF') {
    const next = rotate(queue[i], face), key = stateKey(next);
    if (!seen.has(key)) { seen.add(key); queue.push(next); }
  }
  assert.equal(queue.length, 24);
  return queue;
}

function assertSolution(state, options = {}) {
  const initial = JSON.stringify(state), progress = [];
  const moves = solver.solve(state, model, options.engine || engine, text => progress.push(text));
  assert.equal(JSON.stringify(state), initial, 'Solving must not change input state');
  assert(moves.length <= (options.max || 100), 'Expected a bounded three-phase solution');
  adapter.verifySolution(state, moves, model);
  return { moves, progress };
}

test('solved orientations and short slice positions avoid three-phase table initialization', () => {
  assert.equal(reduction.isInitialized(), false);
  for (const state of orientations(model.solvedState(4))) assert.deepEqual(solver.solve(state, model), []);
  for (const face of model.FACES) for (let depth = 0; depth < 4; depth++) for (let n = 1; n <= 3; n++) {
    const state = replay(model.solvedState(4), [{ face, n, depth }]);
    const moves = solver.solve(state, model);
    assert.equal(moves.length, 1);
    adapter.verifySolution(state, moves, model);
  }
  for (const pair of [
    [{ face: 'R', n: 1, depth: 1 }, { face: 'U', n: 3 }],
    [{ face: 'F', n: 2, depth: 2 }, { face: 'B', n: 3, depth: 0 }],
    [{ face: 'L', n: 1, depth: 3 }, { face: 'U', n: 2, depth: 2 }]
  ]) {
    for (const state of orientations(replay(model.solvedState(4), pair))) {
      const moves = solver.solve(state, model);
      assert(moves.length <= 2);
      adapter.verifySolution(state, moves, model);
    }
  }
  for (const sequence of [
    [{ face: 'R', n: 1, depth: 1 }, { face: 'U', n: 3 }, { face: 'F', n: 2, depth: 1 }],
    [{ face: 'L', n: 1, depth: 2 }, { face: 'F', n: 3 }, { face: 'U', n: 2, depth: 1 }, { face: 'B', n: 1, depth: 1 }]
  ]) {
    for (const state of orientations(replay(model.solvedState(4), sequence)).slice(0, 4)) {
      const moves = solver.solve(state, model);
      assert(moves.length <= sequence.length);
      adapter.verifySolution(state, moves, model);
    }
  }
  assert.equal(reduction.isInitialized(), false);
});

test('already-reduced positions use the 3×3 finish without generating three-phase tables', () => {
  const state = model.solvedState(4);
  model.applySeq(state, "R U F2 L' B D2");
  const { moves, progress } = assertSolution(state, { max: 6 });
  assert(moves.every(move => !move.depth));
  assert(!progress.some(text => /preparing the three-phase/.test(text)));
  assert.equal(reduction.isInitialized(), false);
  const reduced = solver.reducedState(state, model);
  assert(reduced && solver.canFinish(reduced, model));
});

test('all 36 native outer/wide moves agree with CubeModel on arbitrary cubie permutations', () => {
  for (const state of [model.solvedState(4), scramble(91)]) {
    const pieces = solver.toPieces(state, model), before = JSON.stringify(pieces);
    for (let index = 0; index < 36; index++) {
      const expected = solver.toPieces(replay(state, solver.expandMoves([index])), model);
      assert.deepEqual(reduction.applyMove(pieces, index), expected, 'Native move ' + index);
    }
    assert.equal(JSON.stringify(pieces), before);
  }
  assert.equal(reduction.isInitialized(), false, 'Move model access must not generate pruning tables');
});

test('complete optimized solutions improve the v1.5.0 fixtures without input order, IDs or history', () => {
  // Measured from the same deterministic states on the released v1.5.0 solver.
  const previousCounts = [[1, 63], [2, 63], [19, 57], [817, 56], [1414, 62], [9917, 58]];
  let previousTotal = 0, improvedTotal = 0;
  for (const [seed, previousCount] of previousCounts) {
    const state = scramble(seed);
    state.reverse();
    state.forEach((piece, i) => { piece.id = 'unrelated-' + i; });
    Object.defineProperty(state, 'history', { get() { throw new Error('History must never be accessed'); } });
    const { moves, progress } = assertSolution(state);
    assert(moves.length <= previousCount, 'Comparisons must retain the first verified answer');
    previousTotal += previousCount; improvedTotal += moves.length;
    assert(moves.some(move => move.depth > 0), 'Inner slices must be preserved');
    assert(progress.some(text => /searching the three-phase reduction/.test(text)));
    assert(progress.filter(text => /comparing complete solutions/.test(text)).length <= 5);
  }
  assert(improvedTotal < previousTotal, 'The verified post-processing should improve these fixtures');
  assert.equal(reduction.isInitialized(), true);
});

test('a spatially rotated arbitrary cube solves in its displayed frame', () => {
  const state = scramble(7331);
  for (const [face, n] of [['R', 1], ['R', 2], ['R', 3], ['F', 1], ['F', 3]]) {
    assertSolution(rotate(state, face, n));
  }
});

test('OLL and PLL parity are routed through reduction rather than an illegal 3×3 search', () => {
  const oll = model.solvedState(4);
  for (const token of "Rw U2 x Rw U2 Rw U2 Rw' U2 Lw U2 Rw' U2 Rw U2 Rw' U2 Rw'".split(' ')) {
    const match = token.match(/^([URFDLBx])(w)?(2|')?$/);
    const n = match[3] === '2' ? 2 : match[3] === "'" ? 3 : 1;
    const depths = match[1] === 'x' ? [0, 1, 2, 3] : match[2] ? [0, 1] : [0];
    for (const depth of depths) model.applyMove(oll, match[1] === 'x' ? 'R' : match[1], n, depth);
  }
  const pll = replay(model.solvedState(4), [
    { face: 'R', n: 2, depth: 1 }, { face: 'U', n: 2 }, { face: 'R', n: 2, depth: 1 },
    { face: 'U', n: 2 }, { face: 'U', n: 2, depth: 1 },
    { face: 'R', n: 2, depth: 1 }, { face: 'U', n: 2, depth: 1 }
  ]);
  for (const state of [oll, pll]) {
    assert(!model.isSolved(state));
    const reduced = solver.reducedState(state, model);
    assert(reduced);
    assert.equal(solver.canFinish(reduced, model), false);
    const checkedEngine = { solveNearOptimal(input, progress) {
      assert.equal(solver.canFinish(input, model), true, 'Two-phase must receive a legal 3×3 state');
      return engine.solveNearOptimal(input, progress);
    } };
    assertSolution(state, { engine: checkedEngine });
  }
});

test('invalid positions, unsupported sizes and invalid finishing moves fail before playback', () => {
  for (const size of [2, 3, 5, 10]) assert.throws(() => solver.solve(model.solvedState(size), model, engine), /only 4×4/);
  for (const bad of [-1, 36, 1.5, 'U']) assert.throws(() => solver.expandMoves([bad]), /Invalid/);
  const twisted = model.solvedState(4), corner = twisted.find(piece => Object.keys(piece.s).length === 3);
  const faces = Object.keys(corner.s), colors = Object.values(corner.s);
  faces.forEach((face, i) => { corner.s[face] = colors[(i + 1) % 3]; });
  assert.throws(() => solver.solve(twisted, model, engine), /Invalid 4×4/);
  const duplicate = model.solvedState(4);
  duplicate[0] = model.cloneState([duplicate[1]])[0];
  assert.throws(() => solver.solve(duplicate, model, engine), /Invalid 4×4/);
  const state = model.solvedState(4);
  model.applySeq(state, "R U F L B D");
  assert.throws(() => solver.solve(state, model, { solveNearOptimal: () => [] }), /failed verification/);
  assert.throws(() => solver.solve(state, model, { solveNearOptimal: () => [{ face: 'R', n: 1, depth: 5 }] }), /Invalid move/);
});

test('a failed alternative reduction or invalid finish preserves the verified first answer', () => {
  const originalReduce = reduction.reduce, originalOptimize = moveOptimizer.optimize;
  for (const failure of ['reduction', 'finish']) {
    let reductions = 0, finishes = 0, baseline;
    try {
      reduction.reduce = (...args) => {
        if (++reductions > 1 && failure === 'reduction') throw new Error('Alternative reduction failed');
        return originalReduce(...args);
      };
      moveOptimizer.optimize = (...args) => {
        const result = originalOptimize(...args);
        if (!baseline) baseline = result;
        return result;
      };
      const checkedEngine = { solveNearOptimal(...args) {
        if (++finishes > 1 && failure === 'finish') return [{ face: 'invalid', n: 1 }];
        return engine.solveNearOptimal(...args);
      } };
      const { moves } = assertSolution(scramble(1), { engine: checkedEngine });
      assert.deepEqual(moves, baseline);
      assert(reductions > 1 && reductions <= 6);
    } finally {
      reduction.reduce = originalReduce;
      moveOptimizer.optimize = originalOptimize;
    }
  }
});

test('optional simplification errors and incorrect simplifications retain a verified solution', () => {
  const originalOptimize = moveOptimizer.optimize;
  const state = model.solvedState(4);
  model.applySeq(state, "R U F L B D");
  for (const optimize of [() => { throw new Error('Optimizer failed'); }, () => []]) {
    try {
      moveOptimizer.optimize = optimize;
      assertSolution(state, { max: 6 });
    } finally { moveOptimizer.optimize = originalOptimize; }
  }
});

test('the comparison deadline retains a completed candidate and prevents starting more searches', () => {
  const originalNow = Date.now, originalReduce = reduction.reduce;
  let now = 0, calls = 0;
  try {
    Date.now = () => now;
    reduction.reduce = (...args) => {
      const result = originalReduce(...args);
      // The initial solve has no comparison deadline. The first alternative
      // finishes just past it and must not trigger another reduction search.
      if (++calls === 2) now += 5001;
      return result;
    };
    const { moves, progress } = assertSolution(scramble(2));
    assert(moves.length <= 57, 'Never lose the independently optimized baseline');
    assert.equal(calls, 2);
    assert.equal(progress.filter(text => /comparing complete solutions/.test(text)).length, 1);
  } finally {
    Date.now = originalNow;
    reduction.reduce = originalReduce;
  }
});

test('browser globals stay scoped and ignore legacy extra history input', () => {
  let optimized = 0;
  const context = vm.createContext({ CubeShallowSolver: shallowSolver, CubeMoveOptimizer: { optimize(...args) {
    optimized++;
    return moveOptimizer.optimize(...args);
  } } });
  for (const file of ['cube-model.js', 'vendor/four-solver/solver.js', 'four-solver.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  assert.deepEqual(Object.keys(context).sort(), ['CubeFourReduction', 'CubeFourSolver', 'CubeModel', 'CubeMoveOptimizer', 'CubeShallowSolver']);
  const state = replay(model.solvedState(4), [{ face: 'R', n: 1, depth: 1 }, { face: 'F', n: 2 }]);
  const poison = new Proxy({}, { get() { throw new Error('Legacy move history must be ignored'); } });
  const result = context.CubeFourSolver.solve(state, model, null, null, poison);
  assert(result.length <= 2);
  adapter.verifySolution(state, result, model);
  const reduced = model.solvedState(4);
  model.applySeq(reduced, 'R U F L B D');
  adapter.verifySolution(reduced, context.CubeFourSolver.solve(reduced, model, engine, null, poison), model);
  assert(optimized > 0, 'Browser mode should use the shared simplifier');
  assert.equal(context.CubeFourReduction.isInitialized(), false);
});
