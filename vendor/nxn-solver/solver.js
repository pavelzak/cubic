/*
 * NxN cube reduction and beginner-layer solver by Chu Won.
 * Based on pycubing by Vivaan Singhvi. MIT licensed; see LICENSE.
 * Source: https://codepen.io/Chu-Won/pen/JoRaxPj
 * Pure model/solver excerpt; renderer and page code are omitted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NxNSolver = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

// solver is based on https://github.com/vivaansinghvi07/pycubing

const Faces = Enum({
	Front: 1,
	Left: 1,
	Back: 1,
	Right: 1,
	Top: 1,
	Bottom: 1
});

const Colors = Enum({
	Green: 1,
	Orange: 1,
	Blue: 1,
	Red: 1,
	Yellow: 1,
	White: 1
});

const FaceToColor = {
	[Faces.Front]: '#36ff1a',
	[Faces.Left]: '#ff721a',
	[Faces.Back]: '#1a1aff',
	[Faces.Right]: '#ff1a1a',
	[Faces.Top]: '#fff11a',
	[Faces.Bottom]: '#ffffff'
};

const ColorToString = {
	[Colors.Green]: 'G',
	[Colors.Orange]: 'O',
	[Colors.Blue]: 'B',
	[Colors.Red]: 'R',
	[Colors.White]: 'W',
	[Colors.Yellow]: 'Y'
};

const FaceToString = {
	[Faces.Front]: 'F',
	[Faces.Left]: 'L',
	[Faces.Back]: 'B',
	[Faces.Right]: 'R',
	[Faces.Top]: 'U',
	[Faces.Bottom]: 'D'
};

const StringToColor = InverseEnum(ColorToString);
const StringToFace = InverseEnum(FaceToString);

function InverseEnum(map) {
	const out = {};
	for (const key in map) {
		out[map[key]] = parseInt(key);
	}
	return out;
}

function Enum(map) {
	let i = 0;
	for (const key in map) {
		map[key] = i++;
	}
	map.length = i;
	return map;
}

const EdgeMap = {
	[Faces.Front]: {
		[Faces.Top]: [1, 0],
		[Faces.Bottom]: [1, 2],
		[Faces.Left]: [0, 1],
		[Faces.Right]: [2, 1]
	},
	[Faces.Back]: {
		[Faces.Top]: [1, 0],
		[Faces.Bottom]: [1, 2],
		[Faces.Left]: [2, 1],
		[Faces.Right]: [0, 1]
	},
	[Faces.Right]: {
		[Faces.Top]: [1, 0],
		[Faces.Bottom]: [1, 2],
		[Faces.Front]: [0, 1],
		[Faces.Back]: [2, 1]
	},
	[Faces.Left]: {
		[Faces.Top]: [1, 0],
		[Faces.Bottom]: [1, 2],
		[Faces.Front]: [2, 1],
		[Faces.Back]: [0, 1]
	},
	[Faces.Top]: {
		[Faces.Front]: [1, 2],
		[Faces.Back]: [1, 0],
		[Faces.Left]: [0, 1],
		[Faces.Right]: [2, 1]
	},
	[Faces.Bottom]: {
		[Faces.Front]: [1, 0],
		[Faces.Back]: [1, 2],
		[Faces.Left]: [0, 1],
		[Faces.Right]: [2, 1]
	}
};

const CornerMap = {
	[`${Faces.Front},${Faces.Top},${Faces.Left}`]: [
		[0, 0],
		[0, 2],
		[2, 0]
	],
	[`${Faces.Front},${Faces.Top},${Faces.Right}`]: [
		[2, 0],
		[2, 2],
		[0, 0]
	],
	[`${Faces.Front},${Faces.Bottom},${Faces.Left}`]: [
		[0, 2],
		[0, 0],
		[2, 2]
	],
	[`${Faces.Front},${Faces.Bottom},${Faces.Right}`]: [
		[2, 2],
		[2, 0],
		[0, 2]
	],
	[`${Faces.Back},${Faces.Top},${Faces.Left}`]: [
		[2, 0],
		[0, 0],
		[0, 0]
	],
	[`${Faces.Back},${Faces.Top},${Faces.Right}`]: [
		[0, 0],
		[2, 0],
		[2, 0]
	],
	[`${Faces.Back},${Faces.Bottom},${Faces.Left}`]: [
		[2, 2],
		[0, 2],
		[0, 2]
	],
	[`${Faces.Back},${Faces.Bottom},${Faces.Right}`]: [
		[0, 2],
		[2, 2],
		[2, 2]
	]
};
const SideFaces = [Faces.Front, Faces.Right, Faces.Back, Faces.Left];

const SideEdges = [
	[Faces.Left, Faces.Front],
	[Faces.Front, Faces.Right],
	[Faces.Right, Faces.Back],
	[Faces.Back, Faces.Left]
];

const AxisMoves = {
	x: 'R',
	y: 'U',
	z: 'F'
};

class Cube {
	constructor(size = 3) {
		this.size = size;
		this.matrix = [];

		for (let i = 0; i < Faces.length; i++) {
			this.matrix[i] = [];
			for (let y = 0; y < this.size; y++) {
				this.matrix[i][y] = [];
				for (let x = 0; x < this.size; x++) {
					this.matrix[i][y][x] = i;
				}
			}
		}
	}

	isSolved() {
		for (let i = 0; i < Faces.length; i++) {
			let color = this.matrix[i][0][0];
			for (let y = 0; y < this.size; y++) {
				for (let x = 0; x < this.size; x++) {
					if (this.matrix[i][y][x] !== color) return false;
				}
			}
		}

		return true;
	}

	turnRight(dist, layer, width) {
		dist = this.clampDist(dist, layer, width);

		if (layer - width === 0) {
			this.turnFace(Faces.Right, dist);
		}

		if (layer === this.size) {
			this.turnFace(Faces.Left, 4 - dist);
		}

		const faceList = [Faces.Front, Faces.Top, Faces.Back, Faces.Bottom];

		const old = this.copy();
		for (let j = 0; j < faceList.length; j++) {
			const from = faceList[j];
			const to = faceList[(j + dist) % faceList.length];

			for (let i = 0; i < width; i++) {
				const x = this.size - 1 - (layer - 1) + i;
				for (let y = 0; y < this.size; y++) {
					let tx = x,
						ty = y;
					let fx = x,
						fy = y;

					if (to === Faces.Back) {
						tx = this.size - 1 - x;
						ty = this.size - 1 - y;
					}

					if (from === Faces.Back) {
						fx = this.size - 1 - x;
						fy = this.size - 1 - y;
					}

					this.matrix[to][ty][tx] = old[from][fy][fx];
				}
			}
		}
	}

	turnLeft(dist, layer, width) {
		dist = this.clampDist(dist, layer, width);

		if (layer - width === 0) {
			this.turnFace(Faces.Left, dist);
		}

		if (layer === this.size) {
			this.turnFace(Faces.Right, 4 - dist);
		}

		const faceList = [Faces.Front, Faces.Bottom, Faces.Back, Faces.Top];

		const old = this.copy();

		for (let j = 0; j < faceList.length; j++) {
			const from = faceList[j];
			const to = faceList[(j + dist) % faceList.length];

			for (let i = 0; i < width; i++) {
				const x = layer - 1 - i;
				for (let y = 0; y < this.size; y++) {
					let tx = x,
						ty = y;
					let fx = x,
						fy = y;
					if (to === Faces.Back) {
						tx = this.size - 1 - x;
						ty = this.size - 1 - y;
					}

					if (from === Faces.Back) {
						fx = this.size - 1 - x;
						fy = this.size - 1 - y;
					}

					this.matrix[to][ty][tx] = old[from][fy][fx];
				}
			}
		}
	}

	turnTop(dist, layer, width) {
		dist = this.clampDist(dist, layer, width);

		if (layer - width === 0) {
			this.turnFace(Faces.Top, dist);
		}

		if (layer === this.size) {
			this.turnFace(Faces.Bottom, 4 - dist);
		}

		const faceList = [Faces.Front, Faces.Left, Faces.Back, Faces.Right];

		const old = this.copy();

		for (let j = 0; j < faceList.length; j++) {
			const from = faceList[j];
			const to = faceList[(j + dist) % faceList.length];

			for (let i = 0; i < width; i++) {
				const y = layer - 1 - i;
				for (let x = 0; x < this.size; x++) {
					this.matrix[to][y][x] = old[from][y][x];
				}
			}
		}
	}

	turnBottom(dist, layer, width) {
		dist = this.clampDist(dist, layer, width);

		if (layer - width === 0) {
			this.turnFace(Faces.Bottom, dist);
		}

		if (layer === this.size) {
			this.turnFace(Faces.Top, 4 - dist);
		}

		const faceList = [Faces.Front, Faces.Right, Faces.Back, Faces.Left];

		const old = this.copy();

		for (let j = 0; j < faceList.length; j++) {
			const from = faceList[j];
			const to = faceList[(j + dist) % faceList.length];

			for (let i = 0; i < width; i++) {
				const y = this.size - 1 - (layer - 1) + i;
				for (let x = 0; x < this.size; x++) {
					this.matrix[to][y][x] = old[from][y][x];
				}
			}
		}
	}

	turnFront(dist, layer, width) {
		dist = this.clampDist(dist, layer, width);

		if (layer - width === 0) {
			this.turnFace(Faces.Front, dist);
		}

		if (layer === this.size) {
			this.turnFace(Faces.Back, 4 - dist);
		}

		const faceList = [Faces.Left, Faces.Top, Faces.Right, Faces.Bottom];

		const old = this.copy();

		for (let j = 0; j < faceList.length; j++) {
			const from = faceList[j];
			const to = faceList[(j + dist) % faceList.length];

			for (let i = 0; i < width; i++) {
				const x = this.size - 1 - (layer - 1) + i;
				for (let y = 0; y < this.size; y++) {
					let tx = x,
						ty = y;
					let fx = x,
						fy = y;

					if (from === Faces.Left) {
						fy = this.size - 1 - y;
					} else if (from === Faces.Top) {
						fx = y;
						fy = x;
					} else if (from === Faces.Right) {
						fx = this.size - 1 - x;
					} else if (from === Faces.Bottom) {
						fx = this.size - 1 - y;
						fy = this.size - 1 - x;
					}

					if (to === Faces.Top) {
						tx = y;
						ty = x;
					} else if (to === Faces.Right) {
						tx = this.size - 1 - x;
					} else if (to === Faces.Bottom) {
						tx = this.size - 1 - y;
						ty = this.size - 1 - x;
					} else if (to === Faces.Left) {
						ty = this.size - 1 - y;
					}
					this.matrix[to][ty][tx] = old[from][fy][fx];
				}
			}
		}
	}

	turnBack(dist, layer, width) {
		dist = this.clampDist(dist, layer, width);

		if (layer - width === 0) {
			this.turnFace(Faces.Back, dist);
		}

		if (layer === this.size) {
			this.turnFace(Faces.Front, 4 - dist);
		}

		const faceList = [Faces.Left, Faces.Bottom, Faces.Right, Faces.Top];

		const old = this.copy();
		for (let j = 0; j < faceList.length; j++) {
			const from = faceList[j];
			const to = faceList[(j + dist) % faceList.length];

			for (let i = 0; i < width; i++) {
				const x = layer - 1 - i;
				for (let y = 0; y < this.size; y++) {
					let tx = x,
						ty = y;
					let fx = x,
						fy = y;

					if (from === Faces.Left) {
						fx = x;
						fy = y;
					} else if (from === Faces.Bottom) {
						fx = y;
						fy = this.size - 1 - x;
					} else if (from === Faces.Right) {
						fx = this.size - 1 - x;
						fy = this.size - 1 - y;
					} else if (from === Faces.Top) {
						fx = this.size - 1 - y;
						fy = x;
					}

					if (to === Faces.Bottom) {
						tx = y;
						ty = this.size - 1 - x;
					} else if (to === Faces.Right) {
						tx = this.size - 1 - x;
						ty = this.size - 1 - y;
					} else if (to === Faces.Top) {
						tx = this.size - 1 - y;
						ty = x;
					} else if (to === Faces.Left) {
						tx = x;
						ty = y;
					}

					this.matrix[to][ty][tx] = old[from][fy][fx];
				}
			}
		}
	}

	copy() {
		const out = [];
		for (let i = 0; i < this.matrix.length; i++) {
			out[i] = [];
			for (let y = 0; y < this.size; y++) {
				out[i][y] = Array.from(this.matrix[i][y]);
			}
		}
		return out;
	}

	turnFace(face, dist = 1) {
		const array = this.matrix[face];

		const old = [];
		for (let y = 0; y < this.size; y++) {
			old[y] = Array.from(array[y]);
		}

		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				let nx, ny;
				if (dist === 1) {
					nx = this.size - 1 - y;
					ny = x;
				} else if (dist === 2) {
					nx = this.size - 1 - x;
					ny = this.size - 1 - y;
				} else if (dist === 3) {
					nx = y;
					ny = this.size - 1 - x;
				}

				array[ny][nx] = old[y][x];
			}
		}
	}

	fromString(text) {
		const s2 = this.size * this.size;
		const n = Faces.length * s2;
		if (text.length !== n) {
			throw new Error(`String needs to be of length ${n}, got ${text.length}.`);
		}

		for (let i = 0; i < n; i++) {
			const face = Math.floor(i / s2);
			const color = StringToColor[text[i]];
			if (color === undefined) throw new Error(`Unknown color at ${i}.`);

			const j = i % s2;
			const x = j % this.size;
			const y = Math.floor(j / this.size);
			this.matrix[color][y][x] = color;
		}
	}

	toString() {
		let out = '';

		for (let i = 0; i < Faces.length; i++) {
			for (let j = 0; j < this.size; j++) {
				for (let k = 0; k < this.size; k++) {
					const color = this.matrix[i][j][k];
					out += ColorToString[color];
				}
			}
		}

		return out;
	}

	toString2() {
		const rows = [
			[-1, Faces.Top],
			[Faces.Left, Faces.Front, Faces.Right, Faces.Back],
			[-1, Faces.Bottom]
		];

		let maxLength = -1;
		for (const row of rows) {
			if (row.length > maxLength) {
				maxLength = row.length;
			}
		}

		const width = maxLength * this.size;
		const height = rows.length * this.size;
		const out = Array.from({
			length: height
		}, () => Array(width).fill(' '));

		for (let i = 0; i < rows.length; i++) {
			const list = rows[i];
			for (let j = 0; j < list.length; j++) {
				const face = list[j];
				if (face === -1) continue;
				for (let y = 0; y < this.size; y++) {
					for (let x = 0; x < this.size; x++) {
						const color = this.matrix[face][y][x];
						out[i * this.size + y][j * this.size + x] = ColorToString[color]; // || /*(FaceToString[face] + String.fromCharCode(65 + y * this.size + x)) || */ColorToString[color];
					}
				}
			}
		}

		return out.map(row => row.join(' ')).join('\n');
	}

	clampDist(dist, layer, width) {
		if (layer > this.size || layer < 1) throw new Error(`Invalid layer: ${layer}.`);
		if (width > layer || width < 1) throw new Error(`Invalid width: ${width}.`);
		if (dist === 0) throw new Error(`Invalid dist: ${dist}.`);

		dist %= 4;
		dist < 0 && (dist += 4);
		return dist;
	}

	turn(move, dist = 1, layer = 1, width = 1) {
		if (dist === 0) return;

		switch (move) {
			case 'F': this.turnFront(dist, layer, width); break;
			case 'B': this.turnBack(dist, layer, width); break;
			case 'U': this.turnTop(dist, layer, width); break;
			case 'D': this.turnBottom(dist, layer, width); break;
			case 'L': this.turnLeft(dist, layer, width); break;
			case 'R': this.turnRight(dist, layer, width); break;
			default: throw new Error(`Invalid move: ${move}.`);
		}

		this.onTurn?.apply(this, arguments);
	}

	parse(text) {
		// Width:LayerMoveDist
		// 2:2F'

		const list = text.split(' ');
		for (let text of list) {
			text = text.trim();
			if (!text) continue;

			let dist = 1;
			const last = text[text.length - 1];
			if (last === `'`) {
				dist = -1;
				text = text.slice(0, -1);
			} else if (last === '2') {
				dist = 2;
				text = text.slice(0, -1);
			}

			let move = text[text.length - 1];
			text = text.slice(0, -1);

			let layer, width;

			if (move in AxisMoves) {
				move = AxisMoves[move];
				width = layer = this.size;
			} else {
				const items = text.split(':');
				layer = parseInt(items.pop()) || 1;
				width = parseInt(items.pop()) || 1;
			}

			this.turn(move, dist, layer, width);
		}
	}

	scramble() {
		const moves = 'FBUDLR';

		const n = Math.round((this.size ** 2) * 2);
		for (let i = 0; i < n; i++) {
			const dist = Math.ceil(Math.random() * 3);
			const layer = Math.ceil(Math.random() * this.size);
			const width = Math.ceil(Math.random() * layer);
			const move = moves[Math.floor(Math.random() * moves.length)];
			this.turn(move, dist, layer, width);
		}
	}

	getEdge(a, b) {
		const coordA = EdgeMap[a]?.[b];
		const coordB = EdgeMap[b]?.[a];
		if (!coordA || !coordB) throw new Error(`Invalid edge combination.`);
		const colorA = this.matrix[a][coordA[1]][coordA[0]];
		const colorB = this.matrix[b][coordB[1]][coordB[0]];

		return {
			c2f: {
				[colorA]: a,
				[colorB]: b
			},
			f2c: {
				[a]: colorA,
				[b]: colorB
			}
		};
	}

	getCorner(a, b, c) {
		if (a !== Faces.Front && a !== Faces.Back) {
			if (b === Faces.Front || b === Faces.Back) {
				[a, b] = [b, a];
			} else {
				[a, c] = [c, a];
			}
		}

		if (b !== Faces.Top && b !== Faces.Bottom) {
			[b, c] = [c, b];
		}

		const corner = CornerMap[`${a},${b},${c}`];
		if (!corner) throw new Error(`Invalid corner combination.`);

		const [coordA, coordB, coordC] = corner;

		const colorA = this.matrix[a][coordA[1]][coordA[0]];
		const colorB = this.matrix[b][coordB[1]][coordB[0]];
		const colorC = this.matrix[c][coordC[1]][coordC[0]];

		return {
			c2f: {
				[colorA]: a,
				[colorB]: b,
				[colorC]: c
			},
			f2c: {
				[a]: colorA,
				[b]: colorB,
				[c]: colorC
			}
		};
	}

	getCenterColor(face) {
		return this.matrix[face][1][1];
	}

	turnToText(move, dist, layer, width) {
		let out = move;
		if (layer === width && width === this.size) {
			if (move === 'F' || move === 'B') out = 'z';
			else if (move === 'R' || move === 'L') out = 'x';
			else if (move === 'U' || move === 'D') out = 'y';
		} else if (layer > 1) {
			out = layer + out;
		}

		if (width > 1 && width < this.size) out = `${width}:${out}`;

		if (dist === -1) out += `'`;
		else if (dist === 2) out += `2`;

		return out;
	}

	highlightCoord(x, y, z) {}
	highlight(a, b, c) {}
	dehighlight() {}
}
function orient(cube) {
	let face;
	for (let i = 0; i < Faces.length; i++) {
		if (cube.getCenterColor(i) === Colors.White) {
			face = i;
			break;
		}
	}

	if (face === Faces.Bottom) return;

	cube.highlight(face);

	switch (face) {
		case Faces.Right: cube.turn('F', 1, 2, 1); break;
		case Faces.Left: cube.turn('F', -1, 2, 1); break;
		case Faces.Front: cube.turn('R', -1, 2, 1); break;
		case Faces.Back: cube.turn('R', 1, 2, 1); break;
		case Faces.Top: cube.turn('R', 2, 2, 1); break;
	}

	cube.dehighlight();
}

