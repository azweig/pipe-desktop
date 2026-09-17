// 📧 LECTOR Y REDACTOR DE CORREO — lo que hace que la sección Correo no te mande a la vista de chat.
//
// Un chat se lee con "quién dijo qué". Un correo necesita otra cosa: asunto, De/Para/CC, cuerpo HTML, adjuntos, y
// poder responder, responder a todos o reenviar sin salir. Eso es esto.
//
// Lo que NO se toca del visor que ya existía, porque es una propiedad de privacidad y no una decisión estética:
// el cuerpo va en un iframe SANDBOXEADO con una CSP que bloquea todo recurso remoto. Sin eso, abrir un correo le
// avisa al remitente (píxel de rastreo) y le entrega tu IP. Las imágenes remotas se cargan sólo si VOS las pedís.
import { useEffect, useMemo, useRef, useState } from "react"
import { getCorreo, prepararCorreo, cuentasCorreo, enviarCorreo, guardarBorrador,
  type CorreoHilo, type CorreoMsg, type Preparado, type CuentaEnvio } from "./api"

const fechaLarga = (ts: number) => new Date(ts).toLocaleString("es", { dateStyle: "long", timeStyle: "short" })
const tam = (n = 0) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB")

// Mismo documento que el visor de siempre: CSP sin `default-src`, imágenes remotas sólo bajo pedido explícito.
function docSeguro(html: string, remotasOk: boolean) {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:${remotasOk ? " https:" : ""}; style-src 'unsafe-inline'; font-src data:">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">'
    + '<style>body{margin:0;padding:14px;font-family:system-ui;color:#111;line-height:1.55;word-break:break-word}'
    + 'img{max-width:100%!important;height:auto}table{max-width:100%!important}</style>' + html
}

