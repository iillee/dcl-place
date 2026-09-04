/**
 * paintState.ts — authoritative paint map as sparse PaintCell CRDT + palette.
 *
 * Clients send cell ids via paintTick. Server interns the sender's team
 * Color4 into the palette, writes a Byte index into a per-cell PaintCell
 * component (created on first paint), and publishes coverage on
 * PaintCoverage. No room-message state sync.
 */

import { Color4 } from '@dcl/sdk/math'

import {
	PaletteEntry,
	PaintCoverage,
} from 'src/shared/components'
import { cellIdToKey } from 'src/shared/paintGrid'
import {
	colorKey,
	teamColor,
	teamPaletteIndex,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	MAX_PALETTE_INDEX,
	TEAM_COLORS,
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
import { Team } from 'src/shared/team'

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


// MARK: seedTeamPalette

/**
 * Seed palette indexes 0/1/2 for None/Red/Blue. Call once after initPaintSync
 * so CRDT PaletteEntry entities already exist. Indexes are deterministic.
 */
export function seedTeamPalette(): void {
	internColor(TEAM_COLORS[Team.None]) // → 0
	internColor(TEAM_COLORS[Team.Red])  // → 1
	internColor(TEAM_COLORS[Team.Blue]) // → 2
	if (colorToIndex.get(colorKey(TEAM_COLORS[Team.None])) !== PALETTE_NONE ||
		colorToIndex.get(colorKey(TEAM_COLORS[Team.Red]))  !== PALETTE_RED ||
		colorToIndex.get(colorKey(TEAM_COLORS[Team.Blue])) !== PALETTE_BLUE) {
		console.error('[PaintState] seedTeamPalette: reserved indexes mismatch')
	}
	publishCoverage()
	console.log('[PaintState] palette seeded: 0=None 1=Red 2=Blue')
}


// MARK: seedPlacePalette

/**
 * dcl/place: seed all 16 palette colors at their fixed indexes (1..16).
 * Call after seedTeamPalette so indexes 0/1/2 remain None/Red/Blue.
 * Idempotent — internColor returns existing index on exact match.
 */
export function seedPlacePalette(): void {
	for (let i = 0; i < PLACE_PALETTE.length; i++) {
		const idx = internColor(PLACE_PALETTE[i])
		const expected = i + 1
		if (idx !== expected) {
			console.error(`[PaintState] seedPlacePalette: color ${i} interned at ${idx}, expected ${expected}`)
		}
	}
	console.log(`[PaintState] place palette seeded: 16 colors at indexes 1..${PLACE_PALETTE_SIZE}`)
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


// MARK: applyPaint

/**
 * Apply a paint from a validated sender's team. Overwrites existing color.
 * Returns true only when the cell's palette index actually changed.
 */
export function applyPaint(id: string, team: number): boolean {
	const index = teamPaletteIndex(team as Team)
	internColor(teamColor(team as Team))

	const prev = cellIndex.get(id) ?? PALETTE_NONE
	if (prev === index) return false

	if (!writeCellIndex(id, index)) return false
	cellIndex.set(id, index)
	coverageDirty = true
	return true
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

/** Live coverage counters from the authoritative cell map. */
export function coverage(): { red: number; blue: number; total: number } {
	let red = 0, blue = 0
	for (const idx of cellIndex.values()) {
		if (idx === PALETTE_RED)       red++
		else if (idx === PALETTE_BLUE) blue++
	}
	return { red, blue, total: cellIndex.size }
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