function solveWhiteCross(cube) {
	function allEdgesWhite(face) {
		const list = [
			[1, 0],
			[0, 1],
			[2, 1],
			[1, 2]
		];
		for (const [x, y] of list) {
			if (cube.matrix[face][y][x] !== Colors.White) return false;
		}
		return true;
	}
	while (!allEdgesWhite(Faces.Top)) {
		let topFrontEdge = cube.getEdge(Faces.Front, Faces.Top);

		while (topFrontEdge.f2c[Faces.Top] === Colors.White) {
			cube.turn('U', 1, 1, 1);
			topFrontEdge = cube.getEdge(Faces.Front, Faces.Top);
		}

		if (topFrontEdge.f2c[Faces.Front] === Colors.White) {
			cube.highlight(Faces.Front, Faces.Top);
			cube.parse(`F U' R`);
			cube.dehighlight();
		} else block: {
			for (let i = 0; i < SideEdges.length; i++) {
				if (Colors.White in cube.getEdge(...SideEdges[i]).c2f) {
					cube.highlight(...SideEdges[i]);
					cube.turn('U', i, 2, 1);

					if (cube.getEdge(Faces.Front, Faces.Left).f2c[Faces.Left] === Colors.White) {
						cube.turn('F', 1, 1, 1);
					} else {
						cube.parse(`2U' F'`);
					}

					cube.dehighlight();

					break block;
				}
			}
			for (let i = 0; i < SideFaces.length; i++) {
				if (Colors.White in cube.getEdge(Faces.Bottom, SideFaces[i]).c2f) {
					cube.highlight(Faces.Bottom, SideFaces[i]);
					cube.turn('D', -i, 1, 1);

					if (cube.getEdge(Faces.Front, Faces.Bottom).f2c[Faces.Bottom] === Colors.White) {
						cube.turn('F', 2, 1, 1);
					} else {
						cube.parse(`F' U' R`);
					}

					cube.dehighlight();

					break block;
				}
			}
		}
	}

	while (!allEdgesWhite(Faces.Bottom)) {
		let topFrontEdge = cube.getEdge(Faces.Front, Faces.Top);

		while (topFrontEdge.f2c[Faces.Top] !== Colors.White) {
			cube.turn('U', 1, 1, 1);
			topFrontEdge = cube.getEdge(Faces.Front, Faces.Top);
		}

		cube.highlight(Faces.Top, Faces.Front);

		while (topFrontEdge.f2c[Faces.Front] !== cube.matrix[Faces.Front][1][1]) {
			cube.turn('D', 1, 2, 2);
		}
		cube.turn('F', 2, 1, 1);

		cube.dehighlight();
	}
}

