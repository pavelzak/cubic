(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubeModel = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

/* ================= cube model + solver ================= */
/* ---------- Rubik's cube model + layer-by-layer solver ---------- */
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const N = { U: [0, 1, 0], D: [0, -1, 0], L: [-1, 0, 0], R: [1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
const SIDES = ['F', 'R', 'B', 'L'];
// each side face paired with the face to its right
const RING = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (...vs) => vs.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function rot1(v, a) { const d = dot(a, v), c = cross(a, v); return [a[0] * d - c[0], a[1] * d - c[1], a[2] * d - c[2]]; }
function rotN(v, a, n) { let r = v; for (let i = 0; i < n; i++) r = rot1(r, a); return r; }
function faceOfVec(v) { for (const f of FACES) if (same(N[f], v)) return f; return null; }

function solvedState(size = 3) {
  if (!Number.isInteger(size) || size < 2 || size > 10) {
    throw new RangeError('Cube size must be an integer from 2 to 10.');
  }
  const extent = (size - 1) / 2;
  const st = []; let id = 0;
  for (let x = -extent; x <= extent; x++) for (let y = -extent; y <= extent; y++) for (let z = -extent; z <= extent; z++) {
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== extent) continue;
    const s = {};
    for (const f of FACES) if (dot([x, y, z], N[f]) === extent) s[f] = f;
    st.push({ id: id++, p: [x, y, z], s });
  }
  return st;
}
const cloneState = st => st.map(c => ({ id: c.id, p: c.p.slice(), s: Object.assign({}, c.s) }));

function cubeSize(state) {
  if (!state.length) throw new Error('Cannot determine the size of an empty cube.');
  // Every stored cubie is on the surface, including after any legal layer turn.
  const p = state[0].p;
  return 2 * Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) + 1;
}

function applyRot(st, axis, layer, n) {
  n = ((n % 4) + 4) % 4; if (!n) return;
  for (const c of st) {
    if (dot(c.p, axis) !== layer) continue;
    c.p = rotN(c.p, axis, n);
    const ns = {};
    for (const k in c.s) ns[faceOfVec(rotN(N[k], axis, n))] = c.s[k];
    c.s = ns;
  }
}
function applyMove(st, f, n, depth = 0) {
  const size = cubeSize(st);
  if (!Number.isInteger(depth) || depth < 0 || depth >= size) {
    throw new RangeError('Layer depth must be an integer from 0 to ' + (size - 1) + '.');
  }
  applyRot(st, N[f], (size - 1) / 2 - depth, n);
}

function parseSeq(str) {
  const out = [];
  for (const t of str.trim().split(/\s+/)) if (t) out.push([t[0], t[1] === "'" ? 3 : t[1] === '2' ? 2 : 1]);
  return out;
}
function applySeq(st, str) { if (str && str.trim()) for (const [f, n] of parseSeq(str)) applyMove(st, f, n); }

const pieceAt = (st, p) => st.find(c => same(c.p, p));
const byId = (st, id) => st.find(c => c.id === id);
const seqLen = s => (s && s.trim() ? s.trim().split(/\s+/).length : 0);

/* ---------- solver ---------- */
function solve(initial) {
  if (cubeSize(initial) !== 3) throw new Error('Layer-by-layer solving supports only 3×3 cubes.');
  const st = cloneState(initial);
  const moves = [];
  // colour on each centre, so slice turns don't confuse the solver
  const CC = {};
  for (const f of FACES) CC[f] = pieceAt(st, N[f]).s[f];

  function doSeq(str) { for (const [f, n] of parseSeq(str)) { applyMove(st, f, n); moves.push({ face: f, n }); } }
  function tryC(cands, goal) {
    for (const c of cands) {
      const t = cloneState(st); applySeq(t, c);
      if (goal(t)) { doSeq(c); return true; }
    }
    return false;
  }
  function findPiece(s, cols) {
    return s.find(c => {
      const k = Object.values(c.s);
      return k.length === cols.length && cols.every(x => k.includes(x));
    });
  }
  function search(s0, maxDepth, goal) {
    if (goal(s0)) return '';
    const path = [];
    const dfs = (s, depth, last) => {
      if (depth === 0) return goal(s) ? path.join(' ') : null;
      for (const f of FACES) {
        if (f === last) continue;
        const t = cloneState(s);
        for (let n = 1; n <= 3; n++) {
          applyMove(t, f, 1);
          path.push(f + (n === 1 ? '' : n === 2 ? '2' : "'"));
          const r = dfs(t, depth - 1, f);
          if (r !== null) return r;
          path.pop();
        }
      }
      return null;
    };
    for (let d = 1; d <= maxDepth; d++) { const r = dfs(s0, d, ''); if (r !== null) return r; }
    return null;
  }
  const U = k => 'U '.repeat(k);

  const edgeOK = (s, a, b) => { const c = pieceAt(s, add(N[a], N[b])); return c.s[a] === CC[a] && c.s[b] === CC[b]; };
  const cornerOK = (s, a, b, d) => { const c = pieceAt(s, add(N[a], N[b], N[d])); return c.s[a] === CC[a] && c.s[b] === CC[b] && c.s[d] === CC[d]; };
  const crossOK = s => SIDES.every(X => edgeOK(s, 'D', X));
  const cornersOK = s => RING.every(([X, Y]) => cornerOK(s, 'D', X, Y));
  const midOK = s => RING.every(([X, Y]) => edgeOK(s, X, Y));
  const f2lOK = s => crossOK(s) && cornersOK(s) && midOK(s);
  const upEdges = s => SIDES.filter(f => pieceAt(s, add(N.U, N[f])).s.U === CC.U).length;
  const upCorners = s => RING.filter(([X, Y]) => pieceAt(s, add(N.U, N[X], N[Y])).s.U === CC.U).length;
  const isSolvedS = s => s.every(c => Object.keys(c.s).every(f => c.s[f] === CC[f]));
  const fail = step => { throw new Error('solver stuck at: ' + step); };

  /* 1 — bottom cross */
  for (let g = 0; !crossOK(st); g++) {
    if (g > 8) fail('cross');
    const keep = SIDES.filter(X => edgeOK(st, 'D', X));
    const rem = SIDES.filter(X => !edgeOK(st, 'D', X));
    const held = s => keep.every(Y => edgeOK(s, 'D', Y));
    // place one edge outright
    let best = null;
    for (const X of rem) {
      const seq = search(st, 4, s => edgeOK(s, 'D', X) && held(s));
      if (seq !== null && (best === null || seqLen(seq) < seqLen(best))) best = seq;
    }
    if (best !== null) { doSeq(best); continue; }
    // otherwise park it on top facing up, then drop it in
    let done = false;
    for (const X of rem) {
      const id = findPiece(st, [CC.D, CC[X]]).id;
      const petal = s => { const c = byId(s, id); return c.p[1] === 1 && c.s.U === CC.D; };
      const seq = search(st, 5, s => petal(s) && held(s));
      if (seq === null) continue;
      doSeq(seq);
      for (let k = 0; k < 4; k++) {
        const t = cloneState(st); applySeq(t, U(k) + X + '2');
        if (edgeOK(t, 'D', X) && held(t)) { doSeq(U(k) + X + '2'); done = true; break; }
      }
      if (done) break;
    }
    if (!done) fail('cross');
  }

  /* 2 — bottom corners */
  for (let g = 0; !cornersOK(st); g++) {
    if (g > 6) fail('corners');
    const done = RING.filter(([X, Y]) => cornerOK(st, 'D', X, Y));
    const prevOK = s => crossOK(s) && done.every(([a, b]) => cornerOK(s, 'D', a, b));
    const rem = RING.filter(r => !done.includes(r));
    // prefer a corner already waiting on top: no extraction needed
    const [X, Y] = rem.find(([a, b]) => findPiece(st, [CC.D, CC[a], CC[b]]).p[1] === 1) || rem[0];
    const id = findPiece(st, [CC.D, CC[X], CC[Y]]).id;
    const inU = s => byId(s, id).p[1] === 1;
    if (!inU(st)) {
      const seq = search(st, 4, s => inU(s) && prevOK(s));
      if (seq === null) fail('corner out ' + X + Y);
      doSeq(seq);
    }
    const cands = [];
    const base = [`${Y} U ${Y}'`, `${Y} U' ${Y}'`, `${Y} U2 ${Y}'`, `${X}' U ${X}`, `${X}' U' ${X}`, `${X}' U2 ${X}`];
    for (let k = 0; k < 4; k++) for (const b of base) cands.push(U(k) + b);
    for (let m = 1; m <= 6; m++) for (let k = 0; k < 4; k++) cands.push(U(k) + (`${Y} U ${Y}' U' `).repeat(m));
    cands.sort((a, b) => seqLen(a) - seqLen(b));
    if (!tryC(cands, s => cornerOK(s, 'D', X, Y) && prevOK(s))) fail('corner in ' + X + Y);
  }

  /* 3 — middle layer edges */
  const RI = (X, Y) => `U ${Y} U' ${Y}' U' ${X}' U ${X}`;
  const LI = (X, Y) => `U' ${X}' U ${X} U ${Y} U' ${Y}'`;
  for (let g = 0; !midOK(st); g++) {
    if (g > 6) fail('middle');
    const done = RING.filter(([X, Y]) => edgeOK(st, X, Y));
    const prevOK = s => crossOK(s) && cornersOK(s) && done.every(([a, b]) => edgeOK(s, a, b));
    const rem = RING.filter(r => !done.includes(r));
    // prefer an edge already waiting on top: no extraction needed
    const [X, Y] = rem.find(([a, b]) => findPiece(st, [CC[a], CC[b]]).p[1] === 1) || rem[0];
    const id = findPiece(st, [CC[X], CC[Y]]).id;
    const inU = s => byId(s, id).p[1] === 1;
    if (!inU(st)) {
      const c = [];
      for (const [a, b] of RING) { c.push(RI(a, b)); c.push(LI(a, b)); }
      if (!tryC(c, s => inU(s) && prevOK(s))) fail('mid out ' + X + Y);
    }
    const cands = [];
    for (let k = 0; k < 4; k++) { cands.push(U(k) + RI(X, Y)); cands.push(U(k) + LI(X, Y)); }
    if (!tryC(cands, s => edgeOK(s, X, Y) && prevOK(s))) fail('mid in ' + X + Y);
  }

  /* 4 — top cross */
  const OLL_E = ["F R U R' U' F'", "F U R U' R' F'"];
  for (let g = 0; upEdges(st) < 4; g++) {
    if (g > 4) fail('top cross');
    const cur = upEdges(st);
    const cands = [];
    for (let k = 0; k < 4; k++) for (const a of OLL_E) cands.push(U(k) + a);
    if (!tryC(cands, s => upEdges(s) > cur && f2lOK(s))) fail('top cross');
  }

  /* 5 — twist top corners up (sune / antisune) */
  {
    const S = ["R U R' U R U2 R'", "R U2 R' U' R U' R'"];
    const cands = [];
    for (let k = 0; k < 4; k++) for (const a of S) cands.push(U(k) + a);
    for (let k = 0; k < 4; k++) for (const a of S) for (let j = 0; j < 4; j++) for (const b of S) cands.push(U(k) + a + ' ' + U(j) + b);
    cands.sort((a, b) => seqLen(a) - seqLen(b));
    const goal = s => upCorners(s) === 4 && upEdges(s) === 4 && f2lOK(s);
    if (!goal(st) && !tryC(cands, goal)) fail('top corners twist');
  }

  /* 6 — put top corners in place (pure corner 3-cycles) */
  {
    const A = ["R' F R' B2 R F' R' B2 R2", "R B' R F2 R' B R F2 R2"];
    const done = s => RING.every(([X, Y]) => cornerOK(s, 'U', X, Y));
    const cands = [];
    for (let k = 0; k < 4; k++) cands.push(U(k));
    for (let k = 0; k < 4; k++) for (const a of A) for (let j = 0; j < 4; j++) cands.push(U(k) + a + ' ' + U(j));
    for (let k = 0; k < 4; k++) for (const a of A) for (let j = 0; j < 4; j++) for (const b of A) cands.push(U(k) + a + ' ' + U(j) + b);
    cands.sort((a, b) => seqLen(a) - seqLen(b));
    if (!tryC(cands, s => done(s) && f2lOK(s) && upEdges(s) === 4)) fail('top corners place');
  }

  /* 7 — put top edges in place (U perms) */
  {
    const P = ["R U' R U R U R U' R' U' R2", "R2 U R U R' U' R' U' R' U R'"];
    const cands = [''];
    for (const a of P) for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) cands.push(U(k) + a + ' ' + U(j));
    for (const a of P) for (const b of P)
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++)
        cands.push(U(k) + a + ' ' + U(j) + b + ' ' + U(i));
    cands.sort((a, b) => seqLen(a) - seqLen(b));
    if (!tryC(cands, isSolvedS)) fail('top edges place');
  }

  if (!isSolvedS(st)) fail('final check');
  return tidy(moves);
}

function tidy(moves) {
  const out = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && last.face === m.face && (last.depth || 0) === (m.depth || 0)) {
      last.n = (last.n + m.n) % 4;
      if (last.n === 0) out.pop();
    } else {
      const copy = { face: m.face, n: m.n };
      if (m.depth !== undefined) copy.depth = m.depth;
      out.push(copy);
    }
  }
  return out;
}
const moveName = m => (m.depth ? m.depth + 1 : '') + m.face + (m.n === 1 ? '' : m.n === 2 ? '2' : "'");

function isSolved(state) {
  const colors = {};
  for (const cubie of state) {
    for (const face of Object.keys(cubie.s)) {
      const color = cubie.s[face];
      if (colors[face] === undefined) colors[face] = color;
      else if (colors[face] !== color) return false;
    }
  }
  return FACES.every(face => colors[face] !== undefined) && new Set(Object.values(colors)).size === 6;
}

return {
  FACES, N, solvedState, cubeSize, cloneState, applyRot, applyMove, parseSeq, applySeq,
  pieceAt, solveLayerByLayer: solve, tidy, moveName, isSolved
};
});
