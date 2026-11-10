import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TYPES, typeOf, initialOf, colorFor, AVATAR_COLORS, toDay, parseDay, dayMonth, weekdayDate, monthTitle, daysUntil, dueLabel,
  sortOpen, groupByMonth, matches, stats, reminderIcs, cropBase, clampPos, zoomAt, cropRect, fitWithin, CIRCLE,
  readBackup, mergeRevenges, BACKUP_KIND, esc,
} from '../js/logic.js'
import { IDEAS } from '../js/ideas.js'
import { ICON_NAMES } from '../js/icons.js'

const NOW = new Date(2026, 10, 10, 12) // 10 Nov 2026

test('four revenge types, as in the design', () => {
  assert.deepEqual(TYPES.map((t) => t.label), ['אכזרית', 'גדולה', 'יצירתית', 'קטנה'])
  for (const t of TYPES) assert.ok(ICON_NAMES.includes(t.icon), t.icon)
  assert.equal(typeOf('nope').id, 'creative')
})

test('avatar initial and colour', () => {
  assert.equal(initialOf('רונית מהחשבות'), 'ר')
  assert.equal(initialOf('  "השליח"'), 'ה')
  assert.equal(initialOf('dani'), 'D')
  assert.equal(initialOf('🙂'), '?')
  assert.equal(colorFor('דני'), colorFor('דני'))
  assert.ok(AVATAR_COLORS.includes(colorFor('x')))
})

test('Hebrew dates match the design', () => {
  assert.equal(dayMonth(new Date(2026, 10, 3), NOW), '3 בנובמבר')
  assert.equal(dayMonth(new Date(2025, 10, 3), NOW), '3 בנובמבר 2025')
  assert.equal(weekdayDate('2026-11-15'), 'יום ראשון, 15 בנובמבר')
  assert.equal(monthTitle(new Date(2026, 9, 27)), 'אוקטובר 2026')
  assert.equal(toDay(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(parseDay('bad'), null)
})

test('reminder labels', () => {
  assert.equal(daysUntil('2026-11-10', NOW), 0)
  assert.deepEqual(dueLabel('2026-11-10', NOW), { text: 'היום!', late: true })
  assert.deepEqual(dueLabel('2026-11-11', NOW), { text: 'מחר', late: false })
  assert.deepEqual(dueLabel('2026-11-09', NOW), { text: 'התזכורת הייתה אתמול', late: true })
  assert.deepEqual(dueLabel('2026-11-05', NOW), { text: 'באיחור של 5 ימים', late: true })
  assert.deepEqual(dueLabel('2026-11-14', NOW), { text: 'בעוד 4 ימים', late: false })
  assert.equal(dueLabel('2026-12-01', NOW).text, '1 בדצמבר')
  assert.equal(dueLabel(undefined, NOW), null)
})

test('open list: reminders first, then newest', () => {
  const l = sortOpen([
    { id: 'a', createdAt: '2026-11-01' },
    { id: 'b', createdAt: '2026-11-05' },
    { id: 'c', createdAt: '2026-10-01', remindOn: '2026-11-20' },
    { id: 'd', createdAt: '2026-10-01', remindOn: '2026-11-12' },
  ])
  assert.deepEqual(l.map((r) => r.id), ['d', 'c', 'b', 'a'])
})

test('history grouped by month, newest first', () => {
  const g = groupByMonth([
    { id: '1', doneAt: new Date(2026, 9, 14).toISOString() },
    { id: '2', doneAt: new Date(2026, 10, 8).toISOString() },
    { id: '3', doneAt: new Date(2026, 10, 2).toISOString() },
  ])
  assert.deepEqual(g.map((x) => x.title), ['נובמבר 2026', 'אוקטובר 2026'])
  assert.deepEqual(g[0].items.map((r) => r.id), ['2', '3'])
})

test('search looks in name, why, plan and notes', () => {
  const r = { name: 'דני החניה', why: 'תופס לי את המקום', plan: 'קונוסים', notes: '' }
  assert.ok(matches(r, 'חניה'))
  assert.ok(matches(r, 'קונוס'))
  assert.ok(!matches(r, 'שליח'))
  assert.ok(matches(r, '  '))
})

test('stats', () => {
  const list = [
    { name: 'דני', type: 'small', status: 'open', createdAt: '2026-11-01T10:00:00Z' },
    { name: 'דני', type: 'small', status: 'done', createdAt: '2026-11-01T10:00:00Z', doneAt: '2026-11-05T10:00:00Z' },
    { name: 'רונית', type: 'cruel', status: 'done', createdAt: '2026-09-01T10:00:00Z', doneAt: '2026-10-10T10:00:00Z' },
  ]
  const s = stats(list, NOW)
  assert.equal(s.open, 1)
  assert.equal(s.done, 2)
  assert.equal(s.thisMonth, 1)
  assert.equal(s.rate, 67)
  assert.equal(s.byType.find((t) => t.id === 'small').count, 2)
  assert.equal(s.months.length, 6)
  assert.equal(s.months.at(-1).count, 1)
  assert.equal(s.months.at(-2).count, 1)
  assert.equal(s.avgDays, Math.round((4 + 39) / 2))
  assert.deepEqual(s.regular, { name: 'דני', count: 2 })
  assert.equal(stats([], NOW).avgDays, null)
})

test('calendar file is valid, folded and escaped', () => {
  const ics = reminderIcs({ id: 'x1', name: 'דני, החניה', why: 'שורה 1\nשורה; 2', remindOn: '2026-11-15' }, new Date('2026-11-10T08:00:00Z'))
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
  assert.match(ics, /DTSTART;VALUE=DATE:20261115\r\n/)
  assert.match(ics, /DTEND;VALUE=DATE:20261116\r\n/)
  assert.match(ics, /DTSTAMP:20261110T080000Z/)
  assert.match(ics, /TRIGGER:PT9H/)
  const unfolded = ics.replace(/\r\n /g, '')
  assert.ok(unfolded.includes('SUMMARY:נקמה: דני\\, החניה'))
  assert.ok(unfolded.includes('שורה 1\\nשורה\\; 2'))
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line)
  assert.equal(reminderIcs({ id: 'y', name: 'a', why: 'b' }), null)
})

test('crop keeps the circle covered and zooms around the finger', () => {
  const S = 340, D = S * CIRCLE, w = 1200, h = 800
  const base = cropBase(w, h, D)
  assert.equal(base, D / 800) // the short side fills the circle
  const c0 = (S - D) / 2
  // Dragging too far right/down is stopped at the circle's edge.
  assert.deepEqual(clampPos(500, 500, w, h, base, S, D), { x: c0, y: c0 })
  // Too far left/up likewise.
  const p = clampPos(-5000, -5000, w, h, base, S, D)
  assert.ok(Math.abs(p.x + w * base - (c0 + D)) < 1e-9 && Math.abs(p.y + h * base - (c0 + D)) < 1e-9)
  // Zooming keeps the pinch point still.
  const st = { scale: base, x: 10, y: 20 }
  const z = zoomAt(st, base * 2, 100, 150)
  const before = { ix: (100 - st.x) / st.scale, iy: (150 - st.y) / st.scale }
  const after = { ix: (100 - z.x) / z.scale, iy: (150 - z.y) / z.scale }
  assert.ok(Math.abs(before.ix - after.ix) < 1e-9 && Math.abs(before.iy - after.iy) < 1e-9)
  // Centred image at base scale: the crop is the middle square of the short side.
  const x = (S - w * base) / 2, y = (S - h * base) / 2
  const r = cropRect(x, y, base, S, D)
  assert.ok(Math.abs(r.size - 800) < 1e-6 && Math.abs(r.sx - 200) < 1e-6 && Math.abs(r.sy) < 1e-6)
})

test('photos shrink but never grow', () => {
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 })
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 })
})