function solveFirstLayerCorners(cube) {
	function isCornerSolved(a, b) {
		const corner = cube.getCorner(a, b, Faces.Bottom);
		const centerA = cube.getCenterColor(a);
		const centerB = cube.getCenterColor(b);

		return {
			permutated: Colors.White in corner.c2f && centerA in corner.c2f && centerB in corner.c2f,
			oriented: corner.f2c[Faces.Bottom] === Colors.White && corner.f2c[a] === centerA && corner.f2c[b] === centerB
		};
	}

	function allCornersSolved() {
		for (const [a, b] of SideEdges) {
			const corner = isCornerSolved(a, b);
			if (!corner.permutated || !corner.oriented) return false;
		}
		return true;
	}

	function isCornerMatched(a, b, c, colorA, colorB, colorC) {
		const corner = cube.getCorner(a, b, c);
		return colorA in corner.c2f && colorB in corner.c2f && colorC in corner.c2f;
	}

	while (!allCornersSolved()) {
		let cornerSolved = isCornerSolved(Faces.Front, Faces.Right);
		while (cornerSolved.permutated && cornerSolved.oriented) {
			cube.turn('D', 1, 2, 2);
			cornerSolved = isCornerSolved(Faces.Front, Faces.Right);
		}

		if (cornerSolved.permutated) {
			cube.highlight(Faces.Front, Faces.Right, Faces.Bottom);
			const corner = cube.getCorner(Faces.Front, Faces.Right, Faces.Bottom);
			switch (corner.c2f[Colors.White]) {
				case Faces.Right:
					cube.parse(`R U R' U' R U R' U'`);
					break;
				case Faces.Front:
					cube.parse(`U R U' R' U R U' R'`);
					break;
				default:
					throw new Error(`Impossible scramble. White can only be on right or front.`);
			}
			cube.dehighlight();
		}
		for (let i = 0; i < SideEdges.length; i++) {
			if (isCornerMatched(Faces.Bottom, ...SideEdges[i], Colors.White, cube.getCenterColor(Faces.Front), cube.getCenterColor(Faces.Right))) {
				cube.highlight(Faces.Bottom, ...SideEdges[i]);
				const dist = i - 1;
				cube.turn('D', -dist, 1, 1);
				cube.parse(`R U R' U'`);
				cube.turn('D', dist, 1, 1);
				cube.dehighlight();
				break;
			}
		}
		for (let i = 0; i < SideEdges.length; i++) {
			if (isCornerMatched(Faces.Top, ...SideEdges[i], Colors.White, cube.getCenterColor(Faces.Front), cube.getCenterColor(Faces.Right))) {
				cube.highlight(Faces.Top, ...SideEdges[i]);
				cube.turn('U', i - 1, 1, 1);

				const corner = cube.getCorner(Faces.Front, Faces.Right, Faces.Top);
				switch (corner.c2f[Colors.White]) {
					case Faces.Front:
						cube.parse(`U R U' R'`);
						break;
					case Faces.Right:
						cube.parse(`R U R' U'`);
						break;
					case Faces.Top:
						cube.parse(`R U2 R' U' R U R' U'`);
						break;
					default:
						throw new Error(`Impossible scramble: White can only be on front, right or top.`);
				}
				cube.dehighlight();
				break;
			}
		}
	}
}

