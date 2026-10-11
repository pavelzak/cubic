(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/nxn-solver/solver.js'), require('./layer-solver.js'),
      require('./solver-engine.js'), function () { return require('./vendor/cubejs/cube.js'); });
  } else {
    root.CubeShortSolver = factory(root.NxNSolver, root.CubeLayerSolver, root.CubeSolverEngine,
      function () { return root.Cube; });
  }
})(typeof self !== 'undefined' ? self : globalThis, function (vendor, layerSolver, adapter, getCube) {
'use strict';

const faces = 'FLBRUD';
const axes = ['R', 'U', 'F'];
const opposite = { R: 'L', U: 'D', F: 'B' };
const shortTables = new Map();
const mod4 = n => ((n % 4) + 4) % 4;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rotate(vector, axis, turns) {
  for (let i = 0; i < turns; i++) {
    const d = dot(vector, axis);
    const cross = [axis[1] * vector[2] - axis[2] * vector[1],
      axis[2] * vector[0] - axis[0] * vector[2], axis[0] * vector[1] - axis[1] * vector[0]];
    vector = axis.map((value, j) => value * d - cross[j]);
  }
  return vector;
}

function nearestMove(axis, depth, n, size) {
  let face = axes[axis];
  if (depth > (size - 1) / 2) {
    depth = size - depth - 1;
    face = opposite[face];
    n = 4 - n;
  }
  return { face, depth, n };
}

function validateMove(move, size, model) {
  const depth = move && move.depth !== undefined ? move.depth : 0;
  if (!move || !Object.prototype.hasOwnProperty.call(model.N, move.face) ||
      ![1, 2, 3].includes(move.n) || !Number.isInteger(depth) || depth < 0 || depth >= size) {
    throw new Error('Invalid move in a shorter-solution candidate.');
  }
  return depth;
}

// Parallel slices commute. A common turn on every slice is a whole-cube
// rotation: carry it in the coordinate frame instead of animating N moves.
// A solved cube may finish in any orientation, as in CubeModel.isSolved.
function optimize(moves, size, model) {
  if (!Array.isArray(moves)) throw new Error('Invalid shorter-solution candidate.');
  let current = moves;
  for (let pass = 0; pass < 3; pass++) {
    const groups = [];
    for (const move of current) {
      const depth = validateMove(move, size, model), normal = model.N[move.face];
      const axis = normal.findIndex(value => value !== 0), positive = normal[axis] > 0;
      let group = groups[groups.length - 1];
      if (!group || group.axis !== axis) {
        group = { axis, turns: Array(size).fill(0) };
        groups.push(group);
      }
      const index = positive ? depth : size - depth - 1;
      group.turns[index] = mod4(group.turns[index] + (positive ? move.n : -move.n));
      if (group.turns.every(turns => turns === 0)) groups.pop();
    }

    let frame = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const result = [];
    for (const group of groups) {
      const counts = [0, 0, 0, 0];
      for (const turns of group.turns) counts[turns]++;
      let rotation = 0;
      for (let n = 1; n < 4; n++) if (counts[n] > counts[rotation]) rotation = n;
      const virtualAxis = model.N[axes[group.axis]];
      const actualAxis = frame.map(vector => dot(vector, virtualAxis));
      const axis = actualAxis.findIndex(value => value !== 0), positive = actualAxis[axis] > 0;
      for (let depth = 0; depth < size; depth++) {
        const n = mod4(group.turns[depth] - rotation);
        if (n) result.push(nearestMove(axis, positive ? depth : size - depth - 1,
          positive ? n : 4 - n, size));
      }
      if (rotation) frame = frame.map(vector => rotate(vector, virtualAxis, rotation));
    }
    if (result.length >= current.length) return result;
    current = result;
  }
  return current;
}

function solves(state, moves, model) {
  try { adapter.verifySolution(state, moves, model); return true; }
  catch (_) { return false; }
}

// Color names do not change the move needed to solve a sticker pattern.
// This also recognizes uniformly solved cubes in any final orientation.
function patternKey(state, model) {
  const matrix = layerSolver.toCube(state, model).matrix;
  const colors = new Map();
  let key = '';
  for (const face of matrix) for (const row of face) for (const color of row) {
    if (!colors.has(color)) colors.set(color, colors.size);
    key += colors.get(color);
  }
  return key;
}

function shortSolution(state, size, model) {
  let table = shortTables.get(size);
  if (!table) {
    const moves = [], states = new Map(), solved = model.solvedState(size);
    for (let axis = 0; axis < 3; axis++) for (let depth = 0; depth < size; depth++) {
      for (let n = 1; n <= 3; n++) {
        const move = nearestMove(axis, depth, n, size), next = model.cloneState(solved);
        moves.push(move);
        model.applyMove(next, move.face, move.n, move.depth);
        states.set(patternKey(next, model), { face: move.face, depth: move.depth, n: 4 - move.n });
      }
    }
    table = { moves, states };
    shortTables.set(size, table);
  }
  let best = null;
  for (const move of table.moves) {
    const next = model.cloneState(state);
    model.applyMove(next, move.face, move.n, move.depth);
    if (model.isSolved(next)) return [move];
    const final = table.states.get(patternKey(next, model));
    if (final && !best) {
      const candidate = optimize([move, final], size, model);
      if (solves(state, candidate, model)) best = candidate;
    }
  }
  return best;
}

function threeTurnSolution(state, size, model) {
  // The one-turn goal table was populated by shortSolution. Meet it with
  // two turns from the current state instead of generating all three plies.
  const table = shortTables.get(size);
  const candidates = table.moves.map(move => {
    const normal = model.N[move.face], axis = normal.findIndex(value => value !== 0);
    return { move, axis, depth: normal[axis] > 0 ? move.depth : size - move.depth - 1 };
  });
  for (const first of candidates) {
    const prefix = model.cloneState(state), a = first.move;
    model.applyMove(prefix, a.face, a.n, a.depth);
    for (const second of candidates) {
      // Same-layer turns combine; different parallel layers commute, so
      // keep one ordering while preserving genuine three-layer solutions.
      if (first.axis === second.axis && second.depth <= first.depth) continue;
      const next = model.cloneState(prefix), b = second.move;
      model.applyMove(next, b.face, b.n, b.depth);
      const final = table.states.get(patternKey(next, model));
      if (final) {
        const result = optimize([a, b, final], size, model);
        if (solves(state, result, model)) return result;
      }
    }
  }
  return null;
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
  const short = shortSolution(state, size, model);
  if (short) return short;
  if (deep) {
    const three = threeTurnSolution(state, size, model);
    if (three) return three;
  }

  onProgress('Building and simplifying a reduction solution…');
  let best = optimize(layerSolver.solve(state, model), size, model);
  if (!solves(state, best, model)) throw new Error('The shorter solution failed verification.');

  // Keep a verified result before searching alternative reduction orders.
  // Worker termination remains immediate if the user presses Stop.
  const deadline = Date.now() + (deep ? 10000 : 2000);
  const plans = searchPlans(size, deep), finishCache = deep ? new Map() : null;
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
      vendor.solveCenters(cube);
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
