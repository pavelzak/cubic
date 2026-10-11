'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../cube-model.js');
const build = require('../scripts/build-worker.cjs');

const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'solver-worker-client.js'), 'utf8');

function client(protocol = 'file:') {
  const events = [], blobs = new Map();
  let nextId = 0;
  const harness = { events, constructionError: null };
  class BlobStub {
    constructor(parts, options) {
      this.source = parts.join('');
      this.type = options.type;
    }
  }
  class WorkerStub {
    constructor(url) {
      events.push(['worker', url]);
      if (harness.constructionError) throw harness.constructionError;
      this.source = blobs.get(url).source;
      this.url = url;
    }
  }
  const context = vm.createContext({
    Blob: BlobStub,
    Worker: WorkerStub,
    location: { protocol },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, 'text/javascript');
        const url = 'blob:review/' + ++nextId;
        blobs.set(url, blob);
        events.push(['create', url]);
        return url;
      },
      revokeObjectURL(url) {
        events.push(['revoke', url]);
        blobs.delete(url);
      }
    }
  });
  context.window = context;
  vm.runInContext(bundle, context, { filename: 'solver-worker-client.js' });
  return Object.assign(harness, { context, create: () => context.CubeSolverWorker.create() });
}

function isolatedWorker() {
  const worker = client().create(), messages = [];
  const context = vm.createContext({
    postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); }
  });
  context.self = context;
  // importScripts is deliberately absent: the worker must be self-contained.
  vm.runInContext(worker.source, context, { filename: 'generated-blob-worker.js', timeout: 10000 });
  function request(data) {
    messages.length = 0;
    context.request = data;
    vm.runInContext('self.onmessage({ data: request });', context, { timeout: 30000 });
    assert(messages.every(message => message.id === data.id));
    return messages.at(-1);
  }
  return { context, request };
}

function assertSolution(state, result) {
  assert.equal(result.type, 'result', result.message);
  const replay = model.cloneState(state);
  for (const move of result.moves) model.applyMove(replay, move.face, move.n, move.depth);
  assert(model.isSolved(replay));
}

function assertTablesUninitialized(context) {
  for (const [name, table] of Object.entries(context.Cube.moveTables)) {
    if (name !== 'parity') assert.equal(table, null, name);
  }
  assert(Object.values(context.Cube.pruningTables).every(table => table === null));
}

test('generated worker artifact exactly matches all current sources and MIT notices', () => {
  assert.equal(bundle, build.renderBundle(), 'Run node scripts/build-worker.cjs after changing worker sources');
  for (const license of build.licenses) {
    assert(bundle.includes(fs.readFileSync(path.join(root, license), 'utf8').trimEnd()));
  }
});

test('HTTP and local-file clients only create workers, without running solvers on the page', () => {
  for (const protocol of ['https:', 'file:']) {
    const harness = client(protocol);
    for (const name of ['CubeModel', 'CubeSolverEngine', 'CubeTwoSolver', 'CubeTwoOptimalSolver', 'NxNSolver', 'CubeLayerSolver', 'CubeCenterSolver', 'CubeMoveOptimizer', 'CubeShallowSolver', 'CubeShortSolver', 'CubeFourReduction', 'CubeFourSolver', 'Cube', 'onmessage']) {
      assert.equal(harness.context[name], undefined, name + ' must not execute in the page');
    }
    assert.deepEqual(harness.events, []);
    const first = harness.create(), second = harness.create();
    assert.notEqual(first.url, second.url);
    assert.equal(first.source, second.source);
    assert.deepEqual(harness.events, [
      ['create', first.url], ['worker', first.url], ['revoke', first.url],
      ['create', second.url], ['worker', second.url], ['revoke', second.url]
    ]);
    assert.equal(harness.context.CubeModel, undefined);
    assert.equal(harness.context.onmessage, undefined);
  }
});

test('failed Worker construction revokes its Blob URL and preserves the original error', () => {
  const harness = client();
  const error = new Error('Worker blocked');
  harness.constructionError = error;
  assert.throws(harness.create, actual => actual === error);
  assert.deepEqual(harness.events.map(event => event[0]), ['create', 'worker', 'revoke']);
  assert.equal(new Set(harness.events.map(event => event[1])).size, 1);
});

test('self-contained worker solves every cube size without fetching dependencies', () => {
  const worker = isolatedWorker();
  assertTablesUninitialized(worker.context);
  for (let size = 2; size <= 10; size++) {
    const state = model.solvedState(size);
    model.applyMove(state, 'R', 1, size > 3 ? Math.floor((size - 1) / 2) : 0);
    model.applyMove(state, 'U', 3);
    const before = JSON.stringify(state);
    assertSolution(state, worker.request({ id: size, mode: 'layer', state }));
    assert.equal(JSON.stringify(state), before);
    assertTablesUninitialized(worker.context);
  }
  const state = model.solvedState(3);
  model.applySeq(state, 'D L2');
  const result = worker.request({ id: 'short', mode: 'near-optimal', state });
  assertSolution(state, result);
  assert.equal(result.moves.length, 2);
  assertTablesUninitialized(worker.context);
  for (const size of [2, 4, 5, 6, 7, 8, 9, 10]) {
    const initial = model.solvedState(size);
    const scrambleMoves = [
      { face: 'R', n: 1, depth: size > 3 ? 1 : 0 },
      { face: 'U', n: 3, depth: 0 }
    ];
    for (const move of scrambleMoves) model.applyMove(initial, move.face, move.n, move.depth);
    const result = worker.request({ id: 'short-' + size, mode: 'near-optimal', state: initial });
    assertSolution(initial, result);
    assert(result.moves.length <= 2);
    if (size >= 4) {
      const deep = worker.request({ id: 'deep-' + size, mode: 'deep', state: initial });
      assertSolution(initial, deep);
      assert(deep.moves.length <= 2);
    }
  }
  assert.equal(worker.request({ id: 'deep-invalid', mode: 'deep', state }).type, 'error');
  assert.equal(worker.request({ id: 'three-phase-invalid', mode: 'three-phase', state }).type, 'error');
  assert.equal(worker.request({ id: 'unknown', mode: 'unknown', state }).type, 'error');
});

test('all bundled larger-cube modes solve only the current state', () => {
  const worker = isolatedWorker();
  const state = model.solvedState(4);
  model.applyMove(state, 'R', 1, 1);
  model.applySeq(state, "U F2 L' B");
  for (const mode of ['near-optimal', 'deep', 'three-phase']) {
    const request = { id: 'state-only-' + mode, mode, state };
    Object.defineProperty(request, 'history', {
      get() { throw new Error('The bundled solver must not read move history'); }
    });
    assertSolution(state, worker.request(request));
  }
});

test('bundled near-optimal solver initializes search tables only when a longer solve needs them', () => {
  const worker = isolatedWorker();
  assertTablesUninitialized(worker.context);
  const state = model.solvedState(3);
  model.applySeq(state, "R U2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  const result = worker.request({ id: 'long', mode: 'near-optimal', state });
  assertSolution(state, result);
  assert(result.moves.length <= 22);
  assert(Object.values(worker.context.Cube.moveTables).every(table => table !== null));
  assert(Object.values(worker.context.Cube.pruningTables).every(table => table !== null));
});