function solveSecondLayerEdges(cube) {
	function isEdgeSolved(a, b) {
		const edge = cube.getEdge(a, b);
		return edge.f2c[a] === cube.getCenterColor(a) && edge.f2c[b] === cube.getCenterColor(b);
	}

	function allEdgesSolved() {
		for (const [a, b] of SideEdges) {
			if (!isEdgeSolved(a, b)) return false;
		}
		return true;
	}

	function isEdgeMatched(a, b) {
		const edge = cube.getEdge(a, b);
		return cube.getCenterColor(Faces.Front) in edge.c2f && cube.getCenterColor(Faces.Right) in edge.c2f;
	}

	const swapEdge = `R U R' U' y L' U' L U y'`;

	while (!allEdgesSolved()) {
		while (isEdgeSolved(Faces.Front, Faces.Right)) {
			cube.turn('D', 1, 2, 2);
		}

		if (isEdgeMatched(Faces.Front, Faces.Right)) {
			cube.highlight(Faces.Front, Faces.Right);
			cube.parse(`${swapEdge} U2 ${swapEdge}`);
			cube.dehighlight();
		}

		for (let i = 0; i < SideEdges.length; i++) {
			if (isEdgeMatched(...SideEdges[i])) {
				cube.highlight(...SideEdges[i]);
				const dist = i - 1;
				cube.turn('D', -dist, 2, 2);
				cube.parse(swapEdge);
				cube.turn('D', dist, 2, 2);
				cube.dehighlight();
				break;
			}
		}

		for (let i = 0; i < SideFaces.length; i++) {
			if (isEdgeMatched(Faces.Top, SideFaces[i])) {
				cube.highlight(Faces.Top, SideFaces[i])
				cube.turn('U', i, 1, 1);
				const edge = cube.getEdge(Faces.Top, Faces.Front);
				if (edge.f2c[Faces.Front] === cube.getCenterColor(Faces.Front)) {
					cube.parse(`U ${swapEdge}`);
				} else {
					cube.parse(`y U2 L' U' L U y' R U R' U'`);
				}
				cube.dehighlight();
				break;
			}
		}
	}
}

