'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const CubeModel = require('../cube-model.js');

// Run the actual queue, controls, and event handlers without a WebGL context.
// Worker replies and animation completion remain under each test's control.
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('/* ================= move queue');
const end = html.indexOf('/* ================= pointer');
assert(start >= 0 && end > start, 'Cannot locate the application controls');
const source = html.slice(start, end);

class Element {
  constructor(tagName = 'DIV') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.className = '';
    this.disabled = false;
    this.value = '';
    this.textContent = '';
  }
  set textContent(value) {
    this.text = String(value);
    this.html = '';
    this.children = [];
  }
  get textContent() { return this.text; }
  set innerHTML(value) {
    this.html = String(value);
    this.text = this.html.replace(/<[^>]*>/g, '');
    this.children = [];
  }
  get innerHTML() { return this.html; }
  set className(value) {
    this.classes = String(value);
    this.classWrites = (this.classWrites || 0) + 1;
  }
  get className() { return this.classes; }
  appendChild(child) { this.children.push(child); }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  get lastChild() { return this.children.at(-1); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute() {}
  scrollIntoView() {}
  click() { if (!this.disabled) this.listeners.click?.(); }
  querySelectorAll(selector) {
    const classes = selector.split('.').slice(1);
    return this.children.filter(child => classes.every(name => child.className.split(' ').includes(name)));
  }
  querySelector(selector) {
    if (selector === '.empty' && this.html.includes('class="empty"')) return {};
    return this.querySelectorAll(selector)[0] || null;
  }
}

function app(options = {}) {
  const elements = new Map();
  const listeners = {};
  const workers = [];
  const animations = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(['solverMode', 'cubeSize', 'layerDepth'].includes(id) ? 'SELECT' : 'DIV'));
    return elements.get(id);
  };
  element('solverMode').value = 'layer';
  element('cubeSize').value = '3';
  element('layerDepth').value = '0';
  element('btnReset').textContent = 'Reset';
  element('historyReel').hidden = false;
  const document = {
    activeElement: null,
    getElementById: element,
    createElement: tag => new Element(tag.toUpperCase()),
    querySelectorAll: selector => selector === '#keys button' ? element('keys').children : []
  };
  class Worker {
    constructor(url) {
      if (options.workerConstructionError) throw new Error(options.workerConstructionError);
      this.url = url;
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) { this.messages.push(structuredClone(message)); }
    terminate() { this.terminated = true; }
    // Deliberately permit delivery after terminate to simulate an already queued event.
    reply(data) { this.onmessage({ data: structuredClone(data) }); }
  }
  const context = vm.createContext({
    CubeModel, document, location: { protocol: options.protocol || 'http:' },
    CubeSolverWorker: { create: () => new Worker('blob:test-worker') },
    window: { addEventListener: (type, listener) => { listeners[type] = listener; } },
    performance: { now: () => 100 }, reduceMotion: true, invalidate() {},
    stage: { classList: { remove() {} } }, buildCube() {},
    runTurn: (move, done) => animations.push({ move, done })
  });
  vm.runInContext(`
    const { N, solvedState, cloneState, applyRot, applyMove, moveName, isSolved: isSolvedState } = CubeModel;
    var size = Number(document.getElementById('cubeSize').value);
    var state = solvedState(size), drag = null;
    ${source}
  `, context);
  const evaluate = expression => vm.runInContext(expression, context);
  return {
    element, document, workers, animations,
    setup(sequence) {
      context.testSequence = sequence;
      evaluate('CubeModel.applySeq(state, testSequence)');
    },
    click(id) { element(id).click(); },
    key(key, shiftKey = false) { listeners.keydown({ key, shiftKey, preventDefault() {} }); },
    turn(face, n, depth = 0) {
      context.testMove = { face, n, depth };
      evaluate('userTurn(faceMove(testMove.face, testMove.n, testMove.depth))');
    },
    travel(position) {
      assert(element('historyTape').children[position], 'Expected a history button for position ' + position);
      element('historyTape').children[position].click();
    },
    changeSize(value) {
      element('cubeSize').value = String(value);
      element('cubeSize').listeners.change();
    },
    result(moves, worker = workers.at(-1), id = worker.messages.at(-1).id) {
      worker.reply({ id, type: 'result', moves });
    },
    completeTurn() {
      assert(animations.length, 'Expected an in-flight animation');
      const { move, done } = animations.shift();
      CubeModel.applyRot(evaluate('state'), move.axis, move.layer, move.n);
      done();
    },
    finish() {
      let remaining = 10000;
      while (animations.length && remaining-- > 0) this.completeTurn();
      assert(remaining > 0, 'Unexpectedly long animation queue');
    },
    snapshot() {
      return JSON.parse(evaluate(`JSON.stringify({
        state, size, depth: selectedDepth(), solved: isSolved(), busy, running, queued: queue.length,
        pending: solveRequest && solveRequest.id, moveCount, timing,
        status: elStatus.textContent, historyMoves, historyCursor, historyNavigationTarget
      })`));
    }
  };
}

