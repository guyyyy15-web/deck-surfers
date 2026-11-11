// Proof photos: shrink before encrypting and uploading, and show stored ones.
import { getPhoto } from './db.js'

export const SIDE = 1280

export async function shrinkFile(file, max = SIDE) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('not an image'))
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.8))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const urls = new Map()
export async function photoUrl(id) {
  if (!id) return null
  if (urls.has(id)) return urls.get(id)
  const p = await getPhoto(id).catch(() => null)
  if (!p?.blob) return null
  const u = URL.createObjectURL(p.blob)
  urls.set(id, u)
  return u
}
