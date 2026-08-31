/**
 * layer.topDownPan.tsx — pan controls, active only in top-down mode.
 *
 * Composition (all children guarded by isTopDownActive()):
 *   - Desktop drag catcher: full-screen invisible overlay that starts a
 *     drag on press and ends it on release. A separate system reads
 *     PrimaryPointerInfo.screenDelta each frame while the drag is live
 *     and feeds it into the camera as pan delta. Mirrors the slider
 *     pattern documented in build-ui/references/ui-sliders.md.
 *   - Mobile d-pad: four hold-to-pan arrow buttons anchored bottom-right,
 *     with a fullscreen release-catcher (only mounted while a button is
 *     held) so lifting the finger outside the button still ends the pan.
 *   - Recenter button: top-center, snaps camera back to follow-the-player.
 *
 * Desktop and mobile controls are both rendered on both platforms — the
 * SDK's own input model gates them (screenDelta is desktop-only, and the
 * d-pad works equally well with a mouse if a desktop user prefers it).
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { InputAction, PointerEventType, PrimaryPointerInfo, engine, inputSystem } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { UI_THEME } from 'src/client/ui/theme/settings'
import { applyPanDelta, beginDrag, beginPan, canZoomIn, canZoomOut, endDrag, endPan, getDpadSpeed, isDragging, isTopDownActive, zoomIn, zoomOut } from 'src/client/topDownCamera'
import { playUiClick } from 'src/client/audio'


const { colors, borderRadius } = UI_THEME

const PANEL_BG = colors.statsBg
const WHITE    = Color4.White()
const GOLD     = Color4.create(1.0, 0.84, 0.0, 1)

// Layout — d-pad cluster sits above the mobile jump/interaction cluster
// so it does not overlap the native gamepad HUD. Recenter chip goes top-
// center so it never fights the top-right (chat / camera) or top-left
// (menu) client HUD zones.
const DPAD_BTN         = 72
const DPAD_GAP         = 8
// Nudged in from the right edge so the d-pad clears the native
// mobile jump/interaction cluster in the bottom-right corner.
const DPAD_MARGIN_RIGHT = 96
const DPAD_MARGIN_BOTTOM = 440  // above the native mobile action buttons

// Zoom cluster (+/-) sizing. Slightly smaller than d-pad buttons so
// they read as secondary controls and don't fight the pan cluster for
// visual weight.
const ZOOM_BTN            = 60
const ZOOM_GAP            = 8
const ZOOM_MARGIN_MOBILE  = { right: 180, bottom: 290 } // down-left of d-pad cluster
const ZOOM_MARGIN_DESKTOP = { right: 24,  bottom: 200 } // above native jump button on desktop
const ZOOM_GLYPH_BAR      = 4  // thickness of the + / - glyph bars
const ZOOM_GLYPH_LEN      = 24 // length of the + / - glyph bars

// Vertical inset at the top of the drag catcher so it never covers the
// top-center action bar (see layer.brushSize.tsx: top margin 32 + 72 px
// button + breathing room). Without this gap the fullscreen catcher
// swallows every action-bar click while top-down mode is active.


// MARK: dragPollSystem
/**
 * Reads PrimaryPointerInfo.screenDelta each frame and forwards it to the
 * camera while a drag is in progress. Also acts as a safety net for
 * missed onMouseUp events (e.g. cursor left the window).
 */
export function dragPollSystem(): void {
	if (!isTopDownActive()) return

	// Safety net: pointer released globally (e.g. cursor left window).
	if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
		endDrag()
		return
	}

	const delta = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenDelta
	if (!delta) return
	if (delta.x === 0 && delta.y === 0) return
	applyPanDelta(delta.x, delta.y)
}


// MARK: DpadButton
/**
 * Single hold-to-pan arrow button. `dir` is the (vx, vz) unit vector for
 * the pan direction; multiplied by the camera's tuned speed on press.
 * `rotationDeg` rotates the up-facing glyph to match the button role.
 */
function DpadButton(props: {
	dir:         { vx: number; vz: number }
	rotationDeg: number
	keyId:       string
}) {
	const speed = getDpadSpeed()
	return (
		<UiEntity
			key={props.keyId}
			uiTransform={{
				width         : DPAD_BTN,
				height        : DPAD_BTN,
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
			}}
			uiBackground={{ color: PANEL_BG }}
			onMouseDown={() => beginPan(props.dir.vx * speed, props.dir.vz * speed)}
			onMouseUp={endPan}
		>
			<DirectionalArrow rotationDeg={props.rotationDeg} color={WHITE} />
		</UiEntity>
	)
}


