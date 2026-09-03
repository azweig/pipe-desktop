// 📧 CORREO — solo email, en tres cajones.
//
// Existe por dos razones concretas. La bandeja general mezcla ~2M de mensajes de mensajería con ~13k de correo, así
// que el correo se pierde. Y el cajón de spam estaba escondido por completo: un falso positivo del clasificador era
// invisible y no había forma de corregirlo — llegó a haber un "Problema de facturación", un aviso de corte de
// servicio y la notificación de una reunión ahí adentro, sin que se vieran en ningún lado.
import { useEffect, useState } from "react"
import { getMail, mailNoSpam, mailEsSpam, type MailRow } from "./api"

const TABS: [string, string][] = [["prioritarios", "Prioritarios"], ["todos", "Todos"], ["spam", "Spam"]]
const ago = (ts?: number) => {
  if (!ts) return ""
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return "ahora"
  if (m < 60) return m + "m"
  if (m < 1440) return Math.floor(m / 60) + "h"
  return Math.floor(m / 1440) + "d"
}

export default function Correo({ onOpen }: { onOpen: (key: string) => void }) {
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
      <div className="paneh"><h1>Correo</h1></div>
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
            {items.map((m) => (
              <div key={m.key} className={"mailrow" + (m.unread ? " unread" : "")} onClick={() => onOpen(m.key)}>
                <div className="mailmain">
                  <div className="mailde">
                    {m.importante ? <span className="mailbadge imp" title={m.razon || "Necesita tu atención"}>✦</span> : null}
                    {!m.importante && m.transaccional ? <span className="mailbadge" title="Aviso que pide acción (factura, vencimiento, servicio, agenda)">🧾</span> : null}
                    <span className="mailnm">{m.name || m.email || "(sin remitente)"}</span>
                    {m.account ? <span className="mailcta">{m.account}</span> : null}
                  </div>
                  <div className="mailtxt">{String(m.lastText || "").replace(/\s+/g, " ").slice(0, 160)}</div>
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
  )
}
