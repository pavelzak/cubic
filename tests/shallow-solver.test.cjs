'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../cube-model.js');
const shallow = require('../shallow-solver.js');

function apply(state, moves) {
  for (const move of moves) model.applyMove(state, move.face, move.n, move.depth);
}

function fourMoves(size) {
  return [{ face: 'R', n: 1, depth: 1 }, { face: 'U', n: 3, depth: 0 },
    { face: 'F', n: 2, depth: 0 }, { face: 'L', n: 1, depth: Math.min(2, size - 1) }];
}

function assertSolution(state, moves, limit) {
  assert(Array.isArray(moves));
  assert(moves.length <= limit);
  const size = model.cubeSize(state), result = model.cloneState(state);
  assert(moves.every(move => move.depth >= 0 && move.depth <= Math.floor((size - 1) / 2)),
    'Moves must use the nearer face for each slice');
  apply(result, moves);
  assert(model.isSolved(result));
}

test('one through four turns respect the requested depth and prioritize shorter solutions', () => {
  for (const size of [4, 7, 10]) {
    const state = model.solvedState(size);
    assert.deepEqual(shallow.find(state, model, 4), []);
    for (let length = 1; length <= 4; length++) {
      apply(state, [fourMoves(size)[length - 1]]);
      if (length > 1) assert.equal(shallow.find(state, model, length - 1), null);
      const moves = shallow.find(state, model, 4);
      assert.equal(moves.length, length);
      assertSolution(state, moves, length);
    }
  }
});

test('four-turn lookup preserves commuting slices, rotated colors, and unordered cubies on every size', () => {
  for (let size = 2; size <= 10; size++) {
    for (const sequence of [fourMoves(size), [
      { face: 'U', n: 1, depth: size - 1 }, { face: 'R', n: 1, depth: 0 },
      { face: 'R', n: 2, depth: size - 1 }, { face: 'F', n: 3, depth: Math.floor(size / 2) }
    ]]) {
      const state = model.solvedState(size);
      for (let depth = 0; depth < size; depth++) model.applyMove(state, 'F', 1, depth);
      apply(state, sequence);
      state.reverse();
      for (const cubie of state) cubie.id += 1000;
      const before = JSON.stringify(state), moves = shallow.find(state, model, 4);
      assertSolution(state, moves, 4);
      assert.equal(JSON.stringify(state), before);
    }
  }
});

test('random positions outside four turns return null instead of an unverified solution', () => {
  for (const size of [4, 5, 10]) {
    const state = model.solvedState(size);
    let seed = 19;
    function next() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    for (let i = 0; i < size * 10; i++) {
      model.applyMove(state, model.FACES[Math.floor(next() * 6)], 1 + Math.floor(next() * 3), Math.floor(next() * size));
    }
    assert.equal(shallow.find(state, model, 4), null);
  }
});

test('mutating returned moves cannot corrupt cached searches', () => {
  for (const length of [1, 2, 4]) {
    const state = model.solvedState(4);
    apply(state, fourMoves(4).slice(0, length));
    const moves = shallow.find(state, model, 4);
    assert.equal(moves.length, length);
    for (const move of moves) { move.face = 'invalid'; move.n = 0; move.depth = -1; }
    assertSolution(state, shallow.find(state, model, 4), length);
    const unrelated = model.solvedState(4);
    apply(unrelated, [{ face: 'B', n: 2, depth: 1 }, { face: 'D', n: 1, depth: 0 }]);
    assertSolution(unrelated, shallow.find(unrelated, model, 4), 2);
  }
});

test('browser module has no dependencies and retains only one large table across size changes', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../shallow-solver.js'), 'utf8'), context);
  let builds = 0;
  const countedModel = { ...model, solvedState(size) { builds++; return model.solvedState(size); } };
  const find = size => {
    const state = model.solvedState(size);
    apply(state, fourMoves(size));
    assertSolution(state, context.CubeShallowSolver.find(state, countedModel, 4), 4);
  };
  find(10); assert.equal(builds, 2, 'Build the one-turn and two-turn tables once');
  find(10); assert.equal(builds, 2, 'Reuse both tables for a repeated size');
  find(7); assert.equal(builds, 4, 'Build tables for the new size');
  find(10); assert.equal(builds, 5, 'The old two-turn table was evicted; its small table remains');
});

test('invalid depths and incomplete or malformed sticker states fail before searching', () => {
  for (const depth of [0, 5, 1.5, NaN]) assert.throws(() => shallow.find(model.solvedState(4), model, depth), /depth/);
  assert.throws(() => shallow.find(model.solvedState(4), { ...model, cubeSize() { return 11; } }), /sizes/);
  const missing = model.solvedState(4);
  missing.pop();
  assert.throws(() => shallow.find(missing, model), /Incomplete/);
  const duplicate = model.solvedState(4);
  duplicate.push(duplicate[0]);
  assert.throws(() => shallow.find(duplicate, model), /position/);
  const colors = model.solvedState(4);
  colors[0].s[Object.keys(colors[0].s)[0]] = 'unexpected';
  assert.throws(() => shallow.find(colors, model), /colors/);
});
