(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubeTwoSolver = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

// The 2×2 has only corners. These are the corner stages of the existing
// layer-by-layer method, with no artificial edges or move-history dependency.
function solve(initial, model, onProgress) {
  if (model.cubeSize(initial) !== 2) throw new Error('This solver supports only 2×2 cubes.');
  if (model.isSolved(initial)) return [];
  const state = model.cloneState(initial);
  const moves = [];
  const ring = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']];
  const up = turns => 'U '.repeat(turns);
  const length = sequence => sequence.trim() ? sequence.trim().split(/\s+/).length : 0;
  const report = message => { if (onProgress) onProgress(message); };
  const fail = step => { throw new Error('2×2 solver stuck at: ' + step); };

  function apply(sequence) {
    for (const [face, n] of model.parseSeq(sequence)) {
      model.applyMove(state, face, n);
      moves.push({ face, n });
    }
  }
  function cornerOK(cube, a, b, c) {
    const position = model.N[a].map((value, axis) =>
      (value + model.N[b][axis] + model.N[c][axis]) / 2);
    const corner = model.pieceAt(cube, position);
    return corner.s[a] === a && corner.s[b] === b && corner.s[c] === c;
  }
  const bottomOK = cube => ring.every(([a, b]) => cornerOK(cube, 'D', a, b));
  const topOriented = cube => cube.filter(corner => corner.p[1] === 0.5)
    .every(corner => corner.s.U === 'U');
  const pieceWithColors = (cube, colors) => cube.find(corner =>
    colors.every(color => Object.values(corner.s).includes(color)));

  function tryCandidates(candidates, goal) {
    for (const sequence of candidates) {
      const candidate = model.cloneState(state);
      model.applySeq(candidate, sequence);
      if (goal(candidate)) { apply(sequence); return true; }
    }
    return false;
  }

  // Only used to extract a bottom corner while keeping completed slots intact.
  function search(maxDepth, goal) {
    const path = [];
    function visit(cube, depth, lastFace) {
      if (!depth) return goal(cube) ? path.join(' ') : null;
      for (const face of model.FACES) {
        if (face === lastFace) continue;
        const candidate = model.cloneState(cube);
        for (let n = 1; n <= 3; n++) {
          model.applyMove(candidate, face, 1);
          path.push(model.moveName({ face, n }));
          const found = visit(candidate, depth - 1, face);
          if (found !== null) return found;
          path.pop();
        }
      }
      return null;
    }
    if (goal(state)) return '';
    for (let depth = 1; depth <= maxDepth; depth++) {
      const found = visit(state, depth, '');
      if (found !== null) return found;
    }
    return null;
  }

  report('2×2: building the bottom layer…');
  for (let pass = 0; !bottomOK(state); pass++) {
    if (pass >= 4) fail('bottom corners');
    const completed = ring.filter(([a, b]) => cornerOK(state, 'D', a, b));
    const keep = cube => completed.every(([a, b]) => cornerOK(cube, 'D', a, b));
    const remaining = ring.filter(pair => !completed.includes(pair));
    const [a, b] = remaining.find(([x, y]) =>
      pieceWithColors(state, ['D', x, y]).p[1] === 0.5) || remaining[0];
    const id = pieceWithColors(state, ['D', a, b]).id;
    const inTop = cube => cube.find(corner => corner.id === id).p[1] === 0.5;
    if (!inTop(state)) {
      const extraction = search(4, cube => inTop(cube) && keep(cube));
      if (extraction === null) fail('extracting a bottom corner');
      apply(extraction);
    }
    const candidates = [];
    const insertions = [
      `${b} U ${b}'`, `${b} U' ${b}'`, `${b} U2 ${b}'`,
      `${a}' U ${a}`, `${a}' U' ${a}`, `${a}' U2 ${a}`
    ];
    for (let turn = 0; turn < 4; turn++) {
      for (const insertion of insertions) candidates.push(up(turn) + insertion);
    }
    for (let repeats = 1; repeats <= 6; repeats++) {
      for (let turn = 0; turn < 4; turn++) {
        candidates.push(up(turn) + (`${b} U ${b}' U' `).repeat(repeats));
      }
    }
    candidates.sort((x, y) => length(x) - length(y));
    if (!tryCandidates(candidates, cube => cornerOK(cube, 'D', a, b) && keep(cube))) {
      fail('inserting a bottom corner');
    }
  }

  report('2×2: orienting the top corners…');
  if (!topOriented(state)) {
    const sune = ["R U R' U R U2 R'", "R U2 R' U' R U' R'"];
    const candidates = [];
    for (let turn = 0; turn < 4; turn++) {
      for (const first of sune) {
        candidates.push(up(turn) + first);
        for (let nextTurn = 0; nextTurn < 4; nextTurn++) {
          for (const second of sune) candidates.push(up(turn) + first + ' ' + up(nextTurn) + second);
        }
      }
    }
    candidates.sort((x, y) => length(x) - length(y));
    if (!tryCandidates(candidates, cube => topOriented(cube) && bottomOK(cube))) fail('top orientation');
  }

  report('2×2: placing the top corners…');
  {
    const cycles = ["R' F R' B2 R F' R' B2 R2", "R B' R F2 R' B R F2 R2"];
    const candidates = [];
    for (let turn = 0; turn < 4; turn++) {
      candidates.push(up(turn));
      for (const first of cycles) {
        for (let nextTurn = 0; nextTurn < 4; nextTurn++) {
          candidates.push(up(turn) + first + ' ' + up(nextTurn));
          for (const second of cycles) candidates.push(up(turn) + first + ' ' + up(nextTurn) + second);
        }
      }
    }
    candidates.sort((x, y) => length(x) - length(y));
    if (!tryCandidates(candidates, cube => model.isSolved(cube))) fail('top permutation');
  }
  if (!model.isSolved(state)) fail('final verification');
  return model.tidy(moves);
}

return { solve };
});