function assertUnlocked(instance) {
  assert.equal(instance.snapshot().busy, false);
  for (const id of ['btnScramble', 'btnSolve', 'solverMode', 'cubeSize', 'layerDepth']) {
    assert.equal(instance.element(id).disabled, false, id + ' should be enabled');
  }
  assert.equal(instance.element('nearOptimalMode').disabled, false,
    'The shorter-solution option should be available for every size');
  assert(instance.element('keys').children.every(button => !button.disabled));
  assert.equal(instance.element('btnReset').textContent, 'Reset');
}

test('keyboard turns are blocked from solve request through playback', () => {
  const instance = app();
  instance.setup('U');
  const before = instance.snapshot().state;
  instance.click('btnSolve');
  instance.key('f');
  assert.deepEqual(instance.snapshot().state, before);
  assert.equal(instance.snapshot().running, false);
  assert.equal(instance.animations.length, 0);
  assert.equal(instance.workers.length, 1);
  assert.equal(instance.workers[0].url, 'blob:test-worker');
  instance.result([{ face: 'U', n: 3 }]);
  instance.key('f');
  assert.equal(instance.snapshot().queued, 0);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.snapshot().moveCount, 1);
  assertUnlocked(instance);
});

test('Stop cancels computation and ignores late replies', () => {
  const instance = app();
  instance.setup('U');
  const before = instance.snapshot().state;
  instance.click('btnSolve');
  const worker = instance.workers[0];
  instance.click('btnReset');
  assert.equal(worker.terminated, true);
  assertUnlocked(instance);
  instance.result([{ face: 'U', n: 3 }], worker);
  assert.deepEqual(instance.snapshot().state, before);
  assert.equal(instance.snapshot().pending, null);
  assert.equal(instance.animations.length, 0);
  assert.match(instance.snapshot().status, /stopped/i);
});

test('old worker messages cannot interfere with a new solve request', () => {
  const instance = app();
  instance.setup('U');
  instance.click('btnSolve');
  const oldWorker = instance.workers[0];
  instance.click('btnReset');
  instance.key('f');
  instance.finish();
  instance.element('solverMode').value = 'near-optimal';
  instance.click('btnSolve');
  const newWorker = instance.workers[1];
  const pending = instance.snapshot();
  oldWorker.reply({ id: oldWorker.messages[0].id, type: 'error', message: 'stale failure' });
  instance.result([{ face: 'U', n: 3 }], oldWorker);
  newWorker.reply({ id: oldWorker.messages[0].id, type: 'progress', message: 'stale progress' });
  assert.deepEqual(instance.snapshot(), pending);
  assert.equal(newWorker.messages[0].mode, 'near-optimal');
  instance.result([{ face: 'F', n: 3 }, { face: 'U', n: 3 }], newWorker);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.match(instance.snapshot().status, /near-optimal/);
  assertUnlocked(instance);
});

test('malformed or incorrect worker solutions never animate', async t => {
  const cases = {
    'non-array': null,
    'unknown face': [{ face: 'X', n: 1 }],
    'zero turn': [{ face: 'U', n: 0 }],
    'non-numeric turn': [{ face: 'U', n: '3' }],
    'negative depth': [{ face: 'U', n: 3, depth: -1 }],
    'fractional depth': [{ face: 'U', n: 3, depth: 0.5 }],
    'out-of-range depth': [{ face: 'U', n: 3, depth: 3 }],
    'string depth': [{ face: 'U', n: 3, depth: '0' }],
    'null depth': [{ face: 'U', n: 3, depth: null }],
    'wrong solution': [{ face: 'F', n: 3 }],
    'empty solution for unsolved cube': []
  };
  for (const [name, moves] of Object.entries(cases)) {
    await t.test(name, () => {
      const instance = app();
      instance.setup('U');
      const before = instance.snapshot().state;
      instance.click('btnSolve');
      instance.result(moves);
      assert.deepEqual(instance.snapshot().state, before);
      assert.equal(instance.animations.length, 0);
      assert.equal(instance.workers[0].terminated, true);
      assert.match(instance.snapshot().status, /Could not find a solution/);
      assertUnlocked(instance);
    });
  }
});

test('worker errors release every disabled control', async t => {
  for (const kind of ['construction', 'error-event', 'message-error', 'solver-error']) {
    await t.test(kind, () => {
      const instance = app(kind === 'construction' ? { workerConstructionError: 'blocked' } : {});
      instance.setup('U');
      instance.click('btnSolve');
      const worker = instance.workers[0];
      if (kind === 'error-event') worker.onerror({ message: 'crashed', preventDefault() {} });
      if (kind === 'message-error') worker.onmessageerror();
      if (kind === 'solver-error') worker.reply({ id: worker.messages[0].id, type: 'error', message: 'failed' });
      assert.equal(instance.snapshot().pending, null);
      assert.equal(instance.animations.length, 0);
      assert.match(instance.snapshot().status, /Could not find a solution/);
      assertUnlocked(instance);
    });
  }
});

