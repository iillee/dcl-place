/**
 * snapshotDiscord.ts — server-side canvas snapshot poster.
 *
 * On a timer, if the canvas has changed since the last post, encode the
 * current paint state to PNG and POST it to a Discord webhook as a
 * multipart file upload. The channel becomes a permanent timelapse
 * archive — Discord keeps every attachment; a later ffmpeg pass turns
 * them into an mp4.
 *
 * Also exposes postSnapshotNow() for the client-triggered ⬇ button, with
 * a per-sender rate limit so a mash-happy player can't spam the channel.
 *
 * Webhook URL comes from EnvVar DISCORD_SNAPSHOT_WEBHOOK. Unset =
 * disabled silently (safe for local preview so we don't spam prod channel).
 *
 * NOTE on Discord CDN URLs: as of late 2023 attachment URLs are signed
 * and expire in ~24h. That doesn't affect the archive (message endures,
 * refetch via API gets fresh signed URL) but rules out using one URL as
 * a long-lived in-world texture. That's a separate feature — see DESIGN.md.
 */

import { EnvVar } from '@dcl/sdk/server'

import { parseCellId } from 'src/shared/paintGrid'
import {
	MAZE_GRID_WIDTH,
	MAZE_GRID_HEIGHT,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { bytesToBase64 as _b64, encodePngRgb } from 'src/shared/utils/pngEncoder'
void _b64
import {
	allPaintedCells,
	isSnapshotDirty,
	markSnapshotClean,
	paintedCellCount,
	paletteColorAt,
} from 'src/server/paintState'


// MARK: constants

/** Post at most once per this interval on the periodic timer. */
const AUTO_POST_INTERVAL_MS = 5 * 60 * 1000   // 5 min

/** Manual-post cooldown per sender (mash guard). */
const MANUAL_POST_MIN_GAP_MS = 60 * 1000       // 60s

/** Global floor between any two posts, auto or manual. */
const GLOBAL_MIN_GAP_MS      = 30 * 1000       // 30s

/** PNG pixels per paint cell. 2× → 640×640 output. */
const PNG_PIXELS_PER_CELL = 2

const W_CELLS = MAZE_GRID_WIDTH  * PAINT_CELLS_PER_TILE_AXIS
const H_CELLS = MAZE_GRID_HEIGHT * PAINT_CELLS_PER_TILE_AXIS

/** Unpainted-cell fill color (matches TEAM_COLORS[None] = #EAEAEA). */
const BG_R = 0xEA, BG_G = 0xEA, BG_B = 0xEA


// MARK: state

let webhookUrl = ''
let lastAutoPostAt   = 0
let lastAnyPostAt    = 0
const lastManualByUser = new Map<string, number>()


// MARK: initSnapshotDiscord

export async function initSnapshotDiscord(): Promise<void> {
	try {
		webhookUrl = (await EnvVar.get('DISCORD_SNAPSHOT_WEBHOOK')) || ''
	} catch (err) {
		webhookUrl = ''
		console.log(`[Snapshot] EnvVar.get failed (${err}) — snapshot posting disabled`)
	}
	if (webhookUrl) {
		console.log('[Snapshot] webhook loaded from env — auto-post every 5 min if dirty')
	} else {
		console.log('[Snapshot] no DISCORD_SNAPSHOT_WEBHOOK set — snapshot posting disabled')
	}
}


// MARK: snapshot tick

/**
 * Call once per second-ish from the server tick loop. Cheap when nothing
 * to do; only encodes+uploads when interval elapsed AND canvas changed.
 */
export function snapshotAutoTick(): void {
	if (!webhookUrl) return
	const now = Date.now()
	if (now - lastAutoPostAt < AUTO_POST_INTERVAL_MS) return
	if (!isSnapshotDirty()) return
	if (now - lastAnyPostAt < GLOBAL_MIN_GAP_MS) return
	lastAutoPostAt = now
	lastAnyPostAt  = now
	markSnapshotClean()
	void postSnapshot(`canvas snapshot -- ${paintedCellCount()} pixels painted`)
}


// MARK: postSnapshotNow

/**
 * Client-triggered post. Rate-limited per sender + globally. Returns
 * quietly on refusal — the client already dispatched an audio blip.
 */
export function postSnapshotNow(fromUserId: string): void {
	if (!webhookUrl) return
	const now = Date.now()
	if (now - lastAnyPostAt < GLOBAL_MIN_GAP_MS) {
		console.log(`[Snapshot] manual post from ${fromUserId} refused (global gap)`)
		return
	}
	const lastByUser = lastManualByUser.get(fromUserId) ?? 0
	if (now - lastByUser < MANUAL_POST_MIN_GAP_MS) {
		console.log(`[Snapshot] manual post from ${fromUserId} refused (per-user gap)`)
		return
	}
	lastManualByUser.set(fromUserId, now)
	lastAnyPostAt = now
	// Manual posts count as "we posted the latest state" so also clear
	// the auto-dirty flag and reset the auto timer.
	lastAutoPostAt = now
	markSnapshotClean()
	void postSnapshot(`on-demand snapshot (by \`${shortAddress(fromUserId)}\`) -- ${paintedCellCount()} pixels`)
}


// MARK: postSnapshot

async function postSnapshot(caption: string): Promise<void> {
	try {
		const png = encodeCanvasPng()
		const body = buildMultipart(caption, png)
		const res = await fetch(webhookUrl, {
			method:  'POST',
			headers: { 'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` },
			body:    body as any,
		})
		if (!res.ok) {
			console.log(`[Snapshot] webhook non-2xx: ${res.status} ${res.statusText}`)
			return
		}
		console.log(`[Snapshot] posted ${png.length} byte PNG (${W_CELLS * PNG_PIXELS_PER_CELL}px)`)
	} catch (err) {
		console.log(`[Snapshot] post failed: ${err}`)
	}
}


// MARK: encodeCanvasPng

/**
 * Rasterize server-side paint state into a PNG. Iterates cellIndex
 * (sparse) and stamps each painted cell into the RGB grid.
 *
 * North-up orientation:
 *   image.x = worldX               (west → east)
 *   image.y = H_CELLS - 1 - worldZ (north → south)
 */
function encodeCanvasPng(): Uint8Array {
	const scale   = PNG_PIXELS_PER_CELL
	const wPixels = W_CELLS * scale
	const hPixels = H_CELLS * scale
	const rgb     = new Uint8Array(wPixels * hPixels * 3)

	// Fill background.
	for (let i = 0; i < rgb.length; i += 3) {
		rgb[i]     = BG_R
		rgb[i + 1] = BG_G
		rgb[i + 2] = BG_B
	}

	let stamped = 0
	for (const [cellIdStr, paletteIndex] of allPaintedCells()) {
		const coord = parseCellId(cellIdStr)
		if (!coord) continue
		const worldX = coord.tx * PAINT_CELLS_PER_TILE_AXIS + coord.col
		const worldZ = coord.tz * PAINT_CELLS_PER_TILE_AXIS + coord.row
		if (worldX < 0 || worldX >= W_CELLS) continue
		if (worldZ < 0 || worldZ >= H_CELLS) continue
		const color = paletteColorAt(paletteIndex)
		if (!color) continue
		const r = Math.max(0, Math.min(255, Math.round(color.r * 255)))
		const g = Math.max(0, Math.min(255, Math.round(color.g * 255)))
		const b = Math.max(0, Math.min(255, Math.round(color.b * 255)))
		const imgX = worldX
		const imgY = (H_CELLS - 1) - worldZ
		for (let dy = 0; dy < scale; dy++) {
			const py = imgY * scale + dy
			let off = (py * wPixels + imgX * scale) * 3
			for (let dx = 0; dx < scale; dx++) {
				rgb[off++] = r
				rgb[off++] = g
				rgb[off++] = b
			}
		}
		stamped++
	}
	console.log(`[Snapshot] encoded ${stamped} cells → ${wPixels}×${hPixels} PNG`)
	return encodePngRgb(wPixels, hPixels, rgb)
}


// MARK: multipart body

const MULTIPART_BOUNDARY = '----dclplaceSnapshot' + Math.random().toString(36).slice(2, 10)

/**
 * Build a multipart/form-data body for Discord webhook file upload.
 * Two parts: JSON payload (caption + no mentions) + binary PNG file.
 * We assemble as Uint8Array so binary bytes survive intact (a string
 * body would corrupt the PNG on encode).
 */
function buildMultipart(caption: string, png: Uint8Array): Uint8Array {
	const payload = JSON.stringify({ content: caption, allowed_mentions: { parse: [] } })

	const preJson = asciiBytes(
		`--${MULTIPART_BOUNDARY}\r\n` +
		`Content-Disposition: form-data; name="payload_json"\r\n` +
		`Content-Type: application/json\r\n\r\n` +
		`${payload}\r\n`
	)
	const preFile = asciiBytes(
		`--${MULTIPART_BOUNDARY}\r\n` +
		`Content-Disposition: form-data; name="files[0]"; filename="canvas.png"\r\n` +
		`Content-Type: image/png\r\n\r\n`
	)
	const postFile = asciiBytes(`\r\n--${MULTIPART_BOUNDARY}--\r\n`)

	const total = preJson.length + preFile.length + png.length + postFile.length
	const out = new Uint8Array(total)
	let off = 0
	out.set(preJson,  off); off += preJson.length
	out.set(preFile,  off); off += preFile.length
	out.set(png,      off); off += png.length
	out.set(postFile, off)
	return out
}


// MARK: asciiBytes
/**
 * Encode a string as bytes. Callers keep captions ASCII-only so we can
 * skip a full UTF-8 encoder (TextEncoder is not available in the
 * sandboxed server runtime). Any non-ASCII char is coerced to '?'.
 */
function asciiBytes(s: string): Uint8Array {
	const out = new Uint8Array(s.length)
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		out[i] = c < 0x80 ? c : 0x3F  // '?'
	}
	return out
}


// MARK: shortAddress
function shortAddress(addr: string): string {
	if (addr.length <= 10) return addr
	return addr.slice(0, 6) + '…' + addr.slice(-4)
}
