'use strict';

if (typeof CubeModel === 'undefined') importScripts('cube-model.js');
if (typeof CubeSolverEngine === 'undefined') importScripts('solver-engine.js');

var nearOptimalEngine = null;
var twoSolverLoaded = false;
var largeSolverLoaded = false;

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
        if (!twoSolverLoaded) {
          if (typeof CubeTwoSolver === 'undefined') importScripts('two-solver.js');
          twoSolverLoaded = true;
        }
        moves = CubeTwoSolver.solve(request.state, CubeModel, progress);
      } else if (size === 3) {
        progress('Working out a layer-by-layer solution…');
        moves = CubeModel.solveLayerByLayer(request.state);
      } else {
        if (!largeSolverLoaded) {
          if (typeof NxNSolver === 'undefined') importScripts('vendor/nxn-solver/solver.js');
          if (typeof CubeLayerSolver === 'undefined') importScripts('layer-solver.js');
          largeSolverLoaded = true;
        }
        moves = CubeLayerSolver.solve(request.state, CubeModel, progress);
      }
      CubeSolverEngine.verifySolution(request.state, moves, CubeModel);
    } else if (request.mode === 'near-optimal') {
      if (size !== 3) throw new Error('Near-optimal solving is available for 3×3 cubes only.');
      if (!nearOptimalEngine) {
        progress('Loading the near-optimal solver…');
        if (typeof Cube === 'undefined') importScripts('vendor/cubejs/cube.js');
        if (typeof Cube.initSolver !== 'function') importScripts('vendor/cubejs/solve.js');
        nearOptimalEngine = CubeSolverEngine.createEngine(CubeModel, Cube);
      }
      moves = nearOptimalEngine.solveNearOptimal(request.state, progress);
    } else {
      throw new Error('Unknown solver mode.');
    }
    self.postMessage({ id: request.id, type: 'result', moves: moves });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: error.message });
  }
};