function solveOllEdges(cube) {
	let sum = 0;
	const solved = {};
	for (const face of SideFaces) {
		if (cube.getEdge(Faces.Top, face).f2c[Faces.Top] === Colors.Yellow) {
			sum++;
			solved[face] = true;
		}
	}

	const changeShape = `F R U R' U' F'`;

	cube.highlight(Faces.Top);
	for (const face of SideFaces) cube.highlight(Faces.Top, face);

	switch (sum) {
		case 0:
			cube.parse(`${changeShape} ${changeShape} U ${changeShape}`);
			break;

		case 2:
			// left-right line or front-right L
			if (!(solved[Faces.Left] && solved[Faces.Right])) {
				if (solved[Faces.Front] && solved[Faces.Back]) {
					cube.turn('U', 1, 1, 1);
					// console.log(`randi: i dont know how to code 😔, im randi (not randa)\nranda: my laptop broke ;-;`);
				} else {
					if (solved[Faces.Front]) {
						if (solved[Faces.Left]) cube.parse(`U'`);
					} else {
						if (solved[Faces.Right]) cube.parse(`U`);
						else cube.parse(`U2`);
					}
					cube.parse(`${changeShape} U`);
				}
			}
			cube.parse(changeShape);
			break;

		case 4:
			break;

		default:
			throw new Error(`Impossible shape. Should be either a dot, line or L.`);
	}

	cube.dehighlight();
}