// MARK: DirectionalArrow
/** Renders one of four pre-oriented chunky arrows (React-ECS has no rotate). */
function DirectionalArrow(props: { rotationDeg: number; color: Color4 }) {
	// 0 = up, 90 = right, 180 = down, 270 = left.
	// We build each direction from bars sized/aligned appropriately.
	const bars: { w: number; h: number }[] = [
		{ w: 8,  h: 4 },
		{ w: 18, h: 4 },
		{ w: 28, h: 4 },
	]
	if (props.rotationDeg === 0 || props.rotationDeg === 180) {
		// Vertical stack; reverse for down.
		const rows = props.rotationDeg === 0 ? bars : bars.slice().reverse()
		return (
			<UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
				{rows.map((r, i) => (
					<UiEntity
						key={`v_${props.rotationDeg}_${i}`}
						uiTransform={{ width: r.w, height: r.h, margin: { top: i === 0 ? 0 : 2 } }}
						uiBackground={{ color: props.color }}
					/>
				))}
			</UiEntity>
		)
	}
	// Horizontal: row of vertical bars (swap w/h). rotationDeg 90 = right,
	// 270 = left.
	const cols = props.rotationDeg === 270 ? bars : bars.slice().reverse()
	return (
		<UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
			{cols.map((c, i) => (
				<UiEntity
					key={`h_${props.rotationDeg}_${i}`}
					uiTransform={{ width: c.h, height: c.w, margin: { left: i === 0 ? 0 : 2 } }}
					uiBackground={{ color: props.color }}
				/>
			))}
		</UiEntity>
	)
}


// MARK: Dpad
/** 3×3 grid with arrow buttons on N/E/S/W. Center is empty. */
function Dpad() {
	// Axis mapping. Empirically corrected after playtest — the initial
	// screen-top=+X derivation was wrong (likely because the small east
	// offset produces screen-top=-X in practice). Signs flipped from the
	// original guess:
	//   up    → (vx=-1, vz= 0)
	//   right → (vx= 0, vz=+1)
	//   down  → (vx=+1, vz= 0)
	//   left  → (vx= 0, vz=-1)
	const empty = (id: string) => (
		<UiEntity key={id} uiTransform={{ width: DPAD_BTN, height: DPAD_BTN }} />
	)
	return (
		<UiEntity
			uiTransform={{
				positionType : 'absolute',
				position     : { right: DPAD_MARGIN_RIGHT, bottom: DPAD_MARGIN_BOTTOM },
				flexDirection: 'column',
				alignItems   : 'center',
			}}
		>
			{/* row 1 */}
			<UiEntity uiTransform={{ flexDirection: 'row' }}>
				{empty('nw')}
				<UiEntity uiTransform={{ margin: { left: DPAD_GAP, right: DPAD_GAP } }}>
					<DpadButton dir={{ vx: -1, vz:  0 }} rotationDeg={0}   keyId="dpad_up" />
				</UiEntity>
				{empty('ne')}
			</UiEntity>
			{/* row 2 */}
			<UiEntity uiTransform={{ flexDirection: 'row', margin: { top: DPAD_GAP } }}>
				<DpadButton dir={{ vx: 0, vz: -1 }} rotationDeg={270} keyId="dpad_left" />
				<UiEntity uiTransform={{ margin: { left: DPAD_GAP, right: DPAD_GAP } }}>
					{empty('center')}
				</UiEntity>
				<DpadButton dir={{ vx: 0, vz: +1 }} rotationDeg={90}  keyId="dpad_right" />
			</UiEntity>
			{/* row 3 */}
			<UiEntity uiTransform={{ flexDirection: 'row', margin: { top: DPAD_GAP } }}>
				{empty('sw')}
				<UiEntity uiTransform={{ margin: { left: DPAD_GAP, right: DPAD_GAP } }}>
					<DpadButton dir={{ vx: +1, vz: 0 }} rotationDeg={180} keyId="dpad_down" />
				</UiEntity>
				{empty('se')}
			</UiEntity>
		</UiEntity>
	)
}


// MARK: ZoomButton
/**
 * Single zoom button (+ or -). Grayed via alpha when the camera is
 * already at the corresponding altitude limit so the affordance is
 * self-explanatory. onMouseDown (not onClick) for snappier feel.
 */
function ZoomButton(props: {
	kind:    'in' | 'out'
	enabled: boolean
	keyId:   string
}) {
	const bg = props.enabled
		? PANEL_BG
		: Color4.create(PANEL_BG.r, PANEL_BG.g, PANEL_BG.b, PANEL_BG.a * 0.4)
	const tint = props.enabled ? WHITE : Color4.create(1, 1, 1, 0.4)
	return (
		<UiEntity
			key={props.keyId}
			uiTransform={{
				width         : ZOOM_BTN,
				height        : ZOOM_BTN,
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
			}}
			uiBackground={{ color: bg }}
			onMouseDown={() => {
				if (!props.enabled) return
				playUiClick()
				if (props.kind === 'in') zoomIn()
				else                     zoomOut()
			}}
		>
			<ZoomGlyph kind={props.kind} color={tint} />
		</UiEntity>
	)
}


