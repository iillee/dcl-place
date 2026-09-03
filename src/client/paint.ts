/**
 * paint.ts — dcl/place: flat pixel canvas renderer.
 *
 * Rewritten from dcl-canvas: this variant removes the walking-brush loop,
 * the extruder cubes, the collision pillars, and the paint outbox. Cells
 * are simple flat colored slabs that recolor in place from PaintCell CRDT.
 * All actual paint requests go through client/placeInput.ts → placePixel.
 *
 * Exports kept for compat with maze/rebuild, ui/utils/coverage, and the
 * (soon-to-be-removed) legacy UI layers.
 */

import {
	engine, Transform, MeshRenderer, Material, Entity, NetworkEntity,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

import { PaintTile, PaletteEntry, PaintCoverage } from 'src/shared/components'
import {
	HI, LO, MASKS, Mask, SIZE,
	cellId as sharedCellId,
	rotateMask as sharedRotateMask,
} from 'src/shared/maze/graph'
import { TileType } from 'src/shared/maze/tiles'
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
	PLACE_PALETTE_SIZE,
} from 'src/shared/palette'
import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_GLTF_SCALE,
} from 'src/shared/settings'
import { Team } from 'src/shared/team'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'
import { playClaimSfx } from 'src/client/audio'

// Re-exports so old imports keep compiling.
export { MASKS, type Mask }
export { Team } from 'src/shared/team'
export const cellId = sharedCellId
export const rotateMask = sharedRotateMask


// -------- Palette (CRDT-observed) --------

// Seed with the compat colors + all 16 place colors so materials resolve
// immediately without waiting for PaletteEntry CRDT to sync.
const paletteByIndex = new Map<number, Color4>([
	[PALETTE_NONE, TEAM_COLORS[Team.None]],
	[PALETTE_RED,  TEAM_COLORS[Team.Red]],
	[PALETTE_BLUE, TEAM_COLORS[Team.Blue]],
])
for (let i = 0; i < PLACE_PALETTE.length; i++) {
	paletteByIndex.set(i + 1, PLACE_PALETTE[i])
}

// Per-tile shadow copy of the last-observed PaintTile.cells byte array.
// Diffed against the incoming CRDT payload each frame; only changed
// bytes trigger applyPaintIndex. tileKey → byte array (length =
// PAINT_CELLS_PER_TILE).
const tileShadow    = new Map<number, number[]>()
// cellId → last rendered palette index.
const renderedIndex = new Map<string, number>()

// Telemetry — exported for the perf HUD.
let observedTiles      = 0
let observedPaintedPx  = 0
let firstTileAtMs: number | null = null
let lastHydrationAtMs: number | null = null
const moduleLoadMs = Date.now()

/** Look up a cell's last-observed palette byte from the per-tile shadow.
 *  Returns undefined for cells the CRDT has never touched. */
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
	eventBus.on(ClientEvents.RoundReset, () => { clearAllPaintState() })

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
		// Re-tint any already-rendered cells that use this palette slot.
		for (const [id, idx] of renderedIndex) {
			if (idx === entry.index) applyPaintIndex(id, idx, true)
		}
	}
}

// Hydration gate: the first sync pass loads every persisted pixel and
// would fire a pop per cell. Flip after the first pass so only live
// changes make sound. Coalesced to one pop per frame regardless of how
// many cells changed (concurrent painters).
let paintHydrated = false

