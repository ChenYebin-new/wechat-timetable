export const HOME_PAGE_PATH = '/pages/timetable/index'
export const SHARE_TITLE = '拾课课表｜课表与待办'
export const FRIEND_SHARE_IMAGE = '/assets/share/friend-card-5x4.jpg'
export const TIMELINE_SHARE_IMAGE = '/assets/share/timeline-square.jpg'
export const TIMELINE_HOME_QUERY = 'qige_share=home'

const TIMELINE_HOME_QUERY_KEY = 'qige_share'
const TIMELINE_HOME_QUERY_VALUE = 'home'
const TIMELINE_SINGLE_PAGE_SCENE = 1154

interface ShareEntryPage {
  setData(data: { showShareHomePreview: boolean }): void
}

export function enableHomeShare(): void {
  wx.showShareMenu({
    menus: ['shareAppMessage', 'shareTimeline'],
  })
}

export function shareHomeToFriend() {
  return {
    title: SHARE_TITLE,
    path: HOME_PAGE_PATH,
    imageUrl: FRIEND_SHARE_IMAGE,
  }
}

export function shareHomeToTimeline() {
  return {
    title: SHARE_TITLE,
    query: TIMELINE_HOME_QUERY,
    imageUrl: TIMELINE_SHARE_IMAGE,
  }
}

function currentScene(): number {
  try {
    return wx.getEnterOptionsSync().scene
  } catch {
    return 0
  }
}

function isTimelineHomeEntry(options?: Record<string, string | undefined>): boolean {
  return options?.[TIMELINE_HOME_QUERY_KEY] === TIMELINE_HOME_QUERY_VALUE
}

function redirectToHome(): void {
  wx.switchTab({
    url: HOME_PAGE_PATH,
    fail: () => wx.reLaunch({ url: HOME_PAGE_PATH }),
  })
}

/**
 * Enables both share menus for a normal page load. Timeline entries first render
 * a data-free preview; after entering the full mini program, secondary pages
 * immediately switch to the timetable home page.
 *
 * Returns true when the caller must stop its original page initialization.
 */
export function initializeHomeSharing(
  page: ShareEntryPage,
  currentPagePath: string,
  options?: Record<string, string | undefined>,
): boolean {
  if (!isTimelineHomeEntry(options)) {
    enableHomeShare()
    return false
  }

  if (currentScene() === TIMELINE_SINGLE_PAGE_SCENE) {
    page.setData({ showShareHomePreview: true })
    return true
  }

  if (currentPagePath !== HOME_PAGE_PATH) {
    page.setData({ showShareHomePreview: true })
    redirectToHome()
    return true
  }

  page.setData({ showShareHomePreview: false })
  enableHomeShare()
  return false
}
