# cubic

Interactive 3D Rubik's cube with two solver modes:

- **Layer by layer** follows the cross, corners, middle layer, and last layer.
- **Near-optimal** finds short solutions quickly using Kociemba's two-phase
  algorithm. It does not guarantee the absolute fewest moves. A half turn counts
  as one move, just like a quarter turn.

Select a mode before pressing **Solve**. Both searches run in a background worker;
**Stop** cancels a search or stops playback after the current turn finishes. The
first near-optimal search takes a few extra seconds to prepare its lookup tables.

**Live demo:** https://pavelzak.github.io/cubic/

## Run locally

Serve the repository over HTTP so the browser can load the solver worker:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Three.js loads from a CDN; the solver code is included
in the repository. No build step is needed.

## Tests

With Node.js installed:

```sh
node --test tests/*.test.cjs
```

The near-optimal engine uses [cube.js](https://github.com/ldez/cubejs), vendored
under its MIT license in `vendor/cubejs`.
