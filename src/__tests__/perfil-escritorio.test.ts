// TRES FALLAS DEL PANEL DE PERFIL EN ESCRITORIO. Las tres tenían el dato correcto del lado del server: era la app
// la que lo pedía mal, lo pisaba, o directamente no lo pintaba.
//
// 1. FICHA PEGADA: getPerson del hilo anterior podía responder DESPUÉS de que abrías otro chat, y pisaba la ficha.
//    Veías la bio, los teléfonos y los temas de otra persona bajo el nombre correcto — indistinguible de un bug de
//    identidad. (Caso real: un contacto mostrando los 6 teléfonos y la bio de un grupo familiar.)
// 2. "NO ENCONTRÉ CHAT 1:1": si la persona solo aparecía en grupos, te dejaba en un cartel de error. Conocemos su
//    número por la ficha, así que hay que ABRIR la conversación, que es lo que uno quiere al tocar un nombre.
// 3. La API mandaba antigüedad, grupos en común y gente en común, y el escritorio no los pintaba.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const app = readFileSync("src/App.tsx", "utf8")

describe("ficha pegada del contacto anterior", () => {
  it("hay una ref sincrónica con el hilo abierto", () => {
    expect(app).toMatch(/const abiertoRef = useRef<string \| null>\(null\)/)
    expect(app).toMatch(/abiertoRef\.current = t\.key/)
  })
  it("una respuesta tardía NO pinta si ya cambiaste de chat", () => {
    expect(app).toMatch(/const sigueAbierto = \(\) => abiertoRef\.current === t\.key/)
    for (const set of ["setPerson(p)", "setTargets(entry.targets)", "setSched(r)", "setThreadCovert(st)"]) {
      const i = app.indexOf(set)
      expect(i).toBeGreaterThan(0)
      expect(app.slice(Math.max(0, i - 120), i)).toMatch(/sigueAbierto\(\)/)
    }
  })
  it("igual se cachea aunque no se pinte (reabrir el chat no re-pide)", () => {
    expect(app).toMatch(/entry\.person = p; if \(sigueAbierto\(\)\)/)
  })
})

describe("abrir el chat aunque no exista todavía", () => {
  it("usa el teléfono o el correo de la ficha para abrirlo", () => {
    const i = app.indexOf("const openByName")
    const fn = app.slice(i, i + 2600)
    expect(fn).toMatch(/p\.contacts && p\.contacts\.phones/)
    expect(fn).toMatch(/nuevaConversacion\(destino, tel \? "whatsapp" : "email"\)/)
  })
  it("solo avisa cuando NO hay a dónde escribir, y dice por qué", () => {
    const i = app.indexOf("const openByName")
    const fn = app.slice(i, i + 2600)
    expect(fn).toMatch(/no tengo su número ni su correo/)
    expect(fn).not.toMatch(/No encontré un chat 1:1/)
  })
})

describe("el perfil muestra lo que la API ya mandaba", () => {
  it("antigüedad de la relación", () => {
    expect(app).toMatch(/function antiguedad\(ts: number\)/)
    expect(app).toMatch(/Se conocen hace/)
  })
  it("grupos en común, y se pueden abrir", () => {
    expect(app).toMatch(/person\.shared\.groups\.slice/)
    expect(app).toMatch(/openByKey\(g\.thread, g\.name\)/)
  })
  it("gente en común, y se puede abrir su chat", () => {
    expect(app).toMatch(/person\.shared\.people\.slice/)
    expect(app).toMatch(/openByName\(q\.name\)/)
  })
})
