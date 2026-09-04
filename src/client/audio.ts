/**
 * audio.ts — background music + UI click sound.
 *
 * Music is parented to the camera so it stays at ear-level anywhere in
 * the 160m scene. Starts muted so the scene loads quietly; the HUD mute
 * pill toggles it via toggleMusic().
 *
 * Playback position is tracked across pause/resume so the loop continues
 * where it left off instead of restarting each unmute. Pattern borrowed
 * from flagtag's boomboxState: the SDK reads currentTime on the
 * playing:false → true transition, so we must seek BEFORE flipping playing.
 *
 * Future SFX (paint hits, round-end fanfare) will register subscribers on
 * `eventBus` / `ClientEvents` from this module — keeping all audio config in one place.
 */

import { AudioSource, Entity, InputAction, PointerEventType, Transform, engine, inputSystem } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
// MP3 rather than WAV — mobile Explorer plays MP3 reliably; the same
// AudioSource pointed at a WAV would go silent for swatch taps even
// though the identical pattern worked on desktop.
const CLICK_SRC = 'assets/sounds/click.mp3'
const CLAIM_SRC = 'assets/sounds/pop.mp3'

let musicEnt: Entity = 0 as Entity
// Round-robin pools for one-shot SFX. Reusing the SAME entity per
// AudioSource.createOrReplace call causes rapid re-triggers to silently
// no-op on mobile Explorer (documented flaky spot; see the
// currentTime:0 hack in a prior revision). Cycling through several
// entities guarantees each call lands on a "fresh" AudioSource and
// actually plays. 6 slots > any realistic burst rate (fastest human
// tap ~10 Hz, longest sound ~0.4 s → max 4 overlaps).
const SFX_POOL_SIZE = 6
let clickPool: Entity[] = []
let claimPool: Entity[] = []
let clickIdx = 0
let claimIdx = 0
let musicMuted = true
let playStartMs = 0
let pausedPositionSec = 0

export function initAudio(): void {
  // Allocate SFX pools up front. Parent to CameraEntity so `global:true`
  // has a sensible fallback position; volume is set per-play below.
  for (let i = 0; i < SFX_POOL_SIZE; i++) {
    const c = engine.addEntity()
    Transform.create(c, { parent: engine.CameraEntity })
    clickPool.push(c)
    const p = engine.addEntity()
    Transform.create(p, { parent: engine.CameraEntity })
    claimPool.push(p)
  }
  musicEnt = engine.addEntity()
  Transform.create(musicEnt, { parent: engine.CameraEntity })
  AudioSource.create(musicEnt, {
    audioClipUrl: MUSIC_SRC,
    playing: !musicMuted,
    loop: true,
    volume: MUSIC_VOLUME,
    global: true,
  })
  playStartMs = Date.now()

  // Desktop hotkey: `2` (IA_ACTION_4) toggles music mute. Matches the
  // top-bar left-to-right key order: 1 spectator, 2 mute, 3 leaderboard,
  // 4 help. toggleMusic() already plays the UI click.
  //
  // Desktop-only guard: on mobile the native on-screen `?` button is
  // remapped to IA_ACTION_4 (see touchControls.ts) which routes to help;
  // without this guard, tapping `?` also toggles mute.
  if (!isMobile()) {
    engine.addSystem(() => {
      if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) {
        playUiClick()
        toggleMusic()
      }
    })
  }
}

export function isMusicMuted(): boolean {
  return musicMuted
}

/**
 * Play the shared UI click SFX. Fire from any button that wants the same
 * feedback as the mute toggle — star, popup close, etc. Reuses the same
 * entity as the mute click so we don't leak audio sources per-button.
 */
// De-dupe window for playUiClick. Mobile webviews commonly fire BOTH
// touchstart and mousedown for a single tap, and some native mobile
// buttons (e.g. the on-screen spectator eye) synthesize paired
// InputAction triggers 100–150 ms apart — the round-robin pool makes
// both audible as a "double" click. 200 ms is still well under a
// realistic human re-tap cadence but wide enough to swallow the
// duplicates.
const UI_CLICK_DEDUPE_MS = 200
let lastClickMs = 0
export function playUiClick(): void {
  if (clickPool.length === 0) return
  const now = Date.now()
  if (now - lastClickMs < UI_CLICK_DEDUPE_MS) return
  lastClickMs = now
  // Round-robin through the pool so mobile Explorer actually re-triggers
  // instead of no-op'ing on identical back-to-back createOrReplace calls.
  const ent = clickPool[clickIdx]
  clickIdx = (clickIdx + 1) % clickPool.length
  AudioSource.createOrReplace(ent, {
    audioClipUrl: CLICK_SRC,
    playing: true, loop: false, volume: 0.7, global: true,
    currentTime: 0,
  })
}

/**
 * Play the tile-claim SFX for the local player only (camera-parented,
 * global=true so no 3D falloff). Fires once per new claim — caller
 * (paint CRDT apply) already guards against re-walking own tiles,
 * so no additional throttle needed. Low volume so continuous painting
 * reads as a soft rhythmic sparkle, not a machine gun.
 */
// Skip the leading silence / attack ramp of pop.mp3 so the transient
// hits the moment paint fires (was landing ~50ms late).
const CLAIM_START_SEC = 0.05
export function playClaimSfx(): void {
  if (claimPool.length === 0) return
  // Same pool pattern as playUiClick. Volume bumped so it stays audible
  // in spectator mode where the virtual camera is far from the source
  // (global:true is meant to bypass falloff but mobile Explorer
  // attenuates it much more aggressively than desktop).
  const ent = claimPool[claimIdx]
  claimIdx = (claimIdx + 1) % claimPool.length
  AudioSource.createOrReplace(ent, {
    audioClipUrl: CLAIM_SRC,
    playing: true, loop: false, volume: 0.5, global: true,
    currentTime: CLAIM_START_SEC,
  })
}

export function toggleMusic(): void {
  // NOTE: callers (top-bar button, hotkey handler) are responsible for
  // playing the UI click. Firing it here too caused a "double click" on
  // mobile since the round-robin pool no longer no-ops duplicate plays.
  const a = AudioSource.getMutableOrNull(musicEnt) as
    { volume: number; playing: boolean; currentTime?: number } | null
  if (!a) return
  if (!musicMuted) {
    // Pause: bank the elapsed play time and stop.
    pausedPositionSec += (Date.now() - playStartMs) / 1000
    a.playing = false
    musicMuted = true
  } else {
    // Resume: seek first, THEN flip playing on.
    a.currentTime = pausedPositionSec
    a.playing = true
    playStartMs = Date.now()
    musicMuted = false
  }
}
