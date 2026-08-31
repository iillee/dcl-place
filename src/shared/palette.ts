/**
 * palette.ts — 16-color r/place palette + Team compat shims.
 *
 * Palette index layout (stable wire values):
 *   0        — unpainted / none (white background)
 *   1..16    — the 16 selectable r/place colors
 *   1        — RED (also aliased to Team.Red for legacy call sites)
 *   2        — BLUE (also aliased to Team.Blue for legacy call sites)
 *
 * Everything above index 2 is dcl/place-only and never referenced by
 * team-based helpers.
 */

import { Color4 } from '@dcl/sdk/math'

import { Team } from './team'

/** Palette index 0 is always unpainted / white. */
export const PALETTE_NONE = 0

/** Reserved to keep Team.Red / Team.Blue call sites compiling. */
export const PALETTE_RED  = 1
export const PALETTE_BLUE = 2

export const MAX_PALETTE_INDEX = 255


// -------- 16-color dcl/place palette --------
// Classic r/place-inspired palette, hex → Color4.
// The first entry (index 1) is red so PALETTE_RED semantics still line up.
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


// -------- Team compat shims --------
// Preserved so paintState.ts / paintSync.ts / server.ts keep compiling
// while we migrate. Only indexes 0/1/2 are meaningful here.

export const TEAM_COLORS: Record<Team, Color4> = {
	[Team.None]: Color4.create(1, 1, 1, 1),
	[Team.Red]:  PLACE_PALETTE[0], // palette index 1
	[Team.Blue]: PLACE_PALETTE[1], // palette index 2
}


/** Exact-match key for palette interning (component-wise float equality). */
export function colorKey(c: Color4): string {
	return `${c.r},${c.g},${c.b},${c.a}`
}


/** Map a Team enum to its Color4. */
export function teamColor(team: Team): Color4 {
	return TEAM_COLORS[team] ?? TEAM_COLORS[Team.None]
}


/** Map Team → reserved palette index (valid after seedTeamPalette). */
export function teamPaletteIndex(team: Team): number {
	if (team === Team.Red)  return PALETTE_RED
	if (team === Team.Blue) return PALETTE_BLUE
	return PALETTE_NONE
}


/** dcl/place: map a 1..16 palette index to its Color4. Returns undefined if OOB. */
export function placeColor(paletteIndex: number): Color4 | undefined {
	if (paletteIndex < 1 || paletteIndex > PLACE_PALETTE_SIZE) return undefined
	return PLACE_PALETTE[paletteIndex - 1]
}
