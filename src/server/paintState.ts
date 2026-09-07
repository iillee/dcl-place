/**
 * paintState.ts — authoritative paint map as chunked PaintTile CRDT + palette.
 *
 * Clients send placePixel { cellId, paletteIndex }. Server validates,
 * writes a Byte index into the containing tile's cells buffer, and
 * publishes coverage on PaintCoverage. No room-message state sync.
 */

import { Color4 } from '@dcl/sdk/math'

import {
	PaletteEntry,
	PaintCoverage,
} from 'src/shared/components'
import { cellIdToKey } from 'src/shared/paintGrid'
import {
	colorKey,
	UNPAINTED_COLOR,
	PALETTE_NONE,
	MAX_PALETTE_INDEX,
	PLACE_PALETTE,
	PLACE_PALETTE_SIZE,
	placeColor,
} from 'src/shared/palette'
import {
	ensurePaletteEntity,
	getPaintCoverageEntity,
	writeCellByte,
	zeroAllPaintTiles,
	paintedCellCount as tilePaintedCellCount,
} from 'src/shared/paintSync'

import { noteComponentChange } from 'src/server/serverStats'

// colorKey → palette index
const colorToIndex = new Map<string, number>()
// index → Color4
const indexToColor: Color4[] = []
let nextPaletteIndex = 0

// cellId → palette index (authoritative). 0 = unpainted.
const cellIndex = new Map<string, number>()

// Coverage dirty flag — coalesced into PaintCoverage at 5 Hz by server.ts.
let coverageDirty = false

// Canvas dirty flag — tripped by any accepted paint, cleared after Storage flush.
let canvasDirty = false
// Separate dirty flag consumed by the Discord snapshot poster. Set by the
// same code paths that mark canvasDirty, but cleared independently after
// each Discord post (canvasStorage.saveCanvas clears canvasDirty on its
// own 30s schedule and would otherwise steal the signal).
let snapshotDirty = false


// MARK: seedPlacePalette

/**
 * Seed the palette CRDT: index 0 = unpainted grey, indexes 1..N = the
 * PLACE_PALETTE colors. Call once after initPaintSync so PaletteEntry
 * entities already exist. Idempotent — internColor returns the existing
 * index on exact match.
 */
export function seedPlacePalette(): void {
	internColor(UNPAINTED_COLOR) // → 0
	if (colorToIndex.get(colorKey(UNPAINTED_COLOR)) !== PALETTE_NONE) {
		console.error('[PaintState] seedPlacePalette: PALETTE_NONE slot mismatch')
	}
	for (let i = 0; i < PLACE_PALETTE.length; i++) {
		const idx = internColor(PLACE_PALETTE[i])
		const expected = i + 1
		if (idx !== expected) {
			console.error(`[PaintState] seedPlacePalette: color ${i} interned at ${idx}, expected ${expected}`)
		}
	}
	publishCoverage()
	console.log(`[PaintState] palette seeded: index 0 = unpainted, 1..${PLACE_PALETTE_SIZE} = PLACE_PALETTE`)
}


// MARK: applyPaintIndex

/**
 * dcl/place: paint a cell with a specific palette index (0..PLACE_PALETTE_SIZE).
 * Index 0 erases the cell back to unpainted. Overwrites whatever was there.
 * Returns true only when the cell actually changed.
 */
export function applyPaintIndex(id: string, paletteIndex: number): boolean {
	if (paletteIndex < 0 || paletteIndex > PLACE_PALETTE_SIZE) return false
	const prev = cellIndex.get(id) ?? PALETTE_NONE
	if (prev === paletteIndex) return false
	if (!writeCellIndex(id, paletteIndex)) return false
	if (paletteIndex === PALETTE_NONE) cellIndex.delete(id)
	else                                cellIndex.set(id, paletteIndex)
	coverageDirty = true
	canvasDirty   = true
	snapshotDirty = true
	return true
}


// MARK: hydratePaintCell

/**
 * Load-time restore: write a persisted (cellId, paletteIndex) pair into
 * the authoritative map + CRDT without tripping the canvas dirty flag.
 * Used by canvasStorage.loadCanvas() on server boot. Skips invalid ids
 * (bad tile coords, out-of-range palette) silently.
 */
