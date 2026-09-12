import { useLayoutEffect, useSyncExternalStore } from 'react'
import './heroui-theme.css'
import './vmnet-refinements.css'
import './layout-redesign.css'

let mountedPages = 0
let mountedHomePages = 0

const wideLayoutQuery = '(min-width: 1024px)'
function subscribeWideLayout(onChange: () => void) {
  const media = window.matchMedia(wideLayoutQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Keep tab keyboard navigation aligned with the responsive visual orientation. */
export function usePortalWideLayout() {
  return useSyncExternalStore(subscribeWideLayout, () => window.matchMedia(wideLayoutQuery).matches, () => false)
}

/** Scope the theme to mounted portal pages, including overlays rendered into body. */
export function usePortalTheme(surface: 'portal' | 'home' = 'portal') {
  useLayoutEffect(() => {
    mountedPages += 1
    document.body.setAttribute('data-portal-theme', 'heroui')
    if (surface === 'home') {
      mountedHomePages += 1
      document.body.setAttribute('data-vmnet-home', '')
    }

    return () => {
      if (surface === 'home') {
        mountedHomePages -= 1
        if (mountedHomePages === 0) document.body.removeAttribute('data-vmnet-home')
      }
      mountedPages -= 1
      if (mountedPages === 0) {
        document.body.removeAttribute('data-portal-theme')
      }
    }
  }, [surface])
}
