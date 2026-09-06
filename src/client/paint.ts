/**
 * paint.ts — dcl/place: flat pixel canvas renderer (solid-floor edition).
 *
 * The scene is a single 320×320m floor GLB with a uniform 10×10 grid of
 * "tiles" (32m each) and 16×16 paint cells per tile → 25,600 paintable
 * pixels. No maze, no ramps, no rotations, no per-tile GLB fetches.
 *
 * spawnPaintCanvas() runs once at boot and creates:
 *   1. The single floor GLB.
 *   2. All 25,600 paint-cell entities as flat colored boxes, positioned
 *      deterministically from tile/cell math (no MASKS lookup, so every
 *      pixel is paintable — fixes the two-shade-white bug).
 *
 * CRDT observation (PaintTile.cells byte array) still drives recoloring
 * via applyPaintIndex on diff, identical to the previous implementation.
 */

import {
	engine, Transform, MeshRenderer, Material, GltfContainer, ColliderLayer,
	Entity, NetworkEntity,
} from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'

import { PaintTile, PaletteEntry, PaintCoverage } from 'src/shared/components'
import {
	cellIdToKey,
	cellKeyToCellId,
	joinCellKey,
	tileKeyFromNetworkId,
	PAINT_CELLS_PER_TILE,
} from 'src/shared/paintGrid'
import {
	TEAM_COLORS,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	PLACE_PALETTE,
} from 'src/shared/palette'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_GLTF_SCALE,
	MAZE_TILE_WORLD_METERS,
	PAINT_CELL_SIZE_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { Team } from 'src/shared/team'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'
import { playClaimSfx } from 'src/client/audio'


// -------- Geometry constants (all derived from settings) --------

/** World-meters per tile edge. Alias so call sites read naturally. */
const CELL = MAZE_TILE_WORLD_METERS
/** Cells along one tile edge (16). */
const SIZE = PAINT_CELLS_PER_TILE_AXIS
/** World-meters per paint cell (2). */
const CELL_SIZE = PAINT_CELL_SIZE_METERS

// Perimeter trim. The old maze used a CROSS_MASK that left tile-corner
// voids everywhere (interior AND outer edges). With a solid floor GLB we
// want:
//   - Interior voids FILLED (all cells paintable, no unpaintable holes)
//   - Outer-perimeter arms TRIMMED (they'd overhang the floor edge)
//
// LO/HI are the old corridor bounds (LO=3, HI=13 at SIZE=16), matching
// the CROSS_MASK layout the persisted canvas was written against. We
// only skip cells in the OUTER strip of edge tiles — all interior cell
// ids are unchanged, so every existing painted pixel keeps rendering in
// the exact same world position.
const ARM = (SIZE * 20) / 32
const LO  = (SIZE - ARM) / 2
const HI  = (SIZE + ARM) / 2

function cellOnFloor(tx: number, tz: number, col: number, row: number): boolean {
	if (tx === 0                   && col < LO) return false
	if (tx === MAZE_GRID_WIDTH - 1 && col >= HI) return false
	if (tz === 0                    && row < LO) return false
	if (tz === MAZE_GRID_HEIGHT - 1 && row >= HI) return false
	return true
}

/** Walkable floor top (world Y) — matches the old tile GLB's top surface
 *  so persisted paint doesn't shift vertically. */
export const WALKABLE_TOP = 0.5 * MAZE_TILE_GLTF_SCALE
/** Vertical offset above tile origin (y=0) for the flat paint-cell slabs. */
const FLAT_OFFSET  = 0.275 * MAZE_TILE_GLTF_SCALE
/** Slab thickness. */
const FLAT_THICKNESS = 0.02


// -------- Stable cell-id string --------

/** Canonical cellId string: "tx,tz,ty:col,row". `ty` is always 0 on this
 *  flat scene but preserved in the format so paintGrid math and any
 *  stored CRDT keys remain compatible. */
export function cellId(tx: number, tz: number, ty: number, col: number, row: number): string {
	return `${tx},${tz},${ty}:${col},${row}`
}


// -------- Palette (CRDT-observed) --------

const paletteByIndex = new Map<number, Color4>([
	[PALETTE_NONE, TEAM_COLORS[Team.None]],
	[PALETTE_RED,  TEAM_COLORS[Team.Red]],
	[PALETTE_BLUE, TEAM_COLORS[Team.Blue]],
])
for (let i = 0; i < PLACE_PALETTE.length; i++) {
	paletteByIndex.set(i + 1, PLACE_PALETTE[i])
}


// -------- Shadow / render state --------

const tileShadow    = new Map<number, number[]>() // tileKey → last-observed bytes
const renderedIndex = new Map<string, number>()   // cellId → last rendered palette index

