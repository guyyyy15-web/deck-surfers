// The duckling that is you. Plain SVG strings (no ids, no gradients, no clip paths), so the same picture works in
// lists, sheets, notifications and the splash, many times on one page.
//
// A look has slots, one item each: hat, face, neck, body (clothes, with a color), held, plus color and mood.
// Older profiles had a single `accessory`; lookOf() moves it into the right slot.

export const DUCK_COLORS = [
  { id: 'sun', label: 'צהוב', fill: '#FFD54A' },
  { id: 'pink', label: 'ורוד', fill: '#FFB3C7' },
  { id: 'mint', label: 'מנטה', fill: '#9FE0C4' },
  { id: 'sky', label: 'תכלת', fill: '#A9D4FF' },
  { id: 'lilac', label: 'סגול', fill: '#CDB8F2' },
  { id: 'peach', label: 'אפרסק', fill: '#FFC99E' },
  { id: 'white', label: 'לבן', fill: '#FBF7EF' },
  { id: 'cocoa', label: 'שוקו', fill: '#C9A27E' },
]

export const CLOTH_COLORS = [
  { id: 'red', label: 'אדום', fill: '#E2574C' },
  { id: 'blue', label: 'כחול', fill: '#4C8DFF' },
  { id: 'green', label: 'ירוק', fill: '#4FB06D' },
  { id: 'yellow', label: 'צהוב', fill: '#FFC93C' },
  { id: 'purple', label: 'סגול', fill: '#9B7BE0' },
  { id: 'pink', label: 'ורוד', fill: '#FF7FA8' },
  { id: 'denim', label: 'ג׳ינס', fill: '#5B7DB1' },
  { id: 'black', label: 'שחור', fill: '#3B3646' },
]

export const MOODS = [
  { id: 'happy', label: 'שמח' },
  { id: 'wink', label: 'קורץ' },
  { id: 'shy', label: 'נבוך' },
  { id: 'wow', label: 'מופתע' },
  { id: 'cool', label: 'קול' },
  { id: 'sleepy', label: 'ישנוני' },
]

// The crown is not on these lists: it belongs to whoever runs the yard (the mother duck).
export const SLOTS = {
  hat: {
    label: 'על הראש',
    items: [
      { id: 'none', label: 'בלי' }, { id: 'cap', label: 'כובע' }, { id: 'beanie', label: 'כובע גרב' }, { id: 'party', label: 'כובע מסיבה' },
      { id: 'chef', label: 'כובע שף' }, { id: 'beret', label: 'ברט' }, { id: 'tophat', label: 'צילינדר' }, { id: 'ears', label: 'אוזני חתול' },
      { id: 'phones', label: 'אוזניות' }, { id: 'bow', label: 'סרט' }, { id: 'flower', label: 'פרח' }, { id: 'sprout', label: 'נבט' }, { id: 'cherry', label: 'דובדבנים' },
    ],
  },
  face: {
    label: 'משקפיים',
    items: [{ id: 'none', label: 'בלי' }, { id: 'shades', label: 'משקפי שמש' }, { id: 'hearts', label: 'לבבות' }, { id: 'round', label: 'עגולים' }, { id: 'stars', label: 'כוכבים' }],
  },
  neck: {
    label: 'צוואר',
    items: [{ id: 'none', label: 'בלי' }, { id: 'scarf', label: 'צעיף' }, { id: 'bowtie', label: 'פפיון' }, { id: 'tie', label: 'עניבה' }, { id: 'pearls', label: 'פנינים' }, { id: 'bandana', label: 'בנדנה' }],
  },
  body: {
    label: 'בגדים',
    items: [
      { id: 'none', label: 'בלי' }, { id: 'tshirt', label: 'חולצה' }, { id: 'hoodie', label: 'קפוצ׳ון' }, { id: 'sweater', label: 'סוודר פסים' }, { id: 'dress', label: 'שמלה' },
      { id: 'overalls', label: 'סרבל' }, { id: 'apron', label: 'סינר' }, { id: 'raincoat', label: 'מעיל גשם' }, { id: 'cape', label: 'גלימה' },
    ],
  },
  held: {
    label: 'ביד',
    items: [{ id: 'none', label: 'כלום' }, { id: 'balloon', label: 'בלון' }, { id: 'coffee', label: 'קפה' }, { id: 'broom', label: 'מטאטא' }, { id: 'spatula', label: 'מרית' }, { id: 'flowers', label: 'זר' }, { id: 'phone', label: 'טלפון' }],
  },
}

