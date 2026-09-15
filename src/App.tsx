import { useEffect, useState } from 'react'
import Admin from './components/Admin'
import Assets from './components/Assets'
import Background from './components/Background'
import History from './components/History'
import Onboarding from './components/Onboarding'
import Settings from './components/Settings'
import { SidebarDesktop, SidebarMobile, type Tab } from './components/Sidebar'
import Studio from './components/Studio'
import Toasts from './components/Toasts'
import TopBar from './components/TopBar'
import { gwRuntimeConfig } from './engine/gateway'
import { StoreProvider, useStore } from './store'

function readHash(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

/* ── Application shell ───────────────────────────────────────────────────────
   One predictable structure:

   APP (h-screen grid rows: main only — page scrolls inside the content region)
   ├── Background (decorative layer, fixed, pointer-events-none, aria-hidden)
   ├── Sidebar (fixed width, full-height, own region)
   └── Main (min-w-0)
       ├── TopBar (fixed-height row)
       └── Content region (the ONLY scroller on desktop; page transition lives here)

   Every page renders inside this same region → columns belong to one page,
   no unrelated vertical stacks, no dead voids.
   ──────────────────────────────────────────────────────────────────────────── */

function Shell() {
  const store = useStore()
  const { onboarded } = store
  const [tab, setTab] = useState<Tab>('studio')
  const [route, setRoute] = useState<string>(readHash())
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Hosted builds: the proxy address lives in the host's server-side env and is
  // fetched at runtime, so it never ships in the public JS bundle. A `?proxy=`
  // link always wins (that's the deliberate per-browser override).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('proxy')) return
    let alive = true
    gwRuntimeConfig().then((cfg) => {
      if (alive && cfg && cfg.url !== store.gateway.url) store.setGateway(cfg)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pageKey = route === 'admin' ? 'admin' : tab

  return (
    <div className="app-shell flex text-ink font-sans overflow-hidden">
      <Background />
      {/* no extra wrapper background — aurora image + scrim come from Background */}

      {/* desktop sidebar region */}
      <div className="hidden lg:flex shrink-0 h-full py-4 pl-4">
        <SidebarDesktop
          tab={tab}
          onTab={setTab}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      </div>

      {/* main region: top nav + the single content scroller */}
      <div className="flex-1 min-w-0 h-full flex flex-col px-4 lg:pl-4 py-4">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="app-main flex-1 min-h-0 mt-4 overflow-y-auto" tabIndex={-1}>
          {/* Studio stays mounted: switching tabs must never destroy an uploaded
              video, running analysis, or finished kit. It hides, it doesn't die. */}
          <div className={pageKey === 'studio' ? 'animate-page-in' : 'hidden'} aria-hidden={pageKey !== 'studio'}>
            <Studio />
          </div>
          {/* Other pages mount on demand with the page transition. */}
          {pageKey === 'history' && (
            <div key="history" className="animate-page-in"><History onOpen={() => setTab('studio')} /></div>
          )}
          {pageKey === 'assets' && (
            <div key="assets" className="animate-page-in"><Assets /></div>
          )}
          {pageKey === 'settings' && (
            <div key="settings" className="animate-page-in"><Settings /></div>
          )}
          {pageKey === 'admin' && (
            <div key="admin" className="animate-page-in"><Admin /></div>
          )}
        </main>
      </div>

      <Toasts />
      {!onboarded && route !== 'admin' && <Onboarding />}
      <SidebarMobile
        tab={tab}
        onTab={setTab}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
