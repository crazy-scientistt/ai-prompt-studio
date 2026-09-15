import React from 'react'

/* Local, responsive wine background. Source and license: assets/sources. */
export default function Background() {
  return (
    <div aria-hidden="true" className="app-background">
      <picture>
      <source media="(max-width: 640px)" srcSet="/bg-wine-960.webp" />
      <img
        src="/bg-wine-1920.webp"
        alt=""
        width={1920} height={1080} loading="eager"
        draggable={false}
      />
      </picture>
    </div>
  )
}