// ── UN CORREO DEL HILO ───────────────────────────────────────────────────────────────────────────────────────────
function Mensaje({ m, abierto, onToggle }: { m: CorreoMsg; abierto: boolean; onToggle: () => void }) {
  const [remotas, setRemotas] = useState(false)
  const hayRemotas = /<img[^>]+src=["']https?:/i.test(m.html || "")
  return (
    <div className="cr-msg">
      <div className="cr-msg-head" onClick={onToggle}>
        <div style={{ minWidth: 0 }}>
          <div className="cr-de">{m.dir === "out" ? "Vos" : (m.deNombre || m.de || "(sin remitente)")}</div>
          <div className="cr-meta">
            {m.para.length ? <>Para: {m.para.join(", ")}</> : m.sinDestinatarios ? <span title="Este correo es anterior a que el hub guardara los destinatarios">Para: —</span> : null}
            {m.cc.length ? <> · CC: {m.cc.join(", ")}</> : null}
          </div>
        </div>
        <div className="cr-fecha">{fechaLarga(m.ts)}</div>
      </div>
      {abierto ? (
        <>
          {hayRemotas && !remotas ? (
            <button className="cr-remotas" onClick={() => setRemotas(true)}>
              🖼 Mostrar imágenes remotas
              <span>Bloqueadas para que el remitente no sepa que lo abriste</span>
            </button>
          ) : null}
          {m.adjuntos.length ? (
            <div className="cr-adj">
              {m.adjuntos.map((a, i) => <span key={i} className="cr-chip">📎 {a.nombre} · {tam(a.tam)}</span>)}
            </div>
          ) : null}
          <iframe title="correo" sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={docSeguro(m.html || "<p style='color:#888'>(sin cuerpo)</p>", remotas)} className="cr-body" />
        </>
      ) : null}
    </div>
  )
}

// ── REDACTOR ─────────────────────────────────────────────────────────────────────────────────────────────────────
// El cuerpo es un contentEditable. NO se sanea acá y ya: lo que se manda lo limpia el SERVIDOR, porque confiar en la
// limpieza del cliente es confiar en que nadie va a llamar al endpoint a mano.
function Redactor({ inicial, cuentas, onCerrar, onEnviado, onToast }: {
  inicial: Partial<Preparado> & { to?: string[]; cc?: string[] }
  cuentas: CuentaEnvio[]; onCerrar: () => void; onEnviado: () => void; onToast: (m: string) => void
}) {
  const [cuenta, setCuenta] = useState(inicial.cuenta || cuentas[0]?.label || "")
  const [to, setTo] = useState((inicial.to || []).join(", "))
  const [cc, setCc] = useState((inicial.cc || []).join(", "))
  const [bcc, setBcc] = useState("")
  const [verCopias, setVerCopias] = useState(!!(inicial.cc || []).length)
  const [asunto, setAsunto] = useState(inicial.asunto || "")
  const [enviando, setEnviando] = useState(false)
  const [guardado, setGuardado] = useState("")
  const cuerpoRef = useRef<HTMLDivElement>(null)
  const borradorRef = useRef<string>("")

  // Autoguardado: perder un correo largo por cerrar una ventana es de las peores cosas que puede hacer un cliente
  // de correo. Cada 4s y sólo si hay algo escrito.
  useEffect(() => {
    const t = setInterval(async () => {
      const html = cuerpoRef.current?.innerHTML || ""
      if (!html.trim() && !asunto.trim() && !to.trim()) return
      const r: any = await guardarBorrador({ id: borradorRef.current || undefined, cuenta, to, cc, bcc, asunto, html,
        cita: inicial.cita || "", citaTxt: inicial.citaTxt || "", inReplyTo: inicial.inReplyTo || "" }).catch(() => null)
      if (r?.id) { borradorRef.current = r.id; setGuardado("Borrador guardado " + new Date().toLocaleTimeString("es", { timeStyle: "short" })) }
    }, 4000)
    return () => clearInterval(t)
  }, [cuenta, to, cc, bcc, asunto, inicial.cita, inicial.citaTxt, inicial.inReplyTo])

  // document.execCommand está obsoleto pero es lo único que da formato en un contentEditable sin traer un editor
  // entero (y sus dependencias) a una app que se quiere liviana. Para negrita/cursiva/listas alcanza y sobra.
  const fmt = (cmd: string, val?: string) => { cuerpoRef.current?.focus(); document.execCommand(cmd, false, val) }
  const link = () => { const u = prompt("Dirección del enlace:"); if (u) fmt("createLink", /^https?:/i.test(u) ? u : "https://" + u) }

  const enviar = async () => {
    if (!to.trim()) { onToast("Falta el destinatario."); return }
    if (!asunto.trim() && !confirm("El correo no tiene asunto. ¿Mandarlo igual?")) return
    setEnviando(true)
    const r: any = await enviarCorreo({
      msgId: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), // candado anti-doble-envío
      cuenta, to, cc, bcc, asunto, html: cuerpoRef.current?.innerHTML || "",
      cita: inicial.cita || "", citaTxt: inicial.citaTxt || "", inReplyTo: inicial.inReplyTo || "",
      borradorId: borradorRef.current || "",
    }).catch(() => ({ error: "No se pudo conectar con el hub." }))
    setEnviando(false)
    if (r?.error) { onToast(r.error); return }
    onToast("✓ Correo enviado")
    onEnviado()
  }

  return (
    <div className="cr-red">
      <div className="cr-red-head">
        <b>{inicial.inReplyTo ? "Responder" : inicial.cita ? "Reenviar" : "Correo nuevo"}</b>
        <button className="cr-x" onClick={onCerrar}>✕</button>
      </div>
      <label className="cr-campo"><span>De</span>
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
          {cuentas.map((c) => <option key={c.label} value={c.label}>{c.user}</option>)}
        </select>
      </label>
      <label className="cr-campo"><span>Para</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="nombre@dominio.com, otro@dominio.com" autoFocus={!inicial.inReplyTo} />
        {!verCopias ? <button className="cr-mini" onClick={() => setVerCopias(true)}>CC/CCO</button> : null}
      </label>
      {verCopias ? (<>
        <label className="cr-campo"><span>CC</span><input value={cc} onChange={(e) => setCc(e.target.value)} /></label>
        <label className="cr-campo"><span>CCO</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} /></label>
      </>) : null}
      <label className="cr-campo"><span>Asunto</span>
        <input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="(sin asunto)" />
      </label>
      <div className="cr-tools">
        {([["bold", "B", "Negrita"], ["italic", "I", "Cursiva"], ["underline", "U", "Subrayado"]] as [string, string, string][])
          .map(([c, l, t]) => <button key={c} title={t} onClick={() => fmt(c)} style={{ fontWeight: c === "bold" ? 800 : 500, fontStyle: c === "italic" ? "italic" : "normal", textDecoration: c === "underline" ? "underline" : "none" }}>{l}</button>)}
        <button title="Enlace" onClick={link}>🔗</button>
        <button title="Lista" onClick={() => fmt("insertUnorderedList")}>•—</button>
        <button title="Quitar formato" onClick={() => fmt("removeFormat")}>⌫</button>
      </div>
      <div ref={cuerpoRef} className="cr-editor" contentEditable suppressContentEditableWarning autoFocus={!!inicial.inReplyTo} />
      <div className="cr-firma-nota">Tu firma se agrega automáticamente al enviar{inicial.cita ? ", arriba del mensaje citado" : ""}.</div>
      <div className="cr-red-pie">
        <button className="cr-enviar" onClick={enviar} disabled={enviando}>{enviando ? "Enviando…" : "Enviar"}</button>
        <span className="cr-guardado">{guardado}</span>
      </div>
    </div>
  )
}

