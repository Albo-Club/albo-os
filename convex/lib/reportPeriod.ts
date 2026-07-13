/**
 * Report period parsing (brick 5). Pure, unit-tested.
 *
 * Periods are normalized English strings ("January 2026", "Q4 2025",
 * "S1 2026", "2025", "November - December 2025") coming from the extraction
 * LLM. Parsing to [startMs, endMs] is DETERMINISTIC CODE — never delegated
 * to the model (validated design: no silent unit/date arithmetic by LLM).
 */

const MONTHS_EN = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MONTHS_FR: Record<string, number> = {
  janvier: 0,
  février: 1,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  août: 7,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  décembre: 11,
  decembre: 11,
}

function monthIndex(word: string): number | null {
  const w = word.toLowerCase()
  const en = MONTHS_EN.indexOf(w)
  if (en >= 0) return en
  if (w in MONTHS_FR) return MONTHS_FR[w]
  return null
}

function monthStart(year: number, month: number): number {
  return Date.UTC(year, month, 1)
}

function monthEnd(year: number, month: number): number {
  // Last ms of the month = start of next month - 1.
  return Date.UTC(year, month + 1, 1) - 1
}

export interface ParsedPeriod {
  startMs: number
  endMs: number
}

/**
 * Normalize a period string for display + dedup: French months translated,
 * whitespace collapsed, capitalized months ("janvier 2026" → "January 2026").
 */
export function normalizePeriodDisplay(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ')
  return cleaned
    .split(' ')
    .map((w) => {
      const idx = monthIndex(w)
      if (idx === null) return w
      const en = MONTHS_EN[idx]
      return en.charAt(0).toUpperCase() + en.slice(1)
    })
    .join(' ')
}

/** Parse a normalized period into UTC ms bounds. Null when unparseable. */
export function parsePeriod(display: string): ParsedPeriod | null {
  const s = display.trim()

  // "Q4 2025"
  let m = s.match(/^Q([1-4])\s+(\d{4})$/i)
  if (m) {
    const q = Number(m[1])
    const year = Number(m[2])
    return { startMs: monthStart(year, (q - 1) * 3), endMs: monthEnd(year, (q - 1) * 3 + 2) }
  }

  // "S1 2026" / "H1 2026"
  m = s.match(/^[SH]([12])\s+(\d{4})$/i)
  if (m) {
    const h = Number(m[1])
    const year = Number(m[2])
    return {
      startMs: monthStart(year, h === 1 ? 0 : 6),
      endMs: monthEnd(year, h === 1 ? 5 : 11),
    }
  }

  // "2025"
  m = s.match(/^(\d{4})$/)
  if (m) {
    const year = Number(m[1])
    return { startMs: monthStart(year, 0), endMs: monthEnd(year, 11) }
  }

  // "November - December 2025" (month range, shared year)
  m = s.match(/^([A-Za-zéûà]+)\s*[-–]\s*([A-Za-zéûà]+)\s+(\d{4})$/)
  if (m) {
    const a = monthIndex(m[1])
    const b = monthIndex(m[2])
    const year = Number(m[3])
    if (a !== null && b !== null) {
      return { startMs: monthStart(year, a), endMs: monthEnd(year, b >= a ? b : b + 12) }
    }
  }

  // "January 2026"
  m = s.match(/^([A-Za-zéûà]+)\s+(\d{4})$/)
  if (m) {
    const idx = monthIndex(m[1])
    const year = Number(m[2])
    if (idx !== null) {
      return { startMs: monthStart(year, idx), endMs: monthEnd(year, idx) }
    }
  }

  return null
}
