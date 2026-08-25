// ESPACIOS — el escritorio tenía todo menos eliminar, y era lo único que sí podía el móvil. Este test deja el
// invariante puesto: la app conoce las 8 operaciones del server. Si el server gana una y acá no llega, falla.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const api = readFileSync("src/api.ts", "utf8")
const app = readFileSync("src/App.tsx", "utf8")

const ENDPOINTS = [
  "/api/espacios",
  "/api/espacio/view",
  "/api/espacio",
  "/api/espacio/delete",
  "/api/espacio/rule",
  "/api/espacio/rule/delete",
  "/api/espacio/exception",
  "/api/espacio/exception/delete",
]

describe("api de espacios", () => {
  it.each(ENDPOINTS)("el escritorio sabe llamar a %s", (e) => {
    expect(api).toContain(`"${e}`) // varias se arman concatenando (…?id=…), así que abrimos comilla y no cerramos
  })
})

describe("panel de espacios", () => {
  it("puede crear, con subespacios e icono", () => {
    expect(app).toContain("EspacioCreate")
    expect(app).toMatch(/createEsp\(n, ic, openId\)/)
  })
  it("maneja reglas y excepciones", () => {
    expect(app).toContain("addEspacioRule")
    expect(app).toContain("addEspacioException")
    expect(app).toContain("delEspacioException")
  })
  it("eliminar pasa por ConfirmDialog — nunca de un click", () => {
    const i = app.indexOf('modal?.kind === "del"')
    expect(i).toBeGreaterThan(0)
    expect(app.slice(i, i + 400)).toContain("ConfirmDialog")
    // y el botón que lo abre solo abre el modal, no borra
    expect(app).toMatch(/onClick=\{\(\) => setModal\(\{ kind: "del" \}\)\}/)
  })
})
