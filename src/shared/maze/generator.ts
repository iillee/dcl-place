/**
 * generator.ts — grid state + placement rules + BFS maze growth.
 *
 * Deterministic given a seed. `generate()` mutates module-private state
 * (`grid`, `placeCounter`) — callers loop over seeds via `resetGrid()` +
 * `setSeed()` + `generate()` + `validate()` until a valid maze surfaces.
 *
 * No engine imports. Pure over tiles + rng + math. The visual side
 * (spawning entities) lives in rebuild.ts.
 *
 * Grid coordinates are integer cell indices; world Y is a real number
 * quantized to STEP multiples (with 3-decimal rounding to defeat float
 * drift from repeated `y + STEP` arithmetic).
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_MAX_STACK_Y_METERS,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_RAMP_STEP_METERS,
	MAZE_TILE_GLTF_SCALE,
	MAZE_TILE_WORLD_METERS,
	SCENE_WORLD_SIZE_METERS,
} from 'src/shared/settings'

import { rand, setSeed } from 'src/shared/maze/rng'
import {
	ALL_DIRS, DX, DZ, Dir, OPP,
	TILES, TileType,
	GROWTH_PRIMARY, GROWTH_FALLBACK,
	openingsAt, highDirAt,
} from 'src/shared/maze/tiles'

// MARK: World-scale aliases
// Masters live in src/shared/settings.ts (SCENE_ / MAZE_ / PAINT_ names).
// Short aliases kept for maze-local readability; prefer settings names
// at mixed call sites.
export const TILE_SCALE  = MAZE_TILE_GLTF_SCALE
export const CELL        = MAZE_TILE_WORLD_METERS
export const SCENE_SIZE  = SCENE_WORLD_SIZE_METERS
export const GRID_W      = MAZE_GRID_WIDTH
export const GRID_H      = MAZE_GRID_HEIGHT
export const MAZE_ORIGIN = MAZE_ORIGIN_OFFSET_METERS
export const STEP        = MAZE_RAMP_STEP_METERS
export const MAX_Y       = MAZE_MAX_STACK_Y_METERS

export interface Placed {
  type: TileType
  r: number
  x: number
  z: number
  y: number
  /** BFS order (seed=0, seed's neighbors=1..N, etc.). Used for reveal cascade. */
  order: number
}

// MARK: Grid state
// Kept module-private; callers touch the grid only via the exported
// helpers below (`resetGrid`, `getPlacedTilesInOrder`, `lookupTile`,
// `hasPlacementAt`). Prevents accidental mutation from the render side.
const grid = new Map<string, Placed>()
let placeCounter = 0

// Y quantization: STEP is 10.767, so `y + STEP + STEP` drifts. Rounding
// to 3 decimals makes lookups match regardless of accumulated float error.
const key = (x: number, z: number, y: number) =>
  `${x},${z},${Math.round(y * 1000) / 1000}`

const inBounds = (x: number, z: number) =>
  x >= 0 && x < GRID_W && z >= 0 && z < GRID_H

export function resetGrid(): void {
  grid.clear()
  placeCounter = 0
}

export function gridSize(): number {
  return grid.size
}

/** BFS-order iteration — seeds first, then neighbors, ideal for reveal cascade. */
export function getPlacedTilesInOrder(): Placed[] {
  return [...grid.values()].sort((a, b) => a.order - b.order)
}

/**
 * Look up the highest tile at (tx, tz) whose Y is at or below the player's
 * feet (with a small tolerance). Used by the painting system to resolve
 * world-space player position → the tile they're standing on.
 */
export function lookupTile(
  tx: number, tz: number, playerY: number,
): { type: TileType; r: number; y: number } | null {
  let best: Placed | null = null
  for (const p of grid.values()) {
    if (p.x !== tx || p.z !== tz) continue
    if (p.y > playerY + 0.5) continue
    if (!best || p.y > best.y) best = p
  }
  return best ? { type: best.type, r: best.r, y: best.y } : null
}

// MARK: Rotation offsets
// GLB pivot is at the tile's SW corner (geometry extends +X/+Z), so
// rotating swings geometry into other cells. This offset compensates
// so the rotated tile still fills its intended parcel.
export const ROT_OFFSET: Array<[number, number]> = [
  [0, 0],           // r=0: no offset
  [0, CELL],        // r=1: 90° CW
  [CELL, CELL],     // r=2: 180°
  [CELL, 0],        // r=3: 270° CW
]

