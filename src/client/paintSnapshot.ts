/**
 * paintSnapshot.ts \u2014 build a "clean" pixel snapshot of the current paint
 * state directly from the CRDT (no camera / screenshot involved).
 *
 * Two outputs:
 *   1. buildSnapshotPixels() \u2014 a Color4 grid the overlay UI renders as a
 *      colored-cell mosaic.
 *   2. snapshotDataUrl() \u2014 the same grid, upscaled and encoded as an
 *      uncompressed PNG in a `data:image/png;base64,...` URL. Pass this to
 *      openExternalUrl() so the player's browser opens it and they can
 *      right-click / long-press to save.
 */

import { engine, NetworkEntity } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'

import { PaintCell, PaletteEntry } from 'src/shared/components'
import { cellKeyFromNetworkId, unpackCellKey } from 'src/shared/paintGrid'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { bytesToBase64, encodePngRgb } from 'src/shared/utils/pngEncoder'


// MARK: constants

// The walkable grid is 4 tiles wide (X, west→east) x 7 tiles tall
// (Z, south→north). The exported / previewed image is rotated 90° clockwise
// so it reads LANDSCAPE and matches what the spectator top-down camera
// shows (world +X at screen top, world +Z at screen right).
const WORLD_W_CELLS = MAZE_GRID_WIDTH  * PAINT_CELLS_PER_TILE_AXIS  // 64
const WORLD_H_CELLS = MAZE_GRID_HEIGHT * PAINT_CELLS_PER_TILE_AXIS  // 112

/** Snapshot image dimensions in cells (after 90° rotation — landscape). */
export const SNAPSHOT_WIDTH_CELLS  = WORLD_H_CELLS
export const SNAPSHOT_HEIGHT_CELLS = WORLD_W_CELLS

/** Background for unpainted / non-walkable cells in the exported image. */
const BG_COLOR: Color4 = Color4.create(1, 1, 1, 1)

/** How many PNG pixels per paint cell in the downloadable image. */
const PNG_PIXELS_PER_CELL = 4


// MARK: readPalette
function readPalette(): Map<number, Color4> {
	const out = new Map<number, Color4>()
	for (const [, entry] of engine.getEntitiesWith(PaletteEntry)) {
		out.set(entry.index, Color4.create(entry.color.r, entry.color.g, entry.color.b, entry.color.a))
	}
	return out
}


// MARK: buildSnapshotPixels
/**
 * Read every PaintCell CRDT component, map the packed cell key back to
 * (tileX, tileZ, col, row), and stamp its palette color into a global
 * Color4 grid sized SNAPSHOT_WIDTH_CELLS x SNAPSHOT_HEIGHT_CELLS.
 *
 * Unpainted / never-touched cells default to BG_COLOR.
 */
export function buildSnapshotPixels(): Color4[][] {
	const palette = readPalette()

	// Row-major: pixels[y][x], sized SNAPSHOT_HEIGHT_CELLS x SNAPSHOT_WIDTH_CELLS.
	// Rotation mapping (90° CW from world to image):
	//   image.x = world.z   (Z goes left→right on the image)
	//   image.y = WORLD_W_CELLS - 1 - world.x   (X goes bottom→top on the image)
	const pixels: Color4[][] = new Array(SNAPSHOT_HEIGHT_CELLS)
	for (let y = 0; y < SNAPSHOT_HEIGHT_CELLS; y++) {
		const row = new Array<Color4>(SNAPSHOT_WIDTH_CELLS)
		for (let x = 0; x < SNAPSHOT_WIDTH_CELLS; x++) row[x] = BG_COLOR
		pixels[y] = row
	}

	let painted = 0
	for (const [entity, cell] of engine.getEntitiesWith(PaintCell)) {
		const net = NetworkEntity.getOrNull(entity)
		if (!net) continue
		const key = cellKeyFromNetworkId(Number(net.entityId))
		if (key === null) continue
		const { tx, tz, col, row } = unpackCellKey(key)
		const worldX = tx * PAINT_CELLS_PER_TILE_AXIS + col
		const worldZ = tz * PAINT_CELLS_PER_TILE_AXIS + row
		if (worldX < 0 || worldX >= WORLD_W_CELLS) continue
		if (worldZ < 0 || worldZ >= WORLD_H_CELLS) continue
		const imgX = worldZ
		const imgY = (WORLD_W_CELLS - 1) - worldX
		const color = palette.get(cell.index)
		if (!color) continue
		pixels[imgY][imgX] = color
		painted++
	}
	console.log(`[Snapshot] buildSnapshotPixels: ${painted} painted cells / ${SNAPSHOT_WIDTH_CELLS}x${SNAPSHOT_HEIGHT_CELLS} grid`)
	return pixels
}


// MARK: snapshotDataUrl
/**
 * Encode the current paint state as a PNG data URL. Each paint cell is
 * upscaled to PNG_PIXELS_PER_CELL square pixels so the resulting image
 * is easier to view / save at a usable size.
 *
 * Rows are flipped so the exported image is north-up (matches the
 * top-down spectator camera view).
 */
export function snapshotDataUrl(): string {
	const cells   = buildSnapshotPixels()
	const scale   = PNG_PIXELS_PER_CELL
	const wPixels = SNAPSHOT_WIDTH_CELLS  * scale
	const hPixels = SNAPSHOT_HEIGHT_CELLS * scale
	const rgb     = new Uint8Array(wPixels * hPixels * 3)

	for (let cy = 0; cy < SNAPSHOT_HEIGHT_CELLS; cy++) {
		const srcRow = cells[cy]
		for (let cx = 0; cx < SNAPSHOT_WIDTH_CELLS; cx++) {
			const c = srcRow[cx]
			const r = Math.max(0, Math.min(255, Math.round(c.r * 255)))
			const g = Math.max(0, Math.min(255, Math.round(c.g * 255)))
			const b = Math.max(0, Math.min(255, Math.round(c.b * 255)))
			// Fill scale x scale block in the output image.
			for (let dy = 0; dy < scale; dy++) {
				const py = cy * scale + dy
				let off = (py * wPixels + cx * scale) * 3
				for (let dx = 0; dx < scale; dx++) {
					rgb[off++] = r
					rgb[off++] = g
					rgb[off++] = b
				}
			}
		}
	}

	const png = encodePngRgb(wPixels, hPixels, rgb)
	const b64 = bytesToBase64(png)
	console.log(`[Snapshot] snapshotDataUrl: ${wPixels}x${hPixels} PNG, ${png.length} bytes (b64 ${b64.length} chars)`)
	return `data:image/png;base64,${b64}`
}
