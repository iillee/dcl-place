/**
 * paintSnapshot.ts — build a PNG snapshot of the current canvas state
 * directly from the CRDT (no camera / screenshot involved) and hand it
 * to the player's browser via openExternalUrl().
 *
 * dcl/place is square (20×20 tiles × 16 cells = 320×320 pixels), so
 * unlike the canvas project we don't rotate — image y=0 is NORTH
 * (world +Z max), image x=0 is WEST (world +X = 0). Matches the
 * top-down spectator camera view.
 *
 * Ported from dcl-canvas/src/client/paintSnapshot.ts.
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
const WORLD_W_CELLS = MAZE_GRID_WIDTH  * PAINT_CELLS_PER_TILE_AXIS  // 320
const WORLD_H_CELLS = MAZE_GRID_HEIGHT * PAINT_CELLS_PER_TILE_AXIS  // 320

export const SNAPSHOT_WIDTH_CELLS  = WORLD_W_CELLS
export const SNAPSHOT_HEIGHT_CELLS = WORLD_H_CELLS

/** Background color for unpainted cells (matches TEAM_COLORS[None] = #EAEAEA). */
const BG_COLOR: Color4 = Color4.create(0xEA / 255, 0xEA / 255, 0xEA / 255, 1)

/**
 * PNG pixels per paint cell. 2× → 640×640 PNG (~1.2MB uncompressed RGB
 * before deflate). Bump to 3–4 if we want a chunkier readable image.
 */
const PNG_PIXELS_PER_CELL = 2


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
 * Read every PaintCell CRDT component, resolve its (worldX, worldZ),
 * and stamp its palette color into a Color4 grid sized
 * SNAPSHOT_HEIGHT_CELLS × SNAPSHOT_WIDTH_CELLS.
 *
 * North-up orientation:
 *   image.x = worldX               (west→east)
 *   image.y = WORLD_H_CELLS - 1 - worldZ   (north→south)
 */
export function buildSnapshotPixels(): Color4[][] {
	const palette = readPalette()

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
		const imgX = worldX
		const imgY = (WORLD_H_CELLS - 1) - worldZ
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
 * upscaled to PNG_PIXELS_PER_CELL square pixels.
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
