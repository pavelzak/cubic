(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubeTwoOptimalSolver = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

// Fix the DBL corner's position and sticker frame. The remaining coordinates
// are 7! permutations and 3^6 orientations. U/R/F moves leave that corner fixed.
// A turn of an opposite face differs from the corresponding U/R/F turn by a
// whole-cube rotation, so this quotient preserves shortest face-turn distance
// when a uniformly colored cube in any spatial orientation counts as solved.
// Generate all move effects from CubeModel; no external solver code is used.
const CORNERS = [
  ['U', 'R', 'F'], ['U', 'F', 'L'], ['U', 'L', 'B'], ['U', 'B', 'R'],
  ['D', 'F', 'R'], ['D', 'L', 'F'], ['D', 'B', 'L'], ['D', 'R', 'B']
];
const ACTIVE = [0, 1, 2, 3, 4, 5, 7];
const FACTORIAL = [1, 1, 2, 6, 24, 120, 720];
const PERMUTATIONS = 5040, ORIENTATIONS = 729, STATES = PERMUTATIONS * ORIENTATIONS;
const MOVES = ['U', 'R', 'F'].flatMap(face => [1, 2, 3].map(n => ({ face, n })));
let tables = null;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const key = colors => colors.slice().sort().join('');
const invalid = () => { throw new Error('Invalid 2×2 corner state.'); };

function readState(state, model) {
  if (model.cubeSize(state) !== 2) throw new Error('The optimal corner solver supports only 2×2 cubes.');
  if (state.length !== 8) invalid();
  const anchor = state.find(corner => key(Object.values(corner.s)) === 'BDL');
  if (!anchor) invalid();
  const anchorColors = CORNERS[6];
  const sourceNormals = anchorColors.map(color => {
    const face = Object.keys(anchor.s).find(face => anchor.s[face] === color);
    return model.N[face];
  });
  const targetNormals = anchorColors.map(color => model.N[color]);
  if (sourceNormals.some(normal => !normal) ||
      dot(cross(sourceNormals[0], sourceNormals[1]), sourceNormals[2]) !==
      dot(cross(targetNormals[0], targetNormals[1]), targetNormals[2])) invalid();
  function rotate(vector) {
    return [0, 1, 2].map(axis => sourceNormals.reduce((sum, normal, index) =>
      sum + dot(vector, normal) * targetNormals[index][axis], 0));
  }
  const faceMap = {}, inverseFaces = {};
  for (const face of model.FACES) {
    const normal = rotate(model.N[face]);
    const target = model.FACES.find(candidate => model.N[candidate].every((value, axis) => value === normal[axis]));
    if (!target) invalid();
    faceMap[face] = target;
    inverseFaces[target] = face;
  }
  const positions = new Map(CORNERS.map((faces, index) => [
    [0, 1, 2].map(axis => faces.reduce((sum, face) => sum + model.N[face][axis], 0) / 2).join(','), index
  ]));
  const pieces = new Map(CORNERS.map((faces, index) => [key(faces), index]));
  const cp = new Array(8).fill(-1), co = new Array(8).fill(-1), seen = new Set();
  for (const corner of state) {
    const position = positions.get(rotate(corner.p).join(','));
    if (position === undefined || cp[position] !== -1 || Object.keys(corner.s).length !== 3) invalid();
    const stickers = {};
    for (const face of Object.keys(corner.s)) {
      if (!faceMap[face]) invalid();
      stickers[faceMap[face]] = corner.s[face];
    }
    const colors = CORNERS[position].map(face => stickers[face]);
    const orientation = colors.findIndex(color => color === 'U' || color === 'D');
    const piece = pieces.get(key(colors));
    if (piece === undefined || orientation < 0 || seen.has(piece)) invalid();
    if (!CORNERS[piece].every((color, index) => color === colors[(orientation + index) % 3])) invalid();
    cp[position] = piece; co[position] = orientation; seen.add(piece);
  }
  if (cp[6] !== 6 || co[6] !== 0 || co.reduce((sum, value) => sum + value, 0) % 3 !== 0) invalid();
  return { cp, co, inverseFaces };
}

function permutationRank(cp) {
  let rank = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (cp[ACTIVE[j]] < cp[ACTIVE[i]]) smaller++;
    rank = rank * (7 - i) + smaller;
  }
  return rank;
}

function permutationAt(rank) {
  const available = ACTIVE.slice(), cp = new Array(8);
  cp[6] = 6;
  for (let i = 0; i < 7; i++) {
    const factor = FACTORIAL[6 - i], digit = Math.floor(rank / factor);
    rank %= factor;
    cp[ACTIVE[i]] = available.splice(digit, 1)[0];
  }
  return cp;
}

