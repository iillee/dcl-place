/**
 * brush.ts — runtime state for the local player's paint brush size.
 *
 * The initial value comes from settings (PAINT_BRUSH_SIZE_CELLS) but the
 * player can grow / shrink the footprint at runtime via the +/- HUD
 * buttons. Sizes are always odd so the footprint stays centered on the
 * avatar.
 *
 * Server does not know or care about the brush size — the client just
 * emits more (or fewer) cell ids per paintTick.
 */

import { PAINT_BRUSH_SIZE_CELLS } from 'src/shared/settings'


/** Minimum footprint. 0 = painting disabled (brush cleared). */
export const BRUSH_MIN_CELLS = 0
/** Maximum footprint. Odd so it stays centered; 11 = 11x11 = 121 cells. */
export const BRUSH_MAX_CELLS = 11
/** Step between adjacent brush sizes. Odd-only progression: 1,3,5,7,9,11. */
export const BRUSH_STEP_CELLS = 2
/** Extruder-branch default brush footprint. 5x5 gives a satisfying
 *  plateau + taper mound without being overwhelming on load-in.
 *  Falls back to the shared settings value if this is set to 0. */
const EXTRUDER_DEFAULT_BRUSH_CELLS = 5


let currentBrushCells = clampOdd(EXTRUDER_DEFAULT_BRUSH_CELLS || PAINT_BRUSH_SIZE_CELLS)


// MARK: clampOdd
// Sizes are odd (1, 3, 5, …) so the footprint stays centred on the avatar.
// 0 is a special "brush off" value — preserved as-is instead of being
// rounded up to 1.
function clampOdd(n: number): number {
	const clamped = Math.max(BRUSH_MIN_CELLS, Math.min(BRUSH_MAX_CELLS, n))
	if (clamped === 0) return 0
	// Round even numbers DOWN to the nearest odd (2→1, 4→3, …) so that
	// stepping up from 0 produces the sequence 0 → 1 → 3 → 5 … without
	// skipping the single-cell brush.
	return clamped % 2 === 0 ? clamped - 1 : clamped
}


// MARK: getBrushCells
/**
 * Current local brush footprint as an odd cell count (e.g. 3 = 3x3).
 * Read every frame by the painting system.
 */
export function getBrushCells(): number {
	return currentBrushCells
}


// MARK: increaseBrush
/**
 * Grow the brush by one odd-step. No-op at max size.
 */
export function increaseBrush(): void {
	const next = clampOdd(currentBrushCells + BRUSH_STEP_CELLS)
	if (next === currentBrushCells) {
		console.log('Brush: increaseBrush: already at max', currentBrushCells)
		return
	}
	currentBrushCells = next
	console.log('Brush: increaseBrush: now', currentBrushCells)
}


// MARK: cycleBrushUp
/**
 * Grow the brush one odd-step, wrapping back to BRUSH_MIN_CELLS after
 * BRUSH_MAX_CELLS. Bound to the E key for single-hand size cycling up.
 */
export function cycleBrushUp(): void {
	if (currentBrushCells >= BRUSH_MAX_CELLS) {
		currentBrushCells = BRUSH_MIN_CELLS
		console.log('Brush: cycleBrushUp: wrapped to', currentBrushCells)
		return
	}
	currentBrushCells = clampOdd(currentBrushCells + BRUSH_STEP_CELLS)
	console.log('Brush: cycleBrushUp: now', currentBrushCells)
}


// MARK: cycleBrushDown
/**
 * Shrink the brush one odd-step. Clamps at BRUSH_MIN_CELLS (no wrap to
 * max). Bound to the F key.
 */
export function cycleBrushDown(): void {
	const next = clampOdd(currentBrushCells - BRUSH_STEP_CELLS)
	if (next === currentBrushCells) {
		console.log('Brush: cycleBrushDown: already at min', currentBrushCells)
		return
	}
	currentBrushCells = next
	console.log('Brush: cycleBrushDown: now', currentBrushCells)
}


// MARK: decreaseBrush
/**
 * Shrink the brush by one odd-step. No-op at min size.
 */
export function decreaseBrush(): void {
	const next = clampOdd(currentBrushCells - BRUSH_STEP_CELLS)
	if (next === currentBrushCells) {
		console.log('Brush: decreaseBrush: already at min', currentBrushCells)
		return
	}
	currentBrushCells = next
	console.log('Brush: decreaseBrush: now', currentBrushCells)
}