test('worker factory errors show the actual failure on HTTP and file pages and allow retry', () => {
  for (const protocol of ['http:', 'file:']) {
    const options = { protocol, workerConstructionError: 'Worker construction blocked' };
    const instance = app(options);
    instance.turn('U', 1); instance.finish();
    const before = instance.snapshot().state;
    instance.click('btnSolve');
    assert.equal(instance.snapshot().status, 'Could not find a solution: Worker construction blocked');
    assert.doesNotMatch(instance.snapshot().status, /web server|README/i);
    assert.deepEqual(instance.snapshot().state, before);
    assert.equal(instance.snapshot().pending, null);
    assertUnlocked(instance);
    options.workerConstructionError = null;
    instance.click('btnSolve');
    assert.equal(instance.workers[0].url, 'blob:test-worker');
    instance.result([{ face: 'U', n: 3 }]);
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    assert.equal(instance.snapshot().historyCursor, 2);
    assertUnlocked(instance);
  }
});

test('Stop during playback lands only the current move, then a new solve succeeds', () => {
  const instance = app();
  instance.setup('U F R');
  instance.click('btnSolve');
  instance.result([{ face: 'R', n: 3 }, { face: 'F', n: 3 }, { face: 'U', n: 3 }]);
  assert.equal(instance.snapshot().queued, 2);
  instance.click('btnReset');
  assert.equal(instance.snapshot().queued, 0);
  assert.equal(instance.snapshot().running, true);
  instance.completeTurn();
  assert.equal(instance.snapshot().moveCount, 1);
  assert.equal(instance.snapshot().solved, false);
  assert.equal(instance.animations.length, 0);
  assertUnlocked(instance);
  instance.click('btnSolve');
  instance.result([{ face: 'F', n: 3 }, { face: 'U', n: 3 }]);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  instance.click('btnReset');
  assert.equal(instance.snapshot().moveCount, 0);
  assert.equal(instance.snapshot().solved, true);
  assertUnlocked(instance);
});

test('passing through solved during a longer solution keeps timing until playback ends', () => {
  const instance = app();
  instance.turn('U', 1); instance.finish();
  instance.click('btnSolve');
  instance.result([{ face: 'U', n: 3 }, { face: 'R', n: 1 }, { face: 'R', n: 3 }]);
  instance.completeTurn();
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.snapshot().running, true);
  assert.equal(instance.snapshot().timing, true, 'An intermediate solved position must not stop the timer');
  assert.match(instance.snapshot().status, /playing 3 turns/i);
  instance.completeTurn();
  assert.equal(instance.snapshot().solved, false);
  assert.equal(instance.snapshot().timing, true);
  instance.completeTurn();
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.snapshot().timing, false);
  assert.match(instance.snapshot().status, /^Solved in 3 turns/);
  assertUnlocked(instance);
});

test('already-solved cubes do not start a worker', () => {
  const instance = app();
  instance.click('btnSolve');
  assert.equal(instance.workers.length, 0);
  assert.match(instance.snapshot().status, /Already solved/);
  assertUnlocked(instance);
});

test('typing in the solver selector does not turn the cube', () => {
  const instance = app();
  instance.document.activeElement = instance.element('solverMode');
  instance.key('l');
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.animations.length, 0);
  assert.equal(instance.snapshot().moveCount, 0);
});

test('each size rebuilds a solved cube with matching layer options and solver availability', () => {
  const instance = app();
  for (let size = 2; size <= 10; size++) {
    instance.changeSize(size);
    const current = instance.snapshot();
    assert.equal(current.size, size);
    assert.equal(current.state.length, size ** 3 - (size - 2) ** 3);
    assert.equal(current.solved, true);
    assert.equal(current.depth, 0);
    assert.equal(current.moveCount, 0);
    assert.deepEqual(instance.element('layerDepth').children.map(option => option.value),
      Array.from({ length: Math.ceil(size / 2) }, (_, depth) => String(depth)));
    if (size === 2) assert.match(instance.element('solverNote').textContent, /corner|bottom layer/i);
    if (size > 3) assert.match(instance.element('solverNote').textContent, /cent(er|re)|edge/i);
    assertUnlocked(instance);
  }
});

test('keyboard and keypad turn the selected inner layer on even and odd cubes', () => {
  for (const size of [4, 5, 10]) {
    const instance = app();
    instance.changeSize(size);
    const depth = Math.floor((size - 1) / 2);
    instance.element('layerDepth').value = String(depth);
    instance.key('r');
    const move = instance.animations[0].move;
    assert.equal(move.face, 'R');
    assert.equal(move.depth, depth);
    assert.equal(move.layer, (size - 1) / 2 - depth);
    assert.equal(move.name, `${depth + 1}R`);
    instance.finish();
    assert.equal(instance.snapshot().solved, false);
    instance.key('r', true);
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    instance.element('keys').children[0].click();
    assert.equal(instance.animations[0].move.face, 'U');
    assert.equal(instance.animations[0].move.depth, depth);
    assert.equal(instance.animations[0].move.layer, (size - 1) / 2 - depth);
    instance.finish();
    assert.equal(instance.snapshot().solved, false);
  }
});