// Diff each incoming PaintTile buffer against the shadow copy and
// dispatch applyPaintIndex for each changed byte. Only touches cells
// that actually flipped — a tile with 1 new pixel costs 1 apply, not
// PAINT_CELLS_PER_TILE.
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
		if (!incoming || incoming.length !== PAINT_CELLS_PER_TILE) {
			// Newly-created tile before first buffer set — skip.
			continue
		}

		let shadow = tileShadow.get(tileKey)
		if (!shadow) {
			shadow = new Array<number>(PAINT_CELLS_PER_TILE).fill(0)
			tileShadow.set(tileKey, shadow)
			if (firstTileAtMs === null) firstTileAtMs = Date.now()
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

	// Grace window after first tile arrives — CRDT hydration trickles in
	// over many frames, so if we flipped paintHydrated on the first tile
	// every subsequent hydration byte would pop. Wait until the burst is
	// done (3s past first tile) before allowing live-paint SFX.
	const HYDRATION_SFX_GRACE_MS = 3000
	const hydrationSettled = paintHydrated
		&& firstTileAtMs !== null
		&& Date.now() - firstTileAtMs > HYDRATION_SFX_GRACE_MS
	if (anyChange && hydrationSettled) playClaimSfx()
	if (!paintHydrated && tileCount > 0) {
		paintHydrated     = true
		lastHydrationAtMs = Date.now()
		console.log(
			`[Perf/Client] hydration: ${totalPainted} pixels across ${tileCount} tiles ` +
			`in ${lastHydrationAtMs - moduleLoadMs}ms since module load ` +
			`(first tile at ${firstTileAtMs !== null ? firstTileAtMs - moduleLoadMs : '?'}ms)`
		)
	}
}


// -------- Cell store --------

// Floor slab thickness (world m) — thin, sits just above the tile GLB.
const FLAT_THICKNESS = 0.02
// Vertical offset above the tile origin so slabs clear the GLB's floor.
const FLAT_OFFSET    = 0.275 * MAZE_TILE_GLTF_SCALE

type CellKind = 'cube' | 'plane'
type CellData = {
	entity:   Entity
	kind:     CellKind
	basePos:  Vector3
	cellSize: number
}
const cellEntity  = new Map<string, Entity>()
const cellData    = new Map<string, CellData>()
const paintByTile = new Map<Entity, { entities: Entity[]; ids: string[] }>()


// -------- Ramp geometry (kept for compat with maze tile spawning) --------

const RAMP_FLAT_END_METERS = 1.0 * MAZE_TILE_GLTF_SCALE

function rampGeometry(CELL: number, STEP: number) {
	const cellSize     = CELL / SIZE
	const flatLen      = RAMP_FLAT_END_METERS
	const nFlat        = Math.max(1, Math.round(flatLen / cellSize))
	const inclineStart = flatLen
	const inclineEnd   = CELL - flatLen
	const inclineLen   = inclineEnd - inclineStart
	const slopeLen     = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
	const nInclineIdeal = Math.round(slopeLen / cellSize)
	const nInclineMax   = SIZE - 2 * nFlat
	const nIncline      = Math.min(nInclineIdeal, nInclineMax)
	const slopeCellSize = slopeLen / nIncline
	const cosA         = inclineLen / slopeLen
	const sinA         = STEP / slopeLen
	return { cellSize, flatLen, nFlat, inclineStart, inclineEnd, inclineLen,
		slopeLen, nIncline, slopeCellSize, cosA, sinA }
}

function rampCellIdxFromCanonical(lx: number, lz: number, geom: ReturnType<typeof rampGeometry>) {
	const col = Math.floor(lx / geom.cellSize)
	if (col < LO || col >= HI) return null
	let row: number
	if (lz < geom.inclineStart) {
		row = Math.floor(lz / geom.cellSize)
	} else if (lz >= geom.inclineEnd) {
		row = geom.nFlat + geom.nIncline + Math.floor((lz - geom.inclineEnd) / geom.cellSize)
	} else {
		const slopeDist = (lz - geom.inclineStart) / geom.cosA
		row = geom.nFlat + Math.floor(slopeDist / geom.slopeCellSize)
	}
	return { col, row }
}


// -------- Materials --------

function cellMaterialFromColor(color: Color4) {
	return {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	}
}

// Fallback material for unpainted cells. Kept in sync with
// TEAM_COLORS[Team.None] (src/shared/palette.ts) — both must agree so
// a cell rendered via the fallback path looks identical to one rendered
// via paletteByIndex[PALETTE_NONE].
const NONE_MAT = cellMaterialFromColor(TEAM_COLORS[Team.None])

function cellMaterialForIndex(index: number) {
	const color = paletteByIndex.get(index)
	if (!color) return null
	return cellMaterialFromColor(color)
}


