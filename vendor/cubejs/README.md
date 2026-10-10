# cubejs 1.3.2

The unmodified `lib/cube.js`, `lib/solve.js`, and `LICENSE` files from
[cubejs 1.3.2](https://www.npmjs.com/package/cubejs/v/1.3.2) are vendored here.
Upstream: [ldez/cubejs](https://github.com/ldez/cubejs), commit
`678bde034370bb14d095877bc0aaabe9dc52330f`. Licensed under MIT; see `LICENSE`.

Source archive: `https://registry.npmjs.org/cubejs/-/cubejs-1.3.2.tgz`

Archive integrity (SHA-512, base64):
`NuHpWIR/mpjrP3YpU6OaXAbo34idWlzo86GnAqGDG96OHDKyavTAelMyruZ77SgPhQ8l9IcP6/rzXoNcAy9OaQ==`

The solver uses Kociemba's two-phase algorithm. Solutions are limited to 22 face
turns and are near-optimal; they are not guaranteed to use the fewest turns.
The application runs initialization and searches in a worker and verifies the
returned moves against its own cube model before animating them.
