/**
 * canvasStorage.ts — persist the eternal pixel canvas across server sleeps.
 *
 * The multiplayer server sleeps ~2 min after the last player leaves and
 * loses all in-memory state. This module snapshots `paintState`'s sparse
 * cell map into `@dcl/sdk/server` Storage and reloads it on next boot.
 *
 * Encoding (compact plain string, no JSON overhead):
 *   pair  := <cellKey_b36> ":" <paletteIndex_b36>
 *   blob  := pair ( "," pair )*
 *
 * Each pair is ~7–9 bytes for typical uint32 cell keys and 1-char base36
 * palette indexes (1..16 → "1".."g"). A 100k-cell canvas serializes to
 * roughly ~800 KB. Chunked storage lands with Day 8; single-blob is fine
 * for now.
 *
 * Contract:
 *   - loadCanvas() is called ONCE at boot, before any client connects.
 *   - saveCanvas() is called periodically by server.ts if isCanvasDirty().
 *   - Neither call ever throws; failure only logs.
 */

import { Storage } from '@dcl/sdk/server'

import { cellIdToKey, cellKeyToCellId } from 'src/shared/paintGrid'

import {
	allPaintedCells,
	hydratePaintCell,
	markCanvasClean,
	paintedCellCount,
} from 'src/server/paintState'


const STORAGE_KEY      = 'dcl-place:canvas:v1'
// One-generation rolling backup. Before overwriting the main key we copy
// the current value here — so if a bad flush corrupts main we still have
// the previous good state one command away:
//   npx sdk-commands storage scene get "dcl-place:canvas:v1:prev"
const STORAGE_KEY_PREV = 'dcl-place:canvas:v1:prev'


// MARK: loadCanvas

export async function loadCanvas(): Promise<void> {
	try {
		const raw = await Storage.get<string>(STORAGE_KEY)
		if (!raw || raw.length === 0) {
			console.log('[CanvasStorage] no persisted canvas — starting empty')
			return
		}

		let loaded = 0
		let skipped = 0
		// Manual parse — avoids allocating a giant intermediate array.
		let i = 0
		const n = raw.length
		while (i < n) {
			// Read key (base36) up to ':'
			const keyStart = i
			while (i < n && raw.charCodeAt(i) !== 58 /* : */) i++
			if (i >= n) { skipped++; break }
			const keyStr = raw.substring(keyStart, i)
			i++ // skip ':'
			// Read index up to ',' or end
			const idxStart = i
			while (i < n && raw.charCodeAt(i) !== 44 /* , */) i++
			const idxStr = raw.substring(idxStart, i)
			if (i < n) i++ // skip ','

			const key = parseInt(keyStr, 36)
			const idx = parseInt(idxStr, 36)
			if (!Number.isFinite(key) || !Number.isFinite(idx)) { skipped++; continue }

			const id = cellKeyToCellId(key)
			if (hydratePaintCell(id, idx)) loaded++
			else skipped++
		}

		console.log(`[CanvasStorage] hydrated ${loaded} cells (skipped ${skipped}), blob ${raw.length}B`)
	} catch (err) {
		console.log(`[CanvasStorage] load failed (${err}) — starting empty`)
	}
}


// MARK: saveCanvas

export async function saveCanvas(): Promise<void> {
	try {
		const parts: string[] = []
		for (const [id, idx] of allPaintedCells()) {
			const key = cellIdToKey(id)
			if (key === null) continue // ramp/edge indexes that don't pack — skip
			parts.push(`${key.toString(36)}:${idx.toString(36)}`)
		}
		const blob = parts.join(',')

		// Roll current main → prev before overwriting. Never fatal — if the
		// prev-copy fails we still save the new state (better one generation
		// than none). Only skipped if main has never been written yet.
		try {
			const current = await Storage.get<string>(STORAGE_KEY)
			if (current && current.length > 0) {
				const pOk = await Storage.set(STORAGE_KEY_PREV, current)
				if (!pOk) console.log('[CanvasStorage] prev-backup Storage.set returned false (non-fatal)')
			}
		} catch (err) {
			console.log(`[CanvasStorage] prev-backup failed (non-fatal): ${err}`)
		}

		const ok = await Storage.set(STORAGE_KEY, blob)
		if (!ok) {
			console.error(`[CanvasStorage] Storage.set returned false (${parts.length} cells, ${blob.length}B)`)
			return
		}
		markCanvasClean()
		console.log(`[CanvasStorage] persisted ${parts.length} cells (${blob.length}B, total in map=${paintedCellCount()})`)
	} catch (err) {
		console.log(`[CanvasStorage] save failed: ${err}`)
	}
}
