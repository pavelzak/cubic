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
  appendChild(child) { this.children.push(child); }
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
    if (!elements.has(id)) elements.set(id, new Element(id === 'solverMode' ? 'SELECT' : 'DIV'));
    return elements.get(id);
  };
  element('solverMode').value = 'layer';
  element('btnReset').textContent = 'Reset';
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
    CubeModel, document, Worker, location: { protocol: options.protocol || 'http:' },
    window: { addEventListener: (type, listener) => { listeners[type] = listener; } },
    performance: { now: () => 100 }, reduceMotion: true, invalidate() {},
    runTurn: (move, done) => animations.push({ move, done })
  });
  vm.runInContext(`
    const { N, solvedState, cloneState, applyRot, applyMove, moveName, isSolved: isSolvedState } = CubeModel;
    var state = solvedState();
    var meshes = Object.fromEntries(state.map(c => [c.id, {
      position: { set() {} }, quaternion: { identity() {} }
    }]));
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
    key(key) { listeners.keydown({ key, preventDefault() {} }); },
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
      let remaining = 100;
      while (animations.length && remaining-- > 0) this.completeTurn();
      assert(remaining > 0, 'Unexpectedly long animation queue');
    },
    snapshot() {
      return JSON.parse(evaluate(`JSON.stringify({
        state, solved: isSolved(), busy, running, queued: queue.length,
        pending: solveRequest && solveRequest.id, moveCount,
        status: elStatus.textContent, tapeMode
      })`));
    }
  };
}

function assertUnlocked(instance) {
  assert.equal(instance.snapshot().busy, false);
  for (const id of ['btnSolve', 'btnScramble', 'solverMode']) {
    assert.equal(instance.element(id).disabled, false, id + ' should be enabled');
  }
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