function solveOllCorners(cube) {
	cube.parse('x2');

	for (let i = 0; i < SideEdges.length; i++) {
		if (cube.getCorner(Faces.Bottom, ...SideEdges[i]).f2c[Faces.Bottom] !== Colors.Yellow) {
			const dist = i - 1;
			cube.turn('D', -dist, 1, 1);
			cube.highlight(Faces.Bottom, Faces.Front, Faces.Right);
			switch (cube.getCorner(Faces.Front, Faces.Right, Faces.Bottom).c2f[Colors.Yellow]) {
				case Faces.Front:
					cube.parse(`U R U' R' U R U' R'`);
					break;
				case Faces.Right:
					cube.parse(`R U R' U' R U R' U'`);
					break;
				default:
					throw new Error(`Impossible scramble. Yellow can be only on front or right.`);
			}
			cube.dehighlight();
			cube.turn('D', dist, 1, 1);
		}
	}

	cube.parse('x2');
}

function solvePllCorners(cube) {
	function edgeDiff(face) {
		return Math.abs(cube.matrix[face][0][2] - cube.matrix[face][0][0]);
	}

	for (const [a, b] of SideEdges) cube.highlight(Faces.Top, a, b);
	const frontDiff = edgeDiff(Faces.Front);
	const backDiff = edgeDiff(Faces.Back);

	const perm = `R U R' U' R' F R2 U' R' U' R U R' F'`;

	if (frontDiff === backDiff) {
		if (frontDiff === 0) return cube.dehighlight();
		else if (frontDiff === 2) {
			cube.parse(`${perm} y y ${perm}`);
			cube.dehighlight();
			return;
		}
	}

	if (frontDiff === 2) {
		cube.turn('U', -1, 1, 1);
	} else if (backDiff === 2) {
		cube.turn('U', 1, 1, 1);
	} else if (edgeDiff(Faces.Left) === 2) {
		cube.turn('U', 2, 1, 1);
	}
	cube.parse(perm);

	cube.dehighlight();
}

function solvePllEdges(cube) {
	const swapEdge = `R U R' U' L' U' L U U R U' R' U' L' U L`;

	for (const face of SideFaces) cube.highlight(Faces.Top, face);

	for (let i = 0; i < 2; i++) loop: {
		let unsolvedCount = 0;
		let solvedIndex = -1;
		for (let j = 0; j < SideFaces.length; j++) {
			const face = SideFaces[j];
			if (cube.matrix[face][0][1] !== cube.matrix[face][0][0]) {
				unsolvedCount++;
			} else if (solvedIndex === -1) {
				solvedIndex = j;
			}
		}

		switch (unsolvedCount) {
			case 0:
				i = Infinity;
				break;

			case 2:
				throw new Error('Parity detected.');
				break;

			case 4:
				cube.parse(swapEdge);
				break;

			case 3:
				cube.turn('U', solvedIndex, 1, 1);
				if (Math.abs(cube.matrix[Faces.Left][0][1] - cube.matrix[Faces.Left][0][0]) === 2) {
					cube.parse(swapEdge);
				} else {
					cube.parse(`${swapEdge} ${swapEdge}`);
				}
				break;
		}
	}

	cube.dehighlight();
}

function afterLastLayerSolved(cube) {
	while (cube.getCenterColor(Faces.Front) !== cube.matrix[Faces.Front][0][0]) {
		cube.turn('U', 1, 1, 1);
	}

	while (cube.getCenterColor(Faces.Front) !== Colors.Green) {
		cube.parse('y');
	}
}

// NxN solver

function solveCenters(cube) {
	const refCube = new Cube(1);
	if (cube.size % 2 === 1) {
		const s = Math.floor(cube.size / 2);
		for (let i = 0; i < Faces.length; i++) {
			refCube.matrix[i][0][0] = cube.matrix[i][s][s];
		}
	}

	const solvedColors = {};
	const moves = ' y y y x x2'.split(' ');
	for (const move of moves) {
		cube.parse(move);
		refCube.parse(move);

		const targetColor = refCube.matrix[Faces.Front][0][0];

		for (let i = 0; i < 5; i++) {
			if (i < 4) {
				cube.turn('B', 1, cube.size - 1, cube.size - 1);
				refCube.turn('B', 1, 1, 1);
			}

			const searchFace = i === 4 ? Faces.Back : Faces.Top;
			if (cube.matrix[searchFace][1][1] in solvedColors) continue;

			for (let y = 1; y < cube.size - 1; y++) {
				for (let x = 1; x < cube.size - 1; x++) {
					if (cube.matrix[searchFace][y][x] !== targetColor) continue;

					let sliceDist = -1;
					let adjustDist = -1;
					let adjustMove = 'U';

					let fx = x, fy = y;
					if (searchFace === Faces.Back) {
						fx = cube.size - 1 - x;
						fy = cube.size - 1 - y;
						sliceDist = -2;
						adjustMove = 'B';
					}

					let la = fx + 1, lb = fy + 1;
					if (la === lb) {
						lb = cube.size - fy;
						adjustDist *= -1;
					}

					if (searchFace === Faces.Top) cube.highlightCoord(fx, cube.size - 1, fy);
					else cube.highlightCoord(fx, fy, 0);

					while (cube.matrix[Faces.Front][fy][fx] === targetColor) {
						cube.turn('F', 1, 1, 1);
					}
					cube.turn('L', sliceDist, la, 1);
					cube.turn(adjustMove, adjustDist, 1, 1);
					cube.turn('L', sliceDist, lb, 1);
					cube.turn(adjustMove, -adjustDist, 1, 1);
					cube.turn('L', -sliceDist, la, 1);
					cube.turn(adjustMove, adjustDist, 1, 1);
					cube.turn('L', -sliceDist, lb, 1);
					cube.turn(adjustMove, -adjustDist, 1, 1);

					cube.dehighlight();
				}
			}
		}

		solvedColors[targetColor] = true;
	}
}

