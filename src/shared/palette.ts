/**
 * palette.ts — 8-color dcl/place palette.
 *
 * Palette index layout (stable wire values):
 *   0        — unpainted (light grey background, distinct from palette white)
 *   1..8     — the 8 selectable r/place-inspired colors
 */

import { Color4 } from '@dcl/sdk/math'

/** Palette index 0 is always unpainted / grey background. */
export const PALETTE_NONE = 0

export const MAX_PALETTE_INDEX = 255


// -------- 8-color dcl/place palette --------
// Classic r/place-inspired palette, hex → Color4.
function hex(h: string): Color4 {
	const n = parseInt(h.replace('#', ''), 16)
	return Color4.create(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1)
}

/** 8 selectable colors — index in this array + 1 = palette index.
 *  Matches assets/images/pallete.png. */
export const PLACE_PALETTE: Color4[] = [
	hex('#6A99FC'), // 1  blue
	hex('#FF7577'), // 2  red
	hex('#FFD66A'), // 3  yellow
	hex('#7ED596'), // 4  green
	hex('#B794F4'), // 5  purple
	hex('#FFB26A'), // 6  orange
	hex('#FFFFFF'), // 7  white
	hex('#1A1A1A'), // 8  black
]

/** Total selectable colors (excludes PALETTE_NONE). */
export const PLACE_PALETTE_SIZE = PLACE_PALETTE.length


// -------- Unpainted-cell color --------
// Reserved at palette index 0. MUST be distinct from every entry in
// PLACE_PALETTE, or internColor() dedup on the server will alias the
// collision back to index 0 and the real palette slot will never get a
// valid PaletteEntry written to CRDT (visible bug: that color renders as
// black on clients). Light grey #EAEAEA reads as a clean blank canvas
// and stays clearly distinguishable from palette-white (#FFFFFF).
export const UNPAINTED_COLOR = Color4.create(0.918, 0.918, 0.918, 1) // #EAEAEA


/** Exact-match key for palette interning (component-wise float equality). */
export function colorKey(c: Color4): string {
	return `${c.r},${c.g},${c.b},${c.a}`
}


/** dcl/place: map a 1..PLACE_PALETTE_SIZE palette index to its Color4.
 *  Returns undefined if out of bounds. */
export function placeColor(paletteIndex: number): Color4 | undefined {
	if (paletteIndex < 1 || paletteIndex > PLACE_PALETTE_SIZE) return undefined
	return PLACE_PALETTE[paletteIndex - 1]
}
