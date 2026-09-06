/**
 * components.ts — shared ECS component definitions.
 *
 * MUST be statically imported from src/index.ts so defineComponent() runs
 * before main() seals the engine.
 *
 * Schemas are shared. Server-owned entities (LeaderboardState, PaintCoverage,
 * PaletteEntry, PaintTile) are created + syncEntity'd only on the server.
 * Clients observe replicas — they must not syncEntity those.
 *
 * SeedHolder remains client-authored until seed ownership moves server-side.
 */

import { engine, Schemas } from '@dcl/sdk/ecs'

// MARK: LeaderboardState
export const LeaderboardState = engine.defineComponent('leaderboard::state', { json: Schemas.String })

// MARK: PaintTile
// One CRDT entity per (tx, tz, level) tile carrying a packed byte-array
// of every cell inside that tile. Replaces the previous 1-entity-per-
// painted-cell design that overwhelmed the CRDT transport once painted
// coverage exceeded a few hundred cells. Ported from dcl-snowdrift.
//
// cells[localIdx] byte layout for dcl/place:
//   full byte = palette index (0..MAX_PALETTE_INDEX). 0 = unpainted.
// Local cell ordinal is `row * PAINT_SIZE + col`, matching
// paintGrid.splitCellKey()'s intra-tile position.
export const PaintTile = engine.defineComponent('paint::tile', {
	cells: Schemas.Array(Schemas.Byte),
})

// MARK: PaletteEntry
export const PaletteEntry = engine.defineComponent('paint::palette-entry', {
	index: Schemas.Byte,
	color: Schemas.Color4,
})

// MARK: PaintCoverage
export const PaintCoverage = engine.defineComponent('paint::coverage', {
	red:   Schemas.Int,
	blue:  Schemas.Int,
	total: Schemas.Int,
})

// MARK: ServerStats
// Rate-limited debug snapshot. Server writes at SERVER_STATS_PUBLISH_HZ;
// clients only read. Not used for gameplay.
export const ServerStats = engine.defineComponent('server::stats', {
	tiles:             Schemas.Int,
	paintResolution:   Schemas.Int,
	activeComponents:  Schemas.Int,
	maxComponents:     Schemas.Int,
	paintedCells:      Schemas.Int,
	totalChanges:      Schemas.Int,
	changesLast1s:     Schemas.Int,
	changesLast10s:    Schemas.Int,
	changesLast60s:    Schemas.Int,
})