// MARK: ZoomGlyph
/** Renders a chunky + or - glyph from bar primitives (React-ECS has no text glyph atlas for this style). */
function ZoomGlyph(props: { kind: 'in' | 'out'; color: Color4 }) {
	return (
		<UiEntity uiTransform={{ width: ZOOM_GLYPH_LEN, height: ZOOM_GLYPH_LEN, justifyContent: 'center', alignItems: 'center' }}>
			{/* Horizontal bar (part of both + and -) */}
			<UiEntity
				uiTransform={{
					positionType: 'absolute',
					width       : ZOOM_GLYPH_LEN,
					height      : ZOOM_GLYPH_BAR,
				}}
				uiBackground={{ color: props.color }}
			/>
			{/* Vertical bar (only for +) */}
			{props.kind === 'in' && (
				<UiEntity
					uiTransform={{
						positionType: 'absolute',
						width       : ZOOM_GLYPH_BAR,
						height      : ZOOM_GLYPH_LEN,
					}}
					uiBackground={{ color: props.color }}
				/>
			)}
		</UiEntity>
	)
}


// MARK: ZoomCluster
/**
 * Vertically-stacked + / - buttons anchored bottom-right. Sits to the
 * left of the mobile d-pad cluster; on desktop lives lower on the right
 * edge above the native jump button.
 */
function ZoomCluster() {
	const margin = isMobile() ? ZOOM_MARGIN_MOBILE : ZOOM_MARGIN_DESKTOP
	return (
		<UiEntity
			uiTransform={{
				positionType : 'absolute',
				position     : { right: margin.right, bottom: margin.bottom },
				flexDirection: 'column',
				alignItems   : 'center',
			}}
		>
			<ZoomButton kind="in"  enabled={canZoomIn()}  keyId="zoom_in" />
			<UiEntity uiTransform={{ height: ZOOM_GAP }} />
			<ZoomButton kind="out" enabled={canZoomOut()} keyId="zoom_out" />
		</UiEntity>
	)
}


// MARK: DesktopDragCatcher
/**
 * Full-screen invisible layer that starts / ends desktop drag pans.
 * pointerFilter must be 'block' so it receives pointer events; a system
 * elsewhere reads screenDelta each frame while the drag is live.
 *
 * Blocks all click-through to the world beneath. That is intentional in
 * top-down mode (no in-world interactions yet). When we add clickable
 * entities later, gate this catcher off the interaction cursor.
 */
const DRAG_CATCHER_TOP_INSET = 140

function DesktopDragCatcher() {
	return (
		<UiEntity
			key = "ui_TopDown_DragCatcher"
			uiTransform={{
				width       : '100%',
				positionType: 'absolute',
				// top + bottom (no explicit height) leaves an unclickable
				// strip at the top for the action bar to receive events.
				position    : { top: DRAG_CATCHER_TOP_INSET, left: 0, bottom: 0 },
				pointerFilter: 'block',
			}}
			onMouseDown={beginDrag}
			onMouseUp={endDrag}
		/>
	)
}


// MARK: TopDownPanLayer
/**
 * Top-level pan-controls layer. FullScreen zone so its drag catcher can
 * cover the whole canvas. Body renders empty when top-down mode is off
 * so the layer stays mounted (state stable) but visually inert.
 * Order matters: drag catcher first so the d-pad draws above it.
 */
class TopDownPanLayer extends Layer {
	constructor() {
		super({
			id  : 'topDownPan',
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		if (!isTopDownActive()) return null
		return (
			<UiEntity
				key = "ui_TopDownPan_root"
				uiTransform={{
					width        : '100%',
					height       : '100%',
					pointerFilter: 'none',
				}}
			>
				{/* Desktop-only: the drag catcher is a fullscreen block layer
				    that would swallow mobile joystick touches. Mobile pans via
				    the d-pad, so it does not need the catcher at all. */}
				{!isMobile() && <DesktopDragCatcher />}
				{/* D-pad is mobile-only — desktop uses click-drag panning via
				    the catcher above, so the d-pad would only clutter the HUD. */}
				{isMobile() && <Dpad />}
				{/* Zoom cluster on both platforms — there is no reliable
				    mouse-wheel or pinch input in SDK7, so buttons are the
				    single interaction model. */}
				<ZoomCluster />
			</UiEntity>
		)
	}
}


export const topDownPanLayer = new TopDownPanLayer()