// Kept for older code paths and older app versions (a profile still carries one `accessory`).
export const ACCESSORIES = [
  { id: 'none', label: 'בלי' },
  ...SLOTS.hat.items.slice(1), ...SLOTS.face.items.slice(1), ...SLOTS.neck.items.slice(1),
]

const INK = '#3A2E1F'
const BEAK = '#FF9A3C'
const BEAK_DARK = '#E9781F'
const has = (slot, id) => SLOTS[slot].items.some((i) => i.id === id)
export const colorFill = (id) => (DUCK_COLORS.find((c) => c.id === id) || DUCK_COLORS[0]).fill
const clothFill = (id) => (CLOTH_COLORS.find((c) => c.id === id) || CLOTH_COLORS[0]).fill
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The look in slots, from a new profile or an old one with a single `accessory`. */
export function lookOf(p) {
  p ||= {}
  const look = {
    color: DUCK_COLORS.some((c) => c.id === p.color) ? p.color : 'sun',
    mood: MOODS.some((m) => m.id === p.mood) ? p.mood : 'happy',
    hat: has('hat', p.hat) ? p.hat : 'none',
    face: has('face', p.face) ? p.face : 'none',
    neck: has('neck', p.neck) ? p.neck : 'none',
    body: has('body', p.body) ? p.body : 'none',
    bodyColor: CLOTH_COLORS.some((c) => c.id === p.bodyColor) ? p.bodyColor : p.body === 'overalls' ? 'denim' : p.body === 'raincoat' ? 'yellow' : 'red',
    held: has('held', p.held) ? p.held : 'none',
  }
  const slotsGiven = ['hat', 'face', 'neck', 'body', 'held'].some((k) => p[k] !== undefined)
  if (!slotsGiven && p.accessory && p.accessory !== 'none') {
    for (const slot of ['hat', 'face', 'neck']) if (has(slot, p.accessory)) look[slot] = p.accessory
  }
  return look
}

/** The one accessory older app versions understand (they show that one). */
export const legacyAccessory = (look) => [look.hat, look.face, look.neck].find((x) => x && x !== 'none' && x !== 'tophat' && x !== 'round' && x !== 'stars' && x !== 'tie' && x !== 'pearls' && x !== 'bandana') || 'none'

// ---------- Drawing ----------
// viewBox 0 -12 120 132. Head: circle (46, 48) r 26, so x 20–72, y 22–74; eye (36, 46); beak at x 4–23.
// Body: ellipse (64, 86) 33 × 24, so x 31–97, y 62–110; feet at y ≈ 111. The duck faces left (Hebrew reads that
// way). Depth comes from layers: base color, a darker crescent on the back, a lighter front, a shine, then the outline.