function solveEdges(cube) {
	function parseBoth(text) {
		cube.parse(text);
		refCube.parse(text);
	}

	function turnMiddle(dist = 1) {
		cube.turn('U', dist, cube.size - 1, cube.size - 2);
		refCube.turn('U', dist, 2, 1);
	}

	function findPiecesInMainEdge(frontColor, rightColor) {
		const oriented = [];
		const unoriented = [];

		for (let i = 1; i < cube.size - 1; i++) {
			const fc = cube.matrix[Faces.Front][i][cube.size - 1];
			const rc = cube.matrix[Faces.Right][i][0];

			if (fc === frontColor && rc === rightColor) {
				oriented.push(i + 1);
			} else if (fc === rightColor && rc === frontColor) {
				unoriented.push(i + 1);
			}
		}

		return { oriented, unoriented };
	}

	function fixUnorientedEdges(list) {
		for (const layer of list) {
			cube.turn('U', 1, layer, 1);
		}
		parseBoth(flipMainEdge);
		for (const layer of list) {
			cube.turn('U', -1, layer, 1);
		}
	}

	function isMainEdgeSolved(frontColor, rightColor, n = cube.size - 1) {
		for (let i = 1; i < n; i++) {
			if (cube.matrix[Faces.Front][i][cube.size - 1] !== frontColor ||
				cube.matrix[Faces.Right][i][0] !== rightColor) {
				return false;
			}
		}

		return true;
	}
	function isFrontEdgeSolved(face) {
		for (let i = 1; i < cube.size - 1; i++) {
			if (cube.matrix[Faces.Front][face === Faces.Top ? 0 : cube.size - 1][i]
					!== refCube.matrix[Faces.Front][face === Faces.Top ? 0 : 2][1] ||
				cube.matrix[face][face === Faces.Top ? cube.size - 1 : 0][i]
					!== refCube.matrix[face][face === Faces.Top ? 2 : 0][1]) {
				return false;
			}
		}

		return true;
	}
	function anyPieceInMainEdge(colors) {
		for (let i = 1; i < cube.size - 1; i++) {
			if (cube.matrix[Faces.Front][i][cube.size - 1] in colors &&
				cube.matrix[Faces.Right][i][0] in colors) {
				return true;
			}
		}
		return false;
	}

	function anyPieceInTopEdge(colors) {
		for (let i = 1; i < cube.size - 1; i++) {
			if (cube.matrix[Faces.Front][0][i] in colors &&
				cube.matrix[Faces.Top][cube.size - 1][i] in colors) {
				return true;
			}
		}
		return false;
	}

	function anyPieceInBottomEdge(colors) {
		for (let i = 1; i < cube.size - 1; i++) {
			if (cube.matrix[Faces.Front][cube.size - 1][i] in colors &&
				cube.matrix[Faces.Bottom][0][i] in colors) {
				return true;
			}
		}
		return false;
	}

	function getMainEdgeColors() {
		const targetEdge = refCube.getEdge(Faces.Front, Faces.Right);
		return [
			targetEdge.f2c[Faces.Front],
			targetEdge.f2c[Faces.Right]
		];
	}

	const flipMainEdge = `R U R' F R' F' R`;

	const refCube = new Cube(3);

	if (cube.size % 2 === 1) {
		const edges = [[1, 0], [2, 1], [1, 2], [0, 1]];

		const middle = Math.floor(cube.size / 2);
		const end = cube.size - 1;
		for (let i = 0; i < Faces.length; i++) {
			for (const [x, y] of edges) {
				refCube.matrix[i][y][x] = cube.matrix[i]
					[y === 1 ? middle : (y === 2 ? end : 0)]
					[x === 1 ? middle : (x === 2 ? end : 0)]
			}
		}
	}

	const fixCenterMoves = new Int32Array(cube.size - 2);

	for (let i = 0; i < 8; i++) {
		const isTop = i < 4;
		const insertEdgeFace = isTop ? Faces.Top : Faces.Bottom;
		const insertEdgeMove = isTop ? `R U' R'` : `R' D R`;
		const searchMove = isTop ? 'U' : 'D';

		let [frontColor, rightColor] = getMainEdgeColors();

		const colors = { [frontColor]: 1, [rightColor]: 1 };

		const unoriented = findPiecesInMainEdge(frontColor, rightColor).unoriented;
		if (unoriented.length > 0) {
			fixUnorientedEdges(unoriented);
			[frontColor, rightColor] = [rightColor, frontColor];
		}
		while (!isMainEdgeSolved(frontColor, rightColor)) {
			const slots = [];

			for (let j = 0; j < 3; j++) {
				turnMiddle();
				if (!anyPieceInMainEdge(colors)) {
					for (let k = 0; k < 4; k++) {
						parseBoth('U D');
						if (anyPieceInTopEdge(colors)) {
							parseBoth(`R U' R'`);
							break;
						} else if (anyPieceInBottomEdge(colors)) {
							parseBoth(`R' D R`);
							break;
						}
					}
				}

				slots.push(findPiecesInMainEdge(frontColor, rightColor));
			}

			turnMiddle();

			for (let j = 0; j < slots.length; j++) {
				for (const layer of slots[j].oriented) {
					cube.turn('U', j + 1, layer, 1);
					fixCenterMoves[layer - 2] -= j + 1;
				}
			}

			parseBoth(flipMainEdge);
			[frontColor, rightColor] = [rightColor, frontColor];

			for (let j = 0; j < slots.length; j++) {
				for (const layer of slots[j].unoriented) {
					cube.turn('U', j + 1, layer, 1);
					fixCenterMoves[layer - 2] -= j + 1;
				}
			}
		}

		for (let j = 0; j < 4; j++) {
			parseBoth(searchMove);
			if (!isFrontEdgeSolved(insertEdgeFace)) {
				parseBoth(insertEdgeMove);
				break;
			}
		}
	}

	for (let i = 0; i < fixCenterMoves.length; i++) {
		const n = fixCenterMoves[i];
		n && cube.turn('U', n, i + 2, 1);
	}

	for (let i = 0; i < 3; i++) {
		let [frontColor, rightColor] = getMainEdgeColors();

		const unoriented = findPiecesInMainEdge(frontColor, rightColor).unoriented;
		if (unoriented.length > 0) {
			fixUnorientedEdges(unoriented);
			[frontColor, rightColor] = [rightColor, frontColor];
		}

		for (let j = 0; j < 2; j++) {
			const halfSize = Math.floor(cube.size / 2);
			while (!isMainEdgeSolved(frontColor, rightColor, halfSize)) {
				const slots = [];
				for (let k = 0; k < 3; k++) {
					turnMiddle();
					slots.push(findPiecesInMainEdge(frontColor, rightColor).unoriented);
				}
				turnMiddle();

				for (let k = 0; k < slots.length; k++) {
					const topUnoriented = slots[k].filter(x => x > halfSize);
					for (const layer of topUnoriented) {
						cube.turn('U', -(k + 1), cube.size + 1 - layer, 1);
					}
					turnMiddle(k + 1);
					parseBoth(flipMainEdge);
					turnMiddle(-(k + 1));
					for (const layer of topUnoriented) {
						cube.turn('U', k + 1, cube.size + 1 - layer, 1);
					}
				}
			}

			parseBoth(flipMainEdge);
			[frontColor, rightColor] = [rightColor, frontColor];
		}

		turnMiddle();
	}
	function turnLayers(layers, move, dist) {
		for (const layer of layers) {
			cube.turn(move, dist, layer, 1);
		}
	}

	let [frontColor, rightColor] = getMainEdgeColors();
	const parityEdges = findPiecesInMainEdge(frontColor, rightColor).unoriented;
	const numParityEdges = parityEdges.length / 2;
	parseBoth(`F'`);

	const parityEdgesA = parityEdges.slice(0, numParityEdges);
	const parityEdgesB = parityEdges.slice(numParityEdges);

	turnLayers(parityEdgesB, 'L', -1);
	parseBoth('U2 x');
	for (const dist of [-1, -1, 1]) {
		turnLayers(parityEdgesB, 'L', dist);
		parseBoth('U2');
	}
	turnLayers(parityEdgesA, 'L', 1);
	parseBoth('U2');
	for (let i = 2; i < cube.size; i++) {
		if (!parityEdgesA.includes(i)) {
			cube.turn('L', 1, i, 1);
		}
	}
	parseBoth('U2');
	refCube.turn('L', 1, 2, 1);
	for (const dist of [-1, 1, 1]) {
		turnLayers(parityEdgesB, 'L', dist);
		parseBoth('U2');
	}
}

