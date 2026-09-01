/**
 * client/index.ts — client runtime orchestrator.
 *
 * Wires the client-side modules together in a controlled boot order.
 *
 * Feature homes:
 *   - client/maze/*          — tile-grid data + spawn cascade
 *   - client/paint           — paint cell rendering + CRDT observer
 *   - client/placeInput      — feet-tracker + highlight cube + F hotkey
 *   - client/clientHandler   — network boundary (room.on / room.send)
 *   - client/audio           — music + UI SFX
 *   - client/topDownCamera   — spectator VirtualCamera
 *   - client/touchControls   — mobile on-screen button remapping
 *   - client/ui/*            — HUD layers + theme (React-ECS via DUCK)
 */

import { engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { SeedHolder, seedHolder } from 'src/shared/components'
import { SEED_NETWORK_ID } from 'src/shared/paintGrid'

import { initAudio } from 'src/client/audio'
import { initClientHandler } from 'src/client/clientHandler'
import { initMazeNet, rebuildMaze } from 'src/client/maze/rebuild'
import { initPaintNet } from 'src/client/paint'
import { initFeetPaint, initPaintHotkey } from 'src/client/placeInput'
import { initPlayerNet } from 'src/client/player'
import { setupUi } from 'src/client/ui'
import { setupTopDownCamera } from 'src/client/topDownCamera'
import { setupTouchControls } from 'src/client/touchControls'
import { dragPollSystem } from 'src/client/ui/layers/layer.topDownPan'
import { initHelpPanelHotkey } from 'src/client/ui/layers/layer.helpPanel'
import { initLeaderboardHotkey } from 'src/client/ui/layers/layer.leaderboard'


// ─── Seed watcher ───────────────────────────────────────────────────
// Rebuilds the tile grid whenever the synced seed changes. dcl/place has
// no round resets, so in practice this fires exactly once per session
// (when the server's seed CRDT-replicates to us, or when the first-joiner
// path below seeds it).
let currentSeed = 0
engine.addSystem(() => {
	const s = SeedHolder.get(seedHolder).seed
	if (s !== 0 && s !== currentSeed) {
		currentSeed = s
		rebuildMaze(s)
	}
})


// ─── First-joiner initialization ────────────────────────────────────
// If nobody's set the seed after a grace period, we're the first player
// in an empty realm — pick a fixed non-zero seed so the tile grid spawns.
// Subsequent joiners receive the current seed via CRDT before their grace
// elapses and skip this path.
let initTimer = 0
let initDone = false
const INIT_GRACE = 1.5 // seconds
engine.addSystem((dt: number) => {
	if (initDone) return
	initTimer += dt
	if (initTimer < INIT_GRACE) return
	initDone = true
	if (SeedHolder.get(seedHolder).seed === 0) {
		SeedHolder.createOrReplace(seedHolder, { seed: 1 })
	}
})


// ─── setupClient — boot sequence ────────────────────────────────────
export async function setupClient(): Promise<void> {
	initAudio()

	// Composite-lever scrubber. main.composite carries a decorative lever
	// entity from an earlier iteration; we strip it (and anything else
	// tagged with asset-packs::States) at runtime to avoid disturbing
	// interdependent asset-packs data in the composite file itself.
	engine.addSystem(() => {
		const statesComp = engine.getComponentOrNull('asset-packs::States')
		if (!statesComp) return
		for (const [entity] of engine.getEntitiesWith(statesComp)) {
			engine.removeEntity(entity)
		}
	})

	// Tap-to-place: feet-tracker + highlight cube.
	initFeetPaint()

	// Desktop hotkey: `F` triggers PAINT (mirrors the paint button).
	initPaintHotkey()

	// Spectator: per-frame drag-delta poll (no-op unless drag is active).
	engine.addSystem(dragPollSystem)

	// Desktop hotkeys: `3` toggles help, `4` toggles leaderboard.
	initHelpPanelHotkey()
	initLeaderboardHotkey()

	// Reshape the mobile on-screen button cluster (no-op on desktop):
	// eye = spectator, E = mute, F = leaderboard, + = help.
	setupTouchControls()

	// Wire CRDT observers. PaintCell / PaletteEntry / PaintCoverage /
	// LeaderboardState are server-owned (syncEntity only on the server);
	// clients observe replicas.
	initPaintNet()
	initMazeNet()
	initPlayerNet()

	// Register the network boundary LAST so `room.onMessage` subscribers
	// above are all in place before the first message can arrive.
	initClientHandler()

	// SeedHolder is client-authored (first-joiner writes it) — sync it so
	// late joiners inherit the value instead of racing the grace period.
	syncEntity(seedHolder, [SeedHolder.componentId], SEED_NETWORK_ID)

	// Spectator VirtualCamera (inactive until the HUD button toggles it).
	setupTopDownCamera()

	setupUi()
}
