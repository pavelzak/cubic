(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/four-solver/solver.js'));
  else root.CubeFourSolver = factory(root.CubeFourReduction);
})(typeof self !== 'undefined' ? self : globalThis, function (reduction) {
'use strict';

// Facelet layouts from the MIT-licensed TPR FullCube.java (see vendor README).
// Facelets are URFDLB, each face viewed from outside, in row-major order.
const FACES = 'URFDLB';
const CENTERS = [5, 6, 10, 9, 53, 54, 58, 57, 37, 38, 42, 41, 85, 86, 90, 89, 21, 22, 26, 25, 69, 70, 74, 73];
const CORNERS = [[15, 16, 35], [12, 32, 67], [0, 64, 83], [3, 80, 19], [51, 47, 28], [48, 79, 44], [60, 95, 76], [63, 31, 92]];
const WINGS = [[13, 33], [4, 65], [2, 81], [11, 17], [61, 94], [52, 78], [50, 46], [59, 30], [75, 40], [68, 87], [27, 88], [20, 39], [34, 14], [66, 8], [82, 1], [18, 7], [93, 62], [77, 56], [45, 49], [29, 55], [36, 71], [91, 72], [84, 23], [43, 24]];
const CORNER_FACES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGE_FACES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
let shortTable = null;

function invalid() { throw new Error('Invalid 4×4 cube state.'); }

function faceCoordinates(x, y, z, h) {
  return {
    F: [h - y, x + h], L: [h - y, z + h], B: [h - y, h - x],
    R: [h - y, h - z], U: [z + h, x + h], D: [h - z, x + h]
  };
}

function facelets(state, model) {
  if (model.cubeSize(state) !== 4) throw new Error('Three-phase solving supports only 4×4 cubes.');
  if (state.length !== 56) invalid();
  const result = new Array(96), colors = new Array(6).fill(0);
  for (const cubie of state) {
    if (!Array.isArray(cubie.p) || cubie.p.length !== 3 ||
        !cubie.p.every(value => [-1.5, -0.5, 0.5, 1.5].includes(value))) invalid();
    const positions = faceCoordinates(...cubie.p, 1.5);
    for (const face of Object.keys(cubie.s)) {
      const index = FACES.indexOf(face), color = FACES.indexOf(cubie.s[face]);
      if (index < 0 || color < 0 || cubie.s[face].length !== 1) invalid();
      const normal = model.N[face], axis = normal.findIndex(value => value !== 0);
      if (cubie.p[axis] !== 1.5 * normal[axis]) invalid();
      const [row, col] = positions[face], position = index * 16 + row * 4 + col;
      if (result[position] !== undefined) invalid();
      result[position] = color;
      colors[color]++;
    }
  }
  if (colors.some(count => count !== 16) || result.filter(value => value !== undefined).length !== 96) invalid();
  return result;
}

function toPieces(state, model) {
  const f = facelets(state, model);
  // The older MIT JavaScript reduction uses UDFBRL center color numbering.
  const ct = CENTERS.map(position => [0, 4, 2, 1, 5, 3][f[position]]);
  if (Array.from({ length: 6 }, (_, color) => ct.filter(value => value === color).length).some(count => count !== 4)) invalid();
  const ep = WINGS.map(pair => WINGS.findIndex(other =>
    f[pair[0]] === (other[0] >> 4) && f[pair[1]] === (other[1] >> 4)));
  const cp = [], co = [];
  for (const positions of CORNERS) {
    const orientation = positions.findIndex(position => f[position] === 0 || f[position] === 3);
    const piece = CORNERS.findIndex(other => orientation >= 0 && other.every((position, i) =>
      f[positions[(orientation + i) % 3]] === (position >> 4)));
    cp.push(piece); co.push(orientation);
  }
  if (ep.includes(-1) || new Set(ep).size !== 24 || cp.includes(-1) || new Set(cp).size !== 8 ||
      co.reduce((sum, value) => sum + value, 0) % 3 !== 0) invalid();
  return { ct, ep, cp, co };
}

function expandMoves(moves) {
  if (!Array.isArray(moves)) throw new Error('Invalid three-phase reduction.');
  const result = [];
  for (const index of moves) {
    if (!Number.isInteger(index) || index < 0 || index >= 36) throw new Error('Invalid three-phase reduction move.');
    const face = FACES[Math.floor(index / 3) % 6], n = index % 3 + 1;
    result.push({ face, n, depth: 0 });
    if (index >= 18) result.push({ face, n, depth: 1 });
  }
  return result;
}

function replay(state, moves, model) {
  const result = model.cloneState(state);
  for (const move of moves) {
    const depth = move && move.depth === undefined ? 0 : move && move.depth;
    if (!move || !Object.prototype.hasOwnProperty.call(model.N, move.face) ||
        ![1, 2, 3].includes(move.n) || !Number.isInteger(depth) || depth < 0 || depth > 3) {
      throw new Error('Invalid move returned by the three-phase solver.');
    }
    model.applyMove(result, move.face, move.n, depth);
  }
  return result;
}

function patternKey(state, model) {
  const colors = new Map();
  return facelets(state, model).map(color => {
    if (!colors.has(color)) colors.set(color, colors.size);
    return colors.get(color);
  }).join('');
}

// Bidirectional depth 1 + 1, including every individual slice. No move log is used.
function shortSolution(state, model) {
  if (!shortTable) {
    const moves = [], inverse = new Map(), solved = model.solvedState(4);
    for (const face of 'URF') for (let depth = 0; depth < 4; depth++) for (let n = 1; n <= 3; n++) {
      const move = { face, depth, n }, next = replay(solved, [move], model);
      moves.push(move);
      inverse.set(patternKey(next, model), { face, depth, n: 4 - n });
    }
    shortTable = { moves, inverse };
  }
  let best = null;
  for (const move of shortTable.moves) {
    const next = replay(state, [move], model);
    if (model.isSolved(next)) return [move];
    const final = shortTable.inverse.get(patternKey(next, model));
    if (!best && final && model.isSolved(replay(next, [final], model))) best = [move, final];
  }
  return best;
}

function reducedState(state, model) {
  const f = facelets(state, model);
  for (let face = 0; face < 6; face++) {
    for (const indices of [[5, 6, 9, 10], [1, 2], [4, 8], [7, 11], [13, 14]]) {
      if (!indices.every(index => f[face * 16 + index] === f[face * 16 + indices[0]])) return null;
    }
  }
  const result = model.solvedState(3), map = [0, 1, 3];
  for (const cubie of result) {
    const positions = faceCoordinates(...cubie.p, 1);
    for (const face of Object.keys(cubie.s)) {
      const [row, col] = positions[face];
      cubie.s[face] = FACES[f[FACES.indexOf(face) * 16 + map[row] * 4 + map[col]]];
    }
  }
  return result;
}

function permutationParity(permutation) {
  let parity = 0;
  for (let i = 0; i < permutation.length; i++) for (let j = i + 1; j < permutation.length; j++) {
    if (permutation[i] > permutation[j]) parity ^= 1;
  }
  return parity;
}

// A paired 4×4 may still have OLL/PLL parity. Only send legal 3×3 positions
// into the two-phase finish; the full three-phase search handles both parities.
function canFinish(state, model) {
  const colors = {};
  for (const face of FACES) colors[model.pieceAt(state, model.N[face]).s[face]] = face;
  if (Object.keys(colors).length !== 6) return false;
  const cp = [], ep = [];
  let twist = 0, flip = 0;
  for (const [groups, permutation] of [[CORNER_FACES, cp], [EDGE_FACES, ep]]) {
    for (const group of groups) {
      const p = [0, 1, 2].map(axis => [...group].reduce((sum, face) => sum + model.N[face][axis], 0));
      const piece = model.pieceAt(state, p), stickers = [...group].map(face => colors[piece.s[face]]);
      let match = -1, orientation = -1;
      for (let candidate = 0; candidate < groups.length; candidate++) for (let offset = 0; offset < group.length; offset++) {
        if ([...groups[candidate]].every((color, i) => color === stickers[(offset + i) % group.length])) {
          match = candidate; orientation = offset;
        }
      }
      if (match < 0) return false;
      permutation.push(match);
      if (group.length === 3) twist += orientation;
      else flip += orientation;
    }
    if (new Set(permutation).size !== groups.length) return false;
  }
  return twist % 3 === 0 && flip % 2 === 0 && permutationParity(cp) === permutationParity(ep);
}

function solve(state, model, nearOptimalEngine, onProgress) {
  const pieces = toPieces(state, model);
  if (model.isSolved(state)) return [];
  onProgress = onProgress || function () {};
  onProgress('4×4: checking for a short solution…');
  const short = shortSolution(state, model);
  if (short) return short;
  if (!nearOptimalEngine || typeof nearOptimalEngine.solveNearOptimal !== 'function') {
    throw new Error('The three-phase solver needs the 3×3 finishing engine.');
  }
  let reduced = reducedState(state, model), moves = [];
  if (!reduced || !canFinish(reduced, model)) {
    moves = expandMoves(reduction.reduce(pieces, onProgress));
    reduced = reducedState(replay(state, moves, model), model);
    if (!reduced || !canFinish(reduced, model)) throw new Error('The three-phase reduction did not finish.');
  }
  onProgress('4×4: solving the reduced 3×3 cube…');
  const finish = nearOptimalEngine.solveNearOptimal(reduced, onProgress);
  if (!Array.isArray(finish)) throw new Error('Invalid three-phase finishing moves.');
  moves = model.tidy(moves.concat(finish));
  if (!model.isSolved(replay(state, moves, model))) throw new Error('The three-phase solution failed verification.');
  return moves;
}

return { solve, toPieces, expandMoves, reducedState, canFinish };
});