test('size changes are blocked during a manual turn, solver computation, and playback', () => {
  const instance = app();
  function assertSizeLocked() {
    assert.equal(instance.element('cubeSize').disabled, true);
    assert.equal(instance.element('layerDepth').disabled, true);
    instance.changeSize(4); // A dispatched change must also obey the busy guard.
    assert.equal(instance.snapshot().size, 3);
    assert.equal(instance.element('cubeSize').value, '3');
  }
  instance.key('u');
  assertSizeLocked();
  instance.finish();
  instance.click('btnSolve');
  assertSizeLocked();
  instance.result([{ face: 'U', n: 3 }]);
  assertSizeLocked();
  instance.finish();
  instance.changeSize(4);
  assert.equal(instance.snapshot().size, 4);
  assertUnlocked(instance);
});

test('changing size resets state, statistics, pending moves, and selected depth', () => {
  const instance = app();
  instance.changeSize(5);
  instance.element('layerDepth').value = '2';
  instance.key('u');
  instance.finish();
  assert.equal(instance.snapshot().solved, false);
  assert.equal(instance.snapshot().moveCount, 1);
  instance.changeSize(10);
  const current = instance.snapshot();
  assert.equal(current.size, 10);
  assert.equal(current.solved, true);
  assert.equal(current.moveCount, 0);
  assert.equal(current.depth, 0);
  assert.equal(current.queued, 0);
  assert.equal(current.running, false);
  assert.deepEqual(instance.element('historyTape').children.map(button => button.textContent), ['Start']);
  assert.equal(instance.element('rdTime').textContent, '0.0s');
  assertUnlocked(instance);
});

test('out-of-range and non-integer sizes leave the current cube unchanged', () => {
  const instance = app();
  instance.changeSize(4);
  const before = instance.snapshot();
  for (const invalid of [1, 11, 2.5, 'invalid']) {
    instance.changeSize(invalid);
    assert.deepEqual(instance.snapshot(), before);
    assert.equal(instance.element('cubeSize').value, '4');
  }
});

test('every size can request and play a layer-by-layer worker solution', () => {
  const instance = app();
  for (let size = 2; size <= 10; size++) {
    instance.changeSize(size);
    instance.key('u');
    instance.finish();
    instance.click('btnSolve');
    assert.equal(instance.snapshot().busy, true);
    const request = instance.workers.at(-1).messages.at(-1);
    assert.equal(request.mode, 'layer');
    assert.equal(CubeModel.cubeSize(request.state), size);
    assert.deepEqual(Object.keys(request).sort(), ['id', 'mode', 'state']);
    assert.deepEqual(request.state, instance.snapshot().state);
    instance.result([{ face: 'U', n: 3, depth: 0 }]);
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    assertUnlocked(instance);
  }
});

test('size changes preserve the selected mode and label the shorter-solution option accurately', () => {
  const instance = app();
  for (const mode of ['near-optimal', 'layer']) {
    instance.element('solverMode').value = mode;
    for (const size of [2, 3, 4, 5, 6, 7, 8, 9, 10, 3]) {
      instance.changeSize(size);
      assert.equal(instance.element('solverMode').value, mode);
      assert.equal(instance.element('nearOptimalMode').textContent,
        size === 2 ? 'Optimal' : size === 3 ? 'Near-optimal' : 'Shorter solution');
      if (mode === 'near-optimal') {
        const note = instance.element('solverNote').textContent;
        if (size === 2) {
          assert.match(note, /fewest moves/i);
          assert.match(note, /quarter.turn.*half.turn.*one move/i);
        } else {
          assert.match(note, /fewest moves are not guaranteed/i);
          if (size >= 4) {
            assert.match(note, /from the current cube/i);
            assert.doesNotMatch(note, /history/i);
          }
        }
      }
      assertUnlocked(instance);
    }
  }
});

test('the shorter-solution mode plays results with the correct label on every size', () => {
  const instance = app();
  instance.element('solverMode').value = 'near-optimal';
  for (let size = 2; size <= 10; size++) {
    instance.changeSize(size);
    const depth = Math.floor((size - 1) / 2);
    instance.turn('U', 1, depth); instance.finish();
    instance.click('btnSolve');
    const request = instance.workers.at(-1).messages.at(-1);
    assert.equal(request.mode, 'near-optimal');
    assert.equal(CubeModel.cubeSize(request.state), size);
    assert.deepEqual(Object.keys(request).sort(), ['id', 'mode', 'state']);
    assert.deepEqual(request.state, instance.snapshot().state);
    instance.result([{ face: 'U', n: 3, depth }]);
    const label = size === 2 ? 'Optimal' : size === 3 ? 'Near-optimal' : 'Shorter solution';
    assert.equal(instance.snapshot().status, label + ': playing 1 turns.');
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    assert.equal(instance.snapshot().status, 'Solved in 1 turns (' + label.toLowerCase() + ').');
    assertUnlocked(instance);
  }
});

