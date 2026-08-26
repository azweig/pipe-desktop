// ELEGIR A DÓNDE SE MANDA — el escritorio no dejaba: siempre iba al último destino usado. La web y el móvil sí
// tenían selector. Además elegía por CANAL, y eso no alcanza: un contacto puede tener dos números de WhatsApp,
// así que "elegir whatsapp" seguía mandando al mismo. Ahora la elección guarda el destino completo.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const app = readFileSync("src/App.tsx", "utf8")
const css = readFileSync("src/styles.css", "utf8")

describe("selector de destino", () => {
  it("la elección manual identifica el destino completo, no solo el canal", () => {
    expect(app).toMatch(/const tgKey = \(t: any\) => `\$\{t\?\.channel\}\|\$\{t\?\.target\}`/)
    expect(app).toMatch(/tgtKey && targets\.find\(\(x: any\) => tgKey\(x\) === tgtKey\)/)
  })
  it("lo elegido a mano gana sobre el default", () => {
    const i = app.indexOf("const target = () =>")
    const fn = app.slice(i, i + 260)
    expect(fn.indexOf("tgtKey")).toBeLessThan(fn.indexOf("isDefault"))
  })
  it("cambiar de hilo olvida la elección (o mandarías al destino del hilo anterior)", () => {
    expect(app).toMatch(/setSel\(t\);[\s\S]{0,80}setTgtKey\(null\)/)
  })
  it("hay un botón para elegir, y solo cuando hay más de un destino", () => {
    expect(app).toMatch(/targets\.length > 1 \?[\s\S]{0,500}setPickTgt\(true\)/)
  })
  it("el selector lista TODOS los destinos y marca cuál es el último usado", () => {
    const i = app.indexOf("pickTgt && (")
    const modal = app.slice(i, i + 1300)
    expect(modal).toMatch(/targets\.map/)
    expect(modal).toMatch(/t\.isDefault \?/)
    expect(modal).toMatch(/setTgtKey\(k\)/)
  })
  it("se ve como un control, no como texto plano", () => {
    expect(css).toMatch(/\.tgtpick \{[^}]*cursor: pointer/)
  })
})
