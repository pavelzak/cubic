'use strict';

importScripts('cube-model.js', 'solver-engine.js');

var nearOptimalEngine = null;

self.onmessage = function (event) {
  var request = event.data;
  function progress(message) {
    self.postMessage({ id: request.id, type: 'progress', message: message });
  }
  try {
    var moves;
    if (request.mode === 'layer') {
      progress('Working out a layer-by-layer solution…');
      moves = CubeModel.solveLayerByLayer(request.state);
      CubeSolverEngine.verifySolution(request.state, moves, CubeModel);
    } else if (request.mode === 'near-optimal') {
      if (!nearOptimalEngine) {
        progress('Loading the near-optimal solver…');
        importScripts('vendor/cubejs/cube.js', 'vendor/cubejs/solve.js');
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
