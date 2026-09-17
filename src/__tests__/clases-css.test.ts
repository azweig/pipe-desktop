// TODA CLASE QUE USA EL TSX TIENE QUE EXISTIR EN EL CSS.
//
// Un nombre de clase mal escrito no rompe nada: React lo pinta, el navegador no encuentra regla y el elemento queda
// sin estilo. No hay error, no falla el build, no falla el typecheck. Caso real: la vista Correo usaba `paneh` en vez
// de `panehead` y, sobre todo, se olvidaba `panebody` —que es el contenedor de scroll—, así que con 30 filas flexbox
// las ENCOGÍA en vez de scrollear y el texto se pisaba. Se descubrió por una captura de pantalla.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const raiz = join(__dirname, "..")
const css = readFileSync(join(raiz, "styles.css"), "utf8")
const definidas = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))

// TRINQUETE, no limpieza. Estas cinco ya estaban sin regla antes de que existiera este test: el elemento se pinta
// sin estilo y nadie lo notó. No las arreglo acá —son cosméticas, de vistas distintas, y habría que mirar cada una—
// pero quedan anotadas para que el test falle ante una clase NUEVA sin regla, que es lo que se quiere atajar.
// Al arreglar alguna, sacala de esta lista.
const DEUDA_PREVIA = new Set(["dot2", "inp", "secthead", "btn"])
const EXENTAS = new Set([...DEUDA_PREVIA, "mermaid"])

const tsx = readdirSync(raiz).filter((f) => f.endsWith(".tsx"))
  .concat(readdirSync(join(raiz, "components")).filter((f) => f.endsWith(".tsx")).map((f) => join("components", f)))

// Clases "átomo": las que traen GEOMETRÍA propia (ancho y alto fijos). Son elementos por derecho propio —un puntito,
// un spinner— y NO pueden usarse como modificador de otra cosa: le imponen su tamaño al elemento que las recibe.
// Caso real: `.unread` es el puntito de 8x8 de la bandeja, y la vista Correo la usaba como modificador de fila
// (`"mailrow" + (m.unread ? " unread" : "")`). Cada correo sin leer se volvía un círculo de 8 píxeles con el texto
// desbordado encima de las filas vecinas. El test de clases inexistentes NO lo ve: `unread` existe.
// Se parte el CSS por reglas en vez de barrerlo con una regex: pidiendo `(^|})` antes del selector, el `}` que
// cierra una regla se consume y la SIGUIENTE no matchea. Detectaba la mitad de las reglas y el test pasaba en falso.
const ATOMOS = new Set<string>()
for (const bloque of css.split("}")) {
  const i = bloque.indexOf("{")
  if (i < 0) continue
  const selector = bloque.slice(0, i).trim().replace(/\/\*[\s\S]*?\*\//g, "").trim()
  const cuerpo = bloque.slice(i + 1)
  // Sólo un selector de UNA clase suelta define un átomo. `.a.b{}` o `.a .b{}` describen una combinación, no un
  // elemento; contarlos marcaría como átomo a cualquier clase que aparezca en una regla compuesta con tamaño.
  const m = /^\.([a-zA-Z][\w-]*)$/.exec(selector)
  if (!m) continue
  if (/(^|;)\s*width\s*:/.test(cuerpo) && /(^|;)\s*height\s*:/.test(cuerpo)) ATOMOS.add(m[1])
}

describe("clases CSS", () => {
  it("las clases con geometría propia no se usan como modificador", () => {
    const malos: string[] = []
    for (const archivo of tsx) {
      const src = readFileSync(join(raiz, archivo), "utf8")
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
        // EN ORDEN: la PRIMERA clase es la identidad del elemento; las siguientes son modificadores.
        // `"att-st " + estado` está bien (el átomo ES el elemento, y `ok`/`no` sólo le cambian el color).
        // `"mailrow" + " unread"` está mal (el átomo entra de modificador y le impone sus 8x8 a la fila).
        const expr = m[1] ?? m[2] ?? ""
        const clases = m[1] != null
          ? m[1].split(/\s+/).filter(Boolean)
          : [...String(expr).matchAll(/"([^"]*)"|'([^']*)'/g)]
              .flatMap((l) => (l[1] ?? l[2] ?? "").split(/\s+/)).filter(Boolean)
        const intrusos = clases.slice(1).filter((c) => ATOMOS.has(c))
        if (intrusos.length) malos.push(`${archivo}: "${intrusos.join(",")}" usada como modificador de "${clases[0]}"`)
      }
    }
    expect(malos, `una clase con ancho/alto propios impone su tamaño al elemento:\n${malos.join("\n")}`).toEqual([])
  })

  for (const archivo of tsx) {
    it(`${archivo}: no usa clases inexistentes`, () => {
      const src = readFileSync(join(raiz, archivo), "utf8")
      const usadas = new Set<string>()
      // className="a b c" y className={"a" + (x ? " b" : "")}: se toman los literales del atributo.
      // OJO con los operandos de COMPARACIÓN. `className={"tab" + (pane === "correo" ? " on" : "")}` tiene dos
      // literales y sólo uno es una clase: "correo" es el valor con el que se compara. Sin sacarlos, el test acusaba
      // 22 clases inexistentes que en realidad eran nombres de vista, de pestaña y de estado.
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
        if (m[1] != null) { for (const c of m[1].split(/\s+/)) if (c) usadas.add(c); continue }
        // Fuera los operandos de comparación (`=== "x"`) y los argumentos de función (`f("x", …)`): en ambos casos
        // el literal es un dato, no una clase. Con `isAcctSecret("email", …)` el test acusaba una clase "email".
        const expr = String(m[2])
          .replace(/[=!]==?\s*(?:"[^"]*"|'[^']*')/g, " ")
          .replace(/[(,]\s*(?:"[^"]*"|'[^']*')/g, " ")
        for (const lit of expr.matchAll(/"([^"]*)"|'([^']*)'/g)) {
          for (const c of (lit[1] ?? lit[2] ?? "").split(/\s+/)) if (c) usadas.add(c)
        }
      }
      const huerfanas = [...usadas].filter((c) => !definidas.has(c) && !EXENTAS.has(c))
      expect(huerfanas, `clases sin regla en styles.css: ${huerfanas.join(", ")}`).toEqual([])
    })
  }
})