test('every solver receives only the current cube after rewind and branches on its first committed turn', () => {
  for (const mode of ['layer', 'near-optimal']) for (let size = 2; size <= 10; size++) {
    const instance = app();
    instance.changeSize(size);
    const depth = Math.floor((size - 1) / 2);
    instance.turn('U', 1, depth); instance.finish();
    instance.turn('F', 2, 0); instance.finish();
    const prefixState = instance.snapshot().state;
    instance.turn('R', 3, depth); instance.finish();
    const futureState = instance.snapshot().state;
    instance.travel(2); instance.finish();
    instance.element('solverMode').value = mode;
    instance.click('btnSolve');
    const worker = instance.workers.at(-1);
    const request = worker.messages.at(-1);
    assert.deepEqual(request.state, prefixState);
    assert.deepEqual(Object.keys(request).sort(), ['id', 'mode', 'state']);
    assert.equal(request.mode, mode);
    assert.equal(instance.snapshot().historyMoves.length, 3, 'The future stays available while searching');
    instance.click('btnReset');
    instance.result([{ face: 'F', n: 2, depth: 0 }, { face: 'U', n: 3, depth }], worker);
    assert.deepEqual(instance.snapshot().state, prefixState, 'Canceled replies must not change the current prefix');
    instance.travel(3); instance.finish();
    assert.deepEqual(instance.snapshot().state, futureState);
    assert.deepEqual(request.state, prefixState, 'A sent cube snapshot must not change with later navigation');
    assertUnlocked(instance);
    instance.travel(2); instance.finish();
    const retainedHistory = instance.snapshot().historyMoves;
    instance.click('btnSolve');
    const nextRequest = instance.workers.at(-1).messages.at(-1);
    assert.deepEqual(Object.keys(nextRequest).sort(), ['id', 'mode', 'state']);
    assert.deepEqual(nextRequest.state, prefixState);
    instance.result([{ face: 'F', n: 2, depth: 0 }, { face: 'U', n: 3, depth }]);
    assert.deepEqual(instance.snapshot().state, prefixState);
    assert.deepEqual(instance.snapshot().historyMoves, retainedHistory,
      'The future stays available until the first solution turn lands');
    instance.completeTurn();
    assert.equal(instance.snapshot().historyCursor, 3);
    assert.deepEqual(instance.snapshot().historyMoves.slice(0, 2), retainedHistory.slice(0, 2));
    assert.deepEqual(instance.snapshot().historyMoves[2], { face: 'F', n: 2, depth: 0, name: 'F2' });
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    assert.equal(instance.snapshot().historyCursor, 4);
    assert.equal(instance.snapshot().historyMoves.length, 4);
    assert.deepEqual(nextRequest.state, prefixState);
    assertUnlocked(instance);
  }
});

test('a shorter-solution error preserves future history and permits a new large-cube request', () => {
  const instance = app();
  instance.changeSize(10);
  instance.turn('U', 1, 4); instance.finish();
  instance.turn('F', 2, 3); instance.finish();
  instance.travel(1); instance.finish();
  instance.element('solverMode').value = 'near-optimal';
  instance.click('btnSolve');
  const oldWorker = instance.workers[0];
  oldWorker.reply({ id: oldWorker.messages[0].id, type: 'error', message: 'Search interrupted' });
  assert.equal(instance.snapshot().historyCursor, 1);
  assert.equal(instance.snapshot().historyMoves.length, 2);
  assertUnlocked(instance);
  instance.click('btnSolve');
  const currentWorker = instance.workers[1];
  assert.deepEqual(Object.keys(currentWorker.messages[0]).sort(), ['id', 'mode', 'state']);
  assert.deepEqual(currentWorker.messages[0].state, instance.snapshot().state);
  instance.result([{ face: 'U', n: 3, depth: 4 }], oldWorker);
  assert.equal(instance.animations.length, 0, 'Old results must not interrupt the new request');
  instance.result([{ face: 'U', n: 3, depth: 4 }], currentWorker);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.deepEqual(instance.snapshot().historyMoves.map(move => move.name), ['5U', "5U'"]);
  assert.match(instance.snapshot().status, /shorter solution/);
  assertUnlocked(instance);
});

test('inner-layer solver results preserve depth, notation, and navigable history on every size', () => {
  for (let size = 2; size <= 10; size++) {
    const instance = app();
    instance.changeSize(size);
    const depth = Math.floor((size - 1) / 2);
    instance.turn('R', 1, depth); instance.finish();
    const afterR = instance.snapshot().state;
    instance.turn('F', 3, 0); instance.finish();
    instance.element('layerDepth').value = '0';
    instance.click('btnSolve');
    instance.result([{ face: 'F', n: 1, depth: 0 }, { face: 'R', n: 3, depth }]);
    assert.equal(instance.element('historyTape').children.length, 3,
      'Planned solver moves should not appear before they are committed');
    instance.completeTurn();
    assert.equal(instance.animations[0].move.face, 'R');
    assert.equal(instance.animations[0].move.depth, depth);
    assert.equal(instance.animations[0].move.layer, (size - 1) / 2 - depth);
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    assert.deepEqual(instance.element('historyTape').children.slice(-2).map(button => button.textContent),
      ['F', `${depth ? depth + 1 : ''}R'`]);
    assert.equal(instance.snapshot().historyCursor, 4);
    assert.equal(instance.snapshot().historyMoves[3].depth, depth);
    const solved = instance.snapshot().state;
    instance.travel(1); instance.finish();
    assert.deepEqual(instance.snapshot().state, afterR, `${size}×${size} after history rewind`);
    instance.travel(4); instance.finish();
    assert.deepEqual(instance.snapshot().state, solved, `${size}×${size} after history replay`);
    assertUnlocked(instance);
  }
});

