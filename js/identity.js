// "The cat that is you": nickname + cat avatar for groups, and the phone's keys behind it.
//
// No account and no password. Each phone creates two P-256 key pairs (ECDSA to sign requests, ECDH to
// receive group keys). The member id is derived from the signing public key. If cloud backup is on, the
// identity travels inside the encrypted backup (js/sync.js), so a new phone paired with the sync code
// becomes the same member. See docs/groups-spec.md §5.1 and §7.1.

const KEY = 'nk.identity'

export const CAT_COLORS = [
  { id: 'cream', label: 'שמנת', fill: '#fffaf5' },
  { id: 'lilac', label: 'לילך', fill: '#c9a3dd' },
  { id: 'blush', label: 'ורוד', fill: '#f4a9c4' },
  { id: 'sun', label: 'זהב', fill: '#f2c14e' },
  { id: 'mint', label: 'מנטה', fill: '#9fd8c8' },
  { id: 'sky', label: 'שמיים', fill: '#9cc4f0' },
]

export const ACCESSORIES = [
  { id: 'none', label: 'בלי' },
  { id: 'crown', label: 'כתר' },
  { id: 'shades', label: 'משקפי שמש' },
  { id: 'patch', label: 'רטייה' },
  { id: 'ninja', label: 'סרט נינג׳ה' },
  { id: 'wizard', label: 'כובע קוסם' },
  { id: 'mustache', label: 'שפם' },
  { id: 'bowtie', label: 'פפיון' },
]

const NICKNAMES = [
  'החתולה הסגולה', 'מלכת הקונוסים', 'נינג׳ה של חניות', 'הנוקם השקט', 'פרופסור עקיצות', 'הדוכסית של הדבק',
  'קפטן ספוילר', 'הגברת מהקומה השלישית', 'סוכן קטשופ', 'שף הנקמות', 'הברון מהמרפסת', 'נסיכת הנצנצים',
  'המפקד של המזגן', 'מאסטר הפתקים', 'הצל של הוואטסאפ', 'הרוזנת של הרמזים', 'גנרל גליטר', 'הזאב מהמשמרת',
  'החתול עם הכפפות', 'מלך הממים', 'דוקטור סרקזם', 'המכשפה של הצילומים', 'בלש הפרוסה האחרונה', 'נוקמת בחיוך',
]

/** A fresh nickname suggestion, never the same as `current`. */
export function suggestNickname(current = '', rnd = Math.random) {
  const options = NICKNAMES.filter((n) => n !== current)
  return options[Math.floor(rnd() * options.length)]
}

export function validNickname(s) {
  const n = String(s || '').trim()
  return n.length >= 2 && n.length <= 20
}

const colorOf = (id) => (CAT_COLORS.find((c) => c.id === id) || CAT_COLORS[0]).fill

/** The cat as SVG. `look` = { color, accessory }. */
export function catAvatar(look = {}, size = 64, label = '') {
  const acc = look.accessory || 'none'
  const fill = colorOf(look.color)
  const eyes = acc === 'shades'
    ? '<rect x="50" y="74" width="36" height="20" rx="9" fill="#3a2340"/><rect x="104" y="74" width="36" height="20" rx="9" fill="#3a2340"/><path d="M86 82 L104 82" stroke-width="4"/>'
    : acc === 'patch'
      ? '<ellipse cx="70" cy="86" rx="15" ry="12" fill="#3a2340"/><path d="M40 66 L150 60" stroke-width="3"/><path d="M112 88 Q120 80 128 88"/>'
      : '<path d="M62 88 Q70 80 78 88"/><path d="M112 88 Q120 80 128 88"/>'
  const extra = {
    none: '',
    crown: '<path d="M68 34 L74 6 L88 22 L95 2 L102 22 L116 6 L122 34 Z" fill="#f2c14e" stroke-width="3.5"/>',
    shades: '',
    patch: '',
    ninja: '<rect x="40" y="56" width="110" height="14" rx="6" fill="#b3204a" stroke-width="3"/><path d="M150 62 L176 50 M150 66 L174 78" stroke="#b3204a" stroke-width="6"/>',
    wizard: '<path d="M58 44 L95 -22 L132 44 Z" fill="#7f4fa0" stroke-width="3.5"/><path d="M95 4 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1z" fill="#f2c14e" stroke-width="0"/><path d="M50 44 L140 44" stroke-width="5"/>',
    mustache: '<path d="M95 110 Q80 124 62 112 Q78 112 95 104 Q112 112 128 112 Q110 124 95 110 Z" fill="#3a2340" stroke-width="2"/>',
    bowtie: '<path d="M78 138 L95 147 L78 156 Z M112 138 L95 147 L112 156 Z" fill="#f4a9c4" stroke-width="3"/><circle cx="95" cy="147" r="4" fill="#3a2340" stroke-width="0"/>',
  }[acc] || ''
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'
  return `<svg class="cat-avatar" ${a11y} width="${size}" height="${size}" viewBox="-5 -28 200 194" fill="none" stroke="#3a2340" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 70 L46 18 L82 46 Q95 42 108 46 L144 18 L150 70 Q160 96 150 116 Q130 146 95 146 Q60 146 40 116 Q30 96 40 70z" fill="${fill}"/>
    <path d="M52 30 L56 56 L74 46z" fill="#f4a9c4" stroke-width="0"/><path d="M138 30 L134 56 L116 46z" fill="#f4a9c4" stroke-width="0"/>
    ${eyes}
    <ellipse cx="62" cy="104" rx="9" ry="5" fill="#f4a9c4" stroke-width="0"/><ellipse cx="128" cy="104" rx="9" ry="5" fill="#f4a9c4" stroke-width="0"/>
    <path d="M90 100 L100 100 L95 106z" fill="#3a2340" stroke-width="2"/>${acc === 'mustache' ? '' : '<path d="M95 106 Q90 114 84 110 M95 106 Q100 114 106 110"/>'}
    <path d="M30 96 L12 92 M30 106 L14 110 M160 96 L178 92 M160 106 L176 110" stroke-width="3"/>
    ${extra}</svg>`
}

