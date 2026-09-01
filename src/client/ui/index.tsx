/**
 * index.tsx — UI entry point.
 *
 * Registers every HUD layer through @stom66/dcl-ui-component-kit (DUCK).
 * Zone order in the `layers` array is z-order (later = drawn above).
 *
 * Import setupUi from 'src/client/ui'.
 */

import { SetupUiComponentKit } from '@stom66/dcl-ui-component-kit'

import { colorPickerLayer } from 'src/client/ui/layers/layer.colorPicker'
// layer.cooldown — rolled into colorPickerLayer as an inline paint button.
import { helpPanelLayer }   from 'src/client/ui/layers/layer.helpPanel'
import { leaderboardLayer } from 'src/client/ui/layers/layer.leaderboard'
import { topBarLayer }      from 'src/client/ui/layers/layer.topBar'
import { topDownPanLayer }  from 'src/client/ui/layers/layer.topDownPan'
import { versionLayer }        from 'src/client/ui/layers/layer.version'
import { loadingSplashLayer }  from 'src/client/ui/layers/layer.loadingSplash'


// MARK: setupUi
export function setupUi() {
	SetupUiComponentKit({
		layers: [
			// Order = z-order (later draws on top).
			versionLayer,
			// Spectator pan controls sit below chrome so its full-screen
			// drag catcher doesn't swallow taps meant for the top bar
			// or bottom picker.
			topDownPanLayer,
			topBarLayer,
			helpPanelLayer,
			leaderboardLayer,
			colorPickerLayer,
			// Splash must be last so it renders on top of every other layer.
			loadingSplashLayer,
		],
	})
}