test('solver playback accepts every legal depth, including the farthest layer', () => {
  for (const size of [2, 3, 4, 5, 10]) {
    const instance = app();
    instance.changeSize(size);
    instance.turn('R', 1, size - 1); instance.finish();
    instance.click('btnSolve');
    instance.result([{ face: 'R', n: 3, depth: size - 1 }]);
    assert.equal(instance.animations[0].move.depth, size - 1);
    assert.equal(instance.animations[0].move.layer, -(size - 1) / 2);
    instance.finish();
    assert.equal(instance.snapshot().solved, true);
    assertUnlocked(instance);
  }
});

test('Stop during a large-cube solution lands the exact inner layer and preserves its history', () => {
  const instance = app();
  instance.changeSize(10);
  instance.turn('R', 1, 4); instance.finish();
  const afterR = instance.snapshot().state;
  instance.turn('F', 1, 3); instance.finish();
  instance.click('btnSolve');
  instance.result([{ face: 'F', n: 3, depth: 3 }, { face: 'R', n: 3, depth: 4 }]);
  instance.click('btnReset');
  instance.completeTurn();
  assert.deepEqual(instance.snapshot().state, afterR);
  assert.equal(instance.snapshot().historyCursor, 3);
  assert.equal(instance.snapshot().historyMoves.length, 3);
  assert.deepEqual(instance.snapshot().historyMoves[2], { face: 'F', n: 3, depth: 3, name: "4F'" });
  instance.click('btnSolve');
  instance.result([{ face: 'R', n: 3, depth: 4 }]);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  instance.travel(1); instance.finish();
  assert.deepEqual(instance.snapshot().state, afterR);
  assertUnlocked(instance);
});

test('stopping a non-3×3 scramble lands one move and releases the controls', () => {
  for (const size of [2, 4, 5, 10]) {
    const instance = app();
    instance.changeSize(size);
    instance.click('btnScramble');
    assert.equal(instance.snapshot().running, true);
    assert(instance.snapshot().queued > 0);
    assert.equal(instance.element('cubeSize').disabled, true);
    instance.click('btnReset');
    assert.equal(instance.snapshot().queued, 0);
    instance.completeTurn();
    assert.equal(instance.animations.length, 0);
    assert.equal(instance.snapshot().moveCount, 1);
    assert.equal(instance.snapshot().solved, false);
    assertUnlocked(instance);
    instance.key('f');
    instance.finish();
    instance.click('btnReset');
    assert.equal(instance.snapshot().size, size);
    assert.equal(instance.snapshot().solved, true);
    assert.equal(instance.snapshot().moveCount, 0);
    assertUnlocked(instance);
  }
});

test('a canceled worker cannot apply its old solution after a size change', () => {
  const instance = app();
  instance.setup('U');
  instance.click('btnSolve');
  const oldWorker = instance.workers[0];
  instance.click('btnReset');
  instance.changeSize(10);
  const before = instance.snapshot();
  instance.result([{ face: 'U', n: 3 }], oldWorker);
  assert.deepEqual(instance.snapshot(), before);
  assert.equal(instance.animations.length, 0);
  assertUnlocked(instance);
});

test('3×3 solver playback always uses outer layers when an inner layer is selected', () => {
  const instance = app();
  instance.setup('U');
  instance.element('layerDepth').value = '1';
  instance.click('btnSolve');
  instance.result([{ face: 'U', n: 3 }]);
  assert.equal(instance.animations[0].move.depth, 0);
  assert.equal(instance.animations[0].move.layer, 1);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.snapshot().depth, 1);
  assertUnlocked(instance);
});

test('history records only committed turns and animates back to Start and forward', () => {
  const instance = app();
  instance.key('u');
  assert.equal(instance.snapshot().historyMoves.length, 0);
  instance.completeTurn();
  const afterU = instance.snapshot().state;
  assert.equal(instance.snapshot().historyCursor, 1);
  assert.deepEqual(instance.snapshot().historyMoves, [{ face: 'U', depth: 0, n: 1, name: 'U' }]);
  assert.equal(instance.element('historyReel').hidden, false);
  assert.deepEqual(instance.element('historyTape').children.map(button => button.textContent), ['Start', 'U']);
  instance.travel(0);
  assert.deepEqual(instance.snapshot().state, afterU, 'Navigation must not teleport the cube');
  assert.equal(instance.animations[0].move.n, 3);
  assert.equal(instance.snapshot().historyCursor, 1);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.snapshot().historyCursor, 0);
  assert.equal(instance.snapshot().historyMoves.length, 1);
  instance.travel(1);
  assert.equal(instance.animations[0].move.n, 1);
  instance.finish();
  assert.deepEqual(instance.snapshot().state, afterU);
  assert.equal(instance.snapshot().historyCursor, 1);
  assert.equal(instance.snapshot().historyMoves.length, 1);
  assertUnlocked(instance);
});

