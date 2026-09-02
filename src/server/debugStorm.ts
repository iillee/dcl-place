/**
 * debugStorm.ts \u2014 paint-storm harness for stress-testing the chunked
 * PaintTile CRDT rollout at 25k / 50k / 100k saturation.
 *
 * Not part of gameplay. Only fires when EnvVar DCL_PLACE_ALLOW_STORM=="1".
 * Set it via:
 *   npx sdk-commands storage env set DCL_PLACE_ALLOW_STORM --value "1"
 * Unset in production before public playtests:
 *   npx sdk-commands storage env delete DCL_PLACE_ALLOW_STORM
 *
 * Design:
 *   - Clients send debugStorm { target, mode } (mode = "fill" | "random" | "clear")
 *   - Server enqueues cell writes in a plan and paints STORM_CELLS_PER_TICK
 *     per engine tick until done. That amortizes the work across ticks so
 *     the flush loop / cooldown checks / other systems still get frame time.
 *   - Every burst counts against the same paintedCellCount metric the perf
 *     HUD reads, so we can watch the numbers climb live.
 *   - Logs [Storm] progress every 5k cells and a final wall-clock summary
 *     so we can plot "seconds to reach 100k" against build tweaks.
 */

import { engine } from '@dcl/sdk/ecs'
import { EnvVar } from '@dcl/sdk/server'

import { PLACE_PALETTE_SIZE } from 'src/shared/palette'
import {
	PAINT_GRID_W,
	PAINT_GRID_H,
	PAINT_SIZE,
	PAINT_MAX_LEVEL,
} from 'src/shared/paintGrid'

import {
	applyPaintIndex,
	clearAll,
	paintedCellCount,
} from 'src/server/paintState'


// MARK: Tuning

/** Cells painted per engine tick while a storm is active. Higher = faster
 *  storm at the cost of tick time. 500 keeps a single tick under ~10ms on
 *  the multiplayer server. Tune only if measurements suggest we can push it. */
const STORM_CELLS_PER_TICK = 500

/** Log progress every N painted cells. */
const STORM_LOG_STRIDE     = 5000


// MARK: Module state

let allowStorm = false            // resolved from EnvVar on init
let plan: string[] = []           // remaining cellIds to paint (LIFO for pop())
let stormStartMs   = 0
let stormPainted   = 0
let stormTarget    = 0
let stormMode: 'fill' | 'random' | 'clear' | null = null
let nextLogAt      = 0


// MARK: initDebugStorm

export async function initDebugStorm(): Promise<void> {
	try {
		const v = await EnvVar.get('DCL_PLACE_ALLOW_STORM')
		allowStorm = v === '1'
	} catch {
		allowStorm = false
	}
	console.log(`[Storm] init: allowStorm=${allowStorm}`)
}


// MARK: isStormAllowed

export function isStormAllowed(): boolean { return allowStorm }


// MARK: handleDebugStorm

/**
 * Room-message handler. Enqueues a storm plan or triggers a clear.
 * Silently ignores when EnvVar gate is off, so a stray production client
 * with the hotkey wired can never fire this.
 */
export function handleDebugStorm(target: number, mode: string): void {
	if (!allowStorm) {
		console.log(`[Storm] rejected \u2014 DCL_PLACE_ALLOW_STORM not set`)
		return
	}
	if (mode === 'clear') {
		const n = paintedCellCount()
		clearAll()
		console.log(`[Storm] cleared canvas (was ${n} painted cells)`)
		return
	}
	if (mode !== 'fill' && mode !== 'random') {
		console.log(`[Storm] rejected unknown mode="${mode}"`)
		return
	}
	if (!Number.isFinite(target) || target <= 0) {
		console.log(`[Storm] rejected bad target=${target}`)
		return
	}
	if (plan.length > 0) {
		console.log(`[Storm] busy \u2014 ${plan.length} cells still in queue, ignoring new request`)
		return
	}

	plan          = buildPlan(mode, target)
	stormStartMs  = Date.now()
	stormPainted  = 0
	stormTarget   = plan.length
	stormMode     = mode
	nextLogAt     = STORM_LOG_STRIDE
	console.log(`[Storm] START mode=${mode} target=${target} planned=${plan.length} startPainted=${paintedCellCount()}`)
}


