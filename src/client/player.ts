/**
 * player.ts — player-avatar side effects.
 *
 * Currently owns just the initial spawn: teleport every player to the
 * scene's center pad ~2s after boot so they land on solid ground
 * regardless of where scene.json's spawn range dropped them. Requires
 * the ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE permission (declared in scene.json).
 */

import { engine } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'

// Scene is 20 parcels x 20 parcels (320m x 320m). Spawn at the geometric
// centre. If the scene footprint changes, update these coordinates too or
// movePlayerTo will silently fail with "Position is out of scene" and the
// player will stay stranded wherever the client dropped them.
const SPAWN_POSITION      = { x: 160, y: 2, z: 160 }
const SPAWN_CAMERA_TARGET = { x: 160, y: 2, z: 168 }

function teleportHome(): void {
  // Fire-and-forget: movePlayerTo can reject if the player has moved
  // to another scene, and there's nothing useful to do about it.
  movePlayerTo({
    newRelativePosition: SPAWN_POSITION,
    cameraTarget: SPAWN_CAMERA_TARGET,
  }).catch(() => {})
}

export function initPlayerNet(): void {
  // Initial spawn-in: give the canvas ~2s to load, then plant the player
  // on the centre.
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