test('backup: validate and merge', () => {
  assert.throws(() => readBackup({ kind: 'other' }), /לא קובץ גיבוי/)
  const { revenges, photos } = readBackup({
    kind: BACKUP_KIND,
    revenges: [{ id: 'a', name: 'x', status: 'open' }, { id: 'b', status: 'open' }, null],
    photos: [{ id: 'p', data: 'data:image/jpeg;base64,AAAA' }, { id: 'q', data: 'javascript:alert(1)' }],
  })
  assert.deepEqual(revenges.map((r) => r.id), ['a'])
  assert.deepEqual(photos.map((p) => p.id), ['p'])
  const m = mergeRevenges(
    [{ id: 'a', name: 'old', updatedAt: '2026-01-01' }, { id: 'b', name: 'keep', updatedAt: '2026-05-01' }],
    [{ id: 'a', name: 'new', updatedAt: '2026-02-01' }, { id: 'b', name: 'older', updatedAt: '2026-04-01' }, { id: 'c', name: 'add' }],
  )
  assert.equal(m.added, 1)
  assert.equal(m.updated, 1)
  assert.deepEqual(m.list.map((r) => r.name).sort(), ['add', 'keep', 'new'])
})

test('escaping user text', () => {
  assert.equal(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
})

test('ideas: valid, unique, every type covered', () => {
  const ids = new Set()
  for (const i of IDEAS) {
    assert.ok(!ids.has(i.id), `duplicate ${i.id}`)
    ids.add(i.id)
    assert.ok(TYPES.some((t) => t.id === i.type), i.id)
    assert.ok(i.title && i.text.length > 20, i.id)
  }
  for (const t of TYPES) assert.ok(IDEAS.filter((i) => i.type === t.id).length >= 5, t.id)
})
