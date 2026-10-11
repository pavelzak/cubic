(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubeShallowSolver = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const faces = 'FLBRUD';
const axes = ['R', 'U', 'F'];
const opposites = ['L', 'D', 'B'];
// The small one-turn tables cover at most the nine supported cube sizes.
const oneTurnTables = new Map();
// Retain only one larger two-turn table across cube-size changes.
let twoTurnTable = null;

function nearestMove(axis, depth, n, size) {
  if (depth <= (size - 1) / 2) return { face: axes[axis], depth, n };
  return { face: opposites[axis], depth: size - depth - 1, n: 4 - n };
}

function inverse(move) { return { face: move.face, depth: move.depth, n: 4 - move.n }; }

// Normalize color names, since the same turn sequence solves a recolored
// sticker pattern too. Five three-bit colors fit in each UTF-16 character.
// Flat packed keys bound the large table's sticker payload to about 1.6 MB
// for 10×10, instead of retaining thousands of long concatenated strings.
function patternKey(state, size, validate = false) {
  const area = size * size, stickers = Array(6 * area), h = (size - 1) / 2;
  for (const cubie of state) {
    const [x, y, z] = cubie.p;
    for (const face of Object.keys(cubie.s)) {
      let row, col;
      switch (face) {
        case 'F': row = h - y; col = x + h; break;
        case 'L': row = h - y; col = z + h; break;
        case 'B': row = h - y; col = h - x; break;
        case 'R': row = h - y; col = h - z; break;
        case 'U': row = z + h; col = x + h; break;
        case 'D': row = h - z; col = x + h; break;
        default: throw new Error('Invalid cube sticker face.');
      }
      const index = faces.indexOf(face) * area + row * size + col;
      if (validate && (!Number.isInteger(row) || !Number.isInteger(col) ||
          row < 0 || row >= size || col < 0 || col >= size ||
          ({ F: z, B: -z, L: -x, R: x, U: y, D: -y })[face] !== h ||
          stickers[index] !== undefined)) throw new Error('Invalid cube sticker position.');
      stickers[index] = cubie.s[face];
    }
  }
  const colors = new Map(), counts = [], packed = [];
  let bits = 0;
  for (let i = 0; i < stickers.length; i++) {
    const color = stickers[i];
    if (color === undefined) throw new Error('Incomplete cube sticker state.');
    if (!colors.has(color)) colors.set(color, colors.size);
    const colorIndex = colors.get(color);
    if (validate) counts[colorIndex] = (counts[colorIndex] || 0) + 1;
    bits = (bits << 3) | colorIndex;
    if (i % 5 === 4 || i === stickers.length - 1) { packed.push(bits); bits = 0; }
  }
  if (validate && (counts.length !== 6 || counts.some(count => count !== area))) {
    throw new Error('Invalid cube sticker colors.');
  }
  return String.fromCharCode(...packed);
}

function verify(state, moves, model) {
  const replay = model.cloneState(state);
  for (const move of moves) model.applyMove(replay, move.face, move.n, move.depth);
  return model.isSolved(replay);
}

function oneTurnTable(size, model) {
  let table = oneTurnTables.get(size);
  if (table) return table;
  const moves = [], states = new Map(), solved = model.solvedState(size);
  for (let axis = 0; axis < 3; axis++) for (let depth = 0; depth < size; depth++) {
    for (let n = 1; n <= 3; n++) {
      const move = nearestMove(axis, depth, n, size), state = model.cloneState(solved);
      const index = moves.length;
      moves.push({ move, axis, depth });
      model.applyMove(state, move.face, move.n, move.depth);
      states.set(patternKey(state, size), index);
    }
  }
  table = { moves, states };
  oneTurnTables.set(size, table);
  return table;
}

function visitPairs(state, size, table, model, visit) {
  for (let i = 0; i < table.moves.length; i++) {
    const first = table.moves[i], prefix = model.cloneState(state), a = first.move;
    model.applyMove(prefix, a.face, a.n, a.depth);
    for (let j = 0; j < table.moves.length; j++) {
      const second = table.moves[j];
      // Same-layer turns combine; distinct parallel layers commute, so one
      // ordering suffices without dropping genuine multi-layer solutions.
      if (first.axis === second.axis && second.depth <= first.depth) continue;
      const next = model.cloneState(prefix), b = second.move;
      model.applyMove(next, b.face, b.n, b.depth);
      const result = visit(patternKey(next, size), i, j);
      if (result) return result;
    }
  }
  return null;
}

function search(state, model, maxDepth) {
  const size = model.cubeSize(state);
  if (!Number.isInteger(size) || size < 2 || size > 10) throw new Error('Shallow search supports sizes 2 through 10.');
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 4) throw new Error('Shallow search depth must be from 1 to 4.');
  patternKey(state, size, true);
  if (model.isSolved(state)) return [];
  const table = oneTurnTable(size, model), count = table.moves.length;
  let best = null;
  for (const { move } of table.moves) {
    const next = model.cloneState(state);
    model.applyMove(next, move.face, move.n, move.depth);
    if (model.isSolved(next)) return [move];
    if (maxDepth > 1 && !best) {
      const last = table.states.get(patternKey(next, size));
      if (last !== undefined) {
        const candidate = [move, inverse(table.moves[last].move)];
        if (verify(state, candidate, model)) best = candidate;
      }
    }
  }
  if (best || maxDepth < 3) return best;

  // Keep the current two-turn frontier only when a fourth turn is allowed.
  // Reuse it after the three-turn check instead of scanning the same states twice.
  const frontier = maxDepth === 4 ? new Map() : null;
  const three = visitPairs(state, size, table, model, (key, first, second) => {
    const last = table.states.get(key);
    if (last !== undefined) {
      const candidate = [table.moves[first].move, table.moves[second].move, inverse(table.moves[last].move)];
      if (verify(state, candidate, model)) return candidate;
    }
    if (frontier) frontier.set(key, first * count + second);
    return null;
  });
  if (three || !frontier) return three;

  if (!twoTurnTable || twoTurnTable.size !== size) {
    // Drop the previous size before constructing its replacement.
    twoTurnTable = null;
    const states = new Map(), solved = model.solvedState(size);
    visitPairs(solved, size, table, model, (key, first, second) => {
      states.set(key, first * count + second);
    });
    twoTurnTable = { size, states };
  }
  for (const [key, start] of frontier) {
    const end = twoTurnTable.states.get(key);
    if (end === undefined) continue;
    const candidate = [table.moves[Math.floor(start / count)].move, table.moves[start % count].move,
      inverse(table.moves[end % count].move), inverse(table.moves[Math.floor(end / count)].move)];
    if (verify(state, candidate, model)) return candidate;
  }
  return null;
}

function find(state, model, maxDepth = 2) {
  const moves = search(state, model, maxDepth);
  // Callers may annotate or otherwise edit moves; never expose cached objects.
  return moves && moves.map(move => ({ ...move }));
}

return { find };
});
