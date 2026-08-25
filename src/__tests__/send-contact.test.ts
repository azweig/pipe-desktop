// ENVIAR UN CONTACTO — no existía en el escritorio ni en el móvil, solo en la web.
// Llega como archivo .vcf con leyenda, no como tarjeta nativa: mautrix-whatsapp no sabe mandar ContactMessage
// hacia WhatsApp (solo lo traduce al revés). El server pone la leyenda con nombre y teléfono.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const api = readFileSync("src/api.ts", "utf8")
const app = readFileSync("src/App.tsx", "utf8")

describe("enviar contacto", () => {
  it("la api sabe llamar al endpoint", () => {
    expect(api).toContain('"/api/send-contact"')
  })
  it("manda el canal y el destino elegidos, no el default", () => {
    expect(api).toMatch(/sendContact[\s\S]{0,220}channel: t\?\.channel, target: t\?\.target/)
    expect(app).toMatch(/sendContact\(sel\.key, nombre, target\(\)\)/)
  })
  it("hay un botón en el compositor y un selector de contacto", () => {
    expect(app).toMatch(/onClick=\{\(\) => setCtPick\(\{ q: "" \}\)\}/)
    expect(app).toContain("Enviar un contacto")
  })
  it("el selector no ofrece grupos, espacios ni tu propio hilo", () => {
    const i = app.indexOf("ctPick && (")
    const modal = app.slice(i, i + 1200)
    expect(modal).toMatch(/t\.key !== "self"/)
    expect(modal).toMatch(/!t\.espacio/)
    expect(modal).toMatch(/!t\.group/)
  })
})
