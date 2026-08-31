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

let selectedPaletteIndex = 1 // default: red
let nextAllowedAtServer  = 0 // ms since epoch, server clock
let serverSkewMs         = 0 // serverNow - Date.now() at last ack


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
	if (index < 1 || index > PLACE_PALETTE_SIZE) return
	if (index === selectedPaletteIndex) return
	selectedPaletteIndex = index
	notify()
}


// MARK: cooldown

/** Called from the network handler on every cooldownAck. */
export function applyCooldownAck(nextAllowedAt: number, serverNow: number): void {
	nextAllowedAtServer = nextAllowedAt
	serverSkewMs        = serverNow - Date.now()
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