function orientationRank(co) {
  let rank = 0;
  for (let i = 0; i < 6; i++) rank = rank * 3 + co[ACTIVE[i]];
  return rank;
}

function orientationAt(rank) {
  const co = new Array(8).fill(0);
  let sum = 0;
  for (let i = 5; i >= 0; i--) {
    co[ACTIVE[i]] = rank % 3;
    sum += co[ACTIVE[i]];
    rank = Math.floor(rank / 3);
  }
  co[ACTIVE[6]] = (3 - sum % 3) % 3;
  return co;
}

function prepareTables(model, report) {
  if (tables) return tables;
  report('2×2: preparing the shortest-path table…');
  const generators = MOVES.map(move => {
    const state = model.solvedState(2);
    model.applyMove(state, move.face, move.n);
    return readState(state, model);
  });
  const permutationMoves = new Uint16Array(PERMUTATIONS * MOVES.length);
  const orientationMoves = new Uint16Array(ORIENTATIONS * MOVES.length);
  for (let rank = 0; rank < PERMUTATIONS; rank++) {
    const cp = permutationAt(rank);
    for (let move = 0; move < MOVES.length; move++) {
      const next = generators[move].cp.map(source => cp[source]);
      permutationMoves[rank * MOVES.length + move] = permutationRank(next);
    }
  }
  for (let rank = 0; rank < ORIENTATIONS; rank++) {
    const co = orientationAt(rank);
    for (let move = 0; move < MOVES.length; move++) {
      const generator = generators[move];
      const next = generator.cp.map((source, destination) => (co[source] + generator.co[destination]) % 3);
      orientationMoves[rank * MOVES.length + move] = orientationRank(next);
    }
  }

  // Full reverse BFS is a perfect distance heuristic, so solving afterwards
  // only follows decreasing distances and never needs a search tree.
  const distance = new Uint8Array(STATES).fill(255);
  const queue = new Uint32Array(STATES), histogram = [1];
  let head = 0, tail = 1, announcedDepth = -1;
  distance[0] = 0;
  while (head < tail) {
    const state = queue[head++], depth = distance[state];
    if (depth !== announcedDepth) {
      announcedDepth = depth;
      report('2×2: preparing the shortest-path table, depth ' + depth + '…');
    }
    const permutation = Math.floor(state / ORIENTATIONS) * MOVES.length;
    const orientation = (state % ORIENTATIONS) * MOVES.length;
    for (let move = 0; move < MOVES.length; move++) {
      const next = permutationMoves[permutation + move] * ORIENTATIONS + orientationMoves[orientation + move];
      if (distance[next] !== 255) continue;
      distance[next] = depth + 1;
      histogram[depth + 1] = (histogram[depth + 1] || 0) + 1;
      queue[tail++] = next;
    }
  }
  if (tail !== STATES) throw new Error('The 2×2 search table is incomplete.');
  tables = { permutationMoves, orientationMoves, distance, histogram };
  return tables;
}

function solve(state, model, onProgress) {
  const corners = readState(state, model);
  let coordinate = permutationRank(corners.cp) * ORIENTATIONS + orientationRank(corners.co);
  if (!coordinate) return [];
  const report = typeof onProgress === 'function' ? onProgress : function () {};
  const table = prepareTables(model, report), moves = [];
  report('2×2: finding a shortest solution…');
  while (coordinate) {
    const permutation = Math.floor(coordinate / ORIENTATIONS) * MOVES.length;
    const orientation = (coordinate % ORIENTATIONS) * MOVES.length;
    let found = false;
    for (let move = 0; move < MOVES.length; move++) {
      const next = table.permutationMoves[permutation + move] * ORIENTATIONS + table.orientationMoves[orientation + move];
      if (table.distance[next] + 1 !== table.distance[coordinate]) continue;
      moves.push({ face: corners.inverseFaces[MOVES[move].face], n: MOVES[move].n });
      coordinate = next; found = true; break;
    }
    if (!found) throw new Error('The 2×2 search table has no decreasing path.');
  }
  const replay = model.cloneState(state);
  for (const move of moves) model.applyMove(replay, move.face, move.n);
  if (!model.isSolved(replay)) throw new Error('The shortest 2×2 solution failed verification.');
  return moves;
}

function getTableStats() {
  if (!tables) return null;
  const retainedBytes = tables.permutationMoves.byteLength + tables.orientationMoves.byteLength + tables.distance.byteLength;
  return {
    states: STATES, diameter: tables.histogram.length - 1,
    distances: tables.histogram.slice(), retainedBytes,
    initializationBytes: retainedBytes + STATES * Uint32Array.BYTES_PER_ELEMENT
  };
}

return { solve, getTableStats };
});
