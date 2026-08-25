// COLA DE ENVÍO — un 502 no significa "no se envió". Puede cortarse ANTES de que el pedido llegue (seguro
// reintentar) o DESPUÉS de que el mensaje salió (reintentar lo duplicaría). Por eso cada mensaje lleva un `msgId`
// propio que se REPITE en cada reintento: el server lo reserva y, si ya salió, devuelve el resultado viejo.
// Vive fuera de React —con su propio temporizador y en localStorage— para sobrevivir a re-render y a cerrar la app.

export type ItemCola = {
  msgId: string
  key: string
  text: string
  channel?: string
  target?: string
  covert?: boolean
  ts: number
  intentos: number
  nextAt: number
  fallo?: string | null
}

const KEY = "pipe_outbox_v1"
const MAX = 200

export const nuevoMsgId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "m" + Date.now() + Math.random().toString(36).slice(2)

// espera creciente: 2s, 4s, 8s… con techo de 1 min. Rápido si fue un hipo, sin martillar un hub caído.
export const esperaReintento = (intentos: number) => Math.min(60000, 2000 * Math.pow(2, Math.max(0, intentos - 1)))

// Qué hacer según cómo terminó el intento. Pura y aparte para poder probarla: acá se decide la diferencia entre
// "reintentar para siempre" y "perder el mensaje", que son los dos errores caros.
export function clasificar(err: any, data: any): "ok" | "reintentar" | "definitivo" {
  if (err) {
    const code = Number(err.code)
    if (!code) return "reintentar"          // la red falló / el hub no está: reintentable
    if (code >= 500) return "reintentar"    // 502/503: el hub se cayó o reinició
    if (code === 429 || code === 408) return "reintentar"
    return "definitivo"                     // 400/403/404: reintentar no lo va a arreglar
  }
  if (data && data.pending) return "reintentar" // el server avisa que otro reintento lo está mandando
  if (data && data.error) return "definitivo"
  return "ok"
}

// Eventos hacia la app: "cambio" repinta, "enviado" recarga el hilo, "fallo" avisa CON EL MOTIVO (si solo
// avisáramos "cambio", el ítem rechazado ya no estaría en la cola y el motivo se perdería).
export type Evento = { tipo: "cambio" } | { tipo: "enviado"; item: ItemCola } | { tipo: "fallo"; item: ItemCola; motivo: string }

let items: ItemCola[] = cargar()
let escuchas: Array<(ev: Evento) => void> = []
let enviar: ((it: ItemCola) => Promise<any>) | null = null
let timer: any = null
let corriendo = false

function cargar(): ItemCola[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}
function guardar() {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX))) } catch { /* cuota llena: la cola sigue en memoria */ }
}
function avisar(ev: Evento = { tipo: "cambio" }) { guardar(); for (const f of escuchas) f(ev) }

export const pendientes = () => items
export const pendientesDe = (key: string) => items.filter((i) => i.key === key)
export function suscribir(fn: (ev: Evento) => void) {
  escuchas.push(fn)
  return () => { escuchas = escuchas.filter((f) => f !== fn) }
}
// `fn` manda de verdad (lo inyecta la app, que es la que tiene el cliente HTTP). Inyectarlo permite probar la cola.
export function configurar(fn: (it: ItemCola) => Promise<any>) { enviar = fn }

export function encolar(it: Omit<ItemCola, "intentos" | "nextAt">) {
  items = [...items, { ...it, intentos: 0, nextAt: 0 }]
  avisar()
  void flush()
}

function programar() {
  clearTimeout(timer)
  if (!items.length) return
  const proximo = Math.min(...items.map((i) => i.nextAt || 0))
  timer = setTimeout(() => void flush(), Math.max(500, proximo - Date.now()))
}

export async function flush() {
  if (corriendo || !items.length || !enviar) return
  if (typeof navigator !== "undefined" && navigator.onLine === false) return programar()
  corriendo = true
  try {
    for (const it of [...items]) {
      if (it.nextAt && Date.now() < it.nextAt) continue
      let data: any = null, err: any = null
      try { data = await enviar(it) } catch (e) { err = e }
      const q = clasificar(err, data)
      if (q === "reintentar") {
        it.intentos += 1
        it.nextAt = Date.now() + esperaReintento(it.intentos)
        it.fallo = null
        continue
      }
      if (q === "definitivo") {
        const motivo = (err && err.message) || (data && data.error) || "no se pudo enviar"
        items = items.filter((x) => x.msgId !== it.msgId)
        avisar({ tipo: "fallo", item: { ...it, fallo: motivo }, motivo })
        continue
      }
      items = items.filter((x) => x.msgId !== it.msgId)
      avisar({ tipo: "enviado", item: it })
    }
  } finally {
    corriendo = false
    avisar()
    programar()
  }
}

// Reintentar también cuando vuelve la red o cuando volvés a la ventana, no solo por temporizador.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush())
  window.addEventListener("focus", () => void flush())
}