// MARK: Placement rules
// Returns true iff the tile can legally occupy (x, z, y) at rotation r
// given the current grid contents. Encodes: vertical stacking rules,
// cross-level parallel-ramp rules, ramp-handshake rules, preemptive
// unsatisfiability checks, no-two-ramps-in-a-row, and edge connectivity
// against every neighbor at same level and one-below (for ramp decks).
function canPlace(t: TileType, r: number, x: number, z: number, y: number): boolean {
  if (grid.has(key(x, z, y))) return false
  const opens = openingsAt(t, r)
  const highDir = highDirAt(t, r)
  const iAmRamp = !!TILES[t].isRamp

  // Vertical stacking rule:
  //  - The cell above a ramp must be empty OR another ramp (chained upward).
  //  - The cell below a ramp is unrestricted (ramps only go up, so there's empty
  //    air beneath the deck that any tile can occupy).
  const above = grid.get(key(x, z, y + STEP))
  if (above?.type === 'ramp' && !iAmRamp) return false
  if (iAmRamp && above && above.type !== 'ramp') return false
  // Stacked ramps must share the same rotation (same climb direction),
  // otherwise perpendicular ramps collide in a tight vertical space.
  if (iAmRamp && above?.type === 'ramp' && above.r !== r) return false
  const below = grid.get(key(x, z, y - STEP))
  if (iAmRamp && below?.type === 'ramp' && below.r !== r) return false
  // Non-ramp tiles cannot sit above a ramp cell (would clip the ramp's deck).
  if (!iAmRamp && below?.type === 'ramp') return false

  // Cross-level parallel ramp rule.
  // Two ramps that are (a) offset by one STEP in Y, (b) orthogonally adjacent in
  // XZ, and (c) parallel (same axis) must share the SAME high direction — i.e.
  // same rotation, not opposite. Opposite-high parallels form fragile "V"
  // configurations whose resolution requires several dependent placements to
  // succeed; when any link fails, one end is left dangling. Requiring matched
  // high directions collapses these into clean, always-resolvable staircases.
  if (iAmRamp) {
    for (const d of ALL_DIRS) {
      // Only check neighbors along MY axis — same-axis ramps interact via
      // their sloping edges on the axis-aligned column boundary. Cross-axis
      // neighbors meet as wall‑to‑wall regardless of rotation, so they don't
      // create edge mismatches.
      if ((d % 2) !== (r % 2)) continue
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      for (const dy of [STEP, -STEP]) {
        const nb = grid.get(key(nx, nz, y + dy))
        if (nb?.type !== 'ramp') continue
        // Same axis (guaranteed by d filter) but different rotation → opposite
        // highs → misaligned edges on shared boundary at differing Y → reject.
        if (nb.r !== r) return false
      }
    }
  }

  // Adjacent-ramp handshake rule.
  // A ramp's cell-above is locked to be either empty OR a same-rotation ramp.
  // Consequence: if one ramp's HIGH side points at an orthogonally-adjacent
  // same-Y ramp, the pointer's high opening lands in the neighbor's cell-above,
  // which is constrained to the neighbor's rotation. Unless the two ramps share
  // a rotation (matched handshake) OR both high-sides point at each other
  // (parallel-opposite ramps meeting edge-to-edge at Y+STEP), the opening is
  // structurally unsatisfiable → dangling end. Reject up front.
  if (iAmRamp) {
    for (const d of ALL_DIRS) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const nb = grid.get(key(nx, nz, y))
      if (nb?.type !== 'ramp') continue
      const nbHigh = highDirAt(nb.type, nb.r)!
      const mePointsAtNb = highDir === d              // my high goes toward neighbor
      const nbPointsAtMe = nbHigh === OPP[d]          // neighbor's high comes toward me
      if (!mePointsAtNb && !nbPointsAtMe) continue    // no high-side interaction, other checks cover it
      if (nb.r === r) continue                        // same rotation → clean handshake
      if (mePointsAtNb && nbPointsAtMe) continue      // parallel-opposite meeting at shared high edge
      return false                                     // asymmetric point → unsatisfiable
    }
  }

  // Preemptive: if I'm a ramp, my high side lands at (targetX, targetZ, y+STEP).
  // If that cell already has a ramp at y=y with a DIFFERENT rotation, the
  // target cell can never be filled (non-ramp above ramp is forbidden, and only
  // same-rotation ramps can stack). Reject me now to save a wasted attempt.
  if (iAmRamp && highDir !== null) {
    const tx = x + DX[highDir]
    const tz = z + DZ[highDir]
    if (inBounds(tx, tz)) {
      const targetBelow = grid.get(key(tx, tz, y))
      if (targetBelow?.type === 'ramp' && targetBelow.r !== r) return false
    }
  }

  // No-two-ramps-in-a-row rule: a ramp cannot connect directly to another
  // ramp. Forces at least one flat tile between elevation changes, breaking up
  // long staircases and giving the maze more horizontal breathing room.
  if (iAmRamp) {
    for (const d of opens) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const ny = highDir === d ? y + STEP : y
      const nb = grid.get(key(nx, nz, ny))
      if (nb?.type === 'ramp') return false
      // Also check the ramp-below case: if a lower ramp's high side reaches
      // my opening's level, that's still a ramp-to-ramp connection.
      if (ny >= STEP) {
        const under = grid.get(key(nx, nz, ny - STEP))
        if (under?.type === 'ramp' && highDirAt(under.type, under.r) === OPP[d]) return false
      }
    }
  }

  for (const d of ALL_DIRS) {
    const isOpen = opens.has(d)
    const nx = x + DX[d], nz = z + DZ[d]
    if (!inBounds(nx, nz)) {
      if (isOpen) return false // opening would face off-grid
      continue
    }
    // Height at which MY opening on side d sits
    const myY = highDir === d ? y + STEP : y
    if (myY > MAX_Y) return false

    const back = OPP[d]

    // (a) Neighbor at same level as my opening
    const nb1 = grid.get(key(nx, nz, myY))
    if (nb1) {
      const nb1Opens = openingsAt(nb1.type, nb1.r)
      const nb1High = highDirAt(nb1.type, nb1.r)
      if (nb1High === back) {
        // Neighbor's back side is its ramp-high: no horizontal opening from nb1
        // itself at Y=myY. BUT if a ramp below nb1 has its high reaching myY on
        // this edge (same-rotation stack), that lower ramp's high deck IS the
        // walkway our opening receives — so "open" is still valid. Only reject
        // when neither nb1 nor a matching lower ramp provides the connection.
        if (isOpen) {
          if (myY < STEP) return false
          const under = grid.get(key(nx, nz, myY - STEP))
          if (!under || under.type !== 'ramp' || highDirAt(under.type, under.r) !== back) return false
        }
      } else {
        if (nb1Opens.has(back) !== isOpen) return false
      }
    }
    // (a2) If this side is MY ramp's high side, my Y=y level is a wall on that side.
    // A neighbor at (nx, nz, y) with a horizontal opening pointing back at us would
    // die into that wall — reject.
    if (highDir === d) {
      const nbAtY = grid.get(key(nx, nz, y))
      if (nbAtY) {
        const nbAtYOpens = openingsAt(nbAtY.type, nbAtY.r)
        const nbAtYHigh = highDirAt(nbAtY.type, nbAtY.r)
        if (nbAtYOpens.has(back) && nbAtYHigh !== back) return false
      }
    }
    // (b) Ramp below whose upper level reaches my Y.
    //  - If its high side points at me → my side must be OPEN (connects to ramp's high).
    //  - Otherwise (wall side or low side facing me) → my side must be CLOSED,
    //    since there's nothing valid to connect to at this elevation.
    if (myY >= STEP) {
      const nb2 = grid.get(key(nx, nz, myY - STEP))
      if (nb2?.type === 'ramp') {
        const nb2High = highDirAt(nb2.type, nb2.r)
        if (nb2High === back) {
          if (!isOpen) return false
        } else {
          if (isOpen) return false
        }
      }
    }
  }
  return true
}