let observedTiles      = 0
let observedPaintedPx  = 0
let firstTileAtMs: number | null = null
let lastNewTileAtMs: number | null = null // last time a NEW tileKey was seen
let lastHydrationAtMs: number | null = null
const moduleLoadMs = Date.now()

function shadowLookup(cellKey: number | null): number | undefined {
	if (cellKey === null) return undefined
	const tileKey  = Math.floor(cellKey / PAINT_CELLS_PER_TILE)
	const localIdx = cellKey - tileKey * PAINT_CELLS_PER_TILE
	const shadow   = tileShadow.get(tileKey)
	return shadow ? shadow[localIdx] : undefined
}

export function paintTelemetry(): {
	observedTiles: number
	observedPaintedPx: number
	tileShadowSize: number
	firstTileAtMs: number | null
	lastHydrationAtMs: number | null
	moduleLoadMs: number
	paintHydrated: boolean
} {
	return {
		observedTiles,
		observedPaintedPx,
		tileShadowSize: tileShadow.size,
		firstTileAtMs,
		lastHydrationAtMs,
		moduleLoadMs,
		paintHydrated,
	}
}


// -------- Compat: teams (dcl/place is teamless) --------

let localTeam: Team = Team.None
export function setLocalTeam(team: Team): void { localTeam = team }
export function getLocalTeam(): Team { return localTeam }


// -------- initPaintNet: observe CRDT --------

export function initPaintNet(): void {
	eventBus.on(ClientEvents.TeamAssigned, ({ team }) => { localTeam = team })
	// dcl/place has no round resets — the canvas is permanent.

	engine.addSystem(() => {
		syncPaletteFromCrdt()
		syncCellsFromCrdt()
	})
}

function syncPaletteFromCrdt(): void {
	for (const [_e, entry] of engine.getEntitiesWith(PaletteEntry)) {
		if (entry.color.a === 0) continue
		const prev = paletteByIndex.get(entry.index)
		if (prev &&
			prev.r === entry.color.r && prev.g === entry.color.g &&
			prev.b === entry.color.b && prev.a === entry.color.a) continue
		paletteByIndex.set(entry.index, Color4.create(
			entry.color.r, entry.color.g, entry.color.b, entry.color.a,
		))
		for (const [id, idx] of renderedIndex) {
			if (idx === entry.index) applyPaintIndex(id, idx, true)
		}
	}
}

let paintHydrated = false

function syncCellsFromCrdt(): void {
	let anyChange = false
	let totalPainted = 0
	let tileCount = 0
	for (const [entity, tile] of engine.getEntitiesWith(PaintTile)) {
		tileCount++
		const net = NetworkEntity.getOrNull(entity)
		if (!net) continue
		const tileKey = tileKeyFromNetworkId(Number(net.entityId))
		if (tileKey === null) continue

		const incoming = tile.cells
		if (!incoming || incoming.length !== PAINT_CELLS_PER_TILE) continue

		let shadow = tileShadow.get(tileKey)
		if (!shadow) {
			shadow = new Array<number>(PAINT_CELLS_PER_TILE).fill(0)
			tileShadow.set(tileKey, shadow)
			lastNewTileAtMs = Date.now()
			if (firstTileAtMs === null) firstTileAtMs = lastNewTileAtMs
		}

		for (let localIdx = 0; localIdx < PAINT_CELLS_PER_TILE; localIdx++) {
			const next = incoming[localIdx]
			if (next !== 0) totalPainted++
			if (shadow[localIdx] === next) continue
			shadow[localIdx] = next
			const cellKey = joinCellKey(tileKey, localIdx)
			applyPaintIndex(cellKeyToCellId(cellKey), next, false)
			anyChange = true
		}
	}

	observedTiles     = tileCount
	observedPaintedPx = totalPainted

	const HYDRATION_SFX_GRACE_MS = 3000
	const hydrationSettled = paintHydrated
		&& firstTileAtMs !== null
		&& Date.now() - firstTileAtMs > HYDRATION_SFX_GRACE_MS
	if (anyChange && hydrationSettled) playClaimSfx()

	// Flip paintHydrated when EITHER:
	//   (a) all expected tiles have arrived (typical fully-painted canvas), OR
	//   (b) hydration has been quiet for QUIESCENCE_MS (partially-painted
	//       canvas — not all 100 tiles exist server-side, only painted ones), OR
	//   (c) MAX_WAIT_MS has elapsed since module load (safety net for slow
	//       mobile network so the splash never hangs indefinitely).
	//
	// Previous behavior flipped on the first tile, which on mobile meant
	// the splash lifted while ~40% of tiles were still en route — users saw
	// a half-painted canvas with grey holes.
	if (!paintHydrated) {
		const now = Date.now()
		const allArrived = tileCount >= EXPECTED_TILE_COUNT
		const quiescent  = firstTileAtMs !== null
			&& lastNewTileAtMs !== null
			&& now - lastNewTileAtMs > HYDRATION_QUIESCENCE_MS
		const timedOut   = now - moduleLoadMs > HYDRATION_MAX_WAIT_MS
		if (allArrived || quiescent || timedOut) {
			paintHydrated     = true
			lastHydrationAtMs = now
			const reason = allArrived ? 'all-tiles' : quiescent ? 'quiescent' : 'timeout'
			console.log(
				`[Perf/Client] hydration COMPLETE (${reason}): ${totalPainted} pixels ` +
				`across ${tileCount}/${EXPECTED_TILE_COUNT} tiles in ` +
				`${lastHydrationAtMs - moduleLoadMs}ms since module load ` +
				`(first tile at ${firstTileAtMs !== null ? firstTileAtMs - moduleLoadMs : '?'}ms)`
			)
		}
	}
}

