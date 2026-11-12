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
  { id: 'hearts', label: 'משקפי לבבות' },
  { id: 'flower', label: 'פרח' },
  { id: 'bow', label: 'סרט' },
  { id: 'cap', label: 'כובע' },
  { id: 'beanie', label: 'כובע גרב' },
  { id: 'party', label: 'כובע מסיבה' },
  { id: 'chef', label: 'כובע שף' },
  { id: 'beret', label: 'ברט' },
  { id: 'ears', label: 'אוזני חתול' },
  { id: 'phones', label: 'אוזניות' },
  { id: 'sprout', label: 'נבט' },
  { id: 'cherry', label: 'דובדבנים' },
  { id: 'scarf', label: 'צעיף' },
  { id: 'bowtie', label: 'פפיון' },
]

const INK = '#3A2E1F'
export const colorFill = (id) => (DUCK_COLORS.find((c) => c.id === id) || DUCK_COLORS[0]).fill
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Geometry (viewBox 0 0 100 100): the head is a circle at (38, 42), r 21, so its top is y 21 and its back is x 59;
// the eye is at (33, 37); the neck, where head meets body, is around y 58–64. The duck faces left (Hebrew reads
// that way), so it is seen in profile: glasses are ONE lens over the eye with an arm towards the back of the head.
const S = (w = 2.5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`

/** Things over the eye (they replace the plain eye). */
const FACE = {
  shades: `<rect x="23" y="31" width="19" height="12" rx="5" fill="${INK}"/><rect x="26" y="33.5" width="6" height="2.6" rx="1.3" fill="#FFFFFF" opacity=".75"/><path d="M42 36 L58 33" ${S(3)} fill="none"/><path d="M23 37 L19 38" ${S(3)} fill="none"/>`,
  hearts: `<path d="M33 45 C25 40 24 33.5 28.5 31.8 C30.8 31 32.4 32.2 33 34 C33.6 32.2 35.2 31 37.5 31.8 C42 33.5 41 40 33 45 Z" fill="#FF4F8B" ${S(2.2)}/><path d="M29.5 34.5 Q30.5 33.3 32 33.8" stroke="#FFFFFF" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M40.5 35.5 L58 33" ${S(2.6)} fill="none"/>`,
}

/** Things on the head (the crown of whoever runs the yard takes their place). */
const HEAD = {
  flower: `<g transform="translate(47 21)"><circle r="5" cx="0" cy="-6" fill="#FF8FB1" ${S(1.5)}/><circle r="5" cx="6" cy="0" fill="#FF8FB1" ${S(1.5)}/><circle r="5" cx="0" cy="6" fill="#FF8FB1" ${S(1.5)}/><circle r="5" cx="-6" cy="0" fill="#FF8FB1" ${S(1.5)}/><circle r="3.6" fill="#FFD54A" ${S(2)}/></g>`,
  bow: `<path d="M38 19 L27 12 L27 26 Z M38 19 L49 12 L49 26 Z" fill="#FF6B8A" ${S(2.5)}/><circle cx="38" cy="19" r="3.2" fill="#E2457A" ${S(2)}/>`,
  cap: `<path d="M21 28 Q38 6 56 28 Z" fill="#4C8DFF" ${S(3)}/><path d="M21 28 L7 30" ${S(4)}/><circle cx="38" cy="13" r="2.2" fill="${INK}"/>`,
  beanie: `<path d="M21 28 Q38 3 56 28 Z" fill="#7BC67E" ${S(3)}/><path d="M20 27 Q38 22 57 27" ${S(3.5)} fill="none"/><circle cx="38" cy="9" r="4.8" fill="#FFF8EC" ${S(2.5)}/>`,
  party: `<path d="M27 25 L39 -1 L51 25 Z" fill="#B794F6" ${S(2.5)}/><path d="M31.5 16 L46.5 16 M35 8.5 L43 8.5" stroke="#FFD54A" stroke-width="3" stroke-linecap="round"/><circle cx="39" cy="-1" r="4" fill="#FFD54A" ${S(2)}/>`,
  chef: `<circle cx="28" cy="15" r="7.5" fill="#FFFFFF" ${S(2.5)}/><circle cx="48" cy="15" r="7.5" fill="#FFFFFF" ${S(2.5)}/><circle cx="38" cy="10" r="9" fill="#FFFFFF" ${S(2.5)}/><rect x="25" y="16" width="26" height="10" rx="3" fill="#FFFFFF" ${S(2.5)}/>`,
  beret: `<ellipse cx="40" cy="23" rx="18" ry="6.5" transform="rotate(-8 40 23)" fill="#E2574C" ${S(2.5)}/><path d="M41 16.5 L42 12" ${S(3)}/>`,
  ears: `<path d="M24 31 Q38 15 54 29" ${S(3.5)} fill="none"/><path d="M26 27 L25 11 L35 21 Z" fill="#FFB3C7" ${S(2.5)}/><path d="M42 21 L51 9 L53 25 Z" fill="#FFB3C7" ${S(2.5)}/><path d="M27.5 23 L27.2 15.5 L31.5 20 Z M45 21 L50 14.5 L51 21.5 Z" fill="#FF8FB1"/>`,
  phones: `<path d="M24 34 Q34 8 58 31" stroke="#4A4560" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="51" y="30" width="11" height="15" rx="5" fill="#FF6B8A" ${S(2.5)}/>`,
  sprout: `<path d="M40 22 Q39 15 41 10" stroke="#3E8E4F" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M41 12 Q33 3 28 10 Q34 15 41 12 Z" fill="#8BD48C" ${S(2)}/><path d="M41 11 Q49 2 54 8 Q48 14 41 11 Z" fill="#8BD48C" ${S(2)}/>`,
  cherry: `<path d="M43 10 Q40 16 39 24 M43 10 Q47 15 49 23" stroke="#3E8E4F" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M43 10 Q49 5 54 8 Q49 12 43 10 Z" fill="#8BD48C" ${S(1.8)}/><circle cx="39" cy="26" r="4.6" fill="#E2457A" ${S(2.2)}/><circle cx="49.5" cy="25" r="4.6" fill="#E2457A" ${S(2.2)}/><circle cx="37.6" cy="24.6" r="1.2" fill="#FFFFFF"/><circle cx="48" cy="23.6" r="1.2" fill="#FFFFFF"/>`,
}