// ---------- Keys ----------

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function memberIdOf(signPubJwk) {
  const key = await crypto.subtle.importKey('jwk', signPubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
  const raw = await crypto.subtle.exportKey('raw', key)
  return hex(await crypto.subtle.digest('SHA-256', raw)).slice(0, 24)
}

/** New keys for this phone (JWK, so they fit in localStorage and in the encrypted backup). */
export async function newKeys() {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  const keys = {
    signPub: await crypto.subtle.exportKey('jwk', sign.publicKey),
    signPriv: await crypto.subtle.exportKey('jwk', sign.privateKey),
    dhPub: await crypto.subtle.exportKey('jwk', dh.publicKey),
    dhPriv: await crypto.subtle.exportKey('jwk', dh.privateKey),
    createdAt: new Date().toISOString(),
  }
  keys.memberId = await memberIdOf(keys.signPub)
  return keys
}

/** Signs a request: what the server will check (method, path, time, body hash). `body`: string or bytes. */
export async function signRequest(keys, method, path, body = '') {
  const time = String(Date.now())
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const bodyHash = hex(await crypto.subtle.digest('SHA-256', bytes))
  const priv = await crypto.subtle.importKey('jwk', keys.signPriv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(`${method}\n${path}\n${time}\n${bodyHash}`))
  return { 'X-Member': keys.memberId, 'X-Time': time, 'X-Sig': btoa(String.fromCharCode(...new Uint8Array(sig))) }
}

// ---------- Stored identity ----------
// { keys: {...}, profile: { nickname, color, accessory, updatedAt } }

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}
function store(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id))
  } catch {
    /* private mode */
  }
}

export const profile = () => load()?.profile || null

/** Saves the nickname and cat; creates the keys the first time. */
export async function saveProfile({ nickname, color, accessory }) {
  if (!validNickname(nickname)) throw new Error('כינוי צריך להיות באורך 2–20 תווים')
  const cur = load()
  const keys = cur?.keys || (await newKeys())
  const next = { keys, profile: { nickname: nickname.trim(), color, accessory, updatedAt: new Date().toISOString() } }
  store(next)
  return next
}

/**
 * Merges an identity that arrived from another phone of the same person (through the backup).
 * Keys: the older identity wins, so a person stays one member everywhere. Profile: the newer edit wins.
 * Returns true if anything changed here.
 */
export function adopt(remote) {
  if (!remote?.keys || !remote?.profile) return false
  const cur = load()
  if (!cur) {
    store(remote)
    return true
  }
  const keys = remote.keys.createdAt < cur.keys.createdAt ? remote.keys : cur.keys
  const profile = (remote.profile.updatedAt || '') > (cur.profile.updatedAt || '') ? remote.profile : cur.profile
  if (keys === cur.keys && profile === cur.profile) return false
  store({ keys, profile })
  return true
}

/** For the backup: a sortable stamp that makes the older keys win on the server (last write wins). */
export function backupStamp(id) {
  const created = Date.parse(id.keys.createdAt)
  const profileAt = Date.parse(id.profile.updatedAt)
  // Older keys → bigger stamp; same keys → newer profile → bigger stamp.
  return `${String(9e12 - created).padStart(13, '0')}.${String(profileAt).padStart(13, '0')}`
}
