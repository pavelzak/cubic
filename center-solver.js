/*
 * Batched center reduction, adapted from solveCenters in vendor/nxn-solver/solver.js.
 * Original algorithm: Chu Won, based on Vivaan Singhvi's pycubing, MIT licensed.
 * See vendor/nxn-solver/LICENSE for the original notices.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/nxn-solver/solver.js'));
  } else root.CubeCenterSolver = factory(root.NxNSolver);
})(typeof self !== 'undefined' ? self : globalThis, function (vendor) {
  'use strict';

  const { Cube, Faces } = vendor;

  function insertion(size, x, y, fromBack) {
    const frontX = fromBack ? size - 1 - x : x;
    const frontY = fromBack ? size - 1 - y : y;
    const fixedSlice = frontX + 1;
    const diagonal = fixedSlice === frontY + 1;
    return {
      frontX, frontY, fixedSlice,
      slice: diagonal ? size - frontY : frontY + 1,
      adjust: diagonal ? 1 : -1
    };
  }

  function rotatedColor(face, size, y, x, turns) {
    for (let i = 0; i < turns; i++) [y, x] = [size - 1 - x, y];
    return face[y][x];
  }

  // For distinct insertion slices, none equal to the fixed slice, these
  // center commutators have disjoint effects. Their product factors into one
  // commutator with all insertion slices: k insertions cost 2k + 6, not 8k.
  function insertBatch(cube, fixedSlice, slices, fromBack, adjust) {
    const distance = fromBack ? -2 : -1, face = fromBack ? 'B' : 'U';
    cube.turn('L', distance, fixedSlice, 1);
    cube.turn(face, adjust, 1, 1);
    for (const slice of slices) cube.turn('L', distance, slice, 1);
    cube.turn(face, -adjust, 1, 1);
    cube.turn('L', -distance, fixedSlice, 1);
    cube.turn(face, adjust, 1, 1);
    for (const slice of slices) cube.turn('L', -distance, slice, 1);
    cube.turn(face, -adjust, 1, 1);
  }

  function chooseBatch(cube, sourceFace, targetColor, fromBack) {
    const size = cube.size;
    let best = null;
    for (let x = 1; x < size - 1; x++) for (const adjust of [-1, 1]) {
      const candidates = [];
      for (let y = 1; y < size - 1; y++) {
        if (cube.matrix[sourceFace][y][x] !== targetColor) continue;
        const next = insertion(size, x, y, fromBack);
        if (next.adjust === adjust && next.slice !== next.fixedSlice) candidates.push(next);
      }
      if (!candidates.length) continue;
      for (let turns = 0; turns < 4; turns++) {
        const selected = candidates.filter(next =>
          rotatedColor(cube.matrix[Faces.Front], size, next.frontY, next.frontX, turns) !== targetColor);
        const cost = selected.length * 2 + 6 + (turns ? 1 : 0);
        const score = selected.length / cost;
        if (selected.length && (!best || score > best.score)) best = { selected, turns, score };
      }
    }
    return best;
  }

  function solve(cube) {
    const size = cube.size;
    if (!Number.isInteger(size) || size < 4 || size > 10) {
      throw new Error('Batched center solving supports 4×4 through 10×10.');
    }
    const reference = new Cube(1), solvedColors = new Set();
    if (size % 2) {
      const middle = Math.floor(size / 2);
      for (let face = 0; face < Faces.length; face++) {
        reference.matrix[face][0][0] = cube.matrix[face][middle][middle];
      }
    }
    for (const orientation of ['', 'y', 'y', 'y', 'x', 'x2']) {
      cube.parse(orientation);
      reference.parse(orientation);
      const targetColor = reference.matrix[Faces.Front][0][0];
      for (let source = 0; source < 5; source++) {
        if (source < 4) {
          cube.turn('B', 1, size - 1, size - 1);
          reference.turn('B', 1, 1, 1);
        }
        const fromBack = source === 4, sourceFace = fromBack ? Faces.Back : Faces.Top;
        if (solvedColors.has(cube.matrix[sourceFace][1][1])) continue;
        // Each batch fills previously incorrect slots without removing any
        // solved target centers, so at most (size - 2)^2 batches are needed.
        for (let count = 0; count < (size - 2) ** 2; count++) {
          const batch = chooseBatch(cube, sourceFace, targetColor, fromBack);
          if (!batch) break;
          if (batch.turns) cube.turn('F', batch.turns, 1, 1);
          const first = batch.selected[0];
          insertBatch(cube, first.fixedSlice, batch.selected.map(next => next.slice), fromBack, first.adjust);
        }
      }
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        if (cube.matrix[Faces.Front][y][x] !== targetColor) {
          throw new Error('Batched center solving did not finish a face.');
        }
      }
      solvedColors.add(targetColor);
    }
  }

  return { solve, insertBatch };
});