// MARK: buildPlan

/**
 * Generate a list of cellIds to paint. For "fill" mode we walk the grid in
 * scanline order and skip currently-painted cells (checked lazily during
 * the paint loop \u2014 buildPlan can't tell without a full scan). For "random"
 * we just emit `target` random cell picks; duplicates are fine (they'll
 * short-circuit in applyPaintIndex when the color already matches).
 *
 * Level is always 0 (dcl/place is flat \u2014 MAZE_MAX_STACK_Y_METERS = 0),
 * so we skip PAINT_MAX_LEVEL and only enumerate ground-level cells.
 */
function buildPlan(mode: 'fill' | 'random', target: number): string[] {
	void PAINT_MAX_LEVEL  // reserved for future stacked-canvas support
	const out: string[] = []
	if (mode === 'fill') {
		// Scanline the whole ground plane, cap at target.
		for (let tz = 0; tz < PAINT_GRID_H && out.length < target; tz++) {
			for (let tx = 0; tx < PAINT_GRID_W && out.length < target; tx++) {
				for (let row = 0; row < PAINT_SIZE && out.length < target; row++) {
					for (let col = 0; col < PAINT_SIZE && out.length < target; col++) {
						out.push(`${tx},${tz},0:${col},${row}`)
					}
				}
			}
		}
	} else {
		// Random cells across the canvas.
		for (let i = 0; i < target; i++) {
			const tx  = Math.floor(Math.random() * PAINT_GRID_W)
			const tz  = Math.floor(Math.random() * PAINT_GRID_H)
			const col = Math.floor(Math.random() * PAINT_SIZE)
			const row = Math.floor(Math.random() * PAINT_SIZE)
			out.push(`${tx},${tz},0:${col},${row}`)
		}
	}
	return out
}


// MARK: startDebugStormTick

/**
 * Install the per-tick worker that drains the plan. Idempotent \u2014 safe
 * to call once from setupServer(). Cheap when idle (plan.length === 0).
 */
export function startDebugStormTick(): void {
	engine.addSystem(() => {
		if (plan.length === 0) return

		let painted = 0
		while (painted < STORM_CELLS_PER_TICK && plan.length > 0) {
			const id  = plan.pop()!
			const idx = 1 + Math.floor(Math.random() * PLACE_PALETTE_SIZE)  // 1..PLACE_PALETTE_SIZE
			if (applyPaintIndex(id, idx)) painted++
			// Cells that fail (unpackable id) don't count against painted;
			// they're dropped silently and the loop moves on.
		}
		stormPainted += painted

		if (stormPainted >= nextLogAt) {
			const elapsedMs = Date.now() - stormStartMs
			const rate      = elapsedMs > 0 ? (stormPainted / (elapsedMs / 1000)).toFixed(0) : '?'
			console.log(
				`[Storm] progress: ${stormPainted}/${stormTarget} painted ` +
				`(${elapsedMs}ms, ~${rate}/s, canvas total ${paintedCellCount()})`
			)
			nextLogAt = Math.min(stormTarget, nextLogAt + STORM_LOG_STRIDE)
		}

		if (plan.length === 0) {
			const totalMs = Date.now() - stormStartMs
			const rate    = totalMs > 0 ? (stormPainted / (totalMs / 1000)).toFixed(0) : '?'
			console.log(
				`[Storm] DONE mode=${stormMode} painted=${stormPainted}/${stormTarget} ` +
				`in ${totalMs}ms (~${rate}/s), canvas now ${paintedCellCount()} cells`
			)
			stormPainted = 0
			stormTarget  = 0
			stormMode    = null
		}
	})
}
