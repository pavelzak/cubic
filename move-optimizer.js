(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubeMoveOptimizer = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const axes = ['R', 'U', 'F'];
const opposite = { R: 'L', U: 'D', F: 'B' };
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

return { optimize };
});
