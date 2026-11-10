// Icons and drawings from the design's component library (Nekamot.Icon), as SVG strings.

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" data-fill/>',
  bulb: '<path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" data-fill/><path d="M9.5 20h5"/>',
  chart: '<path d="M4 20h16"/><rect x="5.5" y="13" width="3" height="7" rx="1" data-fill/><rect x="10.5" y="8" width="3" height="12" rx="1" data-fill/><rect x="15.5" y="4" width="3" height="16" rx="1" data-fill/>',
  settings: '<path d="M20.8 10.2 L20.8 13.8 L17.8 15.9 L15.9 17.8 L13.8 20.8 L10.2 20.8 L8.1 17.8 L6.2 15.9 L3.2 13.8 L3.2 10.2 L6.2 8.1 L8.1 6.2 L10.2 3.2 L13.8 3.2 L15.9 6.2 L17.8 8.1z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4" data-fill/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  note: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" data-fill/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="3" data-fill/><path d="M4 10h16M9 3v4M15 3v4"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z" data-fill/>',
  sparkle: '<path d="M12 3c.8 5.6 3.4 8.2 9 9-5.6.8-8.2 3.4-9 9-.8-5.6-3.4-8.2-9-9 5.6-.8 8.2-3.4 9-9z" data-fill/>',
  flame: '<path d="M12 21c-4 0-7-2.8-7-6.6 0-3.6 3-5.4 3.6-9.4 2.4 1.6 3.4 3.6 3.4 5.4 1-.9 1.6-2.1 1.6-3.6 2.6 2 5.4 4.6 5.4 7.6 0 3.8-3 6.6-7 6.6z" data-fill/>',
  crown: '<path d="M5 18L3.5 8l5 4L12 5l3.5 7 5-4L19 18z" data-fill/><path d="M5 21h14"/>',
  cupcake: '<path d="M6 13h12l-1.6 8H7.6z" data-fill/><path d="M5.5 13a3 3 0 0 1 1.3-5.7 5.3 5.3 0 0 1 10.4 0 3 3 0 0 1 1.3 5.7z"/><path d="M12 3v-.5"/>',
  bolt: '<path d="M13.5 2.5L5 14h6l-1 7.5L18.5 10h-6z" data-fill/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" data-fill/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="3" data-fill/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z" data-fill/><path d="M13.5 7.5l3 3"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l1 13h8l1-13" data-fill/>',
  undo: '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="4" data-fill/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5" data-fill/><path d="M11 18h2"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" data-fill/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5" data-fill/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
}

export const ICON_NAMES = Object.keys(ICONS)

/** An icon as an SVG string. `fill` is a token name (e.g. 'lilac-300'). */
export function icon(name, size = 24, fill) {
  const f = fill ? `var(--${fill})` : 'none'
  const body = (ICONS[name] || '').replace(/ data-fill/g, ` fill="${f}"`)
  return `<svg class="nk-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/** The cat from the splash screen. */
export function cat(width = 190) {
  const h = Math.round((width * 150) / 190)
  return `<svg class="cat" role="img" aria-label="חתלתול" width="${width}" height="${h}" viewBox="0 0 190 150" fill="none" stroke="var(--ink)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 70 L46 18 L82 46 Q95 42 108 46 L144 18 L150 70 Q160 96 150 116 Q130 146 95 146 Q60 146 40 116 Q30 96 40 70z" fill="var(--surface-raised)"/>
    <path d="M52 30 L56 56 L74 46z" fill="var(--blush)" stroke-width="0"/><path d="M138 30 L134 56 L116 46z" fill="var(--blush)" stroke-width="0"/>
    <path d="M62 88 Q70 80 78 88"/><path d="M112 88 Q120 80 128 88"/>
    <ellipse cx="62" cy="104" rx="9" ry="5" fill="var(--blush)" stroke-width="0"/><ellipse cx="128" cy="104" rx="9" ry="5" fill="var(--blush)" stroke-width="0"/>
    <path d="M90 100 L100 100 L95 106z" fill="var(--ink)" stroke-width="2"/><path d="M95 106 Q90 114 84 110 M95 106 Q100 114 106 110"/>
    <path d="M30 96 L12 92 M30 106 L14 110 M160 96 L178 92 M160 106 L176 110" stroke-width="3"/></svg>`
}

/** The small cat head in the header. */
export function catHead() {
  return `<svg role="img" aria-label="חתלתול" width="44" height="40" viewBox="0 0 190 150" fill="var(--surface-raised)" stroke="var(--ink)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M40 70 L46 18 L82 46 Q95 42 108 46 L144 18 L150 70 Q160 96 150 116 Q130 146 95 146 Q60 146 40 116 Q30 96 40 70z"/><path d="M62 88 Q70 80 78 88 M112 88 Q120 80 128 88" fill="none"/><path d="M90 102 L100 102 L95 108z" fill="var(--ink)" stroke-width="3"/></svg>`
}

const HEART = 'M12 20s-7.5-4.4-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z'
const STAR = 'M12 3c.8 5.6 3.4 8.2 9 9-5.6.8-8.2 3.4-9 9-.8-5.6-3.4-8.2-9-9 5.6-.8 8.2-3.4 9-9z'

/** Decorative heart or sparkle, absolutely positioned with `style`. */
export function deco(kind, size, style, fill) {
  const d = kind === 'heart' ? HEART : STAR
  const f = fill || (kind === 'heart' ? 'var(--lilac-300)' : 'var(--sun)')
  const stroke = fill === 'var(--ink)' ? '' : ' stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round"'
  return `<svg class="deco" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" style="${style}" fill="${f}"${stroke}><path d="${d}"/></svg>`
}
