'use strict';

if (typeof CubeModel === 'undefined') importScripts('cube-model.js');
if (typeof CubeSolverEngine === 'undefined') importScripts('solver-engine.js');

var nearOptimalEngine = null;
function loadLargeSolver() {
  if (typeof NxNSolver === 'undefined') importScripts('vendor/nxn-solver/solver.js');
  if (typeof CubeLayerSolver === 'undefined') importScripts('layer-solver.js');
}

function loadShortSolver() {
  loadLargeSolver();
  loadSharedSearch();
  if (typeof CubeCenterSolver === 'undefined') importScripts('center-solver.js');
  if (typeof CubeShortSolver === 'undefined') importScripts('short-solver.js');
  return CubeShortSolver;
}

function loadSharedSearch() {
  if (typeof CubeMoveOptimizer === 'undefined') importScripts('move-optimizer.js');
  if (typeof CubeShallowSolver === 'undefined') importScripts('shallow-solver.js');
}

function loadNearOptimalEngine(progress) {
  if (!nearOptimalEngine) {
    progress('Loading the short-solution solver…');
    if (typeof Cube === 'undefined') importScripts('vendor/cubejs/cube.js');
    if (typeof Cube.initSolver !== 'function') importScripts('vendor/cubejs/solve.js');
    nearOptimalEngine = CubeSolverEngine.createEngine(CubeModel, Cube);
  }
  return nearOptimalEngine;
}

self.onmessage = function (event) {
  var request = event.data;
  function progress(message) {
    self.postMessage({ id: request.id, type: 'progress', message: message });
  }
  try {
    var size = CubeModel.cubeSize(request.state);
    var moves;
    if (request.mode === 'layer') {
      if (size === 2) {
        if (typeof CubeTwoSolver === 'undefined') importScripts('two-solver.js');
        moves = CubeTwoSolver.solve(request.state, CubeModel, progress);
      } else if (size === 3) {
        progress('Working out a layer-by-layer solution…');
        moves = CubeModel.solveLayerByLayer(request.state);
      } else {
        loadLargeSolver();
        moves = CubeLayerSolver.solve(request.state, CubeModel, progress);
      }
    } else if (request.mode === 'near-optimal') {
      if (size === 2) {
        if (typeof CubeTwoOptimalSolver === 'undefined') importScripts('two-optimal-solver.js');
        moves = CubeTwoOptimalSolver.solve(request.state, CubeModel, progress);
      } else if (size === 3) {
        moves = loadNearOptimalEngine(progress).solveNearOptimal(request.state, progress);
      } else {
        moves = loadShortSolver().solve(request.state, CubeModel, loadNearOptimalEngine(progress), progress);
      }
    } else if (request.mode === 'deep') {
      if (size < 4 || size > 10) throw new Error('Deep search supports 4×4 through 10×10.');
      moves = loadShortSolver().solveDeep(request.state, CubeModel, loadNearOptimalEngine(progress), progress);
    } else if (request.mode === 'three-phase') {
      if (size !== 4) throw new Error('Three-phase solving supports 4×4 only.');
      loadSharedSearch();
      if (typeof CubeFourReduction === 'undefined') importScripts('vendor/four-solver/solver.js');
      if (typeof CubeFourSolver === 'undefined') importScripts('four-solver.js');
      moves = CubeFourSolver.solve(request.state, CubeModel, loadNearOptimalEngine(progress), progress);
    } else {
      throw new Error('Unknown solver mode.');
    }
    CubeSolverEngine.verifySolution(request.state, moves, CubeModel);
    self.postMessage({ id: request.id, type: 'result', moves: moves });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: error.message });
  }
};
