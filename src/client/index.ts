/**
 * client/index.ts — client runtime orchestrator (solid-floor edition).
 *
 * Boots the client-side modules in a controlled order. The maze system
 * has been replaced by a single 320×320m floor GLB + deterministic
 * paint-cell spawn (see paint.ts::spawnPaintCanvas). No seed watcher,
 * no per-tile GLB fetches, no reveal cascade.
 */

import { engine } from '@dcl/sdk/ecs'

import { initAudio } from 'src/client/audio'
import { initClientHandler } from 'src/client/clientHandler'
import { initPaintNet, spawnPaintCanvas } from 'src/client/paint'
import { initFeetPaint, initPaintHotkey } from 'src/client/placeInput'
import { initPlayerNet } from 'src/client/player'
import { setupUi } from 'src/client/ui'
import { setupTopDownCamera } from 'src/client/topDownCamera'
import { setupTouchControls } from 'src/client/touchControls'
import { dragPollSystem } from 'src/client/ui/layers/layer.topDownPan'
import { initHelpPanelHotkey, helpPanelLayer } from 'src/client/ui/layers/layer.helpPanel'
import { initLeaderboardHotkey } from 'src/client/ui/layers/layer.leaderboard'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


// ─── setupClient — boot sequence ────────────────────────────────────
export async function setupClient(): Promise<void> {
	initAudio()

	// Spawn the floor GLB + all 25,600 paint cells in one deterministic
	// pass. Synchronous — no CRDT wait, no reveal cascade. Runs before
	// paint-net observers so cells are ready to recolor when the first
	// PaintTile CRDT payload arrives.
	spawnPaintCanvas()

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

	initFeetPaint()
	initPaintHotkey()

	engine.addSystem(dragPollSystem)

	initHelpPanelHotkey()
	initLeaderboardHotkey()

	setupTouchControls()

	initPaintNet()
	initPlayerNet()

	initClientHandler()

	setupTopDownCamera()

	setupUi()

	// ─── Welcome flow ────────────────────────────────────────────────
	let welcomeTimer = 0
	let welcomeDone  = false
	const WELCOME_DELAY = 3.0
	engine.addSystem((dt: number) => {
		if (welcomeDone) return
		welcomeTimer += dt
		if (welcomeTimer < WELCOME_DELAY) return
		welcomeDone = true
		if (!isTopDownActive()) toggleTopDownCamera()
		if (helpPanelLayer.visibility.isHidden) helpPanelLayer.show()
	})
}
