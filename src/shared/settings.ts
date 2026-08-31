/**
 * settings.ts — single source of truth for world / maze / paint knobs.
 *
 * PERFORMANCE TUNING: change only the two constants under
 * "Performance tuning" below. Maze / scene geometry rarely moves; paint
 * resolution is what you dial when measuring CRDT / component load.
 *
 * Names are prefixed (SCENE_ / MAZE_ / PAINT_) so they stay unambiguous
 * when mixed with domain-local aliases (CELL, STEP, etc.).
 *
 * Safe for client and server — pure constants, no engine imports.
 */

// MARK: Debug vars
// Bundler inlines process.env.NODE_ENV when present; guard for runtimes
// (e.g. headless server) where `process` is undefined.
declare var process: { env: { NODE_ENV?: string } } | undefined

export const IS_DEV =
	typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'


// =============================================================================
// MARK: Performance tuning
// Edit THESE when measuring paint / CRDT load.
// Higher PAINT_CELLS_PER_TILE_AXIS → smaller cells → more component updates.
// Brush is in world meters so the painted footprint stays roughly constant
// when you change resolution (cells are derived further down).
// =============================================================================

/**
 * Paint cells along one edge of a maze tile.
 * Cell world size = maze tile world meters / this value.
 *
 * MUST be a multiple of 16 — the tile GLBs bake a 20/32 corridor ratio,
 * and ARM = SIZE * 20/32, LO = SIZE * 3/16 only quantize to integers at
 * multiples of 16. Non-multiples produce fractional mask indices that
 * misalign paint with the physical corridor.
 *
 * Examples (with current 16 m maze tiles at TILE_SCALE=1):
 *   16 → 1 m cells   (canvas baseline, matches pixelwars mask exactly)
 *   32 → 0.5 m cells (finer detail, ~4× entity count)
 */
export const PAINT_CELLS_PER_TILE_AXIS = 16

/**
 * Target brush diameter in world meters. Converted to an odd cell count
 * from the paint cell size so players cover a similar area at any
 * resolution. Baseline matches squareoff's 3×3 at 2 m cells (= 6 m).
 */
export const PAINT_BRUSH_SIZE_METERS = 6


// MARK: Scene

/** Scene X extent in meters (20 parcels × 16 m). Aligns with parcel X axis. */
export const SCENE_WORLD_SIZE_X_METERS = 320

/** Scene Z extent in meters (20 parcels × 16 m). Aligns with parcel Y axis (world Z). */
export const SCENE_WORLD_SIZE_Z_METERS = 320

// MARK: dcl/place

/** Milliseconds a player must wait between placing pixels (r/place cooldown). */
export const PAINT_COOLDOWN_MS = 1_000

/** Max cells a single client is allowed to send in one paintTick. r/place is 1 pixel per tick. */
export const PAINT_TICK_MAX_CELLS = 1

/**
 * Back-compat alias for square-scene call sites. Use the axis-specific
 * constants above for anything that touches maze geometry.
 */
export const SCENE_WORLD_SIZE_METERS = SCENE_WORLD_SIZE_X_METERS


// MARK: Maze tiles

/**
 * Uniform scale applied to maze tile GLBs.
 * 1 → 16 m tiles (parcel-sized). 2 → 32 m tiles (pixelwars scale).
 *
 * dcl/place uses 2 so each paint cell is 2 m instead of 1 m — pixels are
 * chunky enough to read from spectator altitude and to comfortably
 * stand-on with an avatar. Grid stays 10×10 tiles (320 m / 32 m); total
 * pixels 160×160 = 25,600 (matches the original 1 m plan).
 */
export const MAZE_TILE_GLTF_SCALE = 2

/** Unscaled tile footprint in meters (one parcel edge). */
export const MAZE_TILE_UNSCALED_METERS = 16

/** World-space size of one maze tile after GLTF scale. */
export const MAZE_TILE_WORLD_METERS = MAZE_TILE_UNSCALED_METERS * MAZE_TILE_GLTF_SCALE

/** Unscaled ramp floor-to-floor rise baked into the tile GLBs. */
export const MAZE_RAMP_STEP_UNSCALED_METERS = 5.3835

/** World-space Y rise per ramp after GLTF scale. */
export const MAZE_RAMP_STEP_METERS = MAZE_RAMP_STEP_UNSCALED_METERS * MAZE_TILE_GLTF_SCALE

/**
 * Cap on stacked tile Y (meters). Flat canvas: 0 outlaws any ramp (its high
 * side would sit at y+STEP > 0 and canPlace rejects it up front).
 */
export const MAZE_MAX_STACK_Y_METERS = 0

/** Inclusive max stack level index (0 .. this). */
export const MAZE_MAX_LEVEL_INDEX = Math.floor(MAZE_MAX_STACK_Y_METERS / MAZE_RAMP_STEP_METERS)

/** Maze tile grid width (X), derived from scene X ÷ tile world size. */
export const MAZE_GRID_WIDTH = Math.floor(SCENE_WORLD_SIZE_X_METERS / MAZE_TILE_WORLD_METERS)

/** Maze tile grid height (Z), derived from scene Z ÷ tile world size. */
export const MAZE_GRID_HEIGHT = Math.floor(SCENE_WORLD_SIZE_Z_METERS / MAZE_TILE_WORLD_METERS)

/**
 * World offset applied to every tile position on BOTH axes. With 16 m
 * tiles and 256×144 scene, both axes fit exactly — offset is 0. Kept as
 * a single scalar since both dimensions center the same way.
 */
export const MAZE_ORIGIN_OFFSET_METERS = 0


// MARK: Paint (derived from performance knobs + maze tile size)

/** World-space edge length of one paint cell (meters). */
export const PAINT_CELL_SIZE_METERS =
	MAZE_TILE_WORLD_METERS / PAINT_CELLS_PER_TILE_AXIS


// MARK: oddBrushCells

/**
 * Round a meter brush span to an odd cell count (≥ 1) so the footprint
 * stays centered on the player.
 */
function oddBrushCells(
	brushMeters: number,
	cellMeters:  number,
): number {
	const raw = Math.max(1, Math.round(brushMeters / cellMeters))
	return raw % 2 === 0 ? raw + 1 : raw
}

/**
 * Default player brush footprint as an odd square of paint cells
 * (e.g. 3 → 3×3). Derived from PAINT_BRUSH_SIZE_METERS.
 */
export const PAINT_BRUSH_SIZE_CELLS = oddBrushCells(
	PAINT_BRUSH_SIZE_METERS,
	PAINT_CELL_SIZE_METERS,
)

/**
 * Client → server paintTick flush rate. Inbound room traffic is capped per
 * peer (~300/s); this stays well under that. Not tied to scene population.
 */
export const PAINT_TICK_HZ = 10

/**
 * Max cell ids per paintTick message. One brush footprint plus headroom.
 * Client chunks the outbox to this size; server drops oversized ticks.
 */
// Sized for the largest runtime brush (11x11 = 121 cells) plus headroom,
// so a single frame's footprint always fits in one paintTick message.
export const PAINT_TICK_MAX_IDS = 11 * 11 + 16


// MARK: Server publish rates
// In-memory game state may change every paintTick; CRDT component writes
// are coalesced to these rates so the sync bus is not saturated.

/**
 * How often the server writes PaintCoverage to the CRDT (Hz).
 * Only publishes when coverage is dirty.
 */
export const PAINT_COVERAGE_PUBLISH_HZ = 5

/** How often the server writes ServerStats to the CRDT (Hz). */
export const SERVER_STATS_PUBLISH_HZ = 1
