/**
 * player.ts — player-avatar side effects driven by game events.
 *
 * Currently owns just the round-boundary respawn: teleport every player
 * to the scene's center pad when the round resets. Requires the
 * ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE permission (declared in scene.json).
 *
 * Future homes here: locomotion tweaks (squid-swim on own paint),
 * respawn-on-death (Phase 6), team-color indicator attachments, etc.
 */

import { engine } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

// Scene is 4 parcels wide (x: 0-64m) x 7 tall (z: 0-112m). Spawn at the
// geometric centre — the maze generator places a cross tile there. If the
// scene footprint changes, update these coordinates too or movePlayerTo
// will silently fail with "Position is out of scene" and the player will
// stay stranded wherever the client dropped them.
const SPAWN_POSITION      = { x: 32, y: 2, z: 56 }
const SPAWN_CAMERA_TARGET = { x: 32, y: 2, z: 64 }

function teleportHome(): void {
  // Fire-and-forget: movePlayerTo can reject if the player has moved
  // to another scene, and there's nothing useful to do about it.
  movePlayerTo({
    newRelativePosition: SPAWN_POSITION,
    cameraTarget: SPAWN_CAMERA_TARGET,
  }).catch(() => {})
}

export function initPlayerNet(): void {
  // Round boundary: everyone snaps back to the cross for a clean start.
  eventBus.on(ClientEvents.RoundReset, teleportHome)
  // Initial spawn-in: give the maze ~2s to grow in, then plant the player
  // on the center cross. Without this, players land wherever scene.json's
  // spawn range dropped them, which may or may not be on solid ground
  // depending on maze layout.
  let elapsed = 0
  let done = false
  const INIT_DELAY = 2
  engine.addSystem((dt: number) => {
    if (done) return
    elapsed += dt
    if (elapsed < INIT_DELAY) return
    done = true
    teleportHome()
  })
}
