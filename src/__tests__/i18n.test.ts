import { describe, it, expect } from "vitest"
import en from "../i18n/en.js"
import pt from "../i18n/pt.js"

// Los diccionarios son la ÚNICA fuente de traducción de la app (el español vive escrito en App.tsx y se traduce sobre el DOM).
// Sin estas pruebas, agregar un idioma a medias o duplicar una clave pasa desapercibido: la app simplemente muestra español.
const DICTS: Record<string, { MAP: Record<string, string>; RULES: [RegExp, string][] }> = { en, pt }

describe("diccionarios i18n", () => {
  it("todos los idiomas cubren las MISMAS claves (nadie se queda a medias)", () => {
    const langs = Object.keys(DICTS)
    const base = Object.keys(DICTS[langs[0]].MAP)
    for (const l of langs.slice(1)) {
      const keys = new Set(Object.keys(DICTS[l].MAP))
      const missing = base.filter((k) => !keys.has(k))
      expect(missing, `${l} no traduce ${missing.length} cadenas: ${missing.slice(0, 5).join(" · ")}`).toEqual([])
      const extra = [...keys].filter((k) => !base.includes(k))
      expect(extra, `${l} traduce cadenas que ya no existen: ${extra.slice(0, 5).join(" · ")}`).toEqual([])
    }
  })

  it("ninguna traducción queda vacía", () => {
    for (const [l, d] of Object.entries(DICTS)) {
      const empty = Object.entries(d.MAP).filter(([, v]) => !String(v).trim()).map(([k]) => k)
      expect(empty, `${l} tiene traducciones vacías: ${empty.slice(0, 5).join(" · ")}`).toEqual([])
    }
  })

  it("las reglas de texto interpolado son las mismas en todos los idiomas", () => {
    // Cada regla matchea un patrón del ESPAÑOL; si un idioma pierde una, ese texto queda sin traducir.
    const base = DICTS.en.RULES.map(([re]) => re.source)
    for (const [l, d] of Object.entries(DICTS)) {
      expect(d.RULES.map(([re]) => re.source), `${l} no tiene las mismas reglas que en`).toEqual(base)
    }
  })

  it("las reglas conservan los grupos capturados ($1) donde el original los usa", () => {
    for (const [l, d] of Object.entries(DICTS)) {
      DICTS.en.RULES.forEach(([, enRep], i) => {
        if (!enRep.includes("$1")) return
        expect(d.RULES[i][1], `${l}: la regla ${d.RULES[i][0]} perdió el $1 y borraría el número`).toContain("$1")
      })
    }
  })
})
