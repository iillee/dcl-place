/**
 * clientHandler.ts — client network boundary for dcl/place.
 *
 * Inbound room messages → eventBus / placeState.
 * Outbound: joinRoster + updateName (on state-sync). placePixel is sent
 * on-demand from client/placeInput.ts.
 *
 * Paint *state* is CRDT only (PaintCell / PaletteEntry / PaintCoverage).
 */

import { engine, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { room } from 'src/shared/messages'
import { Team } from 'src/shared/team'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

import { applyCooldownAck } from 'src/client/placeState'

let myTeam: Team = Team.None

const SYNC_LOG_INTERVAL_MS = 1000
const SYNC_DOWN_WARN_MS    = 5000


// MARK: sendDisplayName

function sendDisplayName(address: string): void {
	const av   = AvatarBase.getOrNull(engine.PlayerEntity)
	const name = av?.name || `Guest ${address.slice(-4)}`
	console.log(`[Client] → updateName "${name}"`)
	room.send('updateName', { name })
}


// MARK: resolveJoinUserId

function resolveJoinUserId(): string {
	const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
	if (pid?.address) return pid.address
	return 'guest-' + Math.floor(Math.random() * 1e9).toString(16)
}


// MARK: initClientHandler

export function initClientHandler(): void {
	wireInbound()
	wireTeamAssigned()
	wireOutbound()
}


// MARK: wireInbound

function wireInbound(): void {
	room.onMessage('teamAssigned', ({ team }) => {
		eventBus.emit(ClientEvents.TeamAssigned, { team: team as Team })
	})

	room.onMessage('roundReset', ({ seed, finalRed, finalBlue, finalTotal }) => {
		eventBus.emit(ClientEvents.RoundReset, { seed, finalRed, finalBlue, finalTotal })
	})

	room.onMessage('cooldownAck', ({ accepted, nextAllowedAt, serverNow }) => {
		applyCooldownAck(nextAllowedAt, serverNow)
		if (!accepted) {
			console.log(`[Client] placePixel rejected — cooldown until ${new Date(nextAllowedAt).toISOString()}`)
		}
	})
}


// MARK: wireTeamAssigned

function wireTeamAssigned(): void {
	eventBus.on(ClientEvents.TeamAssigned, ({ team }) => {
		myTeam = team
		console.log(`[Client] teamAssigned → ${myTeam}`)
	})
}


// MARK: wireOutbound

function wireOutbound(): void {
	let joinSent    = false
	let lastSyncLog = 0
	let syncWaitMs  = 0
	let downWarned  = false

	engine.addSystem((dt: number) => {
		const synced = isStateSyncronized()
		if (!synced) {
			syncWaitMs += dt * 1000
			if (syncWaitMs - lastSyncLog >= SYNC_LOG_INTERVAL_MS) {
				lastSyncLog = syncWaitMs
				console.log(`[Client] waiting for isStateSyncronized… (${(syncWaitMs / 1000).toFixed(1)}s)`)
			}
			if (!downWarned && syncWaitMs >= SYNC_DOWN_WARN_MS) {
				downWarned = true
				console.log('[Client] server not connected — Multiplayer Server likely down')
			}
			return
		}
		if (joinSent) return
		joinSent = true
		const userId = resolveJoinUserId()
		console.log(`[Client] isStateSyncronized — → joinRoster ${userId}`)
		room.send('joinRoster', { userId })
		sendDisplayName(userId)
	})
}
