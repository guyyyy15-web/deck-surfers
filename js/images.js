// Photo helpers: decode a picked file, shrink it, and turn blobs into URLs we can show.
import { fitWithin } from './logic.js'
import { getPhoto } from './db.js'

/** Documentation photos: big enough to see what happened, small enough that hundreds fit. */
export const DOC_SIDE = 1600
export const FACE_SIDE = 512

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve({ img, url })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('not an image'))
    }
    img.src = url
  })
}

export function toBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode'))), 'image/jpeg', quality),
  )
}

export async function shrinkFile(file, max = DOC_SIDE) {
  const { img, url } = await loadImage(file)
  try {
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, max)
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    c.getContext('2d').drawImage(img, 0, 0, width, height)
    return await toBlob(c, 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Object URLs for stored photos, made once per session.
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
export function rememberUrl(id, blob) {
  const u = URL.createObjectURL(blob)
  urls.set(id, u)
  return u
}
export function forgetUrl(id) {
  const u = urls.get(id)
  if (u) URL.revokeObjectURL(u)
  urls.delete(id)
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
export async function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)[1]
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
