/**
 * server.ts — dcl/place authoritative server entry point.
 *
 * Runs headless in the SDK Multiplayer Server (hammurabi). No 3D, no
 * ~system/RestrictedActions. Owns:
 *   - the 16-color palette (seeded once at boot)
 *   - the eternal pixel canvas (sparse PaintCell CRDT + palette index)
 *   - per-player cooldown timestamps (in-memory, resets on server restart)
 *   - the top-100 leaderboard (persisted via Storage, deferred to later day)
 *
 * v1 does NOT persist the canvas — that's the Day 8 milestone. When the
 * server sleeps (~2 min after last player leaves) the paint state resets.
 * Good enough for playtesting; permanence lands with chunked Storage.
 */

import { engine } from '@dcl/sdk/ecs'
import { myProfile } from '@dcl/sdk/network'

import { room } from 'src/shared/messages'
import { paintGridCapacity } from 'src/shared/paintGrid'
import { initPaintSync, paintCellEntityCount, relinkPaintSync } from 'src/shared/paintSync'
import {
	PAINT_COOLDOWN_MS,
	PAINT_TICK_MAX_CELLS,
	PAINT_COVERAGE_PUBLISH_HZ,
	MAZE_GRID_WIDTH,
	MAZE_GRID_HEIGHT,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { PLACE_PALETTE_SIZE } from 'src/shared/palette'
import { Team } from 'src/shared/team'

import { initDiscord, bindNameResolver, schedulePlayerJoin, flushPendingJoins } from 'src/server/discord'
import {
	loadFromStorage as loadLeaderboard,
	saveToStorage as saveLeaderboard,
	incrementPaint as leaderboardIncrement,
	updateName as leaderboardUpdateName,
	publish as publishLeaderboard,
	getName as leaderboardGetName,
} from 'src/server/leaderboard'
import {
	applyPaint,
	applyPaintIndex,
	coverage,
	seedTeamPalette,
	seedPlacePalette,
	isCoverageDirty,
	publishCoverage,
} from 'src/server/paintState'
import { initServerStats, startServerStatsTick } from 'src/server/serverStats'

const HEARTBEAT_INTERVAL_S = 5
const PAINT_SUMMARY_INTERVAL_S = 5

// Per-player cooldown: address → next-allowed timestamp (ms since epoch).
// In-memory only; resets on server restart, which is fine (a restart already
// implies the scene has been empty for ~2 min, longer than any cooldown).
const nextAllowedAt = new Map<string, number>()


// MARK: seedStartingArea

/**
 * Paint a small marker square at the center of the canvas so first-load
 * visitors immediately see something. Uses palette index 1 (red).
 */
function seedStartingArea(): void {
	const cx = Math.floor((MAZE_GRID_WIDTH  * PAINT_CELLS_PER_TILE_AXIS) / 2)
	const cz = Math.floor((MAZE_GRID_HEIGHT * PAINT_CELLS_PER_TILE_AXIS) / 2)
	const R = 8
	let painted = 0
	for (let dz = -R; dz < R; dz++) {
		for (let dx = -R; dx < R; dx++) {
			const gx = cx + dx
			const gz = cz + dz
			const tx = Math.floor(gx / PAINT_CELLS_PER_TILE_AXIS)
			const tz = Math.floor(gz / PAINT_CELLS_PER_TILE_AXIS)
			const col = gx - tx * PAINT_CELLS_PER_TILE_AXIS
			const row = gz - tz * PAINT_CELLS_PER_TILE_AXIS
			const id = `${tx},${tz},0:${col},${row}`
			if (applyPaintIndex(id, 1)) painted++
		}
	}
	console.log(`[Server] seedStartingArea: painted ${painted} cells at grid center`)
}


// MARK: setupServer

export async function setupServer(): Promise<void> {
	console.log('[Server] Starting dcl/place server...')

	await loadLeaderboard()

	const paintCap = paintGridCapacity()
	console.log(
		`[Server] paint grid: ${paintCap.cellCapacity} cell slots ` +
		`(${paintCap.paintCellsPerTileAxis}×${paintCap.paintCellsPerTileAxis}/tile × ` +
		`${paintCap.tiles} tiles × ${paintCap.levels} levels); ` +
		`PaintCell networkIds ${paintCap.cellNetBase}+`
	)
	initPaintSync()
	seedTeamPalette()   // indexes 0/1/2 (compat)
	seedPlacePalette()  // indexes 1..16 (dcl/place selectable colors)
	seedStartingArea()

	initServerStats()
	startServerStatsTick(() => coverage().total)

	bindNameResolver(leaderboardGetName)
	await initDiscord()

	// PaintTick summary accumulators
	let placeAttempts     = 0
	let placeApplied      = 0
	let placeRejectedCd   = 0
	let placeRejectedBad  = 0
	let paintSummaryClock = 0

	// joinRoster is kept from canvas so the client boot handshake still works,
	// but there are NO teams in dcl/place. We just log the join and let the
	// client pick its own paletteIndex client-side. Any team assignment is
	// legacy noise — we reply with Team.None (0) to keep the schema stable.
	room.onMessage('joinRoster', ({ userId }, context) => {
		const from = context?.from
		if (!from) return
		if (from !== userId) {
			console.log(`[Server] joinRoster payload/from mismatch (payload=${userId}, from=${from})`)
		}
		console.log(`[Server] joinRoster ${from}`)
		room.send('teamAssigned', { team: Team.None }, { to: [from] })
		schedulePlayerJoin(from)
	})

	// Legacy switchTeam — no-op in dcl/place, silently accept.
	room.onMessage('switchTeam', (_data, context) => {
		if (!context?.from) return
	})

	// Legacy paintTick — dcl/place uses placePixel instead. Ignore silently
	// so an old client build can't scribble on the canvas.
	room.onMessage('paintTick', () => {
		// intentionally empty
	})

	// dcl/place: place a single pixel. Enforces PAINT_COOLDOWN_MS per sender.
	room.onMessage('placePixel', ({ cellId, paletteIndex }, context) => {
		const from = context?.from
		if (!from) return
		placeAttempts++

		const now = Date.now()
		const notBefore = nextAllowedAt.get(from) ?? 0

		// Validate palette index up front so a bad message still burns cooldown time slot.
		if (paletteIndex < 1 || paletteIndex > PLACE_PALETTE_SIZE) {
			placeRejectedBad++
			room.send('cooldownAck', { accepted: false, nextAllowedAt: notBefore, serverNow: now }, { to: [from] })
			return
		}

		// Cooldown gate.
		if (now < notBefore) {
			placeRejectedCd++
			room.send('cooldownAck', { accepted: false, nextAllowedAt: notBefore, serverNow: now }, { to: [from] })
			return
		}

		const changed = applyPaintIndex(cellId, paletteIndex)
		if (!changed) {
			// Same color already there, or invalid cellId — don't burn cooldown.
			placeRejectedBad++
			room.send('cooldownAck', { accepted: false, nextAllowedAt: notBefore, serverNow: now }, { to: [from] })
			return
		}

		const nextAt = now + PAINT_COOLDOWN_MS
		nextAllowedAt.set(from, nextAt)
		leaderboardIncrement(from, 1)
		placeApplied++
		room.send('cooldownAck', { accepted: true, nextAllowedAt: nextAt, serverNow: now }, { to: [from] })
	})

	room.onMessage('updateName', ({ name }, context) => {
		const from = context?.from
		if (!from) return
		leaderboardUpdateName(from, name)
	})

	room.onMessage('requestLeaderboard', (_data, context) => {
		if (!context?.from) return
		publishLeaderboard()
	})

	// Coverage publish tick (CRDT, throttled).
	const COVERAGE_INTERVAL = 1 / PAINT_COVERAGE_PUBLISH_HZ
	let coverageClock = 0
	engine.addSystem((dt: number) => {
		coverageClock += dt
		if (coverageClock < COVERAGE_INTERVAL) return
		coverageClock = 0
		relinkPaintSync()
		if (!isCoverageDirty()) return
		publishCoverage()
	})

	// Heartbeat + placePixel summary
	let heartbeatClock = 0
	engine.addSystem((dt: number) => {
		heartbeatClock += dt
		paintSummaryClock += dt

		if (paintSummaryClock >= PAINT_SUMMARY_INTERVAL_S) {
			paintSummaryClock = 0
			if (placeAttempts > 0) {
				console.log(
					`[Server] placePixel ${PAINT_SUMMARY_INTERVAL_S}s: ` +
					`attempts=${placeAttempts} applied=${placeApplied} ` +
					`rejCooldown=${placeRejectedCd} rejBad=${placeRejectedBad} ` +
					`paintCells=${paintCellEntityCount()}`
				)
				placeAttempts    = 0
				placeApplied     = 0
				placeRejectedCd  = 0
				placeRejectedBad = 0
			}
		}

		if (heartbeatClock < HEARTBEAT_INTERVAL_S) return
		heartbeatClock = 0
		const c = coverage()
		console.log(
			`[Server] alive cells=${paintCellEntityCount()} coverage=${c.total} ` +
			`cooldownEntries=${nextAllowedAt.size} profileReady=${!!myProfile?.networkId}`
		)
	})

	// Periodic leaderboard flush (every 30s if dirty).
	let leaderboardFlushClock = 0
	engine.addSystem((dt: number) => {
		leaderboardFlushClock += dt
		if (leaderboardFlushClock < 30) return
		leaderboardFlushClock = 0
		void saveLeaderboard()
	})

	// Discord join flush (join notifications are debounced 5s).
	let discordFlushClock = 0
	engine.addSystem((dt: number) => {
		discordFlushClock += dt
		if (discordFlushClock < 1) return
		discordFlushClock = 0
		flushPendingJoins()
	})

	console.log(
		`[Server] Ready — 16-color canvas, ${PAINT_COOLDOWN_MS}ms cooldown, ` +
		`grid ${MAZE_GRID_WIDTH}×${MAZE_GRID_HEIGHT} tiles × ${PAINT_CELLS_PER_TILE_AXIS}²/tile = ` +
		`${MAZE_GRID_WIDTH * PAINT_CELLS_PER_TILE_AXIS}×${MAZE_GRID_HEIGHT * PAINT_CELLS_PER_TILE_AXIS} pixels`
	)
	// suppress unused-import lint for legacy helpers kept for compat
	void applyPaint
	void PAINT_TICK_MAX_CELLS
}