test('history restores exact inner-layer positions on every size from 2 through 10', () => {
  for (let size = 2; size <= 10; size++) {
    const instance = app();
    instance.changeSize(size);
    const depth = Math.floor((size - 1) / 2);
    const snapshots = [instance.snapshot().state];
    for (const [face, n] of [['U', 1], ['R', 3], ['F', 2]]) {
      instance.turn(face, n, depth);
      instance.finish();
      snapshots.push(instance.snapshot().state);
    }
    const records = instance.snapshot().historyMoves;
    assert.deepEqual(records.map(move => [move.face, move.depth, move.n]), [['U', depth, 1], ['R', depth, 3], ['F', depth, 2]]);
    for (const target of [1, 3, 0, 2, 3]) {
      instance.travel(target);
      instance.finish();
      assert.deepEqual(instance.snapshot().state, snapshots[target], `${size}×${size} at turn ${target}`);
      assert.equal(instance.snapshot().historyCursor, target);
      assert.deepEqual(instance.snapshot().historyMoves, records);
    }
    assertUnlocked(instance);
  }
});

test('travel locks manual input, size changes, and history buttons until completion', () => {
  const instance = app();
  for (const face of ['U', 'F', 'R']) { instance.turn(face, 1); instance.finish(); }
  instance.travel(0);
  const before = instance.snapshot();
  instance.key('b');
  instance.changeSize(10);
  instance.element('historyTape').children[2].listeners.click(); // bypass disabled DOM control
  instance.element('btnSolve').listeners.click();
  instance.element('btnScramble').listeners.click();
  assert.deepEqual(instance.snapshot(), before);
  assert(instance.element('historyTape').children.every(button => button.disabled));
  assert.equal(instance.workers.length, 0);
  instance.finish();
  assert.equal(instance.snapshot().historyCursor, 0);
  assert.equal(instance.element('historyTape').children[0].disabled, true);
  assert(instance.element('historyTape').children.slice(1).every(button => !button.disabled));
  assertUnlocked(instance);
});

test('Stop during backward and forward travel leaves a coherent committed cursor', () => {
  const instance = app();
  const snapshots = [instance.snapshot().state];
  for (const face of ['U', 'F', 'R']) {
    instance.turn(face, 1); instance.finish(); snapshots.push(instance.snapshot().state);
  }
  instance.travel(0);
  instance.completeTurn(); // Undo R; undo F is now in flight.
  assert.equal(instance.snapshot().historyCursor, 2);
  instance.click('btnReset');
  assert.equal(instance.snapshot().queued, 0);
  instance.completeTurn();
  assert.equal(instance.snapshot().historyCursor, 1);
  assert.deepEqual(instance.snapshot().state, snapshots[1]);
  assert.equal(instance.snapshot().historyMoves.length, 3);
  assert.equal(instance.snapshot().historyNavigationTarget, null);
  assertUnlocked(instance);
  instance.travel(3);
  instance.click('btnReset'); // F lands; R remains available in the future.
  instance.completeTurn();
  assert.equal(instance.snapshot().historyCursor, 2);
  assert.deepEqual(instance.snapshot().state, snapshots[2]);
  assert.equal(instance.snapshot().historyMoves.length, 3);
  instance.travel(3);
  instance.finish();
  assert.deepEqual(instance.snapshot().state, snapshots[3]);
  assertUnlocked(instance);
});

test('a new manual turn after rewind replaces the future branch only when committed', () => {
  const instance = app();
  for (const face of ['U', 'F', 'R']) { instance.turn(face, 1); instance.finish(); }
  instance.travel(1); instance.finish();
  instance.turn('B', 3);
  assert.equal(instance.snapshot().historyMoves.length, 3);
  instance.finish();
  assert.deepEqual(instance.snapshot().historyMoves.map(move => move.name), ['U', "B'"]);
  assert.equal(instance.snapshot().historyCursor, 2);
  assert.deepEqual(instance.element('historyTape').children.map(button => button.textContent), ['Start', 'U', "B'"]);
  instance.travel(0); instance.finish();
  assert.equal(instance.snapshot().solved, true);
  instance.travel(2); instance.finish();
  const expected = CubeModel.solvedState(); CubeModel.applySeq(expected, "U B'");
  assert.deepEqual(instance.snapshot().state, JSON.parse(JSON.stringify(expected)));
});

test('solver moves extend history and solving after rewind discards future playback', () => {
  const instance = app();
  instance.turn('U', 1); instance.finish();
  const afterU = instance.snapshot().state;
  instance.turn('F', 1); instance.finish();
  instance.click('btnSolve');
  instance.result([{ face: 'F', n: 3 }, { face: 'U', n: 3 }]);
  instance.finish();
  assert.equal(instance.snapshot().historyCursor, 4);
  assert.equal(instance.snapshot().historyMoves.length, 4);
  instance.travel(1); instance.finish();
  assert.deepEqual(instance.snapshot().state, afterU);
  instance.click('btnSolve');
  assert.equal(instance.snapshot().historyMoves.length, 4);
  instance.result([{ face: 'U', n: 3 }]);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.deepEqual(instance.snapshot().historyMoves.map(move => move.name), ['U', "U'"]);
  assert.equal(instance.snapshot().historyCursor, 2);
  instance.travel(1); instance.finish();
  assert.deepEqual(instance.snapshot().state, afterU);
});

