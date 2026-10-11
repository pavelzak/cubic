const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../cube-model.js');
const adapter = require('../solver-engine.js');
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');

function scramble(sequence) {
  const state = model.solvedState();
  model.applySeq(state, sequence);
  return state;
}

function replay(state, moves) {
  const result = model.cloneState(state);
  for (const move of moves) model.applyMove(result, move.face, move.n, move.depth);
  assert.equal(model.isSolved(result), true);
}

function seededScrambles(count) {
  let seed = 123456789;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: count }, () => {
    const moves = [];
    let last = '';
    for (let i = 0; i < 25; i++) {
      let face;
      do { face = model.FACES[Math.floor(random() * 6)]; } while (face === last);
      last = face;
      moves.push({ face, n: 1 + Math.floor(random() * 3) });
    }
    return moves.map(model.moveName).join(' ');
  });
}

test('facelet conversion matches an independent cube for every face and turn', () => {
  assert.equal(adapter.toFacelets(model.solvedState(), model), new Cube().asString());
  for (const face of model.FACES) {
    for (const n of [1, 2, 3]) {
      const sequence = model.moveName({ face, n });
      assert.equal(adapter.toFacelets(scramble(sequence), model), new Cube().move(sequence).asString(), sequence);
    }
  }
  for (const sequence of seededScrambles(20)) {
    assert.equal(adapter.toFacelets(scramble(sequence), model), new Cube().move(sequence).asString(), sequence);
  }
});

test('facelet conversion normalizes rotated centers', () => {
  const state = model.solvedState();
  for (const layer of [-1, 0, 1]) model.applyRot(state, model.N.R, layer, 1);
  model.applySeq(state, "R U F2 L'");
  assert.equal(adapter.toFacelets(state, model), new Cube().move("R U F2 L'").asString());
});

test('3×3 solver adapters reject every other size before initializing tables', () => {
  const engine = adapter.createEngine(model, Cube);
  const originalInit = Cube.initSolver;
  Cube.initSolver = () => { throw new Error('Unexpected initialization for an unsupported size'); };
  try {
    for (const size of [2, 4, 5, 6, 7, 8, 9, 10]) {
      const state = model.solvedState(size);
      const expected = { message: 'Solving is available for 3×3 cubes only.' };
      assert.throws(() => adapter.toFacelets(state, model), expected);
      assert.throws(() => engine.solveNearOptimal(state), expected);
      model.applyMove(state, 'R', 1);
      assert.throws(() => engine.solveNearOptimal(state), expected);
    }
  } finally {
    Cube.initSolver = originalInit;
  }
});

test('positions within six turns use a shortest solution without initializing two-phase tables', () => {
  const engine = adapter.createEngine(model, Cube);
  const originalInit = Cube.initSolver;
  Cube.initSolver = () => { throw new Error('Unexpected table initialization for a short position'); };
  try {
    assert.deepEqual(engine.solveNearOptimal(model.solvedState()), []);
    for (const face of model.FACES) {
      for (const n of [1, 2, 3]) {
        const state = scramble(model.moveName({ face, n }));
        const moves = engine.solveNearOptimal(state);
        assert.equal(moves.length, 1);
        replay(state, moves);
      }
    }
    for (const sequence of ['D L2', 'R U F', "R U R' U'", "L2 D' B F2", 'U R F D', 'U R F D L', 'U R F D L B']) {
      const state = scramble(sequence);
      const before = JSON.stringify(state);
      const moves = engine.solveNearOptimal(state);
      assert.ok(moves.length <= model.parseSeq(sequence).length, sequence);
      assert.equal(JSON.stringify(state), before);
      replay(state, moves);
    }
    assert.equal(engine.solveNearOptimal(scramble('D L2')).length, 2);
  } finally {
    Cube.initSolver = originalInit;
  }
});

test('near-optimal solutions replay correctly in at most 22 moves, reusing tables', () => {
  const engine = adapter.createEngine(model, Cube);
  const progress = [];
  const sequences = seededScrambles(20).concat('U R F D L');
  for (const sequence of sequences) {
    const state = scramble(sequence);
    const before = JSON.stringify(state);
    const moves = engine.solveNearOptimal(state, message => progress.push(message));
    assert.ok(moves.length <= 22, `${moves.length} turns for ${sequence}`);
    replay(state, moves);
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal(progress.filter(message => message.includes('Preparing')).length, 1);
  for (const axis of [model.N.R, model.N.U, model.N.F]) {
    const state = scramble("R U F2 D' L B");
    model.applyRot(state, axis, 0, 1);
    const moves = engine.solveNearOptimal(state);
    assert.ok(moves.length <= 22);
    replay(state, moves);
  }
});

test('verification rejects incorrect or malformed solutions', () => {
  assert.throws(() => adapter.verifySolution(scramble('R'), [], model), /failed verification/);
  assert.throws(() => adapter.verifySolution(scramble('R'), [{ face: 'X', n: 1 }], model), /invalid move/);
  assert.throws(() => adapter.verifySolution(scramble('R'), [{ face: 'R', n: 0 }], model), /invalid move/);
  for (const depth of [-1, 3, 0.5, NaN, '1']) {
    assert.throws(() => adapter.verifySolution(scramble('R'), [{ face: 'R', n: 3, depth }], model), /invalid move/);
  }
  const inner = model.solvedState(6);
  model.applyMove(inner, 'R', 1, 2);
  assert.doesNotThrow(() => adapter.verifySolution(inner, [{ face: 'R', n: 3, depth: 2 }], model));
});

function workerHarness() {
  const root = path.resolve(__dirname, '..');
  const messages = [];
  const imports = [];
  const context = vm.createContext({});
  context.self = context;
  context.postMessage = message => messages.push(JSON.parse(JSON.stringify(message)));
  context.importScripts = (...filenames) => {
    for (const filename of filenames) {
      imports.push(filename);
      vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'solver-worker.js'), 'utf8'), context);
  return { context, messages, imports };
}

