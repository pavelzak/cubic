(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/nxn-solver/solver.js'));
  } else root.CubeLayerSolver = factory(root.NxNSolver);
})(typeof self !== 'undefined' ? self : globalThis, function (solver) {
  'use strict';

  // The vendor stores faces in FLBRUD order, viewed from outside each face.
  var faceIndex = { F: 0, L: 1, B: 2, R: 3, U: 4, D: 5 };
  var opposite = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };

  function toCube(state, model) {
    var size = model.cubeSize(state), h = (size - 1) / 2;
    var cube = new solver.Cube(size);
    for (var cubie of state) {
      var x = cubie.p[0], y = cubie.p[1], z = cubie.p[2];
      var coordinates = {
        F: [h - y, x + h], L: [h - y, z + h], B: [h - y, h - x],
        R: [h - y, h - z], U: [z + h, x + h], D: [h - z, x + h]
      };
      for (var face of Object.keys(cubie.s)) {
        var position = coordinates[face], color = faceIndex[cubie.s[face]];
        if (!position || color === undefined || !position.every(function (value) {
          return Number.isInteger(value) && value >= 0 && value < size;
        })) throw new Error('Invalid cube stickers.');
        cube.matrix[faceIndex[face]][position[0]][position[1]] = color;
      }
    }
    return cube;
  }

  // A vendor move turns `width` slices ending at its one-based `layer`.
  // Expand wide/whole-cube turns, then name each slice from its nearest face.
  function movesForTurn(size, face, dist, layer, width) {
    if (layer === undefined) layer = 1;
    if (width === undefined) width = 1;
    if (!Object.prototype.hasOwnProperty.call(faceIndex, face) ||
        !Number.isInteger(dist) || !Number.isInteger(layer) || !Number.isInteger(width) ||
        layer < 1 || layer > size || width < 1 || width > layer) {
      throw new Error('The layer solver returned an invalid move.');
    }
    var n = ((dist % 4) + 4) % 4, moves = [];
    if (!n) return moves;
    for (var i = 0; i < width; i++) {
      var depth = layer - i - 1, outputFace = face, turns = n;
      if (depth > (size - 1) / 2) {
        depth = size - depth - 1;
        outputFace = opposite[face];
        turns = 4 - n;
      }
      moves.push({ face: outputFace, n: turns, depth: depth });
    }
    return moves;
  }

  function appendMove(moves, move) {
    var previous = moves[moves.length - 1];
    if (previous && previous.face === move.face && previous.depth === move.depth) {
      previous.n = (previous.n + move.n) % 4;
      if (!previous.n) moves.pop();
    } else moves.push(move);
  }

  function solve(state, model, onProgress) {
    var size = model.cubeSize(state);
    if (size < 4 || size > 10) throw new Error('The large-cube solver supports 4×4 through 10×10.');
    if (model.isSolved(state)) return [];
    onProgress = onProgress || function () {};
    var cube = toCube(state, model), moves = [], emitted = 0;
    var deadline = Date.now() + 15000;
    cube.onTurn = function (face, dist, layer, width) {
      var slices = movesForTurn(size, face, dist, layer, width);
      emitted += slices.length;
      if (emitted > 100000 || Date.now() > deadline) {
        throw new Error('The layer solver exceeded its work limit.');
      }
      for (var move of slices) appendMove(moves, move);
    };

    onProgress('Solving the centers…');
    solver.solveCenters(cube);
    onProgress('Pairing the edges…');
    solver.solveEdges(cube);
    onProgress('Solving the final layers and correcting parity…');
    solver.solveCorners(cube);
    if (!cube.isSolved()) throw new Error('The layer solver did not finish this cube.');

    // Keep the cubie renderer's model authoritative at the representation boundary.
    var replay = model.cloneState(state);
    for (var move of moves) model.applyMove(replay, move.face, move.n, move.depth);
    if (!model.isSolved(replay)) throw new Error('The layer solution failed verification.');
    return moves;
  }

  return { solve: solve, toCube: toCube, movesForTurn: movesForTurn };
});