// -------- Apply paint (flat recolor, no tweens/extrusion) --------

export function applyPaintIndex(id: string, index: number, force: boolean): void {
	if (!force && renderedIndex.get(id) === index) return
	renderedIndex.set(id, index)
	const data = cellData.get(id)
	if (!data) return
	const mat = cellMaterialForIndex(index) ?? NONE_MAT
	Material.setPbrMaterial(data.entity, mat)
}


// -------- Local-only preview (feet-based painting) --------
// The feet system tints the actual cell entity as the avatar walks over it
// so the player sees exactly what would be painted. renderedIndex (the
// authoritative "what has the server told us this cell is" map) is NOT
// touched — restoreCellMaterial() reads it to revert on cell exit.

/** Tint the cell entity with a palette color WITHOUT recording it as
 *  server truth. Safe to call every frame while the avatar stands on
 *  the same cell (early exits below the SDK's own dirty-check). */
export function setCellPreviewMaterial(id: string, paletteIndex: number): void {
	const data = cellData.get(id)
	if (!data) return
	const mat = cellMaterialForIndex(paletteIndex) ?? NONE_MAT
	Material.setPbrMaterial(data.entity, mat)
}

/** Reset a cell's material to whatever the server last told us it should
 *  be (or the unpainted default). Call when the avatar leaves a preview
 *  cell so we don't lie about the canvas state. */
export function restoreCellMaterial(id: string): void {
	const data = cellData.get(id)
	if (!data) return
	const index = renderedIndex.get(id) ?? PALETTE_NONE
	const mat   = cellMaterialForIndex(index) ?? NONE_MAT
	Material.setPbrMaterial(data.entity, mat)
}


// -------- Public: teardown helpers used by maze/rebuild --------

export function clearAllPaintState(): void {
	tileShadow.clear()
	renderedIndex.clear()
}

export function removePaintForTile(tileEntity: Entity): void {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (const e of rec.entities) engine.removeEntity(e)
	for (const id of rec.ids) {
		cellEntity.delete(id)
		cellData.delete(id)
		renderedIndex.delete(id)
		// Note: intentionally do NOT clear the tile shadow here — the
		// authoritative PaintTile CRDT still holds the byte, and if the
		// tile respawns later the shadow-vs-crdt diff will short-circuit
		// (no re-dispatch needed). If we ever add distance streaming that
		// respawns tiles, revisit this and drop shadow entries on despawn
		// so the fresh cell entities get their initial paint applied.
		void cellIdToKey(id)
	}
	paintByTile.delete(tileEntity)
}

export function resetPaintForTile(tileEntity: Entity): void {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (const id of rec.ids) {
		renderedIndex.set(id, PALETTE_NONE)
		applyPaintIndex(id, PALETTE_NONE, true)
	}
}


// -------- Deprecated outbox (kept as stub for clientHandler import) --------

export function drainPaintOutbox(_max: number): string[] { return [] }


// -------- Spawn cells (same layout as canvas) --------

const SPAWN_DELAY_MS = 500
const deferredSpawns: Array<{ dueMs: number; run: () => void }> = []
let spawnClockMs = 0
engine.addSystem((dt: number) => {
	spawnClockMs += dt * 1000
	while (deferredSpawns.length && deferredSpawns[0].dueMs <= spawnClockMs) {
		deferredSpawns.shift()!.run()
	}
})

export function spawnCellsForTile(
	tileType: string,
	r: number,
	tx: number, tz: number, ty: number,
	CELL: number, STEP: number,
	tileEntity: Entity,
): void {
	const raw = MASKS[tileType as TileType]
	if (!raw) return
	deferredSpawns.push({
		dueMs: spawnClockMs + SPAWN_DELAY_MS,
		run: () => spawnCellsForTileImmediate(tileType, r, tx, tz, ty, CELL, STEP, tileEntity),
	})
}

