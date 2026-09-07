/**
 * messages.ts — shared WS message schema for dcl/place auth server.
 *
 * Registered from both client and server (identical schema). Returns a
 * single `room` handle via registerMessages().
 *
 * Message set: joinRoster, placePixel/cooldownAck, updateName,
 * requestLeaderboard, requestSnapshotPost, debugStorm.
 *
 * Paint *state* (cell indexes + palette + coverage) syncs exclusively via
 * CRDT components (PaintTile / PaletteEntry / PaintCoverage) — not via
 * room messages.
 */

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
	// Client → Server: sent once on client boot after PlayerIdentityData
	// is populated. Server logs the join and triggers a Discord notification.
	joinRoster: Schemas.Map({ userId: Schemas.String }),

	// Client → Server: send this player's display name once on join so
	// the leaderboard shows human-readable names instead of wallet hashes.
	// Server captures into its player-name directory and patches existing
	// leaderboard entries in place.
	updateName: Schemas.Map({ name: Schemas.String }),

	// Client → Server: request an immediate fresh copy of the leaderboard.
	// Fires when the player opens the popup mid-round so they see current
	// standings without waiting for the next periodic broadcast.
	requestLeaderboard: Schemas.Map({}),

	// Client → Server: place a single pixel.
	//   cellId       — `tx,tz,ty:col,row` (see shared/paintGrid.ts)
	//   paletteIndex — 1..PLACE_PALETTE_SIZE (see shared/palette.ts)
	// Server enforces PAINT_COOLDOWN_MS between accepted pixels per sender.
	placePixel: Schemas.Map({
		cellId:       Schemas.String,
		paletteIndex: Schemas.Int,
	}),

	// Server → Client (addressed to sender):
	// Broadcast the sender's next-allowed timestamp (ms since epoch, server
	// clock). Sent on every placePixel — accepted or rejected — so client
	// UI can render a truthful cooldown ring even if a request was rejected.
	cooldownAck: Schemas.Map({
		accepted:      Schemas.Boolean,
		nextAllowedAt: Schemas.Int64,
		serverNow:     Schemas.Int64,
	}),

	// Client → Server: request an on-demand Discord snapshot post of the
	// current canvas. Server rate-limits per-sender to prevent webhook spam;
	// no ack is sent (fire-and-forget).
	requestSnapshotPost: Schemas.Map({}),

	// Client → Server: paint-storm debug trigger. Server ignores unless the
	// DCL_PLACE_ALLOW_STORM EnvVar is set to "1" — production stays safe.
	// When enabled, server paints `target` random-color pixels across the
	// canvas, throttled to STORM_CELLS_PER_TICK per engine tick. mode="fill"
	// paints only currently-unpainted cells; mode="random" may overwrite
	// existing pixels; mode="clear" wipes the entire canvas.
	debugStorm: Schemas.Map({
		target: Schemas.Int,
		mode:   Schemas.String,
	}),
}

export const room = registerMessages(Messages)