test('worker routes solver modes, loads vendors lazily, and preserves request IDs', () => {
  const { context, messages, imports } = workerHarness();
  assert.equal(imports.some(filename => filename.includes('vendor')), false);
  const state = scramble('D L2');
  context.onmessage({ data: { id: 17, mode: 'layer', state } });
  const layerResult = messages.find(message => message.id === 17 && message.type === 'result');
  replay(state, layerResult.moves);
  assert.ok(layerResult.moves.length > 2);
  assert.equal(imports.some(filename => filename.includes('vendor')), false);

  context.onmessage({ data: { id: 18, mode: 'near-optimal', state } });
  const result = messages.find(message => message.id === 18 && message.type === 'result');
  assert.equal(result.moves.length, 2);
  replay(state, result.moves);
  assert.equal(imports.filter(filename => filename === 'vendor/cubejs/cube.js').length, 1);
  assert.ok(messages.some(message => message.id === 18 && message.type === 'progress' && message.message));

  context.onmessage({ data: { id: 19, mode: 'unknown', state } });
  assert.deepEqual(messages.at(-1), { id: 19, type: 'error', message: 'Unknown solver mode.' });

  for (const size of [2, 4, 5, 6, 7, 8, 9, 10]) {
    const initial = model.solvedState(size);
    model.applyMove(initial, 'R', 1, size > 3 ? 1 : 0);
    model.applyMove(initial, 'U', 3);
    const id = `${size}-layer`;
    context.onmessage({ data: { id, mode: 'layer', state: initial } });
    const result = messages.at(-1);
    assert.equal(result.type, 'result', `${size}×${size}: ${result.message}`);
    assert.equal(result.id, id);
    replay(initial, result.moves);
  }
  assert.equal(imports.filter(filename => filename === 'vendor/nxn-solver/solver.js').length, 1);
  assert.equal(imports.filter(filename => filename === 'two-solver.js').length, 1);

  for (const size of [2, 4, 5, 6, 7, 8, 9, 10]) {
    const initial = model.solvedState(size);
    const scrambleMoves = [
      { face: 'R', n: 1, depth: size > 3 ? 1 : 0 },
      { face: 'U', n: 3, depth: 0 }
    ];
    for (const move of scrambleMoves) model.applyMove(initial, move.face, move.n, move.depth);
    const id = `${size}-short`;
    context.onmessage({ data: { id, mode: 'near-optimal', state: initial } });
    const result = messages.at(-1);
    assert.equal(result.type, 'result', `${size}×${size}: ${result.message}`);
    assert.equal(result.id, id);
    assert(result.moves.length <= 2, 'A two-turn position should be recognized from its current state');
    replay(initial, result.moves);
  }
  const largeState = model.solvedState(4);
  model.applyMove(largeState, 'R', 1, 1);
  model.applyMove(largeState, 'U', 3);
  model.applyMove(largeState, 'F', 2);
  const request = { id: 'large-state-only', mode: 'near-optimal', state: largeState };
  Object.defineProperty(request, 'history', {
    get() { throw new Error('The worker must not read move history'); }
  });
  context.onmessage({ data: request });
  const largeResult = messages.at(-1);
  assert.equal(largeResult.type, 'result', largeResult.message);
  replay(largeState, largeResult.moves);
  const layerMoves = require('../layer-solver.js').solve(largeState, model);
  assert(largeResult.moves.length <= layerMoves.length);
  assert.equal(imports.filter(filename => filename === 'two-optimal-solver.js').length, 1);
  assert.equal(imports.filter(filename => filename === 'short-solver.js').length, 1);
  assert.equal(imports.filter(filename => filename === 'vendor/cubejs/cube.js').length, 1);

  for (const mode of ['deep', 'three-phase']) {
    const request = { id: mode + '-state-only', mode, state: largeState };
    Object.defineProperty(request, 'history', {
      get() { throw new Error('The new modes must not read move history'); }
    });
    context.onmessage({ data: request });
    const result = messages.at(-1);
    assert.equal(result.type, 'result', result.message);
    assert.equal(result.id, request.id);
    replay(largeState, result.moves);
  }
  assert.equal(imports.filter(filename => filename === 'vendor/four-solver/solver.js').length, 1);
  assert.equal(imports.filter(filename => filename === 'four-solver.js').length, 1);
  for (const [mode, size] of [['deep', 2], ['deep', 3], ['three-phase', 3], ['three-phase', 5]]) {
    context.onmessage({ data: { id: 'unsupported', mode, state: model.solvedState(size) } });
    const result = messages.at(-1);
    assert.equal(result.type, 'error');
    assert.match(result.message, /supports/);
  }
});

test('a fresh three-phase worker loads only its own engines and shared helpers', () => {
  const { context, messages, imports } = workerHarness();
  const state = model.solvedState(4);
  model.applySeq(state, "R U2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  model.applyMove(state, 'R', 1, 1);
  context.onmessage({ data: { id: 'four-first', mode: 'three-phase', state } });
  const result = messages.at(-1);
  assert.equal(result.type, 'result', result.message);
  replay(state, result.moves);
  for (const helper of ['shallow-solver.js', 'move-optimizer.js', 'four-solver.js']) {
    assert.equal(imports.filter(file => file === helper).length, 1);
  }
  assert(!imports.includes('vendor/nxn-solver/solver.js'));
  assert(!imports.includes('short-solver.js'));
  assert(!imports.includes('center-solver.js'));
});