// ── PANEL COMPLETO ───────────────────────────────────────────────────────────────────────────────────────────────
export default function CorreoVista({ correoKey, onToast }: { correoKey: string; onToast: (m: string) => void }) {
  const [hilo, setHilo] = useState<CorreoHilo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<string>("")
  const [redactar, setRedactar] = useState<(Partial<Preparado>) | null>(null)
  const [cuentas, setCuentas] = useState<CuentaEnvio[]>([])

  useEffect(() => { cuentasCorreo().then((r) => setCuentas(r.cuentas || [])).catch(() => {}) }, [])
  const cargar = () => {
    setCargando(true); setRedactar(null)
    getCorreo(correoKey).then((r) => { setHilo(r); setAbierto(r?.mensajes?.[0]?.id || "") })
      .catch(() => setHilo(null)).finally(() => setCargando(false))
  }
  useEffect(() => { cargar() }, [correoKey])

  const prep = async (modo: string) => {
    const p = await prepararCorreo(correoKey, modo).catch(() => null)
    if (!p || p.error) { onToast(p?.error || "No pude preparar la respuesta."); return }
    setRedactar(p)
  }
  // "Responder a todos" sólo tiene sentido si SABEMOS quiénes estaban en copia. En el correo anterior al esquema v7
  // no se guardaban los destinatarios: ofrecerlo igual mandaría una respuesta a medias sin que nadie se entere.
  const puedeTodos = useMemo(() => !!hilo?.mensajes?.[0] && !hilo.mensajes[0].sinDestinatarios, [hilo])

  if (cargando) return <div className="center" style={{ height: 240 }}><div className="spin" /></div>
  if (!hilo || hilo.error) return <div className="cr-vacio">No pude abrir este correo.</div>

  return (
    <div className="cr-pane">
      <div className="cr-asunto">{hilo.asunto || "(sin asunto)"}</div>
      <div className="cr-acciones">
        <button onClick={() => prep("responder")}>↩ Responder</button>
        <button onClick={() => prep("todos")} disabled={!puedeTodos}
          title={puedeTodos ? "Responder a todos" : "Este correo es anterior a que el hub guardara los destinatarios"}>↩↩ A todos</button>
        <button onClick={() => prep("reenviar")}>➡ Reenviar</button>
        <span className="cr-n">{hilo.n} {hilo.n === 1 ? "mensaje" : "mensajes"}</span>
      </div>
      {redactar ? (
        <Redactor inicial={redactar} cuentas={cuentas} onCerrar={() => setRedactar(null)}
          onEnviado={cargar} onToast={onToast} />
      ) : null}
      {hilo.mensajes.map((m) => (
        <Mensaje key={m.id} m={m} abierto={abierto === m.id} onToggle={() => setAbierto(abierto === m.id ? "" : m.id)} />
      ))}
    </div>
  )
}
