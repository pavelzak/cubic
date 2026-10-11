# Three-phase 4×4 reduction

This is Chen Shuang's three-phase reduction, from the JavaScript port vendored
under `vendor/mit` by cubing.js. It searches the current centers, wings, and
corners. The application finishes the reduced position with its existing 3×3
solver. Neither stage uses the application's move history.

## Pinned sources

The reduction and its small combinatorics helpers are from cubing.js commit
[`36f86df3552ce8cf5221a2e4d918bd983937f01f`](https://github.com/cubing/cubing.js/tree/36f86df3552ce8cf5221a2e4d918bd983937f01f):

- [`444-solver.ts`](https://github.com/cubing/cubing.js/blob/36f86df3552ce8cf5221a2e4d918bd983937f01f/src/cubing/vendor/mit/cs0x7f/cstimer/src/js/scramble/444-solver.ts), SHA-256 `84a77520fb50bc1fa17f6a18edff78fd21828ca1b92bf4ad97aca8a29622a761`.
- [`mathlib.ts`](https://github.com/cubing/cubing.js/blob/36f86df3552ce8cf5221a2e4d918bd983937f01f/src/cubing/vendor/mit/cs0x7f/cstimer/src/js/lib/mathlib.ts), SHA-256 `94ecf02a8cef84cffe13dc89836181211ec85e2a81a03eee00c4a3fa299396f2`.

The adapter's facelet layouts come from
[`FullCube.java`](https://github.com/cs0x7f/TPR-4x4x4-Solver/blob/e432528210ddcc4fb75586a14163b172795caa9f/src/FullCube.java)
at TPR-4x4x4-Solver commit `e432528210ddcc4fb75586a14163b172795caa9f`,
SHA-256 `af78c38df5dd23842ff59631560f4274f5fc26a8d851fc1bcc8bb68d292af1b0`.

## License provenance

We use the MIT option, reproduced in [LICENSE](LICENSE). Chen Shuang added it to
[TPR-4x4x4-Solver](https://github.com/cs0x7f/TPR-4x4x4-Solver/commit/e432528210ddcc4fb75586a14163b172795caa9f)
and confirmed the additional MIT grants in
[min2phase issue 17](https://github.com/cs0x7f/min2phase/issues/17#issuecomment-1905196770).
That discussion explicitly concerns the 4×4 reduction used by cubing.js.
Cubing.js subsequently moved this port into its MIT vendor directory in
[commit b4e7139](https://github.com/cubing/cubing.js/commit/b4e713922f810c882de169b8f9def47b9a1771a2),
citing the author's grant.

The pinned vendor directory also retained an older GPL license file. It is
preserved here as [UPSTREAM-LICENSE-GPL](UPSTREAM-LICENSE-GPL); the additional MIT
grant is the option used for this distribution. This is the pinned MIT-vendored
port, not a copy of the current GPL-only csTimer distribution.

## Local changes

- Erased TypeScript annotations; combined the two source files inside one UMD
  closure exporting `CubeFourReduction`, also usable through CommonJS.
- Removed ESM imports and the exported random-scramble entry point. The state
  bridge copies supplied piece arrays before searching; it cannot generate a
  random state or consume a move log.
- Return `solcube.moveBuffer` in forward order. The upstream scramble formatter
  inverts and changes the final coordinate frame, so simply inverting that
  formatted scramble would not solve the input in its displayed frame.
- Added progress notifications and a small `applyMove` entry point for testing
  every native move against the independent application model.

`four-solver.js` supplies the state validation, coordinate conversion, short
position search, parity checks, 3×3 finish, and final replay verification.
Native wide turns count as one search move but expand to two individual slice
turns in this application's animation and history.

The tables are generated lazily in the existing worker. There are no external
table downloads, dynamic imports, random-number dependencies, or network calls;
the generated Blob worker also runs when `index.html` is opened through `file://`.