function placeTile(t: TileType, r: number, x: number, z: number, y: number): void {
  grid.set(key(x, z, y), { type: t, r, x, z, y, order: placeCounter++ })
}

/**
 * Post-generation sanity:
 *   1. Full coverage — every grid cell filled.
 *   2. Every opening on every tile lands on a valid neighbor opening.
 */
export function validate(): boolean {
  if (grid.size !== GRID_W * GRID_H) return false
  for (const p of grid.values()) {
    const opens = openingsAt(p.type, p.r)
    const highDir = highDirAt(p.type, p.r)
    for (const d of ALL_DIRS) {
      if (!opens.has(d)) continue
      const nx = p.x + DX[d], nz = p.z + DZ[d]
      if (!inBounds(nx, nz)) return false
      const ny = highDir === d ? p.y + STEP : p.y
      const back = OPP[d]
      const nb1 = grid.get(key(nx, nz, ny))
      let connected = false
      if (nb1) {
        const nb1Opens = openingsAt(nb1.type, nb1.r)
        const nb1High = highDirAt(nb1.type, nb1.r)
        if (nb1High !== back && nb1Opens.has(back)) connected = true
      }
      if (!connected && ny >= STEP) {
        const nb2 = grid.get(key(nx, nz, ny - STEP))
        if (nb2 && highDirAt(nb2.type, nb2.r) === back) connected = true
      }
      if (!connected) return false
    }
  }
  return true
}

