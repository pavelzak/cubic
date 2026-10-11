# NxN solver source

This directory vendors only the facelet model and solving algorithms from
[Chu Won’s public “cube solver” Pen](https://codepen.io/Chu-Won/pen/JoRaxPj),
retrieved on 2026-10-10. The source credits
[Vivaan Singhvi’s pycubing](https://github.com/vivaansinghvi07/pycubing).
The solver inspects the current sticker matrix: it solves centers, pairs edges,
then applies a beginner layer-by-layer 3×3 solution with even-cube parity fixes.
It does not use or reverse scramble history.

The public Pen is MIT licensed under
[CodePen’s licensing terms](https://blog.codepen.io/documentation/licensing/).
Pycubing is also MIT licensed; its original copyright notice is included in
`LICENSE`. Its upstream snapshot at retrieval was
[`5ebe709e86d0ce209295c8340fba3c1d061519f3`](https://github.com/vivaansinghvi07/pycubing/tree/5ebe709e86d0ce209295c8340fba3c1d061519f3).
That commit records the attributed project’s state at retrieval; the Pen does
not specify which pycubing revision its author used.

The extracted source starts at `// solver is based on ...` and ends immediately
after `solveN`, before `// rendering`. CodePen has no commit identifier for this
snapshot, so hashes pin the copied artifact:

- Extracted JavaScript SHA-256: `9528e6947e73ba73671ce8da221745c9c290e60ad7ceb48fb11507b3ced44507`
- Vendored `solver.js` SHA-256: `1f84c0c598f52a1e63d1ad2f4db0a33361c4269d9218f4ba8989fab872e93722`

Local changes are a browser/CommonJS wrapper, a license/source header, and
indentation normalization. The algorithms are otherwise unchanged. They are
used for 4×4–10×10; 2×2 and 3×3 are handled elsewhere. The application adapter
in `layer-solver.js` validates the conversion and verifies the returned moves
against its independent cubie model. No runtime network access is required.
