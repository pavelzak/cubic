const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const model = require('../cube-model.js');
const solver = require('../two-optimal-solver.js');

function stateKey(state) {
  return JSON.stringify(state.map(corner => [corner.p, model.FACES.map(face => corner.s[face] || '')]));
}

function rotations(state) {
  const queue = [model.cloneState(state)], seen = new Set([stateKey(state)]);
  for (let head = 0; head < queue.length; head++) {
    for (const face of ['R', 'U', 'F']) {
      const rotated = model.cloneState(queue[head]);
      for (const depth of [0, 1]) model.applyMove(rotated, face, 1, depth);
      const key = stateKey(rotated);
      if (!seen.has(key)) { seen.add(key); queue.push(rotated); }
    }
  }
  assert.equal(queue.length, 24);
  return queue;
}

function verify(state, expectedLength) {
  const before = JSON.stringify(state);
  const moves = solver.solve(state, model);
  assert.equal(JSON.stringify(state), before, 'solving must not mutate the input');
  if (expectedLength !== undefined) assert.equal(moves.length, expectedLength);
  assert.ok(moves.length <= 11);
  const replay = model.cloneState(state);
  for (const move of moves) {
    assert.ok(model.FACES.includes(move.face));
    assert.ok([1, 2, 3].includes(move.n));
    model.applyMove(replay, move.face, move.n);
  }
  assert.equal(model.isSolved(replay), true);
  return moves;
}

test('all 24 solved orientations return no moves without building a table', () => {
  for (const state of rotations(model.solvedState(2))) verify(state, 0);
  assert.equal(solver.getTableStats(), null);
});

test('the exact table covers every position with the independently published distances', () => {
  const state = model.solvedState(2);
  model.applyMove(state, 'R', 1);
  const progress = [];
  assert.equal(solver.solve(state, model, message => progress.push(message)).length, 1);
  const stats = solver.getTableStats();
  assert.equal(stats.states, 3674160);
  assert.equal(stats.diameter, 11);
  // Exhaustive face-turn distribution: https://www.jaapsch.net/puzzles/cube2.htm
  assert.deepEqual(stats.distances, [1, 9, 54, 321, 1847, 9992, 50136, 227536, 870072, 1887748, 623800, 2644]);
  assert.equal(stats.distances.reduce((sum, count) => sum + count, 0), stats.states);
  assert.ok(stats.retainedBytes < 4_000_000);
  assert.ok(stats.initializationBytes < 20_000_000);
  assert.ok(progress.some(message => message.includes('preparing')));
  progress.length = 0;
  solver.solve(state, model, message => progress.push(message));
  assert.equal(progress.some(message => message.includes('preparing')), false, 'reuse the worker table');
  stats.distances[0] = 999;
  assert.equal(solver.getTableStats().distances[0], 1, 'diagnostics must not expose mutable table data');
});

test('shortest lengths match independent all-six-face BFS through depth three', () => {
  // This oracle uses full cubie states and all 18 face turns, starting from
  // every solved orientation. It does not share the solver's normalization,
  // permutation/orientation coordinates, transition tables, or distance table.
  const queue = rotations(model.solvedState(2)).map(state => ({ state, depth: 0 }));
  const seen = new Set(queue.map(entry => stateKey(entry.state)));
  const counts = [24, 0, 0, 0];
  for (let head = 0; head < queue.length; head++) {
    const entry = queue[head];
    verify(entry.state, entry.depth);
    if (entry.depth === 3) continue;
    for (const face of model.FACES) {
      const next = model.cloneState(entry.state);
      for (let n = 1; n <= 3; n++) {
        model.applyMove(next, face, 1);
        const key = stateKey(next);
        if (seen.has(key)) continue;
        seen.add(key);
        counts[entry.depth + 1]++;
        queue.push({ state: model.cloneState(next), depth: entry.depth + 1 });
      }
    }
  }
  assert.deepEqual(counts, [24, 216, 1296, 7704]);
  assert.equal(queue.length, 9240);
});

test('arbitrary face/depth scrambles solve in at most 11 moves without history', () => {
  for (let seed = 1; seed <= 256; seed++) {
    let value = seed;
    const next = max => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return Math.floor(value / 0x100000000 * max);
    };
    const state = model.solvedState(2);
    for (let move = 0; move < 40; move++) model.applyMove(state, model.FACES[next(6)], next(3) + 1, next(2));
    verify(state);
  }
});

test('rotating an arbitrary cube preserves its shortest length and maps moves back correctly', () => {
  const state = model.solvedState(2);
  model.applySeq(state, "R U2 B' L D F2 R' U F");
  const length = verify(state).length;
  for (const rotated of rotations(state)) verify(rotated, length);
  state.reverse().forEach((corner, index) => { corner.id = 1000 + index * 7; });
  verify(state, length);
});

test('illegal twists, mirrored corners, duplicates and unsupported sizes are rejected', () => {
  for (const size of [3, 4, 10]) {
    assert.throws(() => solver.solve(model.solvedState(size), model), /only 2×2/);
  }
  const twisted = model.solvedState(2);
  const twist = twisted.find(corner => corner.s.U && corner.s.R && corner.s.F);
  [twist.s.U, twist.s.R, twist.s.F] = [twist.s.R, twist.s.F, twist.s.U];
  assert.throws(() => solver.solve(twisted, model), /Invalid 2×2/);
  const mirrored = model.solvedState(2);
  [mirrored[0].s.D, mirrored[0].s.L] = [mirrored[0].s.L, mirrored[0].s.D];
  assert.throws(() => solver.solve(mirrored, model), /Invalid 2×2/);
  const duplicate = model.solvedState(2);
  duplicate[1] = model.cloneState([duplicate[0]])[0];
  assert.throws(() => solver.solve(duplicate, model), /Invalid 2×2/);
});

test('the browser/worker global solves using the same API', () => {
  const context = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../two-optimal-solver.js'), 'utf8'), context);
  const state = model.solvedState(2);
  model.applySeq(state, "L' D B2");
  const moves = context.self.CubeTwoOptimalSolver.solve(state, model);
  assert.equal(moves.length, 3);
  for (const move of moves) model.applyMove(state, move.face, move.n);
  assert.equal(model.isSolved(state), true);
});
