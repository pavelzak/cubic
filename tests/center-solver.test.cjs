'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const model = require('../cube-model.js');
const vendor = require('../vendor/nxn-solver/solver.js');
const layer = require('../layer-solver.js');
const centers = require('../center-solver.js');
const adapter = require('../solver-engine.js');

function labeledCube(size) {
  const cube = new vendor.Cube(size);
  let label = 0;
  for (const face of cube.matrix) for (const row of face) {
    for (let x = 0; x < size; x++) row[x] = label++;
  }
  return cube;
}

function scrambledState(size, seed) {
  const state = model.solvedState(size);
  function next() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let depth = 0; depth < size; depth++) model.applyMove(state, 'B', 3, depth);
  for (let i = 0; i < size * 10; i++) {
    model.applyMove(state, model.FACES[Math.floor(next() * 6)],
      1 + Math.floor(next() * 3), Math.floor(next() * size));
  }
  return state;
}

function assertCenters(cube) {
  for (const face of cube.matrix) for (let y = 1; y < cube.size - 1; y++) {
    for (let x = 1; x < cube.size - 1; x++) assert.equal(face[y][x], face[1][1]);
  }
}

test('batch commutators equal separate insertions on every individual sticker', () => {
  for (let size = 4; size <= 10; size++) for (let fixed = 2; fixed < size; fixed++) {
    const available = Array.from({ length: size - 2 }, (_, i) => i + 2).filter(slice => slice !== fixed);
    const batches = [available];
    for (let a = 0; a < available.length; a++) for (let b = a + 1; b < available.length; b++) {
      batches.push([available[a], available[b]]);
    }
    for (const slices of batches) for (const fromBack of [false, true]) for (const adjust of [-1, 1]) {
      const batched = labeledCube(size), separate = labeledCube(size);
      centers.insertBatch(batched, fixed, slices, fromBack, adjust);
      for (const slice of slices) centers.insertBatch(separate, fixed, [slice], fromBack, adjust);
      assert.deepEqual(batched.matrix, separate.matrix, `${size}×${size}, ${fixed}, ${slices}, ${fromBack}, ${adjust}`);
    }
  }
});

test('batched centers leave a valid reduction for odd, even, and rotated cubes', () => {
  for (let size = 4; size <= 10; size++) for (const seed of [17, 29, 103, 907]) {
    const state = scrambledState(size, seed), cube = layer.toCube(state, model), moves = [];
    const before = JSON.stringify(state);
    cube.onTurn = (face, n, depth, width) => {
      moves.push(...layer.movesForTurn(size, face, n, depth, width));
      assert(moves.length < 100000, 'Center reduction must make bounded progress');
    };
    centers.solve(cube);
    assertCenters(cube);
    vendor.solveEdges(cube);
    vendor.solveCorners(cube);
    assert(cube.isSolved(), `${size}×${size}, seed ${seed}`);
    adapter.verifySolution(state, moves, model);
    assert.equal(JSON.stringify(state), before);
  }
});

test('batching materially reduces the center work on fully scrambled large cubes', () => {
  let originalTurns = 0, batchedTurns = 0;
  for (const seed of [19, 41, 73]) {
    const state = scrambledState(10, seed);
    for (const [solve, kind] of [[vendor.solveCenters, 'original'], [centers.solve, 'batched']]) {
      const cube = layer.toCube(state, model);
      cube.onTurn = (_face, n, _layer, width) => {
        if (((n % 4) + 4) % 4) {
          if (kind === 'original') originalTurns += width;
          else batchedTurns += width;
        }
      };
      solve(cube);
      assertCenters(cube);
    }
  }
  assert(batchedTurns < originalTurns * 0.85, `${batchedTurns} should be under 85% of ${originalTurns}`);
});

test('unsupported sizes are rejected before changing the cube', () => {
  for (const size of [2, 3, 11]) {
    const cube = new vendor.Cube(size), before = cube.copy();
    assert.throws(() => centers.solve(cube), /4×4 through 10×10/);
    assert.deepEqual(cube.matrix, before);
  }
});
