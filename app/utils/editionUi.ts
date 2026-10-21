import type { Component } from 'vue'

// Where the cloud edition adds its own pieces to the panel without core ever
// importing ee/: a client plugin in the ee layer registers them here at boot,
// and the settings modal, the layout and the sidebar render whatever is
// registered. In the community build nothing registers, so nothing extra
// renders.

export type SettingsTab = { key: string, label: string, icon: string, component: Component }
/** A link at the bottom of the sidebar. `visible` is read on every render, so it can follow `/admin/me`. */
export type SidebarItem = { key: string, label: string, icon: string, to: string, visible?: () => boolean }
/** A link in the landing page's header (the cloud edition's pricing). */
export type LandingLink = { key: string, label: string, to: string }

const settingsTabs = shallowReactive<SettingsTab[]>([])
const banners = shallowReactive<Component[]>([])
const upgrade = shallowRef<(() => void) | null>(null)
const sidebarItems = shallowReactive<SidebarItem[]>([])
const landingLinks = shallowReactive<LandingLink[]>([])

export function registerSettingsTab(tab: SettingsTab): void {
  if (!settingsTabs.some(item => item.key === tab.key)) settingsTabs.push({ ...tab, component: markRaw(tab.component) })
}

/** A strip above every panel page (plan or verification notices). */
export function registerBanner(component: Component): void {
  if (!banners.includes(component)) banners.push(markRaw(component))
}

/** Where Upgrade goes (billing). Without one, the plan limit modal only offers Close. */
export function setUpgradeAction(fn: () => void): void {
  upgrade.value = fn
}

export function registerSidebarItem(item: SidebarItem): void {
  if (!sidebarItems.some(entry => entry.key === item.key)) sidebarItems.push(item)
}

export function registerLandingLink(link: LandingLink): void {
  if (!landingLinks.some(entry => entry.key === link.key)) landingLinks.push(link)
}

export function editionUi() {
  return { settingsTabs, banners, upgrade, sidebarItems, landingLinks }
}
