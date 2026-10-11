# cubic

Interactive 3D Rubik's cubes from **2×2 through 10×10**. Choose a size to start
with a solved cube. Every size supports scrambling, manual turns, and Reset.

Drag a slice to turn it, or drag the background to rotate the view. The **Layer**
selector chooses the slice for the face buttons and keyboard shortcuts, counting
inward from that face. For example, `2R` turns only the second slice from R.
Hold Shift with U, D, L, R, F, or B for the inverse turn.

Automatic solving is available for every size. **Layer by layer** solves both
layers on 2×2, and follows the cross, corners, middle layer, and last layer on
3×3. Larger cubes first solve their centers and pair their edges, including
parity cases, then finish layer by layer.

The second mode depends on the selected size:

- **Optimal (2×2)** finds the fewest face turns, allowing any solved orientation.
- **Near-optimal (3×3)** finds short solutions using Kociemba's two-phase algorithm.
  It does not guarantee the absolute fewest moves.
- **Shorter solution (4×4–10×10)** compares shortened, verified solutions computed
  from the current sticker positions. This is a best-effort mode, with no claim
  of optimality or closeness to the minimum.

A half turn counts as one move, just like a quarter turn.

Select a mode before pressing **Solve**. Searches run in a background worker;
**Stop** cancels a search or stops playback after the current turn finishes. The
first short-solution search may take a few extra seconds to prepare its lookup tables.
Larger cubes can require thousands of turns. Every solver uses only the current
cube state, and every solution is checked against that state before playback.
Move history is used only for animated navigation; it is never sent to a solver.

Changing sizes resets the cube and turn counter. Size and layer selection are
locked while turns or searches are in progress; Stop remains available.

## Move history

Scramble, manual, and solver turns all appear in one History strip as they finish.
Click a move to animate back to the
state immediately after it, or click **Start** to return to the initial cube.
Later moves remain available to travel forward again. Making a new turn,
scrambling, or playing a new solution after rewinding replaces that future.
Stop pauses history travel after the current turn finishes. Reset and changing
sizes clear the history.

**Live demo:** https://pavelzak.github.io/cubic/

## Run locally

Open `index.html` directly in your browser, or serve the repository over HTTP:

```sh
python3 -m http.server 8000
```

For the server option, open http://localhost:8000. Three.js loads from a CDN;
the solver code is included in the repository. The self-contained solver worker
works with both local files and web servers. No build step is needed to run it.

After editing solver sources, rebuild the checked-in worker bundle:

```sh
node scripts/build-worker.cjs
```

The tests check that the bundle matches its sources. When releasing changes,
update the version footer and script URL versions in `index.html` so browsers
load the matching files.

## Tests

With Node.js installed:

```sh
node --test tests/*.test.cjs
```

The near-optimal engine uses [cube.js](https://github.com/ldez/cubejs), vendored
under its MIT license in `vendor/cubejs`.
The larger-cube layer solver is adapted from
[Chu-Won's solver](https://codepen.io/Chu-Won/pen/JoRaxPj), based on
[pycubing](https://github.com/vivaansinghvi07/pycubing). Its MIT notices and
provenance are included in `vendor/nxn-solver`.