const S = (w = 2.5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`
const shade = 'fill="#2B1D0E" fill-opacity=".13"'
const shine = 'fill="#FFFFFF" fill-opacity=".55"'

// Clothes on the body: the body below a neckline at y 68 (an arc of the body's ellipse).
const SHIRT = 'M42.2 68 A33 24 0 1 0 85.8 68 Q64 74 42.2 68 Z'

function eyes(mood, fill) {
  switch (mood) {
    case 'wink': return `<path d="M30.5 47 Q36 41.5 41.5 47" fill="none" ${S(3)}/>`
    case 'shy': return `<path d="M30.5 45 Q36 50 41.5 45" fill="none" ${S(3)}/><ellipse cx="30" cy="58" rx="7" ry="3.8" fill="#FF7F9E" fill-opacity=".75"/>`
    case 'wow': return `<ellipse cx="36" cy="45.5" rx="5.4" ry="6.6" fill="${INK}"/><circle cx="34.3" cy="43" r="2.1" fill="#FFFFFF"/><circle cx="37.6" cy="48.4" r=".9" fill="#FFFFFF"/>`
    case 'cool': return `<ellipse cx="36" cy="46" rx="4.4" ry="5.4" fill="${INK}"/><path d="M30.5 46.5 L41.5 46.5 L41.5 39 L30.5 39 Z" fill="${fill}"/><path d="M30 46.5 L42 45" fill="none" ${S(2.8)}/>`
    case 'sleepy': return `<path d="M30.5 47 Q36 50.5 41.5 47" fill="none" ${S(3)}/><path d="M64 18 h6 l-6 7 h6 M74 10 h4.5 l-4.5 5 h4.5" fill="none" ${S(2)}/>`
    default: return `<ellipse cx="36" cy="46" rx="4.4" ry="5.4" fill="${INK}"/><circle cx="34.6" cy="43.8" r="1.7" fill="#FFFFFF"/><circle cx="37.3" cy="48.3" r=".8" fill="#FFFFFF"/>`
  }
}

function beak(mood) {
  if (mood === 'wow') {
    return `<path d="M22 58 Q14 66 9 60 Q14 56 22 58 Z" fill="#7A2E1A" ${S(2.2)}/><path d="M23 50 Q11 49.5 5 54.5 Q12 57 23 56 Z" fill="${BEAK}" ${S(2.6)}/><path d="M22 58 Q14 67.5 8 61.5" fill="none" ${S(2.4)}/>`
  }
  return `<path d="M22.5 58.5 Q15 63.5 8.5 58.5 Q15 58 22.5 58.5 Z" fill="${BEAK_DARK}" ${S(2.2)}/><path d="M23 50.5 Q11 50 5 55.5 Q12 59.5 23 58 Z" fill="${BEAK}" ${S(2.6)}/><path d="M9 54 Q12 53 15 53.6" stroke="#FFFFFF" stroke-opacity=".6" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
}

// Things that sit behind the duck (drawn first).
const BEHIND = {
  cape: (c) => `<path d="M60 64 Q96 62 110 104 Q98 112 84 110 Q86 86 66 72 Z" fill="${c}" ${S(2.5)}/><path d="M66 72 Q90 84 92 108" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="4"/>`,
  hoodie: (c) => `<circle cx="51" cy="46" r="30" fill="${c}" ${S(2.6)}/><circle cx="51" cy="46" r="30" fill="#000" fill-opacity=".12"/>`,
}

const BODY = {
  tshirt: (c) => `<path d="${SHIRT}" fill="${c}" ${S(2.5)}/><path d="M52 92 l2.2 4.4 4.8.7 -3.5 3.4.8 4.8 -4.3-2.3 -4.3 2.3.8-4.8 -3.5-3.4 4.8-.7Z" fill="#FFFFFF" fill-opacity=".9"/>`,
  hoodie: (c) => `<path d="${SHIRT}" fill="${c}" ${S(2.5)}/><path d="M48 96 Q64 92 80 96 L78 104 Q64 101 50 104 Z" fill="#000" fill-opacity=".12" ${S(1.8)}/><path d="M60 74 L59 86 M68 74 L68.5 86" ${S(2)}/><circle cx="59" cy="87" r="1.6" fill="${INK}"/><circle cx="68.5" cy="87" r="1.6" fill="${INK}"/>`,
  sweater: (c) => `<path d="${SHIRT}" fill="${c}" ${S(2.5)}/><path d="M32 82 Q64 88 96.5 82 M33 92 Q64 98 96 92 M37.5 101 Q64 107 91 101" fill="none" stroke="#FFFFFF" stroke-opacity=".75" stroke-width="3.2" stroke-linecap="round"/>`,
  dress: (c) => `<path d="M33 90 Q64 98 95 90 L104 110 Q64 122 24 110 Z" fill="${c}" ${S(2.5)}/><path d="${SHIRT}" fill="${c}" ${S(2.5)}/><path d="M30 107 Q64 117 98 107" fill="none" stroke="#FFFFFF" stroke-opacity=".8" stroke-width="2.4" stroke-dasharray="1 5" stroke-linecap="round"/>`,
  overalls: (c) => `<path d="M31.4 88 A33 24 0 0 0 96.6 88 Q64 94 31.4 88 Z" fill="${c}" ${S(2.5)}/><path d="M50 72 H74 V90 H50 Z" fill="${c}" ${S(2.4)}/><path d="M56 78 H68 V86 H56 Z" fill="#000" fill-opacity=".12"/><path d="M52 72 L48 64 M72 72 L80 63" ${S(3)}/><circle cx="53" cy="75" r="1.8" fill="#FFD54A" ${S(1.2)}/><circle cx="71" cy="75" r="1.8" fill="#FFD54A" ${S(1.2)}/>`,
  apron: (c) => `<path d="M44 74 H72 Q74 92 70 106 Q58 110 46 106 Q42 92 44 74 Z" fill="#FFFFFF" ${S(2.4)}/><path d="M50 92 H66 V100 H50 Z" fill="${c}" fill-opacity=".85" ${S(1.8)}/><path d="M72 84 Q84 86 90 82 M44 74 L46 66 M72 74 L74 66" fill="none" ${S(2)}/><path d="M44 76 H72" stroke="${c}" stroke-width="3"/>`,
  raincoat: (c) => `<path d="${SHIRT}" fill="${c}" ${S(2.5)}/><path d="M60 72 L58 108" fill="none" ${S(2)}/><circle cx="54" cy="80" r="2" fill="${INK}"/><circle cx="54" cy="90" r="2" fill="${INK}"/><circle cx="54" cy="100" r="2" fill="${INK}"/><path d="M44 70 L52 76 L62 70" fill="none" ${S(2.4)}/>`,
  cape: (c) => `<path d="M42 70 Q52 76 64 70 L62 76 Q52 80 44 76 Z" fill="${c}" ${S(2.2)}/><circle cx="54" cy="76" r="3" fill="#FFD54A" ${S(1.6)}/>`,
}

