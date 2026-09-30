import { initializeAppearance } from './services/appearance'
// app.ts
App<IAppOption>({
  globalData: {},
  onLaunch() { initializeAppearance() },
})