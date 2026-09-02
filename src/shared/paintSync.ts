/**
 * paintSync.ts — server create + syncEntity for PaintCoverage / Palette / PaintTile.
 *
 * Only the server calls the mutation helpers. Clients observe replicas via
 * getEntitiesWith(PaintTile).
 *
 * Paint state is chunked one CRDT entity per (tx, tz, level) tile: each
 * entity carries a byte-array of PAINT_CELLS_PER_TILE cells. Cells inside
 * a tile buffer are mutated cheaply in memory; PaintTile.createOrReplace
 * is only invoked on the dirty subset via flushDirtyPaintTiles(), which
 * server.ts drives at the end of every engine tick.
 *
 * This replaces the previous 1-CRDT-entity-per-painted-cell model, which
 * scaled linearly with painted-cell count and made joining a heavily
 * painted world untenable on mobile. Ported from dcl-snowdrift.
 *
 * syncEntity requires myProfile.networkId (async). If boot races that, we
 * create the entity anyway and retry sync on later writes — otherwise paint
 * stays server-local and clients see nothing.
 */

import { engine, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { myProfile, syncEntity } from '@dcl/sdk/network'

import {
	PaintTile,
	PaletteEntry,
	PaintCoverage,
} from 'src/shared/components'
import {
	COVERAGE_NETWORK_ID,
	PAINT_CELLS_PER_TILE,
	PALETTE_NETWORK_BASE,
	paintGridCapacity,
	splitCellKey,
	tileNetworkId,
} from 'src/shared/paintGrid'
import {
	TEAM_COLORS,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	MAX_PALETTE_INDEX,
} from 'src/shared/palette'
import { Team } from 'src/shared/team'

export const PREBOUND_PALETTE_SLOTS = 8

// tileKey → owning ECS entity (holds the PaintTile CRDT component).
const tileEntities  = new Map<number, Entity>()
// tileKey → in-memory byte buffer (source of truth between flushes).
const tileBuffers   = new Map<number, number[]>()
// tileKeys whose buffer diverged from the last CRDT write. Flushed and
// cleared by flushDirtyPaintTiles().
const dirtyTiles    = new Set<number>()

const paletteEntities = new Map<number, Entity>()

let paintCoverageEntity: Entity | null = null
let initialized  = false
// Total cells with a non-zero byte across all tile buffers. Cheap running
// counter for logging / telemetry; avoids full-scan every read.
let paintedBytes = 0


// MARK: getPaintCoverageEntity

export function getPaintCoverageEntity(): Entity | null {
	return paintCoverageEntity
}


// MARK: paintTileEntityCount

/** Number of tile entities currently allocated. Bounded by tiles*levels. */
export function paintTileEntityCount(): number {
	return tileEntities.size
}


// MARK: paintedCellCount

/** Total painted cells across all tile buffers (byte != 0). */
export function paintedCellCount(): number {
	return paintedBytes
}


// MARK: eachPaintTileEntity

export function eachPaintTileEntity(): IterableIterator<[number, Entity]> {
	return tileEntities.entries()
}


// MARK: trySync

/**
 * Attach NetworkEntity when the network profile is ready. Safe to call
 * repeatedly — no-ops if already linked or profile not ready yet.
 */
function trySync(entity: Entity, componentIds: number[], networkId: number): void {
	if (NetworkEntity.getOrNull(entity) !== null) return
	if (!myProfile?.networkId) return
	try {
		syncEntity(entity, componentIds, networkId)
	} catch (err) {
		console.error(`[PaintSync] syncEntity@${networkId} failed:`, err)
	}
}


// MARK: ensurePaintTileEntity

/**
 * Create (if needed) and sync a PaintTile entity for `tileKey`. The
 * in-memory buffer is allocated zero-filled so a never-written cell
 * reads as palette index 0 (unpainted) both locally and over the wire.
 */
export function ensurePaintTileEntity(tileKey: number): Entity {
	let e = tileEntities.get(tileKey)
	if (e === undefined) {
		e = engine.addEntity()
		const buf = new Array<number>(PAINT_CELLS_PER_TILE).fill(0)
		tileBuffers.set(tileKey, buf)
		PaintTile.create(e, { cells: buf.slice() })
		tileEntities.set(tileKey, e)
	}
	trySync(e, [PaintTile.componentId], tileNetworkId(tileKey))
	return e
}


// MARK: writeCellByte

/**
 * Write a packed palette byte for a specific cell into its owning tile
 * buffer. Marks the tile dirty on change so the next flushDirtyPaintTiles()
 * call broadcasts it. Returns true when the byte actually changed.
 *
 * Callers pass a packed cell key from paintGrid.packCellKey() — this
 * function handles the tile split and buffer alloc.
 */
export function writeCellByte(cellKey: number, byte: number): boolean {
	const { tileKey, localIdx } = splitCellKey(cellKey)
	ensurePaintTileEntity(tileKey)
	const buf = tileBuffers.get(tileKey)!
	const prev = buf[localIdx]
	if (prev === byte) return false
	// Maintain running painted-cell count without a full-buffer scan.
	if (prev === 0 && byte !== 0)      paintedBytes++
	else if (prev !== 0 && byte === 0) paintedBytes--
	buf[localIdx] = byte
	dirtyTiles.add(tileKey)
	return true
}


// MARK: flushDirtyPaintTiles

/**
 * Broadcast dirty tile buffers as PaintTile.createOrReplace writes.
 * Call once per server engine tick, after all applyPaint mutations for
 * the frame have run. Returns the count of tiles flushed.
 */
export function flushDirtyPaintTiles(): number {
	if (dirtyTiles.size === 0) return 0
	let flushed = 0
	for (const tileKey of dirtyTiles) {
		const entity = tileEntities.get(tileKey)
		const buf    = tileBuffers.get(tileKey)
		if (entity === undefined || buf === undefined) continue
		// Copy the buffer so any future in-place mutation does not silently
		// corrupt the CRDT payload the runtime is still serializing.
		PaintTile.createOrReplace(entity, { cells: buf.slice() })
		// Retry sync in case the entity was created before the network
		// profile was ready.
		trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
		flushed++
	}
	dirtyTiles.clear()
	return flushed
}


// MARK: zeroAllPaintTiles

/**
 * Wipe every tile buffer in place and mark every tile dirty so the next
 * flush publishes a clean slate. Palette entries are kept.
 *
 * dcl/place is a permanent canvas — this is intended only for admin
 * reset scripts, never called during normal operation.
 */
export function zeroAllPaintTiles(): void {
	for (const [tileKey, buf] of tileBuffers) {
		let changed = false
		for (let i = 0; i < buf.length; i++) {
			if (buf[i] !== 0) { buf[i] = 0; changed = true }
		}
		if (changed) dirtyTiles.add(tileKey)
	}
	paintedBytes = 0
}


// MARK: getPaletteEntity

export function getPaletteEntity(index: number): Entity | undefined {
	return paletteEntities.get(index)
}


// MARK: ensurePaletteEntity

/** Create (if needed) and sync a palette slot. */
export function ensurePaletteEntity(index: number): Entity {
	let e = paletteEntities.get(index)
	if (e === undefined) {
		e = engine.addEntity()
		PaletteEntry.create(e, { index, color: Color4.create(0, 0, 0, 0) })
		paletteEntities.set(index, e)
	}
	trySync(e, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + index)
	return e
}


// MARK: relinkPaintSync

/** Retry syncEntity for coverage + palette + tiles after profile ready. */
export function relinkPaintSync(): void {
	if (!initialized || paintCoverageEntity === null) return
	trySync(paintCoverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)
	for (const [index, entity] of paletteEntities) {
		trySync(entity, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + index)
	}
	for (const [tileKey, entity] of tileEntities) {
		trySync(entity, [PaintTile.componentId], tileNetworkId(tileKey))
	}
}


// MARK: initPaintSync

/** Create coverage + pre-bound palette entities. Call once from setupServer. */
export function initPaintSync(): void {
	if (initialized) return
	initialized = true

	const cap = paintGridCapacity()
	paintCoverageEntity = engine.addEntity()
	PaintCoverage.create(paintCoverageEntity, { red: 0, blue: 0, total: 0 })
	trySync(paintCoverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)

	const seedColors: Array<{ index: number; color: Color4 }> = [
		{ index: PALETTE_NONE, color: TEAM_COLORS[Team.None] },
		{ index: PALETTE_RED,  color: TEAM_COLORS[Team.Red] },
		{ index: PALETTE_BLUE, color: TEAM_COLORS[Team.Blue] },
	]

	const slots = Math.min(PREBOUND_PALETTE_SLOTS, MAX_PALETTE_INDEX + 1)
	for (let i = 0; i < slots; i++) {
		const e = engine.addEntity()
		const seeded = seedColors.find(s => s.index === i)
		PaletteEntry.create(e, {
			index: i,
			color: seeded ? seeded.color : Color4.create(0, 0, 0, 0),
		})
		paletteEntities.set(i, e)
		trySync(e, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + i)
	}

	console.log(
		`[PaintSync] grid ${cap.paintCellsPerTileAxis}×${cap.paintCellsPerTileAxis}/tile, ` +
		`tiles=${cap.tiles}, levels=${cap.levels}, capacity=${cap.cellCapacity}; ` +
		`PaintTile network base=${cap.tileNetBase}; ` +
		`PaletteEntry=${paletteEntities.size}; PaintCoverage@${COVERAGE_NETWORK_ID}; ` +
		`profileReady=${!!myProfile?.networkId}`
	)
}
