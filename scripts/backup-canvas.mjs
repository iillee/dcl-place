#!/usr/bin/env node
/**
 * backup-canvas.mjs — pull the live canvas Storage blob(s) and write
 * clean, timestamped files to backups/.
 *
 * Usage:
 *   node scripts/backup-canvas.mjs           # backup main + prev
 *   node scripts/backup-canvas.mjs --prev    # only rollback preview key
 *
 * Files:
 *   backups/canvas-YYYYMMDDTHHMMSSZ.txt        (main state)
 *   backups/canvas-YYYYMMDDTHHMMSSZ.prev.txt   (previous generation)
 *
 * Restore: see scripts/restore-canvas.mjs (not written yet — just
 * `npx sdk-commands storage scene set "dcl-place:canvas:v1" --value "<blob>"`
 * then reboot the server).
 *
 * Recommended cadence: cron / Task Scheduler once an hour while the
 * canvas is active. Each backup is ~10 KB for a partially-painted board,
 * up to ~800 KB for a fully painted 320x320 canvas — pennies of disk.
 */

import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = resolve(ROOT, 'backups')

const KEY_MAIN = 'dcl-place:canvas:v1'
const KEY_PREV = 'dcl-place:canvas:v1:prev'

function ts() {
	const d = new Date()
	const pad = (n) => String(n).padStart(2, '0')
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}` +
	       `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/**
 * Run `sdk-commands storage scene get KEY`, parse the output, and
 * return the raw blob string (with surrounding quotes stripped).
 * Returns null when the key is unset / empty.
 */
function fetchKey(key) {
	const res = spawnSync('npx', ['sdk-commands', 'storage', 'scene', 'get', key], {
		cwd: ROOT,
		encoding: 'utf8',
		shell: process.platform === 'win32',
	})
	if (res.status !== 0) {
		console.error(`[backup] fetch ${key} failed:\n${res.stderr}`)
		return null
	}
	const marker = `Value for '${key}':`
	const idx = res.stdout.indexOf(marker)
	if (idx < 0) {
		console.error(`[backup] fetch ${key}: no value marker in output`)
		return null
	}
	// The value starts on the line after the marker. Grab from after the
	// marker to the first blank line / shutdown log line.
	let tail = res.stdout.slice(idx + marker.length).replace(/^\r?\n/, '')
	const stop = tail.search(/\r?\n\s*\d{4}-\d{2}-\d{2}T/)  // next ISO log line
	if (stop >= 0) tail = tail.slice(0, stop)
	tail = tail.trim()
	if (!tail || tail === '""' || tail === 'null' || tail === 'undefined') return null
	// Value is JSON-quoted string; strip surrounding quotes if present.
	if (tail.startsWith('"') && tail.endsWith('"')) tail = JSON.parse(tail)
	return tail
}

function saveBlob(path, blob, key) {
	if (!blob) {
		console.log(`[backup] ${key}: empty / unset — skipping file`)
		return
	}
	writeFileSync(path, blob)
	console.log(`[backup] ${key} -> ${path} (${blob.length} bytes)`)
}

// --- main ---
mkdirSync(OUT_DIR, { recursive: true })
const stamp = ts()
const onlyPrev = process.argv.includes('--prev')

if (!onlyPrev) {
	const main = fetchKey(KEY_MAIN)
	saveBlob(resolve(OUT_DIR, `canvas-${stamp}.txt`), main, KEY_MAIN)
}
const prev = fetchKey(KEY_PREV)
saveBlob(resolve(OUT_DIR, `canvas-${stamp}.prev.txt`), prev, KEY_PREV)

console.log('[backup] done.')
