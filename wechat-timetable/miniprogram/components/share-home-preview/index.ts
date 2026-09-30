import { DEFAULT_THEME, THEMES, themeStyle } from '../../themes/index'

// Public preview always uses the default theme, independent of personal preferences.
Component({
  data: {
    appearanceStyle: themeStyle(DEFAULT_THEME),
    appearanceIcon: THEMES[DEFAULT_THEME].icons.brand,
  },
})
