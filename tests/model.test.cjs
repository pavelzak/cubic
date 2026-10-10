const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FACES, N, solvedState, cloneState, applyRot, applyMove, applySeq,
  solveLayerByLayer, isSolved
} = require('../cube-model.js');

// Sticker insertion order and signed zero do not change a cube position.
function snapshot(state) {
  return JSON.stringify(state.map(cubie => [
    cubie.id, cubie.p, FACES.map(face => cubie.s[face] || '')
  ]));
}

test('each face move followed by its inverse restores every cubie', () => {
  const expected = snapshot(solvedState());
  for (const face of FACES) {
    for (const n of [1, 2, 3]) {
      const state = solvedState();
      applyMove(state, face, n);
      assert.equal(isSolved(state), false, `${face}, ${n} quarter turns`);
      applyMove(state, face, 4 - n);
      assert.equal(snapshot(state), expected, `${face}, ${n} quarter turns`);
    }
  }
});

test('four quarter turns restore every cubie on each face', () => {
  const expected = snapshot(solvedState());
  for (const face of FACES) {
    const state = solvedState();
    for (let i = 0; i < 4; i++) applyMove(state, face, 1);
    assert.equal(snapshot(state), expected, face);
  }
});

test('clones can be changed independently of the original cube', () => {
  const state = solvedState();
  const copy = cloneState(state);
  applySeq(copy, "R U F'");
  assert.equal(isSolved(state), true);
  assert.equal(isSolved(copy), false);
  copy[0].p[0] = 99;
  copy[0].s.U = 'changed';
  assert.notEqual(state[0].p[0], 99);
  assert.notEqual(state[0].s.U, 'changed');
});

test('solved detection follows the centers after a whole-cube rotation', () => {
  const state = solvedState();
  for (const layer of [-1, 0, 1]) applyRot(state, N.R, layer, 1);
  assert.equal(isSolved(state), true);
  applyMove(state, 'U', 1);
  assert.equal(isSolved(state), false);
});

for (const scramble of ['', 'U', "R U R' U'", "F2 D L2 B' U R2"]) {
  test(`layer-by-layer solution replays successfully: ${scramble || 'solved'}`, () => {
    const state = solvedState();
    applySeq(state, scramble);
    const before = snapshot(state);
    const solution = solveLayerByLayer(state);
    assert.equal(snapshot(state), before, 'solving must not mutate the input');
    for (const move of solution) applyMove(state, move.face, move.n);
    assert.equal(isSolved(state), true);
    assert.equal(snapshot(state), snapshot(solvedState()));
  });
}
