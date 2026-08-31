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

/** 16 selectable colors — index in this array + 1 = palette index. */
export const PLACE_PALETTE: Color4[] = [
	hex('#E50000'), // 1  red
	hex('#0000EA'), // 2  blue
	hex('#FFFFFF'), // 3  white
	hex('#222222'), // 4  black
	hex('#888888'), // 5  grey
	hex('#E4E4E4'), // 6  light grey
	hex('#A06A42'), // 7  brown
	hex('#E59500'), // 8  orange
	hex('#E5D900'), // 9  yellow
	hex('#94E044'), // 10 lime
	hex('#02BE01'), // 11 green
	hex('#00D3DD'), // 12 cyan
	hex('#0083C7'), // 13 azure
	hex('#CF6EE4'), // 14 pink
	hex('#820080'), // 15 magenta
	hex('#FFA7D1'), // 16 rose
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
