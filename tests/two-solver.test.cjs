const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const model = require('../cube-model.js');
const solver = require('../two-solver.js');

function verifySolution(state) {
  const before = JSON.stringify(state);
  const progress = [];
  const solution = solver.solve(state, model, message => progress.push(message));
  assert.equal(JSON.stringify(state), before, 'solver must not change the supplied state');
  const replay = model.cloneState(state);
  for (const move of solution) {
    assert.ok(model.FACES.includes(move.face));
    assert.ok([1, 2, 3].includes(move.n));
    model.applyMove(replay, move.face, move.n, move.depth || 0);
  }
  assert.equal(model.isSolved(replay), true);
  return { solution, progress };
}

test('2×2 solver leaves a solved or whole-cube-rotated cube alone', () => {
  const state = model.solvedState(2);
  assert.deepEqual(solver.solve(state, model), []);
  for (const face of ['R', 'U', 'F']) {
    for (const depth of [0, 1]) model.applyMove(state, face, 1, depth);
    assert.deepEqual(solver.solve(state, model), []);
  }
});

test('2×2 solver rejects other sizes', () => {
  for (const size of [3, 4, 10]) {
    assert.throws(() => solver.solve(model.solvedState(size), model), /only 2×2/);
  }
});

test('2×2 solver handles every individual face turn and inverse', () => {
  for (const face of model.FACES) {
    for (const n of [1, 2, 3]) {
      const state = model.solvedState(2);
      model.applyMove(state, face, n);
      verifySolution(state);
    }
  }
});

test('2×2 layer stages solve seeded arbitrary-depth scrambles without history', () => {
  for (let seed = 1; seed <= 64; seed++) {
    let random = seed;
    const next = max => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return Math.floor(random / 0x100000000 * max);
    };
    const state = model.solvedState(2);
    for (let move = 0; move < 30; move++) {
      model.applyMove(state, model.FACES[next(6)], next(3) + 1, next(2));
    }
    const { solution, progress } = verifySolution(state);
    if (solution.length) {
      assert.equal(progress.length, 3, 'bottom layer, top orientation, then top permutation');
      assert.match(progress[0], /bottom layer/);
      assert.match(progress[1], /orienting/);
      assert.match(progress[2], /placing/);
    }
  }
});

test('2×2 solver completes all 648 legal top-layer arrangements', () => {
  const ring = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']];
  const targets = ring.map(([a, b]) => ({
    faces: ['U', a, b],
    p: model.N.U.map((value, axis) => (value + model.N[a][axis] + model.N[b][axis]) / 2)
  }));
  function permutations(values) {
    if (!values.length) return [[]];
    return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
      .map(rest => [value, ...rest]));
  }
  for (const permutation of permutations([0, 1, 2, 3])) {
    for (let orientation = 0; orientation < 27; orientation++) {
      const twists = [orientation % 3, Math.floor(orientation / 3) % 3, Math.floor(orientation / 9)];
      twists.push((3 - twists.reduce((sum, twist) => sum + twist, 0) % 3) % 3);
      const state = model.solvedState(2);
      const corners = targets.map(target => model.pieceAt(state, target.p));
      for (let source = 0; source < 4; source++) {
        const target = permutation[source];
        const corner = corners[source];
        corner.p = targets[target].p.slice();
        corner.s = Object.fromEntries(targets[source].faces.map((color, index) => [
          targets[target].faces[(index + twists[source]) % 3], color
        ]));
      }
      verifySolution(state);
    }
  }
});

test('2×2 solver exposes its browser/worker global', () => {
  const context = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../two-solver.js'), 'utf8'), context);
  const state = model.solvedState(2);
  model.applyMove(state, 'R', 1);
  const solution = context.self.CubeTwoSolver.solve(state, model);
  for (const move of solution) model.applyMove(state, move.face, move.n);
  assert.equal(model.isSolved(state), true);
});
