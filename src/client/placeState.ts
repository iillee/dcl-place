/**
 * placeState.ts — dcl/place client-side selection + cooldown state.
 *
 * Tiny observable holding two pieces of state the UI + input layers share:
 *   1. selectedPaletteIndex — which of the 16 colors the player will paint
 *   2. cooldown              — nextAllowedAt (server clock ms) + serverSkew
 *
 * Server clock skew is derived from every cooldownAck's serverNow so the
 * UI can render a truthful ring even if the player's local clock drifts.
 */

import { PLACE_PALETTE_SIZE } from 'src/shared/palette'

type Listener = () => void

const listeners = new Set<Listener>()

// 0 = eraser (clears the cell), 1..PLACE_PALETTE_SIZE = paint colors.
let selectedPaletteIndex = 1 // default: first color
let nextAllowedAtServer  = 0 // ms since epoch, server clock

// Server-clock skew (serverNow - Date.now()). Smoothed with an EMA so a
// single high-latency ack on mobile doesn't yank the clock and cause
// the cooldown bar to jump backward mid-fill. Alpha ~0.15 keeps it
// responsive to real drift (device sleep, clock updates) while filtering
// per-ack jitter of a few hundred ms.
//
// The first ack seeds directly (no prior sample to blend); subsequent
// acks blend. `skewSeeded` gates the two behaviours.
let serverSkewMs         = 0
let skewSeeded           = false
const SKEW_EMA_ALPHA     = 0.15

// Bumped every time placeAtFeet() (or any paint code path) rejects a
// user tap. UI subscribers can watch this to flash a "denied" affordance
// on the paint button. Number is monotonic; only the change matters.
let paintDeniedTick      = 0


// MARK: subscribe

export function subscribePlaceState(fn: Listener): () => void {
	listeners.add(fn)
	return () => listeners.delete(fn)
}


function notify(): void {
	for (const fn of listeners) fn()
}


// MARK: palette selection

export function getSelectedPaletteIndex(): number {
	return selectedPaletteIndex
}

export function setSelectedPaletteIndex(index: number): void {
	if (index < 0 || index > PLACE_PALETTE_SIZE) return
	if (index === selectedPaletteIndex) return
	selectedPaletteIndex = index
	notify()
}


// MARK: cooldown

/** Called from the network handler on every cooldownAck. */
export function applyCooldownAck(nextAllowedAt: number, serverNow: number): void {
	nextAllowedAtServer = nextAllowedAt
	const sample = serverNow - Date.now()
	if (!skewSeeded) {
		serverSkewMs = sample
		skewSeeded   = true
	} else {
		serverSkewMs = serverSkewMs + SKEW_EMA_ALPHA * (sample - serverSkewMs)
	}
	notify()
}

/** Approx server-clock "now" using last-known skew. */
export function serverNowMs(): number {
	return Date.now() + serverSkewMs
}

/** Milliseconds remaining before the next pixel is allowed. 0 if ready. */
export function cooldownRemainingMs(): number {
	const remaining = nextAllowedAtServer - serverNowMs()
	return remaining > 0 ? remaining : 0
}

/** True when the local player is currently allowed to place a pixel. */
export function canPlaceNow(): boolean {
	return cooldownRemainingMs() <= 0
}

/** Optimistic lock — set immediately after we SEND a placePixel so the UI
 *  ring starts filling before the server round-trip returns. Overwritten
 *  by the authoritative cooldownAck when it arrives. */
export function noteOptimisticSend(estimatedCooldownMs: number): void {
	const opt = serverNowMs() + estimatedCooldownMs
	if (opt > nextAllowedAtServer) {
		nextAllowedAtServer = opt
		notify()
	}
}


// MARK: paint-denied signal

/** Called by paint code paths when a user's tap is rejected (cooldown
 *  active, no valid cell, airborne, etc). UI layers can subscribe via
 *  subscribePlaceState() and read paintDeniedTick() to flash feedback. */
export function notePaintDenied(): void {
	paintDeniedTick++
	notify()
}

/** Monotonic counter — subscribers compare against their last-seen
 *  value to detect a new denial. */
export function paintDeniedTickValue(): number {
	return paintDeniedTick
}