function spawnCellsForTileImmediate(
	tileType: string,
	r: number,
	tx: number, tz: number, ty: number,
	CELL: number, STEP: number,
	tileEntity: Entity,
): void {
	const raw = MASKS[tileType as TileType]
	if (!raw) return
	const mask = rotateMask(raw, r)
	const h = mask.length, w = mask[0].length
	const cellSize = CELL / w
	const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
	const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

	const isRamp = tileType === 'ramp'
	const rad = r * Math.PI / 2
	const sinR = Math.sin(rad), cosR = Math.cos(rad)
	const geom = rampGeometry(CELL, STEP)
	const slopeAngleDeg = Math.atan2(STEP, geom.inclineLen) * 180 / Math.PI
	const yaw = Quaternion.fromEulerDegrees(0, r * 90, 0)
	const flatRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90, 0, 0))
	const inclineRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90 - slopeAngleDeg, 0, 0))

	const localToWorld = (lx: number, lz: number) => {
		const cx = lx - CELL / 2, cz = lz - CELL / 2
		const wxRel =  cx * cosR + cz * sinR
		const wzRel = -cx * sinR + cz * cosR
		return {
			wx: tileWorldX + CELL / 2 + wxRel,
			wz: tileWorldZ + CELL / 2 + wzRel,
		}
	}

	let tileRec = paintByTile.get(tileEntity)
	if (!tileRec) { tileRec = { entities: [], ids: [] }; paintByTile.set(tileEntity, tileRec) }

	const spawnPlane = (wx: number, wy: number, wz: number, rot: any, col: number, row: number, scaleY: number = cellSize) => {
		const id  = cellId(tx, tz, ty, col, row)
		const key = cellIdToKey(id)
		const preexisting = shadowLookup(key) ?? renderedIndex.get(id) ?? PALETTE_NONE
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy, wz),
			rotation: rot,
			scale:    Vector3.create(cellSize, scaleY, 1),
		})
		MeshRenderer.setPlane(e)
		const mat = cellMaterialForIndex(preexisting) ?? NONE_MAT
		Material.setPbrMaterial(e, mat)
		cellEntity.set(id, e)
		cellData.set(id, { entity: e, kind: 'plane', basePos: Vector3.create(wx, wy, wz), cellSize })
		renderedIndex.set(id, preexisting)
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

	const spawnFlat = (wx: number, wy: number, wz: number, col: number, row: number) => {
		const id  = cellId(tx, tz, ty, col, row)
		const key = cellIdToKey(id)
		const preexisting = shadowLookup(key) ?? renderedIndex.get(id) ?? PALETTE_NONE
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy + FLAT_THICKNESS / 2, wz),
			scale:    Vector3.create(cellSize, FLAT_THICKNESS, cellSize),
		})
		MeshRenderer.setBox(e)
		const mat = cellMaterialForIndex(preexisting) ?? NONE_MAT
		Material.setPbrMaterial(e, mat)
		cellEntity.set(id, e)
		cellData.set(id, { entity: e, kind: 'cube', basePos: Vector3.create(wx, wy, wz), cellSize })
		renderedIndex.set(id, preexisting)
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

	if (isRamp) {
		for (let i = 0; i < geom.nFlat; i++) {
			const lz = (i + 0.5) * geom.cellSize
			for (let col = LO; col < HI; col++) {
				const lx = (col + 0.5) * geom.cellSize
				const idx = rampCellIdxFromCanonical(lx, lz, geom)!
				const { wx, wz } = localToWorld(lx, lz)
				spawnPlane(wx, ty + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
			}
		}
		for (let i = 0; i < geom.nIncline; i++) {
			const slopeDist = (i + 0.5) * geom.slopeCellSize
			const lz = geom.inclineStart + slopeDist * geom.cosA
			const y  = ty + FLAT_OFFSET + slopeDist * geom.sinA
			for (let col = LO; col < HI; col++) {
				const lx = (col + 0.5) * geom.cellSize
				const idx = rampCellIdxFromCanonical(lx, lz, geom)!
				const { wx, wz } = localToWorld(lx, lz)
				spawnPlane(wx, y, wz, inclineRot, idx.col, idx.row, geom.slopeCellSize)
			}
		}
		for (let i = 0; i < geom.nFlat; i++) {
			const lz = geom.inclineEnd + (i + 0.5) * geom.cellSize
			for (let col = LO; col < HI; col++) {
				const lx = (col + 0.5) * geom.cellSize
				const idx = rampCellIdxFromCanonical(lx, lz, geom)!
				const { wx, wz } = localToWorld(lx, lz)
				spawnPlane(wx, ty + STEP + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
			}
		}
		return
	}

	// Non-ramp: flat mask cells.
	for (let row = 0; row < h; row++) {
		for (let col = 0; col < w; col++) {
			const ch = mask[row][col]
			if (ch === '.') continue
			const wx = tileWorldX + (col + 0.5) * cellSize
			const wz = tileWorldZ + (row + 0.5) * cellSize
			let wy: number
			if (ch === 'F') {
				wy = ty + FLAT_OFFSET
			} else if (ch >= '0' && ch <= '9') {
				const t = (ch.charCodeAt(0) - 48) / 9
				wy = ty + t * STEP + FLAT_OFFSET
			} else {
				continue
			}
			spawnFlat(wx, wy, wz, col, row)
		}
	}
}


// -------- Coverage (for HUD) --------

export function coverage(): { red: number; blue: number; total: number } {
	const total = cellEntity.size
	for (const [, crdt] of engine.getEntitiesWith(PaintCoverage)) {
		return { red: crdt.red, blue: crdt.blue, total }
	}
	return { red: 0, blue: 0, total }
}


// -------- World → cellId (for tap-to-place raycast hit) --------

// Height of the walkable floor top above the tile origin. The tile GLB
// bakes ~0.5 m of floor thickness at TILE_SCALE=1; that thickness scales
// uniformly with MAZE_TILE_GLTF_SCALE. Kept as an import from settings
// so scaling the whole scene doesn't leave the highlight buried under
// the tile floor mesh.
const WALKABLE_TOP = 0.5 * MAZE_TILE_GLTF_SCALE

export function worldToCellId(
	px: number, py: number, pz: number,
	CELL: number, STEP: number,
	lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null,
): { id: string; groundY: number } | null {
	const tx = Math.floor((px - MAZE_ORIGIN_OFFSET_METERS) / CELL)
	const tz = Math.floor((pz - MAZE_ORIGIN_OFFSET_METERS) / CELL)
	const tile = lookupTile(tx, tz, py)
	if (!tile) return null

	const raw = MASKS[tile.type as TileType]
	if (!raw) return null

	const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
	const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

	if (tile.type === 'ramp') {
		const geom = rampGeometry(CELL, STEP)
		const rad = tile.r * Math.PI / 2
		const sinR = Math.sin(rad), cosR = Math.cos(rad)
		const dx = px - tileWorldX, dz = pz - tileWorldZ
		const cx = dx - CELL / 2, cz = dz - CELL / 2
		const lx = cosR * cx - sinR * cz + CELL / 2
		const lz = sinR * cx + cosR * cz + CELL / 2
		const idx = rampCellIdxFromCanonical(lx, lz, geom)
		if (!idx) return null
		let surfaceY: number
		if (lz < geom.inclineStart) surfaceY = tile.y + WALKABLE_TOP
		else if (lz >= geom.inclineEnd) surfaceY = tile.y + STEP + WALKABLE_TOP
		else {
			const slopeDist = (lz - geom.inclineStart) / geom.cosA
			surfaceY = tile.y + WALKABLE_TOP + slopeDist * geom.sinA
		}
		return { id: cellId(tx, tz, tile.y, idx.col, idx.row), groundY: surfaceY }
	}

	const mask = rotateMask(raw, tile.r)
	const w = mask[0].length
	const cellSize = CELL / w
	const localX = px - tileWorldX
	const localZ = pz - tileWorldZ
	const col = Math.floor(localX / cellSize)
	const row = Math.floor(localZ / cellSize)
	if (col < 0 || col >= w || row < 0 || row >= mask.length) return null
	const ch = mask[row][col]
	if (ch === '.') return null

	return { id: cellId(tx, tz, tile.y, col, row), groundY: tile.y + WALKABLE_TOP }
}


