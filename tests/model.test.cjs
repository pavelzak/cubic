const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FACES, N, solvedState, cubeSize, cloneState, applyRot, applyMove, applySeq,
  solveLayerByLayer, isSolved, tidy, moveName
} = require('../cube-model.js');

test('move simplification preserves distinct inner layers and their notation', () => {
  const moves = [{ face: 'R', depth: 1, n: 1 }, { face: 'R', depth: 2, n: 3 }];
  assert.deepEqual(tidy(moves), moves);
  assert.equal(moveName(moves[0]), '2R');
  assert.equal(moveName(moves[1]), "3R'");
  assert.deepEqual(tidy([{ face: 'R', depth: 2, n: 1 }, { face: 'R', depth: 2, n: 3 }]), []);
});

// Sticker insertion order and signed zero do not change a cube position.
function snapshot(state) {
  return JSON.stringify(state.map(cubie => [
    cubie.id, cubie.p, FACES.map(face => cubie.s[face] || '')
  ]));
}

test('default 3×3 preserves the original cubie IDs, coordinates and stickers', () => {
  const original = [
    [-1, -1, -1, 'DLB'], [-1, -1, 0, 'DL'], [-1, -1, 1, 'DLF'],
    [-1, 0, -1, 'LB'], [-1, 0, 0, 'L'], [-1, 0, 1, 'LF'],
    [-1, 1, -1, 'ULB'], [-1, 1, 0, 'UL'], [-1, 1, 1, 'ULF'],
    [0, -1, -1, 'DB'], [0, -1, 0, 'D'], [0, -1, 1, 'DF'],
    [0, 0, -1, 'B'], [0, 0, 1, 'F'],
    [0, 1, -1, 'UB'], [0, 1, 0, 'U'], [0, 1, 1, 'UF'],
    [1, -1, -1, 'DRB'], [1, -1, 0, 'DR'], [1, -1, 1, 'DRF'],
    [1, 0, -1, 'RB'], [1, 0, 0, 'R'], [1, 0, 1, 'RF'],
    [1, 1, -1, 'URB'], [1, 1, 0, 'UR'], [1, 1, 1, 'URF']
  ].map(([x, y, z, faces], id) => ({
    id, p: [x, y, z], s: Object.fromEntries([...faces].map(face => [face, face]))
  }));
  assert.deepEqual(solvedState(), original);
  assert.deepEqual(solvedState(3), original);
});

test('cube sizes and layer depths reject unsupported values', () => {
  for (const size of [0, 1, 11, 2.5, NaN, '3', null]) {
    assert.throws(() => solvedState(size), /integer from 2 to 10/);
  }
  for (const size of [2, 10]) {
    for (const depth of [-1, size, 0.5]) {
      assert.throws(() => applyMove(solvedState(size), 'R', 1, depth), /Layer depth/);
    }
  }
});

for (let size = 2; size <= 10; size++) {
  test(`${size}×${size} contains exactly the surface cubies and face stickers`, () => {
    const state = solvedState(size);
    const extent = (size - 1) / 2;
    assert.equal(cubeSize(state), size);
    assert.equal(state.length, size ** 3 - (size - 2) ** 3);
    assert.equal(state.reduce((count, cubie) => count + Object.keys(cubie.s).length, 0), 6 * size ** 2);
    for (const face of FACES) {
      assert.equal(state.filter(cubie => cubie.s[face] === face).length, size ** 2);
    }
    for (const cubie of state) {
      assert.equal(Math.max(...cubie.p.map(Math.abs)), extent);
      assert.ok(cubie.p.every(coordinate => Number.isInteger(coordinate + extent)));
    }
    assert.equal(isSolved(state), true);
  });

  test(`${size}×${size} restores outer and inner layers after inverse and repeated turns`, () => {
    const expected = snapshot(solvedState(size));
    for (const face of FACES) {
      for (let depth = 0; depth < size; depth++) {
        const description = `${face}, depth ${depth}`;
        for (const turns of [1, 2, 3]) {
          const state = solvedState(size);
          applyMove(state, face, turns, depth);
          assert.equal(isSolved(state), false, description);
          assert.equal(cubeSize(state), size, description);
          applyMove(state, face, 4 - turns, depth);
          assert.equal(snapshot(state), expected, description);
        }
        const state = solvedState(size);
        for (let turn = 0; turn < 4; turn++) applyMove(state, face, 1, depth);
        assert.equal(snapshot(state), expected, description);
      }
    }
  });

  test(`${size}×${size} layer permutations preserve cubies, stickers and surface geometry`, () => {
    const state = solvedState(size);
    const extent = (size - 1) / 2;
    const originalColors = state.map(cubie => Object.values(cubie.s).sort().join(''));
    const originalPositions = state.map(cubie => cubie.p.join(',')).sort();
    let seed = size;
    const next = limit => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    for (let move = 0; move < 60; move++) {
      applyMove(state, FACES[next(FACES.length)], next(3) + 1, next(size));
    }
    assert.equal(cubeSize(state), size);
    assert.equal(new Set(state.map(cubie => cubie.id)).size, state.length);
    assert.deepEqual(state.map(cubie => cubie.p.join(',')).sort(), originalPositions);
    const faceCounts = Object.fromEntries(FACES.map(face => [face, 0]));
    for (const cubie of state) {
      assert.equal(Object.values(cubie.s).sort().join(''), originalColors[cubie.id]);
      for (const face of Object.keys(cubie.s)) {
        const normal = N[face];
        assert.equal(cubie.p.reduce((sum, coordinate, axis) => sum + coordinate * normal[axis], 0), extent);
        faceCounts[face]++;
      }
    }
    for (const face of FACES) assert.equal(faceCounts[face], size ** 2);
  });

  test(`${size}×${size} solved detection permits view-independent whole-cube rotations`, () => {
    const state = solvedState(size);
    for (const face of ['R', 'U', 'F']) {
      for (let depth = 0; depth < size; depth++) applyMove(state, face, 1, depth);
      assert.equal(isSolved(state), true);
    }
    applyMove(state, 'R', 1);
    assert.equal(isSolved(state), false);
  });

  if (size !== 3) {
    test(`${size}×${size} is explicitly rejected by the 3×3 layer-by-layer solver`, () => {
      assert.throws(() => solveLayerByLayer(solvedState(size)), /only 3×3/);
    });
  }
}

test('solved detection rejects empty cubes and repeated face colors', () => {
  assert.equal(isSolved([]), false);
  const state = solvedState(4);
  for (const cubie of state) for (const face of Object.keys(cubie.s)) cubie.s[face] = 'U';
  assert.equal(isSolved(state), false);
});

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