/** Things at the neck (they go on with the crown too). */
const NECK = {
  scarf: `<path d="M56 60 L60 77 L67 74.5 L61 58" fill="#E2574C" ${S(2.5)}/><path d="M19 55 Q38 66 59 54 L61 61.5 Q38 74 20 62.5 Z" fill="#E2574C" ${S(2.5)}/><path d="M27 60.5 L28.5 65.5 M36 63 L36.8 68 M45 62.5 L45.5 67.5 M53 59.5 L54.5 64" stroke="#FFD0C8" stroke-width="2" stroke-linecap="round"/>`,
  bowtie: `<path d="M27 63 L18 57.5 L18 68.5 Z M27 63 L36 57.5 L36 68.5 Z" fill="#4C8DFF" ${S(2.4)}/><circle cx="27" cy="63" r="3.2" fill="#2F6FE0" ${S(2)}/>`,
}

/** `look` = { color, accessory }; `crown` = runs the yard. Faces the reading direction (left, in Hebrew). */
export function duck(look = {}, size = 48, { label = '', crown = false } = {}) {
  const fill = colorFill(look.color)
  const acc = look.accessory || 'none'
  const eye = FACE[acc] || `<circle cx="33" cy="37" r="3.5" fill="${INK}"/><circle cx="32" cy="35.8" r="1" fill="#FFFFFF"/>`
  const head = crown
    ? `<path d="M26 22 L25 8 L32 15 L37 4 L42 15 L49 8 L49 22 Z" fill="#FFB020" ${S(3)}/>`
    : HEAD[acc] || ''
  const neck = NECK[acc] || ''
  const a11y = label ? `role="img" aria-label="${attr(label)}"` : 'aria-hidden="true"'
  return `<svg class="duck" ${a11y} width="${size}" height="${size}" viewBox="0 -4 100 104"><ellipse cx="54" cy="70" rx="32" ry="22" fill="${fill}" stroke="${INK}" stroke-width="3.5"/><path d="M70 68 Q58 58 45 66" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><circle cx="38" cy="42" r="21" fill="${fill}" stroke="${INK}" stroke-width="3.5"/><path d="M18 41 L3 46 L18 51 Z" fill="#FF9A3C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><ellipse cx="28" cy="48" rx="5" ry="3" fill="#FF9FB2"/>${neck}${eye}${head}</svg>`
}