function shuffle<T>(a: T[]): T[] {
  const b = a.slice()
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

/**
 * Populate the grid using the current RNG state (caller must `setSeed()`).
 *
 * FLAT full-coverage backtracking solver. Iterates every cell in row-major
 * order and picks a (type, rotation) whose openings match constraints from
 * already-placed neighbors and off-grid walls. Backtracks on dead ends.
 *
 * Guarantees full 5×5 coverage on every seed — unlike the old random-BFS,
 * which grew through openings and often left orphan cells. Seed variety
 * still comes from RNG-shuffled candidate order within each cell.
 *
 * Center tile is anchored to `cross` (r=0) so the rally point stays fixed
 * across seeds. Downstream systems can rely on `(GRID_W/2, GRID_H/2)`
 * always having a 4-way intersection.
 */
export function generate(): void {
  const cx = Math.floor(GRID_W / 2)
  const cz = Math.floor(GRID_H / 2)

  // Pre-anchor a center `cross` as the mandatory rally point — but ONLY
  // when the center cell is truly interior (has all 4 neighbors in-grid).
  // On small grids (any dimension < 3) every cell is on an edge/corner
  // and a 4-opening tile can't legally place there; the solver handles
  // everything from scratch in that case.
  const centerIsInterior = cx > 0 && cx < GRID_W - 1
                        && cz > 0 && cz < GRID_H - 1
  if (centerIsInterior) {
    if (!canPlace('cross', 0, cx, cz, 0)) return
    placeTile('cross', 0, cx, cz, 0)
  }

  // Row-major cell list, skipping the anchored center if we placed one.
  const cells: Array<{ x: number; z: number }> = []
  for (let z = 0; z < GRID_H; z++) {
    for (let x = 0; x < GRID_W; x++) {
      if (centerIsInterior && x === cx && z === cz) continue
      cells.push({ x, z })
    }
  }

  solveCells(cells, 0)
}

/**
 * Recursive backtracking placement. At each cell, tries tile candidates
 * (in shuffled order per rotation) and backtracks on dead ends.
 *
 * Cell-position pool policy:
 *   • Interior cells (all 4 neighbors in-grid) → ONLY `cross`. Every side
 *     must be open to receive the surrounding tiles' openings, and cross
 *     is the only 4-way tile.
 *   • Edge / corner cells → primary pool then fallback. canPlace() rejects
 *     any tile whose openings don't match the constraints from neighbors
 *     (already-placed cross tiles) and off-grid walls, so the solver
 *     naturally picks fork on edges and turn on corners.
 *
 * With MAX_Y=0, ramp openings self-reject in canPlace so ramps never
 * survive even if they were in the pool.
 */
function solveCells(cells: Array<{ x: number; z: number }>, idx: number): boolean {
  if (idx === cells.length) return true
  const { x, z } = cells[idx]
  // Position-based pool policy — explicit, not emergent:
  //   • Corners (2 walls)          → turn
  //   • Edges   (1 wall)          → fork
  //   • Interior (0 walls)        → cross
  const onWestWall  = x === 0
  const onEastWall  = x === GRID_W - 1
  const onSouthWall = z === 0
  const onNorthWall = z === GRID_H - 1
  const wallCount   = (onWestWall ? 1 : 0) + (onEastWall ? 1 : 0)
                    + (onSouthWall ? 1 : 0) + (onNorthWall ? 1 : 0)
  const pool: TileType[] =
    wallCount === 2 ? ['turn']  :
    wallCount === 1 ? ['fork']  :
                      ['cross']
  const pools: TileType[][] = [pool]
  for (const pool of pools) {
    for (const t of shuffle(pool)) {
      for (const r of shuffle([0, 1, 2, 3])) {
        if (!canPlace(t, r, x, z, 0)) continue
        placeTile(t, r, x, z, 0)
        if (solveCells(cells, idx + 1)) return true
        grid.delete(key(x, z, 0))
        placeCounter-- // reclaim the id so BFS order stays contiguous
      }
    }
  }
  return false
}

/**
 * Iterate seeds starting at `startSeed` until one produces a valid maze
 * or the attempt budget is exhausted. Returns the winning seed, or null
 * if none was found. Deterministic: same startSeed always yields the
 * same winner across every client.
 */
export function generateWithRetry(startSeed: number, maxAttempts = 500): number | null {
  for (let i = 0; i < maxAttempts; i++) {
    const trySeed = startSeed + i
    setSeed(trySeed)
    resetGrid()
    generate()
    if (validate()) return trySeed
  }
  return null
}