const EXPECTED_TILE_COUNT     = MAZE_GRID_WIDTH * MAZE_GRID_HEIGHT
const HYDRATION_QUIESCENCE_MS = 1500
const HYDRATION_MAX_WAIT_MS   = 10000


// -------- Cell store --------

const cellEntity = new Map<string, Entity>()


// -------- Materials --------
// Allocate a fresh MaterialInfo object per setPbrMaterial call. Previously
// we tried caching shared objects to reduce mobile GC pressure, but that
// caused a mobile-only blank-canvas regression (SDK / renderer appears to
// mutate or reference the object internally; sharing broke every cell's
// material commit). Fresh objects are cheap enough — revert to safety.

function cellMaterialFromColor(color: Color4) {
	return {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	}
}
const NONE_MAT = cellMaterialFromColor(TEAM_COLORS[Team.None])
function cellMaterialForIndex(index: number) {
	const color = paletteByIndex.get(index)
	if (!color) return null
	return cellMaterialFromColor(color)
}


// -------- Apply paint (flat recolor) --------

export function applyPaintIndex(id: string, index: number, force: boolean): void {
	if (!force && renderedIndex.get(id) === index) return
	renderedIndex.set(id, index)
	const e = cellEntity.get(id)
	if (e === undefined) return
	const mat = cellMaterialForIndex(index) ?? NONE_MAT
	Material.setPbrMaterial(e, mat)
}


// -------- Local-only preview (feet-based painting) --------

export function setCellPreviewMaterial(id: string, paletteIndex: number): void {
	const e = cellEntity.get(id)
	if (e === undefined) return
	const mat = cellMaterialForIndex(paletteIndex) ?? NONE_MAT
	Material.setPbrMaterial(e, mat)
}

export function restoreCellMaterial(id: string): void {
	const e = cellEntity.get(id)
	if (e === undefined) return
	const index = renderedIndex.get(id) ?? PALETTE_NONE
	const mat   = cellMaterialForIndex(index) ?? NONE_MAT
	Material.setPbrMaterial(e, mat)
}


// -------- Teardown helpers --------

export function clearAllPaintState(): void {
	tileShadow.clear()
	renderedIndex.clear()
}


// -------- Deprecated outbox (compat shim) --------

export function drainPaintOutbox(_max: number): string[] { return [] }


// -------- spawnPaintCanvas: chunked boot spawn --------
//
// Cells are spawned across multiple frames instead of one giant loop.
// A single 25,444-cell synchronous burst overwhelms mobile GPU / material
// allocation — users saw ~50% white cells and voids where entities or
// materials silently failed to commit. Chunking gives the renderer a
// chance to breathe between batches.
//
// CELLS_PER_FRAME: sized so a full canvas spawns in <2s at 30fps on
// mid-range mobile. Tune down if voids reappear on slower devices.
const CELLS_PER_FRAME = 600

let canvasSpawned = false
let spawnQueue: Array<{ tx: number; tz: number; col: number; row: number }> = []

/**
 * Boot the solid-floor canvas:
 *   1. Spawn the 320×320m floor GLB at world origin (single entity).
 *   2. Enqueue every paint cell coord; a per-frame system drains the
 *      queue in batches of CELLS_PER_FRAME.
 *
 * Runs exactly once per session. Called from client/index.ts::setupClient.
 */
