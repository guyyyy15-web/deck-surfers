// The duckling that is you. Plain SVG strings, so they work in lists, sheets and the splash alike.

export const DUCK_COLORS = [
  { id: 'sun', label: 'צהוב', fill: '#FFD54A' },
  { id: 'pink', label: 'ורוד', fill: '#FFB3C7' },
  { id: 'mint', label: 'מנטה', fill: '#9FE0C4' },
  { id: 'sky', label: 'תכלת', fill: '#A9D4FF' },
  { id: 'lilac', label: 'סגול', fill: '#CDB8F2' },
  { id: 'peach', label: 'אפרסק', fill: '#FFC99E' },
]

// The crown is not on the list: it belongs to whoever runs the yard (the mother duck).
export const ACCESSORIES = [
  { id: 'none', label: 'בלי' },
  { id: 'shades', label: 'משקפי שמש' },
  { id: 'flower', label: 'פרח' },
  { id: 'cap', label: 'כובע' },
  { id: 'bow', label: 'סרט' },
  { id: 'beanie', label: 'כובע גרב' },
]

const INK = '#3A2E1F'
export const colorFill = (id) => (DUCK_COLORS.find((c) => c.id === id) || DUCK_COLORS[0]).fill
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** `look` = { color, accessory }; `crown` = runs the yard. Faces the reading direction (left, in Hebrew). */
export function duck(look = {}, size = 48, { label = '', crown = false } = {}) {
  const fill = colorFill(look.color)
  const acc = look.accessory || 'none'
  const eye = acc === 'shades'
    ? `<rect x="22" y="31" width="14" height="9" rx="4" fill="${INK}"/><rect x="38" y="31" width="10" height="9" rx="4" fill="${INK}"/>`
    : `<circle cx="33" cy="37" r="3.5" fill="${INK}"/>`
  const top = crown
    ? `<path d="M26 22 L25 8 L32 15 L37 4 L42 15 L49 8 L49 22 Z" fill="#FFB020" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`
    : {
        none: '',
        shades: '',
        flower: `<g transform="translate(46 20)"><circle r="5" cx="0" cy="-6" fill="#FF8FB1"/><circle r="5" cx="6" cy="0" fill="#FF8FB1"/><circle r="5" cx="0" cy="6" fill="#FF8FB1"/><circle r="5" cx="-6" cy="0" fill="#FF8FB1"/><circle r="3.5" fill="#FFD54A" stroke="${INK}" stroke-width="2"/></g>`,
        cap: `<path d="M22 26 Q38 6 54 26 Z" fill="#4C8DFF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M22 26 L8 28" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
        bow: `<path d="M34 18 L24 12 L24 24 Z M34 18 L44 12 L44 24 Z" fill="#FF6B8A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="34" cy="18" r="3" fill="${INK}"/>`,
        beanie: `<path d="M22 26 Q38 4 54 26 Z" fill="#7BC67E" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><circle cx="38" cy="9" r="4.5" fill="#FFF8EC" stroke="${INK}" stroke-width="2.5"/>`,
      }[acc] || ''
  const a11y = label ? `role="img" aria-label="${attr(label)}"` : 'aria-hidden="true"'
  return `<svg class="duck" ${a11y} width="${size}" height="${size}" viewBox="0 0 100 100"><ellipse cx="54" cy="70" rx="32" ry="22" fill="${fill}" stroke="${INK}" stroke-width="3.5"/><circle cx="38" cy="42" r="21" fill="${fill}" stroke="${INK}" stroke-width="3.5"/><path d="M18 41 L3 46 L18 51 Z" fill="#FF9A3C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>${eye}<ellipse cx="28" cy="48" rx="5" ry="3" fill="#FF9FB2"/><path d="M70 68 Q58 58 45 66" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>${top}</svg>`
}
