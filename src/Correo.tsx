// 📧 CORREO — solo email, en tres cajones.
//
// Existe por dos razones concretas. La bandeja general mezcla ~2M de mensajes de mensajería con ~13k de correo, así
// que el correo se pierde. Y el cajón de spam estaba escondido por completo: un falso positivo del clasificador era
// invisible y no había forma de corregirlo — llegó a haber un "Problema de facturación", un aviso de corte de
// servicio y la notificación de una reunión ahí adentro, sin que se vieran en ningún lado.
import { useEffect, useState } from "react"
import { getMail, mailNoSpam, mailEsSpam, type MailRow } from "./api"
import CorreoVista, { Redactor } from "./CorreoVista"
import { cuentasCorreo, type CuentaEnvio } from "./api"

const TABS: [string, string][] = [["prioritarios", "Prioritarios"], ["todos", "Todos"], ["spam", "Spam"]]
const ago = (ts?: number) => {
  if (!ts) return ""
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return "ahora"
  if (m < 60) return m + "m"
  if (m < 1440) return Math.floor(m / 60) + "h"
  return Math.floor(m / 1440) + "d"
}

// `onOpen` sigue existiendo para el caso en que quieras ver la conversación COMPLETA (mezclada con WhatsApp, etc.);
// pero el clic normal ya NO sale de acá: abre el correo como correo, con su asunto, destinatarios y HTML.
export default function Correo({ onOpen, onToast }: { onOpen: (key: string) => void; onToast: (m: string) => void }) {
  const [abierto, setAbierto] = useState<string>("")
  const [nuevo, setNuevo] = useState(false)                 // redactar un correo desde cero, sin hilo previo
  const [cuentas, setCuentas] = useState<CuentaEnvio[]>([])
  useEffect(() => { cuentasCorreo().then((r) => setCuentas(r.cuentas || [])).catch(() => {}) }, [])
  const [tab, setTab] = useState("prioritarios")
  const [items, setItems] = useState<MailRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = async (t: string) => {
    setCargando(true)
    try {
      const r: any = await getMail(t)
      setItems((r && r.items) || []); setCounts((r && r.counts) || {})
    } catch { setItems([]) }
    setCargando(false)
  }
  useEffect(() => { cargar(tab) }, [tab])

  // Marcar/desmarcar corrige el clasificador para siempre. Se saca la fila al toque (la respuesta del server ya no
  // la va a traer) y recién después se recarga: sin eso la fila queda un segundo y parece que no hizo nada.
  const marcar = async (m: MailRow, spam: boolean) => {
    setOcupado(m.key)
    setItems((prev) => prev.filter((x) => x.key !== m.key))
    try { spam ? await mailEsSpam(m.key) : await mailNoSpam(m.key) } catch {}
    setOcupado(null)
    cargar(tab)
  }

  const vacio = tab === "spam" ? "No hay nada apartado como spam."
    : tab === "prioritarios" ? "Nada que necesite tu atención ahora." : "No hay correo."
  const nota = tab === "spam" ? "Esto es lo que el clasificador apartó. Si algo no es spam, marcalo y vuelve a la bandeja."
    : tab === "prioritarios" ? "Correo que no es masivo: marcado importante, avisos que piden acción (✦ 🧾) o gente con la que ya venís hablando." : ""

  return (
    <div className="pane">
      <div className="panehead"><h1>Correo</h1>
        {abierto ? <button className="cr-volver" onClick={() => setAbierto("")}>‹ Volver a la lista</button>
          : <button className="cr-nuevo" style={{ marginLeft: "auto" }} onClick={() => setNuevo(true)}>✉️ Correo nuevo</button>}
      </div>
      {/* .panebody NO es decorativo: es el contenedor de scroll (flex:1 + min-height:0 + overflow-y:auto) que usan
          todas las vistas. Sin él la lista queda como hija directa de .pane, que es overflow:hidden — y flexbox, en
          vez de scrollear, ENCOGE las filas para que entren: el texto se desborda y las filas se pisan entre sí. */}
      {/* Abierto un correo, la lista cede el lugar: en una sola columna leer y listar compiten, y lo que importa
          cuando abrís algo es leerlo. Volver es un clic. */}
      {abierto ? <CorreoVista correoKey={abierto} onToast={onToast} /> : (
      <div className="panebody">
      {nuevo ? <Redactor inicial={{}} cuentas={cuentas} onCerrar={() => setNuevo(false)}
        onEnviado={() => { setNuevo(false); cargar(tab) }} onToast={onToast} /> : null}
      <div className="mailtabs">
        {TABS.map(([id, lbl]) => (
          <button key={id} className={"mailtab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
            {lbl}{counts[id] != null ? <span className="n">{counts[id]}</span> : null}
          </button>
        ))}
      </div>
      {nota ? <div className="mailnote">{nota}</div> : null}
      {cargando ? <div className="mailnone">Cargando…</div>
        : items.length === 0 ? <div className="mailnone">{vacio}</div>
        : (
          <div className="maillist">
            {/* El modificador va `mailnuevo`, NO `unread`: `.unread` es el PUNTITO de 8x8 de la bandeja, con width,
                height y border-radius propios. Usarlo acá convertía cada correo sin leer en un círculo de 8 píxeles
                con todo su contenido desbordado encima de las filas vecinas — que es como se veía roto el diseño.
                Un modificador no puede llamarse igual que una clase que trae geometría. */}
            {items.map((m) => (
              <div key={m.key} className={"mailrow" + (m.unread ? " mailnuevo" : "") + (abierto === m.key ? " sel" : "")} onClick={() => setAbierto(m.key)}>
                <div className="mailmain">
                  <div className="mailde">
                    {m.importante ? <span className="mailbadge imp" title={m.razon || "Necesita tu atención"}>✦</span> : null}
                    {!m.importante && m.transaccional ? <span className="mailbadge" title="Aviso que pide acción (factura, vencimiento, servicio, agenda)">🧾</span> : null}
                    <span className="mailnm">{m.name || m.email || "(sin remitente)"}</span>
                    {m.account ? <span className="mailcta">{m.account}</span> : null}
                    {/* Cuántos mensajes tiene la cadena. Un ida y vuelta de 40 correos y uno suelto se veían idénticos,
                        así que no se sabía si lo que se lee es el principio de algo o el final de una conversación larga. */}
                    {(m.count || 0) > 1 ? <span className="mailn" title={`${m.count} mensajes en esta conversación`}>{m.count}</span> : null}
                  </div>
                  {/* Quién habló ÚLTIMO. Sin esto, un correo que escribiste VOS se lee como si te lo hubieran mandado:
                      la vista te devolvía tu propia respuesta como si fuera algo que tenés que contestar. */}
                  <div className="mailtxt">
                    {m.lastDir === "out" ? <span className="mailvos">Vos:</span> : null}
                    {String(m.lastText || "").replace(/\s+/g, " ").slice(0, 160)}
                  </div>
                </div>
                <div className="mailside">
                  <span className="mailtime">{ago(m.ts)}</span>
                  <button className={"mailact" + (m.spam ? " ok" : "")} disabled={ocupado === m.key}
                    onClick={(e) => { e.stopPropagation(); marcar(m, !m.spam) }}>
                    {m.spam ? "No es spam" : "Es spam"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
