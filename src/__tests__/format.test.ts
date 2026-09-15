import { describe, it, expect } from "vitest"
import { AV, colorOf, initials, hhmm, fmtDur, ago, horaCorta } from "../lib/format"

describe("colorOf", () => {
  it("returns a palette color", () => {
    expect(AV).toContain(colorOf("Juan"))
  })
  it("is deterministic for the same input", () => {
    expect(colorOf("Juan")).toBe(colorOf("Juan"))
  })
  it("handles empty input without throwing", () => {
    expect(AV).toContain(colorOf(""))
  })
})

describe("initials", () => {
  it("takes up to two uppercase initials", () => {
    expect(initials("Juan Perez")).toBe("JP")
  })
  it("uses a single word", () => {
    expect(initials("Madonna")).toBe("M")
  })
  it("caps at two words", () => {
    expect(initials("Juan Carlos Perez")).toBe("JC")
  })
  it("falls back to ? on empty", () => {
    expect(initials("")).toBe("?")
  })
})

describe("hhmm", () => {
  it("returns empty string for missing timestamp", () => {
    expect(hhmm(undefined)).toBe("")
    expect(hhmm(0)).toBe("")
  })
  it("returns a HH:MM-shaped string for a real timestamp", () => {
    expect(hhmm(Date.UTC(2026, 0, 1, 12, 30))).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe("fmtDur", () => {
  it("formats minutes and seconds", () => {
    expect(fmtDur(75)).toBe("1:15")
  })
  it("zero-pads seconds", () => {
    expect(fmtDur(65)).toBe("1:05")
  })
  it("handles sub-minute durations", () => {
    expect(fmtDur(9)).toBe("0:09")
  })
  it("returns empty for missing/non-finite", () => {
    expect(fmtDur(undefined)).toBe("")
    expect(fmtDur(0)).toBe("")
    expect(fmtDur(Infinity)).toBe("")
  })
})

describe("ago", () => {
  it("returns empty for missing timestamp", () => {
    expect(ago(undefined)).toBe("")
  })
  it("returns time-of-day for a recent timestamp", () => {
    expect(ago(Date.now() - 60 * 1000)).toMatch(/\d{1,2}:\d{2}/)
  })
  it("returns Ayer for ~1 day ago", () => {
    expect(ago(Date.now() - 26 * 3600 * 1000)).toBe("Ayer")
  })
  it("returns a date label for older timestamps", () => {
    const label = ago(Date.now() - 10 * 86400000)
    expect(label).not.toBe("")
    expect(label).not.toBe("Ayer")
  })
})

// El resumen de la Home corre a una hora configurada por el usuario. Si el pie dice "hace 7 horas" no puede
// verificar que se haya cumplido el horario que él mismo puso; con "hoy 04:00" sí.
describe("horaCorta", () => {
  const ahora = new Date(2026, 8, 15, 10, 30).getTime() // mar 15/09/2026 10:30 local
  it("dice hoy con la hora de la corrida", () => {
    expect(horaCorta(new Date(2026, 8, 15, 4, 0).getTime(), ahora)).toBe("hoy 04:00")
  })
  it("distingue ayer de hoy aunque falten menos de 24h", () => {
    expect(horaCorta(new Date(2026, 8, 14, 16, 0).getTime(), ahora)).toBe("ayer 16:00")
  })
  it("la próxima corrida puede caer mañana", () => {
    expect(horaCorta(new Date(2026, 8, 16, 4, 0).getTime(), ahora)).toBe("mañana 04:00")
  })
  it("más lejos que eso, el día de la semana", () => {
    expect(horaCorta(new Date(2026, 8, 11, 16, 0).getTime(), ahora)).toMatch(/16:00$/)
  })
})
