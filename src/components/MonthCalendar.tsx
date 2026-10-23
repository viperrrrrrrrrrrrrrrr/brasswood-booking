import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, pad, parseDate, todayStr } from '../lib/date'
import type { DateStr } from '../lib/types'
import { cn } from './ui'

export function monthKey(d: DateStr) {
  return d.slice(0, 7)
}

export function monthRange(month: string): { first: DateStr; last: DateStr } {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { first: `${month}-01`, last: `${month}-${pad(lastDay)}` }
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

interface Props {
  month: string
  onMonthChange: (m: string) => void
  value: DateStr | null
  onChange: (d: DateStr) => void
  isEnabled: (d: DateStr) => boolean
  minMonth?: string
  maxMonth?: string
  loading?: boolean
}

export function MonthCalendar({ month, onMonthChange, value, onChange, isEnabled, minMonth, maxMonth, loading }: Props) {
  const { first, last } = monthRange(month)
  const firstDow = (parseDate(first).getDay() + 6) % 7 // Monday-first
  const days: (DateStr | null)[] = Array(firstDow).fill(null)
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d)
  const today = todayStr()
  const label = parseDate(first).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-stone-900">{label}</p>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!!minMonth && month <= minMonth}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!!maxMonth && month >= maxMonth}
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100 disabled:opacity-30"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-stone-400">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className={cn('grid grid-cols-7 gap-1 transition-opacity', loading && 'opacity-50')}>
        {days.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const enabled = isEnabled(d)
          const selected = d === value
          return (
            <button
              key={d}
              type="button"
              data-date={d}
              disabled={!enabled}
              onClick={() => onChange(d)}
              aria-pressed={selected}
              aria-label={parseDate(d).toDateString()}
              className={cn(
                'relative aspect-square rounded-xl text-sm font-medium transition sm:aspect-auto sm:h-11',
                selected
                  ? 'bg-ink text-white shadow'
                  : enabled
                    ? 'bg-brand-50 text-stone-900 hover:bg-brand-100'
                    : 'text-stone-300',
              )}
            >
              {Number(d.slice(8))}
              {d === today && <span className={cn('absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full', selected ? 'bg-white' : 'bg-brand-500')} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
