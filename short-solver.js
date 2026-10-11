(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/nxn-solver/solver.js'), require('./layer-solver.js'),
      require('./solver-engine.js'), require('./shallow-solver.js'), require('./move-optimizer.js'),
      require('./center-solver.js'), function () { return require('./vendor/cubejs/cube.js'); });
  } else {
    root.CubeShortSolver = factory(root.NxNSolver, root.CubeLayerSolver, root.CubeSolverEngine, root.CubeShallowSolver, root.CubeMoveOptimizer,
      root.CubeCenterSolver, function () { return root.Cube; });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (vendor, layerSolver, adapter, shallowSolver, moveOptimizer, centerSolver, getCube) {
'use strict';

const faces = 'FLBRUD';
const optimize = moveOptimizer.optimize;

function solves(state, moves, model) {
  try { adapter.verifySolution(state, moves, model); return true; }
  catch (_) { return false; }
}

function reducedState(cube, model) {
  const end = cube.size - 1, positions = [0, 1, end];
  for (const face of cube.matrix) {
    for (let row = 1; row < end; row++) for (let col = 1; col < end; col++) {
      if (face[row][col] !== face[1][1]) throw new Error('Centers are not reduced.');
    }
    for (let i = 1; i < end; i++) {
      if (face[0][i] !== face[0][1] || face[end][i] !== face[end][1] ||
          face[i][0] !== face[1][0] || face[i][end] !== face[1][end]) {
        throw new Error('Edges are not paired.');
      }
    }
  }
  const state = model.solvedState(3);
  for (const cubie of state) {
    const [x, y, z] = cubie.p;
    const coordinates = {
      F: [1 - y, x + 1], L: [1 - y, z + 1], B: [1 - y, 1 - x],
      R: [1 - y, 1 - z], U: [z + 1, x + 1], D: [1 - z, x + 1]
    };
    for (const face of Object.keys(cubie.s)) {
      const [row, col] = coordinates[face];
      cubie.s[face] = faces[cube.matrix[faces.indexOf(face)][positions[row]][positions[col]]];
    }
  }
  return state;
}

function parity(permutation) {
  let result = 0;
  for (let i = 0; i < permutation.length; i++) for (let j = i + 1; j < permutation.length; j++) {
    if (permutation[i] > permutation[j]) result ^= 1;
  }
  return result;
}

function reductionParity(state, model) {
  const Cube = getCube(), cube = Cube.fromString(adapter.toFacelets(state, model));
  const validPermutation = (values, count) => values.length === count &&
    values.every(value => Number.isInteger(value) && value >= 0 && value < count) && new Set(values).size === count;
  if (!validPermutation(cube.cp, 8) || !validPermutation(cube.ep, 12) ||
      cube.co.reduce((sum, value) => sum + value, 0) % 3 ||
      cube.eo.reduce((sum, value) => sum + value, 0) % 2) {
    throw new Error('The reduced cube has invalid pieces or orientation parity.');
  }
  return parity(cube.cp) !== parity(cube.ep);
}

function correctParity(cube) {
  // The same PLL parity algorithm used by the vendored beginner finish.
  const half = cube.size / 2, inner = half - 1;
  cube.turn('R', 2, half, inner);
  cube.turn('U', 2, 1, 1);
  cube.turn('R', 2, half, inner);
  cube.turn('U', 2, half, half);
  cube.turn('R', 2, half, inner);
  cube.turn('U', 2, half, inner);
}

function searchPlans(size, deep) {
  const first = [[], [['R', 1]], [['R', 2]], [['R', 3]], [['F', 1]], [['F', 3]]];
  if (!deep) return first.map(turns => ({ turns }));

  // Try the fast mode's six orientations first, then each remaining orientation.
  const orientations = [], seen = new Set();
  function add(turns) {
    const cube = new vendor.Cube(1);
    for (const [face, n] of turns) cube.turn(face, n, 1, 1);
    const key = cube.matrix.map(face => face[0][0]).join('');
    if (!seen.has(key)) { seen.add(key); orientations.push(turns); }
  }
  for (const turns of first) add(turns);
  for (const turns of first) for (let spin = 1; spin < 4; spin++) add(turns.concat([['U', spin]]));
  const plans = orientations.map(turns => ({ turns }));
  for (let i = 0; i < orientations.length; i++) {
    const turns = orientations[i];
    // A counted setup turn changes the greedy center/edge reduction path.
    for (const face of ['R', 'U', 'F']) plans.push({ turns, setup: [face, 1] });
    // Even cubes can also choose a different valid target color arrangement.
    // On odd cubes the fixed center colors already determine those targets.
    if (size % 2 === 0) plans.push({ turns, palette: [['R', 'U', 'F'][i % 3], 1] });
  }
  return plans;
}

function solveWithOptions(state, model, nearOptimalEngine, onProgress, deep) {
  const size = model.cubeSize(state);
  if (size < 4 || size > 10) throw new Error('Shorter solving supports 4×4 through 10×10.');
  if (model.isSolved(state)) return [];
  onProgress = onProgress || function () {};
  onProgress('Checking for a short solution…');
  const short = shallowSolver.find(state, model, deep ? 4 : 2);
  if (short) return short;

  onProgress('Building and simplifying a reduction solution…');
  let best = optimize(layerSolver.solve(state, model), size, model);
  if (!solves(state, best, model)) throw new Error('The shorter solution failed verification.');

  // Keep a verified result before searching alternative reduction orders.
  // Worker termination remains immediate if the user presses Stop.
  const deadline = Date.now() + (deep ? 10000 : 2000);
  // Interleave both center methods so neither depends on a long search
  // finishing every orientation. Keep the same overall time budget.
  const plans = searchPlans(size, deep).flatMap(plan => [plan, { ...plan, batchCenters: true }]);
  const finishCache = deep ? new Map() : null;
  for (let attempt = 0; attempt < plans.length && Date.now() < deadline; attempt++) {
    onProgress((deep ? 'Deep search: comparing reductions (' : 'Comparing shorter reductions (') +
      (attempt + 1) + '/' + plans.length + ')…');
    try {
      const cube = layerSolver.toCube(state, model), raw = [];
      let finishing = false;
      cube.onTurn = function (face, dist, layer, width) {
        if ((!finishing && Date.now() > deadline) || raw.length > 100000) throw new Error('Shorter-solution search limit.');
        raw.push(...layerSolver.movesForTurn(size, face, dist, layer, width));
      };
      const plan = plans[attempt];
      if (plan.palette) {
        const palette = new vendor.Cube(1);
        palette.turn(plan.palette[0], plan.palette[1], 1, 1);
        const colors = palette.matrix.map(face => face[0][0]);
        for (const face of cube.matrix) for (const row of face) {
          for (let col = 0; col < row.length; col++) row[col] = colors[row[col]];
        }
      }
      if (plan.setup) cube.turn(plan.setup[0], plan.setup[1], 1, 1);
      for (const [face, n] of plan.turns) cube.turn(face, n, size, size);
      if (plan.batchCenters) centerSolver.solve(cube);
      else vendor.solveCenters(cube);
      vendor.solveEdges(cube);
      let reduced = reducedState(cube, model);
      if (reductionParity(reduced, model)) {
        if (size % 2) throw new Error('Unexpected odd-cube permutation parity.');
        correctParity(cube);
        reduced = reducedState(cube, model);
        if (reductionParity(reduced, model)) throw new Error('Parity correction did not finish.');
      }
      // Finish a search already in progress even if initialization crossed the
      // time budget; its verified result is preferable to discarding that work.
      finishing = true;
      const key = finishCache && adapter.toFacelets(reduced, model);
      let finish = finishCache && finishCache.get(key);
      if (!finish) {
        finish = nearOptimalEngine.solveNearOptimal(reduced, onProgress);
        if (finishCache) finishCache.set(key, finish);
      }
      for (const move of finish) cube.turn(move.face, move.n, 1, 1);
      if (!cube.isSolved()) throw new Error('The reduced finish did not solve this cube.');
      const candidate = optimize(raw, size, model);
      if (candidate.length < best.length && solves(state, candidate, model)) best = candidate;
    } catch (_) { /* Retain the independently verified best candidate. */ }
  }
  return best;
}

function solve(state, model, nearOptimalEngine, onProgress) {
  return solveWithOptions(state, model, nearOptimalEngine, onProgress, false);
}

function solveDeep(state, model, nearOptimalEngine, onProgress) {
  return solveWithOptions(state, model, nearOptimalEngine, onProgress, true);
}

return { solve, solveDeep, optimize, reducedState };
});
