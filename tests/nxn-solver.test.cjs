'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../cube-model.js');
const vendor = require('../vendor/nxn-solver/solver.js');
const layerSolver = require('../layer-solver.js');

function scrambledState(size, initialSeed) {
  const state = model.solvedState(size);
  let seed = initialSeed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < size * 10; i++) {
    model.applyMove(state, model.FACES[Math.floor(random() * 6)],
      1 + Math.floor(random() * 3), Math.floor(random() * size));
  }
  return state;
}

function replay(state, moves) {
  for (const move of moves) model.applyMove(state, move.face, move.n, move.depth);
}

function assertSolvedFromState(state) {
  const original = JSON.stringify(state), phases = [];
  const moves = layerSolver.solve(state, model, message => phases.push(message));
  assert.equal(JSON.stringify(state), original, 'Solving must not mutate the input');
  const size = model.cubeSize(state);
  assert(moves.length > 0 && moves.length < 20000, 'Expected a bounded constructive solution');
  for (const move of moves) {
    assert(model.FACES.includes(move.face));
    assert([1, 2, 3].includes(move.n));
    assert(Number.isInteger(move.depth) && move.depth >= 0 && move.depth <= (size - 1) / 2);
  }
  assert.equal(phases.length, 3);
  const result = model.cloneState(state);
  replay(result, moves);
  assert.equal(model.isSolved(result), true);
  return moves;
}

test('native face, slice, wide, and whole-cube turns match the independent cubie model', () => {
  for (let size = 4; size <= 10; size++) {
    const initial = scrambledState(size, 12);
    for (const face of model.FACES) {
      for (let layer = 1; layer <= size; layer++) {
        for (const width of new Set([1, layer])) {
          for (const dist of [1, -1, 2]) {
            const state = model.cloneState(initial), cube = layerSolver.toCube(initial, model);
            cube.turn(face, dist, layer, width);
            replay(state, layerSolver.movesForTurn(size, face, dist, layer, width));
            assert.deepEqual(layerSolver.toCube(state, model).matrix, cube.matrix,
              `${size}×${size}: ${face}, dist=${dist}, layer=${layer}, width=${width}`);
          }
        }
      }
    }
  }
});

for (let size = 4; size <= 10; size++) {
  test(`${size}×${size} solves fresh states containing arbitrary inner and outer turns`, () => {
    for (const seed of [1, 2, 19, 817]) {
      const state = scrambledState(size, seed);
      // Piece IDs and array order carry no solution information into this solver.
      state.reverse();
      for (const cubie of state) cubie.id += 1000;
      assertSolvedFromState(state);
    }
  });
}

test('every native step of full odd/even reductions matches cubie-model replay', () => {
  for (const size of [4, 5, 10]) {
    const state = scrambledState(size, 57), cube = layerSolver.toCube(state, model);
    let steps = 0;
    cube.onTurn = (face, dist, layer, width) => {
      assert(++steps < 20000, 'Unexpectedly many reducer steps');
      replay(state, layerSolver.movesForTurn(size, face, dist, layer, width));
      assert.deepEqual(layerSolver.toCube(state, model).matrix, cube.matrix,
        `${size}×${size} intermediate step ${steps}`);
    };
    vendor.solveN(cube);
    assert(cube.isSolved());
    assert(model.isSolved(state));
  }
});

test('even-cube permutation-parity positions solve from their current stickers', () => {
  for (const size of [4, 6, 8, 10]) {
    const state = model.solvedState(size), half = size / 2;
    // The vendor's even-cube PLL parity sequence, applied to an otherwise solved cube.
    const parity = [
      ['R', 2, half, half - 1], ['U', 2, 1, 1],
      ['R', 2, half, half - 1], ['U', 2, half, half],
      ['R', 2, half, half - 1], ['U', 2, half, half - 1]
    ];
    for (const move of parity) replay(state, layerSolver.movesForTurn(size, ...move));
    assert.equal(model.isSolved(state), false);
    assertSolvedFromState(state);
  }
});

test('solved large cubes return no moves and unsupported sizes are rejected', () => {
  for (let size = 4; size <= 10; size++) {
    assert.deepEqual(layerSolver.solve(model.solvedState(size), model), []);
  }
  for (const size of [2, 3]) {
    assert.throws(() => layerSolver.solve(model.solvedState(size), model), /4×4 through 10×10/);
  }
});

test('invalid native move coordinates cannot enter playback', () => {
  for (const args of [
    [4, 'X', 1, 1, 1], [4, 'R', 1, 5, 1], [4, 'R', 1, 1, 2],
    [4, 'U', 1.5, 1, 1], [4, 'F', 1, 2.5, 1], [4, 'L', 1, 2, 0]
  ]) assert.throws(() => layerSolver.movesForTurn(...args), /invalid move/);
});

test('browser worker globals load without CommonJS or DOM dependencies', () => {
  const context = vm.createContext({});
  for (const file of ['vendor/nxn-solver/solver.js', 'layer-solver.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  assert.equal(typeof context.NxNSolver.Cube, 'function');
  assert.equal(typeof context.CubeLayerSolver.solve, 'function');
  const state = scrambledState(4, 913);
  const moves = context.CubeLayerSolver.solve(state, model);
  replay(state, moves);
  assert(model.isSolved(state));
});