function solveCorners(cube) {
	const refCube = new Cube(3);

	// copy corners, edges, centers from NxN cube and solve the 3x3 cube

	const end = cube.size - 1;
	for (let i = 0; i < Faces.length; i++) {
		refCube.matrix[i][1][1] = cube.matrix[i][1][1];

		refCube.matrix[i][0][0] = cube.matrix[i][0][0];
		refCube.matrix[i][0][2] = cube.matrix[i][0][end];
		refCube.matrix[i][2][2] = cube.matrix[i][end][end];
		refCube.matrix[i][2][0] = cube.matrix[i][end][0];

		refCube.matrix[i][0][1] = cube.matrix[i][0][1];
		refCube.matrix[i][1][2] = cube.matrix[i][1][end];
		refCube.matrix[i][2][1] = cube.matrix[i][end][1];
		refCube.matrix[i][1][0] = cube.matrix[i][1][0];
	}

	refCube.onTurn = function (move, dist, layer, width) {
		const w = width;
		if (layer === 2) {
			layer = cube.size - 1;
			if (w === 1) {
				width = cube.size - 2;
			}
		} else if (layer === 3) {
			layer = cube.size;
		}

		if (w === 3) {
			width = cube.size;
		} else if (w === 2) {
			width = cube.size - 1;
		}

		cube.turn(move, dist, layer, width);
	}

	/*refCube.highlight = cube.highlight;
	refCube.highlightCoord = cube.highlightCoord;
	refCube.dehighlight = cube.dehighlight;*/

	try {
		solve3Base(refCube);
	} catch (error) {
		if (cube.size % 2 === 1) throw error;
	}

	cube.dehighlight();

	// fix even sized cube pll parity

	const unsolved = {};
	let unsolvedCount = 0;
	for (const face of SideFaces) {
		unsolved[face] = cube.matrix[face][0][0] !== cube.matrix[face][0][1];
		if (unsolved[face]) unsolvedCount++;
	}

	if (unsolvedCount > 0) {
		let finalMove;
		if (!(unsolved[Faces.Front] && unsolved[Faces.Back])) {
			if (unsolved[Faces.Left] && unsolved[Faces.Right]) {
				cube.parse('U');
			} else {
				if (unsolved[Faces.Front]) {
					if (unsolved[Faces.Left]) cube.parse(`U'`);
				} else {
					if (unsolved[Faces.Right]) cube.parse(`U`);
					else cube.parse(`U2`);
				}

				cube.parse(`R2 D' x`);
				finalMove = `x' D R2`;
			}
		}
		const a = Math.floor(cube.size / 2);
		const b = a - 1;
		cube.turn('R', 2, a, b);
		cube.turn('U', 2, 1, 1);
		cube.turn('R', 2, a, b);
		cube.turn('U', 2, a, a);
		cube.turn('R', 2, a, b);
		cube.turn('U', 2, a, b);

		finalMove && cube.parse(finalMove);
	}

	afterLastLayerSolved(cube);
}

function solve3Base(cube) {
	orient(cube);
	solveWhiteCross(cube);
	solveFirstLayerCorners(cube);
	solveSecondLayerEdges(cube);
	solveOllEdges(cube);
	solveOllCorners(cube);
	solvePllCorners(cube);
	solvePllEdges(cube);
}

function solve3(cube) {
	solve3Base(cube);
	afterLastLayerSolved(cube);
}

function solveN(cube) {
	solveCenters(cube);
	solveEdges(cube);
	solveCorners(cube);
}

return { Cube, Faces, Colors, solve3, solveN, solveCenters, solveEdges, solveCorners };
});
