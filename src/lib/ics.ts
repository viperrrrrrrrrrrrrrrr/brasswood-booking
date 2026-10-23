import type { DateStr } from './types'
import { pad } from './date'

function stamp(date: DateStr, min: number) {
  return `${date.replace(/-/g, '')}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`
}

export function downloadIcs(opts: { uid: string; title: string; description: string; location: string; date: DateStr; start: number; end: number }) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Brasswood Booking Demo//EN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}@brasswood.example`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(opts.date, opts.start)}`,
    `DTEND:${stamp(opts.date, opts.end)}`,
    `SUMMARY:${opts.title}`,
    `DESCRIPTION:${opts.description.replace(/\n/g, '\\n')}`,
    `LOCATION:${opts.location}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.uid}.ics`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