export function spawnPaintCanvas(): void {
	if (canvasSpawned) return
	canvasSpawned = true

	// 1. Floor.
	const floor = engine.addEntity()
	Transform.create(floor, { position: Vector3.create(0, 0, 0) })
	GltfContainer.create(floor, {
		src: 'assets/models/tile_floor.glb',
		visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
	})

	// 2. Build the spawn queue — don't spawn entities yet. The drain system
	// below spawns CELLS_PER_FRAME per frame.
	for (let tz = 0; tz < MAZE_GRID_HEIGHT; tz++) {
		for (let tx = 0; tx < MAZE_GRID_WIDTH; tx++) {
			for (let row = 0; row < SIZE; row++) {
				for (let col = 0; col < SIZE; col++) {
					if (!cellOnFloor(tx, tz, col, row)) continue
					spawnQueue.push({ tx, tz, col, row })
				}
			}
		}
	}
	console.log(`[Place] paint canvas spawn queue: ${spawnQueue.length} cells (${CELLS_PER_FRAME}/frame)`)

	const spawnStartMs = Date.now()
	let cursor         = 0
	const total        = spawnQueue.length
	engine.addSystem(() => {
		if (cursor >= total) return
		const end = Math.min(cursor + CELLS_PER_FRAME, total)
		for (let i = cursor; i < end; i++) {
			const c = spawnQueue[i]
			spawnOneCell(c.tx, c.tz, c.col, c.row)
		}
		cursor = end
		if (cursor >= total) {
			spawnQueue = [] // release memory
			canvasSpawnComplete = true
			console.log(
				`[Place] paint canvas spawn COMPLETE: ${total} cells in ` +
				`${Date.now() - spawnStartMs}ms`
			)
		}
	})
}

let canvasSpawnComplete = false

function spawnOneCell(tx: number, tz: number, col: number, row: number): void {
	const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
	const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS
	const wx = tileWorldX + (col + 0.5) * CELL_SIZE
	const wz = tileWorldZ + (row + 0.5) * CELL_SIZE
	const id  = cellId(tx, tz, 0, col, row)
	const key = cellIdToKey(id)
	const preexisting = shadowLookup(key) ?? PALETTE_NONE

	const e = engine.addEntity()
	Transform.create(e, {
		position: Vector3.create(wx, FLAT_OFFSET + FLAT_THICKNESS / 2, wz),
		scale:    Vector3.create(CELL_SIZE, FLAT_THICKNESS, CELL_SIZE),
	})
	MeshRenderer.setBox(e)
	Material.setPbrMaterial(e, cellMaterialForIndex(preexisting) ?? NONE_MAT)

	cellEntity.set(id, e)
	renderedIndex.set(id, preexisting)
}

/** True while the boot spawn is still draining the queue. Used by the
 *  loading splash gate so the splash stays up until every cell exists. */
export function isSpawningCanvas(): boolean {
	return canvasSpawned && !canvasSpawnComplete
}


// -------- Coverage (for HUD) --------

export function coverage(): { red: number; blue: number; total: number } {
	const total = cellEntity.size
	for (const [, crdt] of engine.getEntitiesWith(PaintCoverage)) {
		return { red: crdt.red, blue: crdt.blue, total }
	}
	return { red: 0, blue: 0, total }
}

export function paintedCount(): number {
	for (const [, crdt] of engine.getEntitiesWith(PaintCoverage)) {
		return crdt.total
	}
	return 0
}

export function totalCellCount(): number {
	return MAZE_GRID_WIDTH * MAZE_GRID_HEIGHT * PAINT_CELLS_PER_TILE
}


// -------- World → cellId (pure math, no tile lookup) --------

/**
 * Resolve the paint cell under a world (px, pz) point on the solid floor.
 * Y is not used for tile selection (single flat level) but is returned
 * so callers can gate on airborne via `groundY - py`.
 *
 * Signature preserved for compat with placeInput.ts. `_CELL` / `_STEP` /
 * `_lookupTile` are ignored; kept as unused params so we don't break
 * that call site's ergonomics in this pass.
 */
export function worldToCellId(
	px: number, _py: number, pz: number,
	_CELL?: number, _STEP?: number,
	_lookupTile?: unknown,
): { id: string; groundY: number } | null {
	const localX = px - MAZE_ORIGIN_OFFSET_METERS
	const localZ = pz - MAZE_ORIGIN_OFFSET_METERS
	if (localX < 0 || localZ < 0) return null
	const tx = Math.floor(localX / CELL)
	const tz = Math.floor(localZ / CELL)
	if (tx < 0 || tx >= MAZE_GRID_WIDTH || tz < 0 || tz >= MAZE_GRID_HEIGHT) return null
	const col = Math.floor((localX - tx * CELL) / CELL_SIZE)
	const row = Math.floor((localZ - tz * CELL) / CELL_SIZE)
	if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return null
	if (!cellOnFloor(tx, tz, col, row)) return null
	return { id: cellId(tx, tz, 0, col, row), groundY: WALKABLE_TOP }
}