const NECK = {
  scarf: `<path d="M56 74 L58 94 L66 92 L63 73" fill="#E2574C" ${S(2.4)}/><path d="M24 64 Q46 80 70 64 L71 72 Q46 90 26 72 Z" fill="#E2574C" ${S(2.5)}/><path d="M31 71 L32.5 76 M40 75 L40.6 80 M49 76 L49 81 M58 74 L59 79 M65 70 L66.5 75" stroke="#FFD0C8" stroke-width="2" stroke-linecap="round"/>`,
  bowtie: `<path d="M33 76 L23 70 L23 82 Z M33 76 L43 70 L43 82 Z" fill="#4C8DFF" ${S(2.4)}/><circle cx="33" cy="76" r="3.3" fill="#2F6FE0" ${S(2)}/>`,
  tie: `<path d="M34 72 L40 72 L39 77 L35 77 Z" fill="#E2574C" ${S(2)}/><path d="M35 77 L33 94 L37 99 L41 94 L39 77 Z" fill="#E2574C" ${S(2.2)}/><path d="M34.5 84 L40 82 M34 90 L40.3 88" stroke="#FFFFFF" stroke-opacity=".6" stroke-width="1.6"/>`,
  pearls: [[27, 69], [31, 72.5], [35.5, 75], [40.5, 76.5], [45.5, 77], [50.5, 76.5], [55.5, 75], [60, 72.5], [64, 69]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#FFFDF5" ${S(1.3)}/>`).join(''),
  bandana: `<path d="M25 68 Q46 80 68 68 L50 92 Z" fill="#E2574C" ${S(2.4)}/><circle cx="40" cy="76" r="1.5" fill="#FFF"/><circle cx="50" cy="80" r="1.5" fill="#FFF"/><circle cx="56" cy="74" r="1.5" fill="#FFF"/><circle cx="48" cy="86" r="1.3" fill="#FFF"/>`,
}

// On the face; `true` = covers the eye (it is drawn instead of the eye).
const FACE = {
  shades: [true, `<rect x="26" y="40" width="21" height="13" rx="5.5" fill="${INK}"/><rect x="29" y="42.5" width="7" height="3" rx="1.5" fill="#FFFFFF" fill-opacity=".75"/><path d="M47 45 L71 42" fill="none" ${S(3)}/><path d="M26 46 L21 47" fill="none" ${S(3)}/>`],
  hearts: [true, `<path d="M36 55.5 C26.5 49.5 25.5 42 30.8 40.2 C33.4 39.4 35.3 40.7 36 42.8 C36.7 40.7 38.6 39.4 41.2 40.2 C46.5 42 45.5 49.5 36 55.5 Z" fill="#FF4F8B" ${S(2.3)}/><path d="M31.5 43.6 Q32.8 42.2 34.6 42.8" stroke="#FFFFFF" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M44.5 44.5 L71 42" fill="none" ${S(2.6)}/>`],
  round: [false, `<circle cx="36" cy="46" r="8.2" fill="#FFFFFF" fill-opacity=".25" ${S(2.4)}/><path d="M44.2 45 L71 42 M27.8 46.5 L21.5 47.5" fill="none" ${S(2.4)}/>`],
  stars: [true, `<path d="M36 36.5 l2.9 5.9 6.5.9 -4.7 4.6 1.1 6.4 -5.8-3 -5.8 3 1.1-6.4 -4.7-4.6 6.5-.9Z" fill="#FFC93C" ${S(2.2)}/><path d="M45 45 L71 42" fill="none" ${S(2.6)}/>`],
}

const HAT = {
  cap: `<path d="M24.5 32 Q46 0 68 31 Z" fill="#4C8DFF" ${S(2.8)}/><path d="M27 31 Q14 30 4 35 Q16 38 30 35 Z" fill="#2F6FE0" ${S(2.6)}/><circle cx="46" cy="14" r="2.4" fill="${INK}"/><path d="M40 10 Q46 7 52 10" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="2" fill="none"/>`,
  beanie: `<path d="M22.5 35 Q46 -6 70 35 Z" fill="#7BC67E" ${S(2.8)}/><path d="M21 35 Q46 27 71 35 L70 41 Q46 33 22 41 Z" fill="#5CA860" ${S(2.4)}/><circle cx="46" cy="4" r="5.5" fill="#FFF8EC" ${S(2.4)}/>`,
  party: `<path d="M31 28 L48 -9 L63 28 Z" fill="#B794F6" ${S(2.6)}/><path d="M36.5 17 L58 17 M41.5 6 L53.5 6" stroke="#FFD54A" stroke-width="3.4" stroke-linecap="round"/><circle cx="48" cy="-9" r="4.6" fill="#FFD54A" ${S(2)}/>`,
  chef: `<circle cx="32" cy="12" r="9.5" fill="#FFFFFF" ${S(2.6)}/><circle cx="60" cy="12" r="9.5" fill="#FFFFFF" ${S(2.6)}/><circle cx="46" cy="5" r="11.5" fill="#FFFFFF" ${S(2.6)}/><path d="M29 14 H63 V30 Q46 26 29 30 Z" fill="#FFFFFF" ${S(2.6)}/><path d="M38 16 V26 M46 15 V25 M54 16 V26" stroke="#E6D9BF" stroke-width="1.8"/>`,
  beret: `<ellipse cx="48" cy="26" rx="25" ry="8.5" transform="rotate(-8 48 26)" fill="#E2574C" ${S(2.6)}/><path d="M49 18 L50 12" ${S(3.2)}/><path d="M36 22 Q46 17 58 19" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  tophat: `<path d="M33 -6 H59 V25 H33 Z" fill="#3B3646" ${S(2.6)}/><path d="M33 16 H59 V21 H33 Z" fill="#E2574C"/><ellipse cx="46" cy="25.5" rx="22" ry="4.6" fill="#3B3646" ${S(2.6)}/><path d="M37 -2 V12" stroke="#FFFFFF" stroke-opacity=".35" stroke-width="2.4" stroke-linecap="round"/>`,
  ears: `<path d="M23 38 Q46 14 69 36" fill="none" ${S(4)}/><path d="M26 32 L25 12 L37 24 Z" fill="#FFB3C7" ${S(2.6)}/><path d="M55 23 L66 10 L68 30 Z" fill="#FFB3C7" ${S(2.6)}/><path d="M28 28 L27.6 18.5 L33 24 Z M58.5 23 L64.5 16 L65.5 25.5 Z" fill="#FF8FB1"/>`,
  phones: `<path d="M21 46 Q34 0 74 40" stroke="#4A4560" stroke-width="5.5" fill="none" stroke-linecap="round"/><rect x="66" y="38" width="13" height="18" rx="6" fill="#FF6B8A" ${S(2.6)}/><rect x="69" y="41" width="4" height="7" rx="2" fill="#FFFFFF" fill-opacity=".5"/>`,
  bow: `<path d="M46 22 L33 13 L33 31 Z M46 22 L59 13 L59 31 Z" fill="#FF6B8A" ${S(2.6)}/><circle cx="46" cy="22" r="3.8" fill="#E2457A" ${S(2.2)}/>`,
  flower: `<g transform="translate(60 26)">${[[0, -7], [7, 0], [0, 7], [-7, 0]].map(([x, y]) => `<circle r="6" cx="${x}" cy="${y}" fill="#FF8FB1" ${S(1.6)}/>`).join('')}<circle r="4.2" fill="#FFD54A" ${S(2)}/></g>`,
  sprout: `<path d="M46 22 Q45 14 47 8" stroke="#3E8E4F" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M47 10 Q37 0 31 8 Q39 14 47 10 Z" fill="#8BD48C" ${S(2.2)}/><path d="M47 9 Q57 -1 63 6 Q56 13 47 9 Z" fill="#8BD48C" ${S(2.2)}/>`,
  cherry: `<path d="M52 8 Q48 16 47 25 M52 8 Q57 14 59 23" stroke="#3E8E4F" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M52 8 Q59 2 65 6 Q59 11 52 8 Z" fill="#8BD48C" ${S(1.9)}/><circle cx="47" cy="27" r="5.4" fill="#E2457A" ${S(2.3)}/><circle cx="59.5" cy="25.5" r="5.4" fill="#E2457A" ${S(2.3)}/><circle cx="45.4" cy="25.3" r="1.4" fill="#FFF"/><circle cx="57.9" cy="23.8" r="1.4" fill="#FFF"/>`,
}
const CROWN = `<path d="M31 25 L30 8 L39 16 L46 3 L53 16 L62 8 L61 25 Z" fill="#FFB020" ${S(2.8)}/><circle cx="46" cy="17" r="2.6" fill="#E2457A" ${S(1.4)}/><path d="M33 21 H59" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="2"/>`

// Held in the wing (the wing is at the back of the body, x 66–92).
const HELD = {
  balloon: `<path d="M84 82 Q92 58 99 36" fill="none" stroke="${INK}" stroke-width="1.6"/><ellipse cx="101" cy="22" rx="11.5" ry="14" fill="#FF6B8A" ${S(2.4)}/><path d="M99 35 L101 37.5 L103 35 Z" fill="#FF6B8A" ${S(1.6)}/><ellipse cx="97" cy="16" rx="3" ry="4.5" fill="#FFFFFF" fill-opacity=".6"/>`,
  coffee: `<path d="M86 66 H100 L98 82 H88 Z" fill="#FFFFFF" ${S(2.4)}/><path d="M86 70 H100" stroke="#C9A27E" stroke-width="3"/><path d="M100 70 Q106 72 99 78" fill="none" ${S(2)}/><path d="M90 62 Q88 58 91 55 M95 62 Q93 58 96 55" fill="none" stroke="${INK}" stroke-opacity=".5" stroke-width="1.8" stroke-linecap="round"/>`,
  broom: `<path d="M104 30 L86 102" stroke="#B07A45" stroke-width="4.2" stroke-linecap="round"/><path d="M104 30 L86 102" stroke="${INK}" stroke-width="1" stroke-opacity=".35"/><path d="M80 100 Q87 96 94 100 L99 116 Q86 120 74 116 Z" fill="#FFC93C" ${S(2.3)}/><path d="M80 104 L77.5 115 M86.5 103 L86 117 M93 104 L95.5 115" stroke="#C99A1E" stroke-width="1.5" stroke-linecap="round"/><path d="M80 100 Q87 96 94 100" stroke="#E2574C" stroke-width="3" fill="none"/>`,
  spatula: `<path d="M82 88 L98 50" stroke="#3B3646" stroke-width="4" stroke-linecap="round"/><rect x="92" y="30" width="14" height="20" rx="3" transform="rotate(22 99 40)" fill="#9CA3AF" ${S(2.2)}/><path d="M97 34 L99 46 M101 33 L103 45" stroke="${INK}" stroke-width="1.4" stroke-opacity=".5" transform="rotate(22 99 40)"/>`,
  flowers: `<path d="M84 84 L92 52 M84 84 L100 56 M84 84 L84 54" stroke="#3E8E4F" stroke-width="2.4" stroke-linecap="round"/><circle cx="92" cy="50" r="5" fill="#FF8FB1" ${S(1.8)}/><circle cx="101" cy="55" r="5" fill="#FFC93C" ${S(1.8)}/><circle cx="84" cy="51" r="5" fill="#B794F6" ${S(1.8)}/><circle cx="92" cy="50" r="1.8" fill="#FFF"/><circle cx="101" cy="55" r="1.8" fill="#FFF"/><circle cx="84" cy="51" r="1.8" fill="#FFF"/>`,
  phone: `<rect x="84" y="62" width="14" height="23" rx="3" transform="rotate(-12 91 73)" fill="#3B3646" ${S(2.2)}/><rect x="86.5" y="65.5" width="9" height="15" rx="1.5" transform="rotate(-12 91 73)" fill="#A9D4FF"/>`,
}

/**
 * The duckling as SVG. `p` = a profile (or look): color, mood, hat, face, neck, body, bodyColor, held — or the old
 * single `accessory`. `crown` = runs the yard (it takes the hat's place).
 */
export function duck(p, size = 48, { label = '', crown = false } = {}) {
  const look = lookOf(p)
  const fill = colorFill(look.color)
  const cloth = clothFill(look.bodyColor)
  const [coversEye, faceSvg] = FACE[look.face] || [false, '']
  const behind = BEHIND[look.body]?.(cloth) || ''
  const wingFill = ['tshirt', 'hoodie', 'sweater', 'raincoat', 'dress'].includes(look.body) ? cloth : fill
  const a11y = label ? `role="img" aria-label="${attr(label)}"` : 'aria-hidden="true"'
  return `<svg class="duck" ${a11y} width="${size}" height="${size}" viewBox="0 -12 120 132">${behind}`
    // feet and tail
    + `<ellipse cx="54" cy="111" rx="8.5" ry="4" fill="${BEAK}" ${S(2.2)}/><ellipse cx="73" cy="111" rx="8.5" ry="4" fill="${BEAK}" ${S(2.2)}/>`
    + `<path d="M92 76 Q102 66 108 68 Q104 76 96 86 Z" fill="${fill}" ${S(2.6)}/>`
    // body: base, shaded back, lighter front, belly, outline
    + `<ellipse cx="64" cy="86" rx="33" ry="24" fill="${fill}"/><ellipse cx="64" cy="86" rx="33" ry="24" ${shade}/><ellipse cx="60.5" cy="83" rx="30" ry="21" fill="${fill}"/>`
    + `<ellipse cx="55" cy="93" rx="17" ry="10" fill="#FFFFFF" fill-opacity=".28"/><ellipse cx="64" cy="86" rx="33" ry="24" fill="none" ${S(3.2)}/>`
    + (BODY[look.body]?.(cloth) || '')
    // wing (a sleeve when the clothes have sleeves)
    + `<path d="M64 82 Q80 70 94 82 Q90 96 70 96 Q60 92 64 82 Z" fill="${wingFill}" ${S(2.8)}/><path d="M70 92 Q82 92 90 84" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>`
    + (HELD[look.held] || '')
    // head: base, shaded back, lighter front, shine, outline, a curl of hair
    + `<circle cx="46" cy="48" r="26" fill="${fill}"/><circle cx="46" cy="48" r="26" ${shade}/><circle cx="43" cy="45" r="23.5" fill="${fill}"/>`
    + `<ellipse cx="37" cy="33" rx="8" ry="4.6" transform="rotate(-24 37 33)" ${shine}/><circle cx="46" cy="48" r="26" fill="none" ${S(3.2)}/>`
    + `<path d="M44 24 C38 14 46 9 47 16 C50 8 58 12 52 22" fill="${fill}" ${S(2.6)}/>`
    + (NECK[look.neck] || '')
    // face
    + `<ellipse cx="29.5" cy="58" rx="5.5" ry="3.2" fill="#FF8FA8" fill-opacity=".7"/>`
    + beak(look.mood)
    + (coversEye ? '' : eyes(look.mood, fill))
    + faceSvg
    + (crown ? CROWN : HAT[look.hat] || '')
    + '</svg>'
}