test('a failed solve preserves the history future and leaves it navigable', () => {
  const instance = app();
  instance.turn('U', 1); instance.finish();
  instance.turn('F', 1); instance.finish();
  const latest = instance.snapshot().state;
  instance.travel(1); instance.finish();
  instance.click('btnSolve');
  instance.result([{ face: 'R', n: 1 }]);
  assert.equal(instance.snapshot().historyMoves.length, 2);
  assert.equal(instance.snapshot().historyCursor, 1);
  instance.travel(2); instance.finish();
  assert.deepEqual(instance.snapshot().state, latest);
  assertUnlocked(instance);
});

test('a scramble after rewind records only landed moves and starts a new branch', () => {
  const instance = app();
  instance.changeSize(10);
  for (const face of ['U', 'F', 'R']) { instance.turn(face, 1, 4); instance.finish(); }
  instance.travel(1); instance.finish();
  instance.click('btnScramble');
  const first = instance.animations[0].move;
  assert.equal(instance.snapshot().historyMoves.length, 3);
  instance.click('btnReset');
  instance.completeTurn();
  assert.equal(instance.snapshot().historyCursor, 2);
  assert.deepEqual(instance.snapshot().historyMoves[1], {
    face: first.face, depth: first.depth, n: first.n, name: first.name
  });
  assert.equal(instance.snapshot().historyMoves.length, 2);
  instance.travel(0); instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assertUnlocked(instance);
});

test('Reset and size changes clear past and future history', () => {
  const instance = app();
  for (const reset of [() => instance.click('btnReset'), () => instance.changeSize(10)]) {
    instance.turn('U', 1); instance.finish();
    instance.turn('F', 1); instance.finish();
    instance.travel(1); instance.finish();
    reset();
    assert.deepEqual(instance.snapshot().historyMoves, []);
    assert.equal(instance.snapshot().historyCursor, 0);
    assert.equal(instance.snapshot().historyNavigationTarget, null);
    assert.deepEqual(instance.element('historyTape').children.map(button => button.textContent), ['Start']);
    assert.equal(instance.element('historyTape').children[0].disabled, true);
    assert.equal(instance.element('historyReel').hidden, false);
    assert.equal(instance.snapshot().solved, true);
    assertUnlocked(instance);
  }
});

test('long solution playback updates the unified history with linear DOM work', () => {
  const instance = app();
  instance.turn('U', 1); instance.finish();
  instance.click('btnSolve');
  // A verified long solution exercises the same UI path as a large-cube solve.
  const moves = [];
  for (let i = 0; i < 2500; i++) moves.push({ face: 'R', n: 1 }, { face: 'R', n: 3 });
  moves.push({ face: 'U', n: 3 });
  instance.result(moves);
  instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assert.equal(instance.snapshot().historyMoves.length, 5002);
  assert.equal(instance.snapshot().historyCursor, 5002);
  const history = instance.element('historyTape').children;
  assert(history.reduce((sum, element) => sum + element.classWrites, 0) < history.length * 8,
    'History reel should append buttons and update only the changed cursor');
  assert.equal(history.length, 5003);
  assertUnlocked(instance);
});

test('the page has one persistent history timeline with Start even before any turn', () => {
  assert.equal((html.match(/<section class="reel(?:\s[^"]*)?"/g) || []).length, 1);
  assert.equal((html.match(/id="historyTape"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="(?:tape|reelLabel|reelCount)"/);
  const instance = app();
  assert.equal(instance.element('historyReel').hidden, false);
  assert.deepEqual(instance.element('historyTape').children.map(button => button.textContent), ['Start']);
  assert.equal(instance.element('historyTape').children[0].disabled, true);
  assert.equal(instance.element('historyCount').textContent, '0 / 0');
});

test('scramble, manual, and solver turns all append to the same navigable history', () => {
  const instance = app();
  instance.click('btnScramble');
  assert.equal(instance.element('historyTape').children.length, 1,
    'An unplayed scramble must not create a separate sequence preview');
  instance.finish();
  const afterScramble = instance.snapshot().state;
  const scrambleMoves = instance.snapshot().historyMoves;
  assert.equal(scrambleMoves.length, 25);
  instance.turn('R', 1); instance.finish();
  const afterManual = instance.snapshot();
  const solution = CubeModel.solveLayerByLayer(afterManual.state);
  instance.click('btnSolve');
  instance.result(solution);
  instance.finish();
  const final = instance.snapshot();
  assert.equal(final.solved, true);
  assert.deepEqual(final.historyMoves.slice(0, 25), scrambleMoves);
  assert.deepEqual(final.historyMoves[25], { face: 'R', depth: 0, n: 1, name: 'R' });
  assert.equal(final.historyMoves.length, 26 + solution.length);
  assert.equal(instance.element('historyTape').children.length, final.historyMoves.length + 1);
  instance.travel(25); instance.finish();
  assert.deepEqual(instance.snapshot().state, afterScramble);
  instance.travel(26); instance.finish();
  assert.deepEqual(instance.snapshot().state, afterManual.state);
  instance.travel(final.historyCursor); instance.finish();
  assert.equal(instance.snapshot().solved, true);
  assertUnlocked(instance);
});
