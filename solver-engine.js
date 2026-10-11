(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeSolverEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Standard URFDLB facelet order, each face viewed from outside the cube.
  var faceCoordinates = {
    U: function (r, c) { return [c - 1, 1, r - 1]; },
    R: function (r, c) { return [1, 1 - r, 1 - c]; },
    F: function (r, c) { return [c - 1, 1 - r, 1]; },
    D: function (r, c) { return [c - 1, -1, 1 - r]; },
    L: function (r, c) { return [-1, 1 - r, c - 1]; },
    B: function (r, c) { return [1 - c, 1 - r, -1]; }
  };

  function requireThreeByThree(state, model) {
    if (model.cubeSize(state) !== 3) {
      throw new Error('Solving is available for 3×3 cubes only.');
    }
  }

  function toFacelets(state, model) {
    requireThreeByThree(state, model);
    var colors = Object.create(null);
    for (var face of model.FACES) {
      var center = model.pieceAt(state, model.N[face]);
      if (!center || !center.s[face] || colors[center.s[face]]) {
        throw new Error('Invalid cube centers.');
      }
      colors[center.s[face]] = face;
    }
    var facelets = '';
    for (var f of 'URFDLB') {
      for (var row = 0; row < 3; row++) {
        for (var col = 0; col < 3; col++) {
          var piece = model.pieceAt(state, faceCoordinates[f](row, col));
          var color = piece && colors[piece.s[f]];
          if (!color) throw new Error('Invalid cube stickers.');
          facelets += color;
        }
      }
    }
    return facelets;
  }

  function verifySolution(state, moves, model) {
    var size = model.cubeSize(state);
    if (!Array.isArray(moves)) throw new Error('The solver returned an invalid move list.');
    var replay = model.cloneState(state);
    for (var move of moves) {
      var depth = move && move.depth !== undefined ? move.depth : 0;
      if (!move || !Object.prototype.hasOwnProperty.call(model.N, move.face) ||
          ![1, 2, 3].includes(move.n) || !Number.isInteger(depth) || depth < 0 || depth >= size) {
        throw new Error('The solver returned an invalid move.');
      }
      model.applyMove(replay, move.face, move.n, depth);
    }
    if (!model.isSolved(replay)) throw new Error('The solution failed verification.');
    return moves;
  }

  function createEngine(model, Cube) {
    var shortStates = null;
    var initialized = false;
    var faces = 'URFDLB';

    function stateKey(cube) {
      return cube.cp.join('') + '/' + cube.co.join('') + '/' +
        cube.ep.join(',') + '/' + cube.eo.join('');
    }

    // A bidirectional search of depth 3 + 3 finds the fewest turns for any
    // position within six face turns, without initializing the large tables.
    function nearbyStates(start) {
      var nodes = [{ cube: start, moves: [] }];
      var visited = new Map([[stateKey(start), nodes[0]]]);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.moves.length === 3) continue;
        var last = node.moves[node.moves.length - 1];
        for (var face = 0; face < faces.length; face++) {
          if (last && last.face === faces[face]) continue;
          for (var n = 1; n <= 3; n++) {
            var next = node.cube.clone().move(face * 3 + n - 1);
            var key = stateKey(next);
            if (visited.has(key)) continue;
            var child = { cube: next, moves: node.moves.concat({ face: faces[face], n: n }) };
            visited.set(key, child);
            nodes.push(child);
          }
        }
      }
      return visited;
    }

    function shortSolution(cube) {
      if (!shortStates) shortStates = nearbyStates(new Cube());
      var best = null;
      for (var entry of nearbyStates(cube)) {
        var other = shortStates.get(entry[0]);
        if (!other) continue;
        var inverse = other.moves.slice().reverse().map(function (move) {
          return { face: move.face, n: 4 - move.n };
        });
        var candidate = model.tidy(entry[1].moves.concat(inverse));
        if (best === null || candidate.length < best.length) best = candidate;
      }
      return best;
    }

    function solveNearOptimal(state, onProgress) {
      requireThreeByThree(state, model);
      onProgress = onProgress || function () {};
      if (model.isSolved(state)) return [];
      var cube = Cube.fromString(toFacelets(state, model));
      onProgress('Checking for a short solution…');
      var moves = shortSolution(cube);
      if (moves === null) {
        if (!initialized) {
          onProgress('Preparing the near-optimal solver for its first use…');
          Cube.initSolver();
          initialized = true;
        }
        onProgress('Finding a near-optimal solution…');
        moves = model.parseSeq(cube.solve(22)).map(function (move) {
          return { face: move[0], n: move[1] };
        });
        moves = model.tidy(moves);
      }
      return verifySolution(state, moves, model);
    }

    return { solveNearOptimal: solveNearOptimal };
  }

  return { toFacelets: toFacelets, verifySolution: verifySolution, createEngine: createEngine };
});
