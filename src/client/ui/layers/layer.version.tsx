/**
 * layer.version.tsx — bottom-right build version chip.
 *
 * DUCK Layer wrapper: Zone handles corner placement + safe-area insets, so
 * no manual absolute positioning. Serves as the reference pattern for all
 * dcl/place UI layers (color picker, cooldown ring, etc.) coming in Day 3.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { UI_THEME } from 'src/client/ui/theme/settings'
import { VERSION } from 'src/shared/data/version'


const { colors, fontSizes, borderRadius } = UI_THEME


// MARK: VersionLayer
/**
 * Compact version chip pinned to the bottom-right of the screen.
 */
class VersionLayer extends Layer {
	constructor() {
		super({
			id  : 'version',
			zone: ZoneType.BottomRight,
		})
	}

	body() {
		return (
			<UiEntity
				key         = "ui_Version_root"
				uiTransform = {{
					width       : 'auto',
					height      : 24,
					borderRadius: borderRadius.sm,
					padding     : { right: 4, left: 4 },
				}}
				uiText = {{
					value    : VERSION,
					fontSize : fontSizes.md,
					color    : colors.versionFg,
					textAlign: 'middle-center',
				}}
				uiBackground = {{
					color: colors.versionBg,
				}}
			/>
		)
	}
}


export const versionLayer = new VersionLayer()