export function hydratePaintCell(id: string, paletteIndex: number): boolean {
	if (paletteIndex < 1 || paletteIndex > PLACE_PALETTE_SIZE) return false
	if (!writeCellIndex(id, paletteIndex)) return false
	cellIndex.set(id, paletteIndex)
	coverageDirty = true // covered cells changed → republish
	return true
}


// MARK: allPaintedCells

/** Iterate every painted cell as (cellId, paletteIndex). Used by canvasStorage. */
export function* allPaintedCells(): IterableIterator<[string, number]> {
	for (const entry of cellIndex) yield entry
}


// MARK: canvas dirty flag

export function isCanvasDirty(): boolean { return canvasDirty }
export function markCanvasClean(): void { canvasDirty = false }
export function isSnapshotDirty(): boolean { return snapshotDirty }
export function markSnapshotClean(): void { snapshotDirty = false }
export function paintedCellCount(): number { return cellIndex.size }

/** Number of non-zero bytes actually resident in tile buffers. Should
 *  match paintedCellCount() in normal operation; divergence indicates a
 *  writeCellByte failure (e.g. unpackable cell id). Telemetry only. */
export function tileBufferPaintedCount(): number { return tilePaintedCellCount() }

/** Palette color lookup (index → Color4). Undefined if slot unused. */
export function paletteColorAt(index: number): Color4 | undefined {
	return indexToColor[index]
}


// MARK: internColor

/**
 * Intern a Color4 into the server palette. Returns the existing index on
 * exact match; otherwise assigns the next free index and writes PaletteEntry
 * BEFORE any cell may reference it.
 */
export function internColor(color: Color4): number {
	const key = colorKey(color)
	const existing = colorToIndex.get(key)
	if (existing !== undefined) return existing

	if (nextPaletteIndex > MAX_PALETTE_INDEX) {
		console.error('[PaintState] internColor: palette full — returning PALETTE_NONE')
		return PALETTE_NONE
	}

	const index = nextPaletteIndex++
	colorToIndex.set(key, index)
	indexToColor[index] = color

	const entity = ensurePaletteEntity(index)
	PaletteEntry.createOrReplace(entity, { index, color })
	return index
}


// MARK: writeCellIndex

function writeCellIndex(id: string, index: number): boolean {
	const key = cellIdToKey(id)
	if (key === null) {
		// Invalid brush edge / ramp index — drop quietly (client also filters).
		return false
	}
	// PaintTile chunked write: mutates the per-tile byte buffer in place
	// and marks the tile dirty. The actual CRDT broadcast happens once per
	// tick from flushDirtyPaintTiles() in server.ts.
	const changed = writeCellByte(key, index)
	if (changed) noteComponentChange(1)
	return true
}


// MARK: isCoverageDirty

/** True when coverage CRDT should be republished. */
export function isCoverageDirty(): boolean {
	return coverageDirty
}


// MARK: coverage

/** Live coverage counters. red/blue kept in the shape for CRDT schema
 *  stability but always 0 in dcl/place (teamless canvas). */
export function coverage(): { red: number; blue: number; total: number } {
	return { red: 0, blue: 0, total: cellIndex.size }
}


// MARK: publishCoverage

/** Write PaintCoverage CRDT and clear the dirty flag. */
export function publishCoverage(): void {
	const entity = getPaintCoverageEntity()
	if (entity === null) {
		console.error('[PaintState] publishCoverage: PaintCoverage entity not initialized')
		return
	}
	const c = coverage()
	PaintCoverage.createOrReplace(entity, {
		red:   c.red,
		blue:  c.blue,
		total: c.total,
	})
	coverageDirty = false
}


// MARK: clearAll

/**
 * Admin-only reset: zero every tile buffer and clear the cell map.
 * Palette entries are kept (stable indexes across resets).
 *
 * dcl/place is a permanent canvas — this is never called during normal
 * operation. Kept for parity with the legacy team-based codebase and for
 * any future admin tooling.
 */
export function clearAll(): void {
	const n = cellIndex.size
	cellIndex.clear()
	// zeroAllPaintTiles wipes the per-tile buffers and marks them dirty.
	zeroAllPaintTiles()
	if (n > 0) noteComponentChange(n)
	coverageDirty = true
	publishCoverage()
}
