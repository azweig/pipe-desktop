import { useEffect, useState, useCallback, useRef } from "react"
import type { ChangeEvent } from "react"
import { authStatus, login, setBase, getBase, getThreads, getThread, getThreadDelta, getThreadBefore, getThreadSync, getPerson, searchContent, hubImage, getTargets, sendMsg, setPin, setArchive, getAutopilot, setAutopilot, autopilotFeedback, correctText, summarizeThread, getSchedule, createSchedule, sttB64, sendAudioB64, sendMediaB64, sendStickerB64, blobToB64, getCovert, setCovert, openExternal, summarizeMedia, readFileB64, importWhatsAppB64, importWhatsAppZipB64, isDesktopApp, Thread, Msg } from "./api"
import { cacheLoad, cacheSave } from "./cache"
import Calendar from "./Calendar"

const CH: Record<string, { c: string; label: string }> = {
  whatsapp: { c: "var(--wa)", label: "WhatsApp" }, teams: { c: "var(--teams)", label: "Teams" },
  email: { c: "var(--gmail)", label: "Gmail" }, telegram: { c: "var(--tg)", label: "Telegram" },
  slack: { c: "#611f69", label: "Slack" }, signal: { c: "#3a76f0", label: "Signal" }, meeting: { c: "var(--accent)", label: "Reunión" },
}
const AV = ["#6366f1", "#e0872b", "#22a06b", "#e2483d", "#2aabee", "#a855f7", "#ec4899", "#14b8a6"]
const colorOf = (s: string) => AV[[...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]
const initials = (n: string) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
const hhmm = (ts?: number) => ts ? new Date(ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : ""
const ago = (ts?: number) => { if (!ts) return ""; const d = (Date.now() - ts) / 86400000; if (d < 1) return hhmm(ts); if (d < 2) return "Ayer"; return new Date(ts).toLocaleDateString("es", { day: "numeric", month: "short" }) }
// etiqueta legible de la fecha detectada para agendar ({year,month,day,hour,minute})
function schedLabel(s: any) {
  const d = s?.date; if (!d?.day) return ""
  const dt = new Date(d.year, (d.month || 1) - 1, d.day)
  const day = dt.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" })
  return s.hasTime ? `${day} ${d.hour}:${String(d.minute || 0).padStart(2, "0")}` : day
}

// deriva el nombre del chat del filename del export ("Chat de WhatsApp con Juan.txt" / "WhatsApp Chat with Juan.txt" → "Juan")
function chatNameFromFile(fn = "") {
  return String(fn)
    .replace(/\.(txt|zip)$/i, "")
    .replace(/^_?chat( de whatsapp con| de whatsapp)?\s*/i, "")
    .replace(/^whatsapp chat( -| with)?\s*/i, "")
    .replace(/^chat -\s*/i, "")
    .trim()
}
// permiso de notificaciones locales del SO (se pide 1 sola vez; el SO lo recuerda). Devuelve si quedó concedido.
async function ensureNotifPermission(): Promise<boolean> {
  try {
    const n = await import("@tauri-apps/plugin-notification")
    let ok = await n.isPermissionGranted()
    if (!ok) ok = (await n.requestPermission()) === "granted"
    return ok
  } catch { return false }
}

const _mediaCache = new Map<string, string>()
function useHubMedia(path?: string) { // baja CUALQUIER media del hub (foto/audio/imagen/video) autenticada → data URI
  const [src, setSrc] = useState<string>(() => (path && _mediaCache.get(path)) || "")
  useEffect(() => {
    if (!path) { setSrc(""); return }
    if (_mediaCache.has(path)) { setSrc(_mediaCache.get(path)!); return }
    let alive = true
    hubImage(path).then((d) => { if (d) { _mediaCache.set(path, d); if (alive) setSrc(d) } }).catch(() => {})
    return () => { alive = false }
  }, [path])
  return src
}
function Avatar({ name, photo, size = 40 }: { name: string; photo?: string; size?: number }) {
  const src = useHubMedia(photo) // baja la foto real del hub; si no hay, cae a las iniciales
  if (src) return <img className="avatar" src={src} style={{ width: size, height: size }} alt="" />
  return <div className="avatar" style={{ width: size, height: size, background: colorOf(name), fontSize: size / 2.8 }}>{initials(name)}</div>
}
const PLACEHOLDER = /^(🖼|📹|🎤|📄|🌟|📎|📍|👤|🖼️)/
function MediaView({ id, path, kind }: { id: string; path: string; kind: string }) {
  const src = useHubMedia(path)
  // 🌐 transcribir + resumir: mismo backend que web/mobile (POST /api/media/summarize). Solo para audio/video/imagen recibidos.
  const [sum, setSum] = useState<{ summary?: string; transcript?: string; lang?: string } | null>(null)
  const [sumBusy, setSumBusy] = useState(false)
  const [sumErr, setSumErr] = useState("")
  const [showT, setShowT] = useState(false)
  const canAi = /^(image|audio|video)$/.test(kind) && !String(id).startsWith("opt-")
  const doSum = async () => {
    setSumBusy(true); setSumErr("")
    const r = await summarizeMedia(id).catch(() => null)
    setSumBusy(false)
    if (!r || r.error) { setSumErr((r && r.error) || "No se pudo procesar el archivo."); return }
    setSum({ summary: r.summary, transcript: r.transcript, lang: r.lang })
  }
  if (!src) return <div className="mediaload"><div className="spin" style={{ width: 18, height: 18, borderWidth: 2 }} /></div>
  const player = kind === "image" ? <img className="mediaimg" src={src} alt="" />
    : kind === "audio" ? <audio controls src={src} style={{ width: 250, height: 38 }} />
    : kind === "video" ? <video controls src={src} className="mediavid" /> : null
  return (
    <>
      {player}
      {canAi && (
        <div style={{ marginTop: 6 }}>
          {!sum && <button onClick={doSum} disabled={sumBusy} data-tip="Transcribe y resume (IA) — traduce si está en otro idioma"
            style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 8, border: "1px solid var(--line2)", background: "transparent", color: "var(--accent)", cursor: sumBusy ? "default" : "pointer", opacity: sumBusy ? .6 : 1 }}>
            {sumBusy ? "🌐 Transcribiendo…" : "🌐 Transcribir y resumir"}</button>}
          {sumErr && <div className="msgsum" style={{ color: "var(--muted)" }}>{sumErr}</div>}
          {sum && <div className="msgsum">✦ {sum.summary || "(sin resumen)"}{sum.lang && sum.lang !== "es" ? ` · ${sum.lang}→es` : ""}
            {sum.transcript ? <div style={{ marginTop: 5 }}>
              <span onClick={() => setShowT((v) => !v)} style={{ cursor: "pointer", color: "var(--accent)", fontSize: 11 }}>{showT ? "Ocultar transcripción" : "Ver transcripción"}</span>
              {showT ? <div style={{ whiteSpace: "pre-wrap", fontSize: 11.5, color: "var(--muted)", marginTop: 4, maxHeight: 180, overflow: "auto" }}>{sum.transcript}</div> : null}
            </div> : null}
          </div>}
        </div>
      )}
    </>
  )
}
// convierte URLs del texto en links clickeables que abren en el navegador del sistema (no dentro del webview)
const URL_RE = /(https?:\/\/[^\s]+)/g
function Linkified({ text }: { text: string }) {
  const parts = (text || "").split(URL_RE)
  return <>{parts.map((p, i) => URL_RE.test(p)
    ? <a key={i} href={p} onClick={(e) => { e.preventDefault(); openExternal(p.replace(/[.,)]+$/, "")) }} style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer", wordBreak: "break-all" }}>{p}</a>
    : <span key={i}>{p}</span>)}</>
}
function Bubble({ m, onFeedback }: { m: Msg; onFeedback?: (m: Msg) => void }) {
  const out = m.dir === "out"
  const [reveal, setReveal] = useState(false) // modo encubierto: ver la tapadera original (lo que ve WhatsApp)
  const hasMedia = m.media && /^(image|audio|video|sticker)$/.test(m.mediaType || "")
  const caption = m.text && !PLACEHOLDER.test(m.text) ? m.text : ""
  return (
    <div className={"bubble " + (out ? "out" : "in")}>
      {m.covert ? (
        <>
          <Linkified text={reveal ? (m.text || "") : m.covert.text} />
          <div className="covertbadge" onClick={() => setReveal((v) => !v)} title="Modo encubierto — lo que ve WhatsApp es la tapadera">🕊️ {reveal ? "ver descifrado" : "descifrado · ver original"}</div>
        </>
      ) : hasMedia ? <MediaView id={m.id} path={m.media!} kind={m.mediaType!} /> : (m.text ? <Linkified text={m.text} /> : (m.mediaType === "file" ? "📄 " + ((m as any).filename || "Archivo") : ""))}
      {hasMedia && caption ? <div style={{ marginTop: 6 }}><Linkified text={caption} /></div> : null}
      {m.summary ? <div className="msgsum">✦ {m.summary}</div> : null}
      {m.auto ? <div className="autobadge" onClick={() => onFeedback?.(m)} title="Respondido por el piloto — calificar">🤖 lo respondió el piloto · calificar</div> : null}
      <div className="btime">{hhmm(m.ts)}</div>
    </div>
  )
}

const NAV = [
  { id: "todo", ico: "▦", label: "Todo" }, { id: "prioritarios", ico: "✦", label: "Prioritarios" },
  { id: "sin", ico: "↩", label: "Sin responder" }, { id: "grupos", ico: "👥", label: "Grupos" },
]
// categorías (mismos buckets que web/mobile: bucketOf → family/amigos/trabajo) + silenciados (t.silenced)
const CATS = [
  { id: "familia", ico: "🏠", label: "Familia", bucket: "family" },
  { id: "amigos", ico: "😄", label: "Amigos", bucket: "amigos" },
  { id: "trabajo", ico: "💼", label: "Trabajo", bucket: "trabajo" },
  { id: "silenciados", ico: "🔕", label: "Silenciados", bucket: "" },
]

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [nav, setNav] = useState("todo")
  const [sel, setSel] = useState<Thread | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [person, setPerson] = useState<any>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [showCtx, setShowCtx] = useState(false)              // panel de contexto: oculto hasta que hacés click en el nombre
  const [chOff, setChOff] = useState<Set<string>>(new Set()) // canales apagados (filtro real de la lista)
  const [pane, setPane] = useState<"mensajes" | "calendario">("mensajes") // vista del rail
  const [draft, setDraft] = useState("")
  const [targets, setTargets] = useState<any[]>([])
  const [threadAuto, setThreadAuto] = useState(false)         // ¿el contacto abierto tiene piloto automático?
  const [modal, setModal] = useState<any>(null)              // "apcfg" | { fb: msgId, original } | null
  const [threadErr, setThreadErr] = useState("")             // error al cargar el hilo (para no mostrar "Sin mensajes" falso)
  const [correctOn, setCorrectOn] = useState(localStorage.getItem("pipe_correct") !== "0") // ✨ corregir con IA al enviar
  const [recording, setRecording] = useState(false)
  const [recAi, setRecAi] = useState(false)                  // ¿la grabación en curso es dictado-IA (true) o nota de voz (false)?
  const [busy, setBusy] = useState("")                       // "correct" | "stt" | "sum" | "attach" | ""
  const [sendOpts, setSendOpts] = useState<any>(null)        // hoja de 3 opciones (tal cual / corregido / mejorado)
  const [sched, setSched] = useState<any>(null)              // tarjeta 📅 de agendar detectada en el hilo
  const [sumCard, setSumCard] = useState("")                 // resumen del chat pedido por el botón
  const [threadCovert, setThreadCovert] = useState<string | null>(null) // estilo encubierto del contacto (null = no configurado)
  const [covertOn, setCovertOn] = useState(false)            // 🕊️ enviar el próximo mensaje cifrado (tapadera)
  const [undoArchive, setUndoArchive] = useState<Thread | null>(null) // toast de "deshacer" tras archivar
  const [hasMore, setHasMore] = useState(false)              // ¿hay mensajes más antiguos para cargar?
  const [oldestTs, setOldestTs] = useState(0)                // ts del más viejo que tengo (para paginar hacia atrás)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState("")                     // buscador de la bandeja (identidad: nombre/teléfono/email)
  const [msgHits, setMsgHits] = useState<any[]>([])          // resultados del buscador CONTEXTUAL (dentro de los mensajes)
  const [syncMsg, setSyncMsg] = useState("")                 // indicador del sync de texto completo ("Guardando historial…")

  useEffect(() => {
    if (!getBase()) { setAuthed(false); return } // sin hub configurado → login (con campo de hub)
    authStatus().then((s) => setAuthed(!!s.authed)).catch(() => setAuthed(false))
  }, [])
  useEffect(() => {
    if (!authed) return
    const cached = localStorage.getItem("pipe_threads") // la bandeja del último arranque → aparece al instante
    if (cached) { try { setThreads(JSON.parse(cached)) } catch {} }
    getThreads().then((d) => {
      const arr = Array.isArray(d) ? d : d.threads || []
      setThreads(arr); try { localStorage.setItem("pipe_threads", JSON.stringify(arr)) } catch {}
      setTimeout(() => fullTextSync(arr), 4000) // arranca el backfill de texto completo unos segundos después (UI primero)
    }).catch(() => {})
  }, [authed])

  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; t0: number; ai: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stickerRef = useRef<HTMLInputElement>(null)
  const syncingRef = useRef(false)
  const msgsRef = useRef<HTMLDivElement>(null)
  // notificaciones locales: detectar mensajes nuevos entrantes con un poll liviano y avisar si la app NO está enfocada
  const threadsRef = useRef<Thread[]>([])            // últimos threads (para abrir el hilo desde el click de la notificación)
  const seenTsRef = useRef<Map<string, number>>(new Map()) // último ts visto por hilo (para detectar lo nuevo)
  const focusedRef = useRef(true)                    // ¿la ventana está enfocada? (no notifico si el usuario ya está mirando)
  const notifOkRef = useRef(false)                   // ¿el SO concedió permiso de notificaciones?
  const pendingNotifKeyRef = useRef<string>("")      // hilo de la última notificación (para abrirlo al hacer click)
  useEffect(() => { threadsRef.current = threads }, [threads])
  // scroll al FONDO (lo más nuevo) al abrir un hilo o cuando llega un mensaje nuevo; NO al "cargar anteriores" (loadOlder prepende arriba)
  const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : ""
  useEffect(() => { if (msgsRef.current && !loadingMore) requestAnimationFrame(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight }) }, [sel?.key, lastMsgId, loadingThread])
  useEffect(() => { if (!undoArchive) return; const id = setTimeout(() => setUndoArchive(null), 6000); return () => clearTimeout(id) }, [undoArchive]) // el toast de deshacer se va solo
  // buscador CONTEXTUAL (debounced): busca dentro del cuerpo de los mensajes
  useEffect(() => {
    const q = query.trim(); if (q.length < 2) { setMsgHits([]); return }
    const id = setTimeout(() => { searchContent(q).then((r) => setMsgHits(Array.isArray(r) ? r : r?.items || [])).catch(() => setMsgHits([])) }, 300)
    return () => clearTimeout(id)
  }, [query])

  const refreshThreads = () => getThreads().then((d) => { const arr = Array.isArray(d) ? d : d.threads || []; setThreads(arr); try { localStorage.setItem("pipe_threads", JSON.stringify(arr)) } catch {} }).catch(() => {})
  const reloadThread = async (key: string) => { try { const d = await getThread(key); setMsgs(d.items || []); cacheSave(key, d.items || [], { maxRev: d.maxRev || 0 }) } catch {} }
  // 💾 SYNC DE TEXTO COMPLETO: baja TODO el texto de TODAS las conversaciones a tu Mac (IndexedDB), en 2do plano.
  // Las imágenes/media quedan on-demand (por link) — solo el texto se guarda entero. Resumible (guarda hasta dónde llegó).
  const fullTextSync = async (list: Thread[]) => {
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      const arr = list.filter((t) => t.key && t.key !== "self" && !(t as any).espacio)
      let done = 0
      for (const t of arr) {
        done++
        const local = await cacheLoad(t.key); const lm = local.meta || {}
        // 1) lo NUEVO (rev > maxRev) → mantiene el archivo al día aunque no abras el chat
        if (lm.maxRev) { const d = await getThreadDelta(t.key, lm.maxRev).catch(() => null); if (d?.items?.length) await cacheSave(t.key, d.items, { maxRev: d.maxRev }) }
        // 2) BACKFILL de lo viejo hasta el principio (resumible por syncOldest)
        if (!lm.syncDone) {
          setSyncMsg(`Guardando historial… ${done}/${arr.length}`)
          let before = lm.syncOldest || 0, guard = 0
          while (guard++ < 8000) {
            const d = await getThreadSync(t.key, before).catch(() => null)
            if (!d || !(d.items || []).length) { await cacheSave(t.key, [], { syncDone: true }); break }
            await cacheSave(t.key, d.items, { syncOldest: d.oldestTs })
            before = d.oldestTs
            if (!d.hasMore) { await cacheSave(t.key, [], { syncDone: true }); break }
            await new Promise((r) => setTimeout(r, 90)) // throttle: no satura el hub ni congela la UI
          }
        }
        await new Promise((r) => setTimeout(r, 40))
      }
    } finally { syncingRef.current = false; setSyncMsg("") }
  }
  // ▲ cargar mensajes MÁS ANTIGUOS (paginación hacia atrás) — arregla el historial de grupos grandes
  const loadOlder = async () => {
    if (!sel || loadingMore || !oldestTs) return
    setLoadingMore(true)
    try {
      const d = await getThreadBefore(sel.key, oldestTs)
      const older = (d.items || []).filter((it: Msg) => (it.ts || 0) < oldestTs)
      if (older.length) {
        setMsgs((cur) => { const byId = new Map<string, Msg>(); for (const it of [...older, ...cur]) byId.set(it.id, it); return [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)) })
        setOldestTs(older[0]?.ts || oldestTs)
        cacheSave(sel.key, older) // guardo los viejos en cache para la próxima
      }
      setHasMore(!!d.hasMore && older.length > 0)
    } catch {}
    setLoadingMore(false)
  }

  const open = useCallback(async (t: Thread) => {
    setSel(t); setShowCtx(false); setPerson(null); setDraft(""); setTargets([]); setThreadAuto(false); setThreadErr(""); setSched(null); setSumCard(""); setThreadCovert(null); setCovertOn(false); setHasMore(false); setOldestTs(0)
    // 1) LOCAL primero (IndexedDB) → los mensajes viejos aparecen al instante, sin re-descargar
    const local = await cacheLoad(t.key)
    const haveLocal = local.items.length > 0
    // hasMore por CANTIDAD (no confío en el flag cacheado: un grupo pudo tener pocos msgs al cachearse y ahora miles) → se auto-corrige en loadOlder
    if (haveLocal) { setMsgs(local.items); setOldestTs(local.items[0]?.ts || 0); setHasMore(local.items.length >= 20); setLoadingThread(false) } else { setMsgs([]); setLoadingThread(true) }
    // 2) de la RED: si ya tengo cache → solo el DELTA (rev > maxRev); si es la 1ra vez → carga completa
    try {
      if (haveLocal) {
        const lm = local.meta || {}
        const d = await getThreadDelta(t.key, lm.maxRev || 0)
        const byId = new Map(local.items.map((i) => [i.id, i])); for (const it of (d.items || [])) byId.set(it.id, it)
        const merged = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0))
        setMsgs(merged); setOldestTs(merged[0]?.ts || 0); setHasMore(merged.length >= 20) // por cantidad, no por el flag stale
        setThreadAuto(!!lm.autopilot)
        cacheSave(t.key, d.items || [], { maxRev: d.maxRev != null ? d.maxRev : (lm.maxRev || 0) })
      } else {
        const d = await getThread(t.key)
        setMsgs(d.items || []); setThreadAuto(!!d.autopilot)
        setOldestTs((d.items || [])[0]?.ts || 0); setHasMore(!!d.hasMore)
        cacheSave(t.key, d.items || [], { maxRev: d.maxRev || 0, autopilot: !!d.autopilot, hasMore: !!d.hasMore, oldestTs: d.oldestTs || 0 })
      }
    } catch (e: any) { if (!haveLocal) setThreadErr(e?.code === 401 ? "Sesión expirada — reconectá." : "No pude cargar los mensajes. Reintentá.") }
    setLoadingThread(false)
    getPerson(t.name).then(setPerson).catch(() => {})
    getTargets(t.key).then((r) => setTargets(r?.targets || [])).catch(() => {})
    getSchedule(t.key).then((r) => { if (r && r.found) setSched(r) }).catch(() => {}) // 📅 ¿está hablando de agendar?
    getCovert(t.key).then((c) => setThreadCovert(c?.enabled ? (c.style || "poema") : null)).catch(() => {}) // 🕊️ ¿este contacto tiene modo encubierto?
  }, [])

  // ── NOTIFICACIONES LOCALES (equivalente desktop del web-push/expo) ──
  // seguimiento del foco: no molesto con notificaciones si el usuario ya está mirando la app
  useEffect(() => {
    const on = () => { focusedRef.current = true }
    const off = () => { focusedRef.current = false }
    const vis = () => { focusedRef.current = document.visibilityState === "visible" && document.hasFocus() }
    window.addEventListener("focus", on); window.addEventListener("blur", off); document.addEventListener("visibilitychange", vis)
    focusedRef.current = document.hasFocus()
    return () => { window.removeEventListener("focus", on); window.removeEventListener("blur", off); document.removeEventListener("visibilitychange", vis) }
  }, [])
  // click en la notificación → traigo la ventana al frente y abro ese hilo
  useEffect(() => {
    if (!isDesktopApp) return
    let un: (() => void) | null = null
    ;(async () => {
      try {
        const n = await import("@tauri-apps/plugin-notification")
        const l = await n.onAction(() => {
          import("@tauri-apps/api/window").then(({ getCurrentWindow }) => { try { getCurrentWindow().setFocus() } catch {} }).catch(() => {})
          const t = threadsRef.current.find((x) => x.key === pendingNotifKeyRef.current)
          if (t) { setPane("mensajes"); open(t) }
        })
        un = () => { l.unregister().catch(() => {}) }
      } catch {}
    })()
    return () => { try { un && un() } catch {} }
  }, [open])
  // poll liviano: cada 25s reviso la bandeja; si hay un mensaje NUEVO entrante y la app está sin foco, disparo la notificación
  useEffect(() => {
    if (!authed || !isDesktopApp) return
    let stop = false
    ensureNotifPermission().then((ok) => { notifOkRef.current = ok }) // pide permiso 1 sola vez al arrancar
    const tick = async () => {
      if (stop) return
      let d: any
      try { d = await getThreads() } catch { return }
      const arr: Thread[] = Array.isArray(d) ? d : d.threads || []
      if (!arr.length) return
      const seen = seenTsRef.current
      const seeding = seen.size === 0 // la 1ra vuelta solo siembra: nunca notifico lo que ya estaba al abrir la app
      const fresh: Thread[] = []
      for (const t of arr) {
        if (!t.key || t.key === "self") continue
        const prev = seen.get(t.key)
        if (!seeding && prev != null && (t.ts || 0) > prev && t.lastDir !== "out") fresh.push(t)
        seen.set(t.key, t.ts || 0)
      }
      setThreads(arr); try { localStorage.setItem("pipe_threads", JSON.stringify(arr)) } catch {}
      if (notifOkRef.current && !focusedRef.current && fresh.length) {
        pendingNotifKeyRef.current = fresh[0].key
        try {
          const n = await import("@tauri-apps/plugin-notification")
          const extra = fresh.length > 3 ? ` +${fresh.length - 3} más` : ""
          fresh.slice(0, 3).forEach((t, i) => n.sendNotification({ title: (t.name || "Nuevo mensaje") + (i === 2 && extra ? extra : ""), body: (t.lastText || "Nuevo mensaje").slice(0, 140) }))
        } catch {}
      }
    }
    const id = setInterval(tick, 25000)
    return () => { stop = true; clearInterval(id) }
  }, [authed])

  const target = () => targets.find((x) => x.isDefault) || targets[0]
  const doSend = async (txt: string, covert = false) => {
    if (!txt.trim() || !sel) return
    const tg = target()
    // en encubierto la burbuja muestra tu texto REAL (+ badge); WhatsApp ve la tapadera que devuelve el server
    setMsgs((cur) => [...cur, { id: "opt-" + Date.now(), dir: "out", text: txt, ts: Date.now(), channel: tg?.channel, ...(covert ? { covert: { text: txt, style: threadCovert || "poema" } } : {}) }]) // optimista
    try { await sendMsg(sel.key, txt, tg, covert); await reloadThread(sel.key) } catch {}
  }
  // corrector ✨: si está activo, muestro las 3 opciones (tal cual / corregido / mejorado); si no, mando tal cual.
  // NO borro el draft hasta tener la hoja abierta → si el corrector falla o cancelás, el texto NUNCA se pierde.
  const onSend = async () => {
    const txt = draft.trim(); if (!txt || !sel) return
    if (covertOn) { setDraft(""); return doSend(txt, true) } // encubierto: cifrado directo, sin corrector
    if (!correctOn) { setDraft(""); return doSend(txt) }
    setBusy("correct")
    const c = await correctText(txt, target()?.channel).catch(() => null)
    setBusy("")
    if (!c) { alert("El corrector no respondió — probá de nuevo, o apagá ✨ para enviar tal cual."); return } // texto intacto en el input
    if (!c.corrected && !c.alternative) { setDraft(""); return doSend(txt) } // no había nada que corregir → mando tal cual
    setDraft("") // recién ahora lo saco del input; si cancelás la hoja te lo devuelvo (onClose)
    setSendOpts({ original: c.original || txt, corrected: c.corrected || txt, alternative: c.alternative || "" })
  }
  const toggleCorrect = () => setCorrectOn((v) => { localStorage.setItem("pipe_correct", v ? "0" : "1"); return !v })

  // grabar: ai=false → nota de voz (manda el audio) · ai=true → dictado (STT → 3 opciones de texto)
  const startRec = async (ai: boolean) => {
    if (!sel || recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "audio/webm")
      const rec = new MediaRecorder(stream, { mimeType: mime }); const chunks: Blob[] = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: mime }); const dur = Math.round((Date.now() - (recRef.current?.t0 || Date.now())) / 1000)
        const ai = recRef.current?.ai; recRef.current = null; setRecording(false)
        const b64 = await blobToB64(blob).catch(() => "")
        if (!b64) return
        if (ai) { // dictado: transcribo y ofrezco las 3 opciones de texto
          setBusy("stt"); const r = await sttB64(b64, mime.split(";")[0]).catch(() => null); setBusy("")
          const t = (r?.text || "").trim(); if (!t) return alert("No pude entender el audio.")
          const c = await correctText(t, target()?.channel).catch(() => null)
          setSendOpts({ original: t, corrected: c?.corrected || t, alternative: c?.alternative || "" })
        } else { // nota de voz real
          setMsgs((cur) => [...cur, { id: "opt-" + Date.now(), dir: "out", text: "🎤 Nota de voz", ts: Date.now(), channel: target()?.channel, mediaType: "audio" }])
          await sendAudioB64(sel.key, b64, mime.split(";")[0], dur, target()).catch(() => alert("No se pudo enviar el audio."))
          await reloadThread(sel.key)
        }
      }
      recRef.current = { rec, chunks, t0: Date.now(), ai }; rec.start(); setRecording(true); setRecAi(ai)
    } catch { alert("No pude acceder al micrófono.") }
  }
  const stopRec = () => recRef.current?.rec.stop()

  // 📎 adjuntar archivo/foto/video real
  const onAttach = () => fileRef.current?.click()
  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])]; e.target.value = ""; if (!files.length || !sel) return
    setBusy("attach")
    for (const f of files) { // varias a la vez → una tras otra (en orden, no satura el bridge)
      const b64 = await blobToB64(f).catch(() => "")
      const kind = /^image\//.test(f.type) ? "image" : /^video\//.test(f.type) ? "video" : "file"
      setMsgs((cur) => [...cur, { id: "opt-" + Date.now() + "-" + f.name, dir: "out", text: kind === "file" ? "📄 " + f.name : "", ts: Date.now(), channel: target()?.channel, mediaType: kind }])
      if (b64) await sendMediaB64(sel.key, b64, f.type || "application/octet-stream", f.name, target()).catch(() => alert("No se pudo enviar " + f.name))
    }
    setBusy(""); await reloadThread(sel.key)
  }
  // 🩷 mandar una imagen como sticker (el server la convierte a webp 512×512)
  const onSticker = () => stickerRef.current?.click()
  const onStickerPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f || !sel) return
    setBusy("attach")
    const b64 = await blobToB64(f).catch(() => "")
    setMsgs((cur) => [...cur, { id: "opt-" + Date.now(), dir: "out", text: "🖼 Sticker", ts: Date.now(), channel: target()?.channel, mediaType: "image" }])
    if (b64) await sendStickerB64(sel.key, b64, f.type || "image/jpeg", target()).catch(() => alert("No se pudo enviar el sticker."))
    setBusy(""); await reloadThread(sel.key)
  }

  // 📝 resumen del chat (range=all → resume toda la conversación; "today" daba vacío si no hablaste hoy)
  const summarize = async () => {
    if (!sel) return; setBusy("sum"); setSumCard("Resumiendo…")
    const r = await summarizeThread(sel.key, "all").catch(() => null); setBusy("")
    setSumCard((r?.summary || r?.text || "").trim() || "No hay suficiente conversación para resumir.")
  }
  const confirmSchedule = async () => {
    if (!sched || !sel) return
    // hora puntual → uso esa fecha; hora vaga → primer hueco libre sugerido; si no hay ninguna, aviso
    const date = sched.hasTime ? sched.date : (sched.suggestions?.[0]?.date || sched.date)
    if (!date) { alert("Falta la hora — abrí el calendario para elegir un horario."); return }
    const r = await createSchedule({ key: sel.key, date, title: sched.topic || sched.title || "Reunión", durationMin: sched.durationMin || 30, platform: sched.platform || "meet", emails: sched.emails || [], note: sched.note || "" }).catch(() => ({ error: "no pude agendar" }))
    setSched(null)
    if (r?.error) alert("No se pudo agendar: " + r.error)
    await reloadThread(sel.key)
  }

  const togglePin = async () => {
    if (!sel) return
    const p = !sel.pinned
    setSel({ ...sel, pinned: p }) // optimista → el botón cambia YA
    setThreads((ts) => ts.map((t) => (t.key === sel.key ? { ...t, pinned: p } : t))) // y la lista
    await setPin(sel.key, p).catch(() => setSel({ ...sel, pinned: !p })) // si falla, revierto
    refreshThreads()
  }
  const archive = async () => {
    if (!sel) return
    const archived = sel
    setSel(null); setThreads((ts) => ts.filter((t) => t.key !== archived.key))
    await setArchive(archived.key, true).catch(() => {})
    setUndoArchive(archived) // toast con "Deshacer" por unos segundos
    refreshThreads()
  }
  const doUndoArchive = async () => { const a = undoArchive; if (!a) return; setUndoArchive(null); await setArchive(a.key, false).catch(() => {}); refreshThreads() }

  if (authed === null) return <div className="center"><div className="spin" /></div>
  if (!authed) return <Login onOk={() => setAuthed(true)} />

  // categoría del hilo — MISMA semántica que web/mobile (bucketCat): family→familia, amigos→amigos, resto→trabajo; spam/grupo fuera
  const isWork = (t: Thread) => !t.group && t.bucket !== "spam" && t.bucket !== "family" && t.bucket !== "amigos"
  const inCat = (t: Thread, id: string) => id === "familia" ? t.bucket === "family" : id === "amigos" ? t.bucket === "amigos" : id === "trabajo" ? isWork(t) : id === "silenciados" ? !!t.silenced : true
  const nq = query.trim().toLowerCase(), ndig = nq.replace(/\D/g, "")
  const matchQ = (t: Thread) => { const hay = `${t.name || ""} ${t.key || ""} ${t.email || ""} ${t.lastText || ""}`.toLowerCase(); return hay.includes(nq) || (ndig.length >= 3 && hay.replace(/\D/g, "").includes(ndig)) }
  const list = threads.filter((t) => t.key !== "self" && !((t as any).espacio) && t.bucket !== "spam")
    // con búsqueda: ignora tab/categoría (busca en TODO); sin búsqueda: respeta tab
    .filter((t) => nq ? matchQ(t) : nav === "sin" ? (t.lastDir !== "out" && (t.unseen || t.unread)) : nav === "grupos" ? t.group : nav === "prioritarios" ? t.pinned
      : CATS.some((c) => c.id === nav) ? inCat(t, nav) : true)
    .filter((t) => { const ch = t.channels || []; return !nq && ch.length ? ch.some((c) => !chOff.has(c)) : true }) // filtro por canal (no aplica en búsqueda)
    .sort((a, b) => (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0)) // el piloto escaló → arriba de todo
  const counts = {
    todo: threads.filter((t) => t.unread || t.unseen).length,
    sin: threads.filter((t) => t.lastDir !== "out" && (t.unseen || t.unread)).length,
    grupos: threads.filter((t) => t.group).length,
    prioritarios: threads.filter((t) => t.pinned).length,
    familia: threads.filter((t) => t.bucket === "family").length,
    amigos: threads.filter((t) => t.bucket === "amigos").length,
    trabajo: threads.filter((t) => isWork(t)).length,
    silenciados: threads.filter((t) => t.silenced).length,
  } as Record<string, number>

  return (
    <div className={"app" + (pane === "calendario" ? " cal" : (sel ? " topen" + (showCtx ? " copen" : "") : ""))}>
      {/* rail */}
      <div className="rail">
        <div className="brand" />
        <button className={"tipright" + (pane === "mensajes" ? " on" : "")} onClick={() => setPane("mensajes")} data-tip="Mensajes">💬</button>
        <button className={"tipright" + (pane === "calendario" ? " on" : "")} onClick={() => setPane("calendario")} data-tip="Calendario">🗓</button>
        <button className="tipright" data-tip="Radar (próximamente)">✦</button>
        <button className="tipright" data-tip="Notas (próximamente)">📄</button>
        <button className="tipright" data-tip="Personas (próximamente)">👤</button>
        <div className="spacer" />
        <div className="me">AZ</div>
      </div>

      {pane === "calendario" ? <Calendar onOpenContact={(name) => {
        const nn = name.trim().toLowerCase()
        const t = threads.find((x) => (x.name || "").trim().toLowerCase() === nn) || threads.find((x) => (x.name || "").toLowerCase().includes(nn.split(" ")[0]))
        setPane("mensajes"); if (t) open(t)
      }} /> : <>

      {/* sidebar */}
      <div className="side">
        <button className="newbtn">＋ Nuevo</button>
        <div className="search"><span style={{ opacity: .6 }}>🔎</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar — nombre, teléfono, email…" />{query ? <span onClick={() => setQuery("")} style={{ cursor: "pointer", opacity: .6 }}>✕</span> : null}</div>
        <div className="grp">Bandeja</div>
        {NAV.map((n) => (
          <div key={n.id} className={"navitem" + (nav === n.id ? " on" : "")} onClick={() => setNav(n.id)}>
            <span className="ico">{n.ico}</span>{n.label}{counts[n.id] ? <span className="n">{counts[n.id]}</span> : null}
          </div>
        ))}
        <div className="grp">Categorías</div>
        {CATS.map((c) => (
          <div key={c.id} className={"navitem" + (nav === c.id ? " on" : "")} onClick={() => setNav(c.id)}>
            <span className="ico">{c.ico}</span>{c.label}{counts[c.id] ? <span className="n">{counts[c.id]}</span> : null}
          </div>
        ))}
        <div className="grp">Espacios</div>
        <div className="navitem"><span className="ico">◆</span>Colegio</div>
        <div className="navitem"><span className="ico">◆</span>Gravity</div>
        <div className="grp">Canales <span className="sep">Separar</span></div>
        {["whatsapp", "teams", "email", "telegram"].map((c) => (
          <div key={c} className="chan" style={{ cursor: "pointer" }} onClick={() => setChOff((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n })}>
            <span className="dot" style={{ background: CH[c].c }} />{CH[c].label}<span className={"sw" + (chOff.has(c) ? " off" : "")} />
          </div>
        ))}
        <div className="grp">Herramientas</div>
        <div className="navitem" onClick={() => setModal("waimport")}><span className="ico">📤</span>Importar WhatsApp</div>
        {syncMsg ? <div className="syncline" title="Guardando todo el texto en tu Mac (offline). Las imágenes quedan on-demand.">💾 {syncMsg}</div> : null}
      </div>

      {/* list */}
      <div className="list">
        <div className="lhead"><h2>{query.trim() ? "Resultados" : "Conversaciones"}</h2><span style={{ color: "var(--muted2)" }}>⚟</span></div>
        {query.trim() ? <div className="grp" style={{ padding: "6px 18px 2px" }}>Contactos</div> : null}
        {list.map((t) => (
          <div key={t.key} className={"row" + (sel?.key === t.key ? " on" : "") + (t.escalated ? " esc" : "")} onClick={() => open(t)}>
            <Avatar name={t.name} photo={t.photo} />
            <div className="mid">
              <div className="top">
                <span className="nm">{t.name}</span>
                {t.escalated ? <span title={t.escalatedReason || "El piloto te lo pasó — revisá vos"} style={{ fontSize: 12 }}>🏖️⚠️</span> : null}
                {(t as any).autopilot && !t.escalated ? <span title="Piloto automático activo" style={{ fontSize: 12 }}>🤖</span> : null}
                <span className="time">{ago(t.ts)}</span>
              </div>
              {t.escalated ? <div className="escnote">🏖️ El piloto te lo pasó{t.escalatedReason ? " · " + t.escalatedReason : ""}</div> : null}
              <div className="sub">
                {(t.channels || []).slice(0, 3).map((c) => <span key={c} className="dot2" style={{ width: 7, height: 7, borderRadius: 9, background: CH[c]?.c || "#ccc", display: "inline-block" }} />)}
                {(t.channels || []).length ? <span className="chip">{(t.channels || []).length} {(t.channels || []).length > 1 ? "canales" : "canal"}</span> : null}
              </div>
              <div className="prev">{(t.lastDir === "out" ? "Vos: " : "") + (t.lastText || "…")}</div>
            </div>
            {(t.unread || t.unseen) ? <span className="unread" /> : null}
          </div>
        ))}
        {/* buscador CONTEXTUAL: coincidencias dentro del cuerpo de los mensajes */}
        {query.trim() && msgHits.length > 0 && (<>
          <div className="grp" style={{ padding: "10px 18px 2px" }}>En los mensajes</div>
          {msgHits.slice(0, 40).map((h, i) => {
            const t = threads.find((x) => x.key === h.key)
            return (
              <div key={"h" + i} className="row" onClick={() => t ? open(t) : open({ key: h.key, name: h.who || h.key } as Thread)}>
                <Avatar name={h.who || h.key} photo={t?.photo} />
                <div className="mid">
                  <div className="top"><span className="nm">{h.who || t?.name || "—"}</span><span className="time">{ago(h.ts)}</span></div>
                  <div className="prev">{(h.dir === "out" ? "Vos: " : "") + (h.text || "")}</div>
                </div>
              </div>
            )
          })}
        </>)}
        {!list.length && !(query.trim() && msgHits.length) && <div className="center" style={{ height: 200 }}>{query.trim() ? "Nada coincide" : "Sin conversaciones"}</div>}
      </div>

      {/* thread */}
      {sel && (
        <div className="thread">
          <div className="thead">
            <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minWidth: 0 }} onClick={() => setShowCtx((v) => !v)} title="Ver/ocultar el contexto del contacto">
              <Avatar name={sel.name} photo={sel.photo} size={38} />
              <div style={{ minWidth: 0 }}>
                <div className="ti">{sel.name} <span style={{ color: "var(--muted2)", fontSize: 12, fontWeight: 400 }}>›</span></div>
                <div className="tsub">{(sel.channels || []).map((c) => CH[c]?.label || c).join(" · ") || "conversación"}</div>
              </div>
            </div>
            <div className="acts">
              <button data-tip={threadAuto ? "Piloto automático ON" : "Piloto automático"} onClick={() => setModal("apcfg")} style={{ color: threadAuto ? "var(--accent)" : undefined }}>🤖</button>
              <button data-tip="Sugerir una respuesta (IA)" onClick={async () => { if (!sel) return; const r = await import("./api").then((a) => a.suggestReply(sel.key)).catch(() => null); if (r?.draft) setDraft(r.draft) }}>✦</button>
              <button data-tip="Resumir la conversación (IA)" onClick={summarize} disabled={busy === "sum"}>{busy === "sum" ? "…" : "📝"}</button>
              <button data-tip={threadCovert ? "Modo encubierto (configurado)" : "Modo encubierto (El Santo)"} onClick={() => setModal("covert")} style={{ color: threadCovert ? "var(--accent)" : undefined }}>🕊️</button>
              <button data-tip={sel.pinned ? "Fijada arriba — desfijar" : "Fijar arriba"} onClick={togglePin} style={sel.pinned ? { color: "#fff", background: "var(--accent)", borderRadius: 8 } : undefined}>📌</button>
              <button data-tip="Archivar" onClick={archive}>🗄</button>
            </div>
          </div>
          <div className="msgs" ref={msgsRef}>
            {!loadingThread && !threadErr && hasMore ? <div className="loadolder" onClick={loadOlder}>{loadingMore ? "Cargando…" : "▲ Cargar mensajes anteriores"}</div> : null}
            {loadingThread ? <div className="center"><div className="spin" /></div>
              : threadErr ? <div className="center" style={{ flexDirection: "column", gap: 10 }}><span style={{ color: "var(--muted)" }}>{threadErr}</span><button className="mbtn" onClick={() => open(sel)}>Reintentar</button></div>
              : <Messages msgs={msgs} onFeedback={(m) => setModal({ fb: m.id, original: m.text || "" })} />}
            {sumCard ? <div className="aisum" style={{ margin: "10px 6px" }}>📝 {sumCard}</div> : null}
          </div>
          <div className="composer">
            {sched ? (
              <div className="schedcard">
                <span>📅 Parece que están coordinando {sched.topic ? <b>{sched.topic}</b> : "algo"}{schedLabel(sched) ? <> · <b>{schedLabel(sched)}</b></> : ""}. ¿Agendo?</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="mbtn" onClick={confirmSchedule}>Agendar</button>
                  <button className="mbtn ghost" onClick={() => setSched(null)}>✕</button>
                </div>
              </div>
            ) : null}
            <div className="cmeta">Responder por <b>{CH[target()?.channel as string]?.label || target()?.channel || CH[(sel.channels || [])[0]]?.label || "el canal habitual"}</b> · Pipe elige dónde suele responder</div>
            <div className="crow">
              {threadCovert ? <button className="clip tipup" data-tip={covertOn ? "Encubierto ON — tocá para desactivar" : "Enviar cifrado (El Santo)"} onClick={() => setCovertOn((v) => !v)} style={{ background: covertOn ? "var(--accent)" : undefined, color: covertOn ? "#fff" : undefined }}>🕊️</button> : null}
              <button className="clip tipup" data-tip={correctOn ? "Corrijo con IA al enviar — tocá para enviar tal cual" : "Enviar tal cual — tocá para corregir con IA"} onClick={toggleCorrect} style={{ background: correctOn ? "var(--accent)" : undefined, color: correctOn ? "#fff" : undefined }}>✨</button>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSend() } }} placeholder={covertOn ? "🕊️ Mensaje encubierto…" : busy === "correct" ? "Corrigiendo…" : recording ? (recAi ? "Grabando… (dictado)" : "Grabando nota de voz…") : "Escribí un mensaje…"} disabled={recording} />
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onFilePicked} />
              <input ref={stickerRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onStickerPicked} />
              <button className="clip tipup" data-tip="Adjuntar fotos, videos o archivos (varios)" onClick={onAttach} disabled={busy === "attach"}>{busy === "attach" ? "…" : "📎"}</button>
              <button className="clip tipup" data-tip="Mandar una imagen como sticker" onClick={onSticker} disabled={busy === "attach"}>😀</button>
              {/* nota de voz: graba y MANDA el audio */}
              <button className={"clip tipup" + (recording && !recAi ? " rec" : "")} data-tip={recording && !recAi ? "Detener y enviar la nota de voz" : "Nota de voz (graba y manda el audio)"} onClick={() => recording ? (!recAi && stopRec()) : startRec(false)} disabled={recording && recAi} style={{ color: recording && !recAi ? "#e2483d" : undefined }}>{recording && !recAi ? "⏹" : "🎤"}</button>
              {/* dictado IA: hablás y lo pasa a TEXTO (no manda audio) */}
              <button className={"clip iapill tipup" + (recording && recAi ? " rec" : "")} data-tip={recording && recAi ? "Detener y transcribir" : "Dictar con IA: hablás → texto"} onClick={() => recording ? (recAi && stopRec()) : startRec(true)} disabled={recording && !recAi} style={{ color: recording && recAi ? "#e2483d" : "var(--accent)" }}>{recording && recAi ? "⏹" : <><span style={{ fontSize: 15 }}>🎤</span><span style={{ fontSize: 8.5, fontWeight: 800, marginLeft: 1 }}>IA</span></>}</button>
              {draft.trim() ? <button className="send" onClick={onSend}>➤</button> : null}
            </div>
          </div>
        </div>
      )}

      {/* context — oculto hasta que hacés click en el nombre del contacto */}
      {sel && showCtx && (
        <div className="ctx">
          <div className="cav" style={{ background: colorOf(sel.name) }}>{initials(sel.name)}</div>
          <div className="cname">{sel.name}</div>
          <div className="crole">{person?.role || (sel.channels || []).map((c) => CH[c]?.label || c).join(" · ")}</div>
          <div className="cicons"><button>💬</button><button>✉️</button><button>📞</button><button>🗓</button></div>
          {person?.bio && (<><div className="cgrp">✦ Contexto</div><div className="cbox">{person.bio}</div></>)}
          {(person?.pending || []).length > 0 && (<>
            <div className="cgrp">Pendientes detectados</div>
            {person.pending.slice(0, 5).map((p: any, i: number) => (
              <div key={i} className="pend"><span className="cb" />{typeof p === "string" ? p : p.text}{p.due ? <span className="due">{p.due}</span> : null}</div>
            ))}
          </>)}
          {(person?.topics || []).length > 0 && (<>
            <div className="cgrp">De qué hablan</div>
            <div className="cbox">{person.topics.slice(0, 4).join(" · ")}</div>
          </>)}
          {sel.group && (() => {
            const members = [...new Set(msgs.filter((m) => m.dir !== "out" && m.name).map((m) => m.name as string))]
            return members.length ? (<>
              <div className="cgrp">Miembros del grupo · {members.length}</div>
              {members.slice(0, 40).map((nm, i) => (
                <div key={i} className="pend" style={{ alignItems: "center" }}>
                  <span className="cav" style={{ width: 26, height: 26, fontSize: 10, background: colorOf(nm), flexShrink: 0 }}>{initials(nm)}</span>{nm}
                </div>
              ))}
            </>) : null
          })()}
        </div>
      )}

      {modal === "apcfg" && sel && <AutopilotModal sel={sel} onClose={() => setModal(null)} onSaved={(on: boolean) => { setThreadAuto(on); setModal(null); refreshThreads() }} />}
      {modal && modal.fb && sel && <FeedbackModal apkey={sel.key} original={modal.original} onClose={() => setModal(null)} />}
      {sendOpts && <SendOptions opts={sendOpts} onPick={(t: string) => { setSendOpts(null); doSend(t) }} onClose={() => { setDraft(sendOpts.original || ""); setSendOpts(null) }} />}
      {modal === "covert" && sel && <CovertModal sel={sel} onClose={() => setModal(null)} onSaved={(style: string | null) => { setThreadCovert(style); if (!style) setCovertOn(false); setModal(null) }} />}
      {modal === "waimport" && <WhatsAppImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); refreshThreads() }} />}
      {undoArchive && <div className="toast"><span>🗄 Archivaste <b>{undoArchive.name}</b></span><button onClick={doUndoArchive}>Deshacer</button></div>}
      </>}
    </div>
  )
}

function AutopilotModal({ sel, onClose, onSaved }: { sel: Thread; onClose: () => void; onSaved: (on: boolean) => void }) {
  const [cfg, setCfg] = useState<any>(null)
  const [max, setMax] = useState("")
  useEffect(() => { getAutopilot(sel.key).then((c) => { setCfg(c); setMax(c.maxPerDay > 0 ? String(c.maxPerDay) : "") }).catch(() => setCfg({ enabled: false })) }, [sel.key])
  const save = async () => { const m = max.trim() ? Math.max(1, Math.min(500, parseInt(max, 10) || 0)) : 0; await setAutopilot(sel.key, true, m).catch(() => {}); onSaved(true) }
  const disable = async () => { await setAutopilot(sel.key, false).catch(() => {}); onSaved(false) }
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>🏖️ Piloto automático · {sel.name}</h3>
      <p className="modalsub">La IA responde <b>en tu voz</b> las preguntas simples de {sel.name}. Nunca suena a IA, no da datos que no diste, no acepta reuniones ni manda fotos — cualquier otra cosa te la escala a vos.</p>
      <label className="modallabel">Límite de respuestas por día — vacío = <b>sin límite</b></label>
      <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="sin límite" className="modalinput" />
      <div className="modalrow">
        <button className="mbtn" onClick={save}>{cfg?.enabled ? "Guardar cambios" : "Activar piloto"}</button>
        {cfg?.enabled ? <button className="mbtn ghost" onClick={disable}>Desactivar</button> : null}
      </div>
    </div></div>
  )
}
function FeedbackModal({ apkey, original, onClose }: { apkey: string; original: string; onClose: () => void }) {
  const [bad, setBad] = useState(false)
  const [txt, setTxt] = useState("")
  const send = async (good: boolean) => { await autopilotFeedback(apkey, good, good ? "" : txt.trim(), original).catch(() => {}); onClose() }
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>🤖 ¿Cómo respondió el piloto?</h3>
      <p className="modalsub">"{(original || "").slice(0, 160)}"</p>
      {!bad ? (
        <div className="modalrow">
          <button className="mbtn" onClick={() => send(true)}>👍 Estuvo bien</button>
          <button className="mbtn ghost" onClick={() => setBad(true)}>👎 Estuvo mal</button>
        </div>
      ) : (<>
        <label className="modallabel">¿Qué hubieras dicho vos? (así aprende a responder como vos)</label>
        <textarea value={txt} onChange={(e) => setTxt(e.target.value)} className="modalinput" style={{ minHeight: 70 }} placeholder="Lo que vos habrías respondido…" />
        <div className="modalrow"><button className="mbtn" onClick={() => send(false)}>Guardar corrección</button></div>
      </>)}
    </div></div>
  )
}

// modo encubierto "El Santo": clave + estilo por-contacto. El server cifra el texto en una tapadera (poema/cuento/…) al enviar.
const COVERT_STYLES = [["poema", "Poema"], ["cuento", "Cuento"], ["receta", "Receta"], ["oracion", "Oración"]]
function CovertModal({ sel, onClose, onSaved }: { sel: Thread; onClose: () => void; onSaved: (style: string | null) => void }) {
  const [cfg, setCfg] = useState<any>(null)
  const [pass, setPass] = useState(""); const [style, setStyle] = useState("poema")
  useEffect(() => { getCovert(sel.key).then((c) => { setCfg(c || {}); if (c?.style) setStyle(c.style) }).catch(() => setCfg({})) }, [sel.key])
  const save = async () => { if (!pass.trim()) return; await setCovert(sel.key, pass.trim(), style).catch(() => {}); onSaved(style) }
  const disable = async () => { await setCovert(sel.key, "", "").catch(() => {}); onSaved(null) }
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>🕊️ Modo encubierto · {sel.name}</h3>
      <p className="modalsub">Tus mensajes viajan disfrazados como un {style} inocente; solo quien tenga la misma clave los descifra. Vos ves tu texto real; WhatsApp ve la tapadera.</p>
      <label className="modallabel">Clave secreta (compartila con {sel.name} por otro medio)</label>
      <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg?.enabled ? "•••••• (ya configurada — escribí para cambiar)" : "una frase que solo ustedes saben"} className="modalinput" type="password" />
      <label className="modallabel">Disfraz</label>
      <div className="modalrow" style={{ flexWrap: "wrap" }}>
        {COVERT_STYLES.map(([id, l]) => <button key={id} className={"mbtn" + (style === id ? "" : " ghost")} onClick={() => setStyle(id)}>{l}</button>)}
      </div>
      <div className="modalrow" style={{ marginTop: 12 }}>
        <button className="mbtn" onClick={save} disabled={!pass.trim()}>{cfg?.enabled ? "Guardar cambios" : "Activar encubierto"}</button>
        {cfg?.enabled ? <button className="mbtn ghost" onClick={disable}>Desactivar</button> : null}
      </div>
    </div></div>
  )
}
// 📤 Importar historial de WhatsApp: el usuario exporta un chat ("Exportar chat" en WhatsApp) y elige el .txt (solo texto) o .zip (con media) acá.
// El archivo se lee nativamente (read_file_b64) y se sube al hub que lo parsea y mergea al hilo sin duplicar. Mismo backend que web/mobile.
const WA_STEPS = [
  "Abrí en WhatsApp el chat o grupo que querés traer.",
  "Tocá el menú ⋮ → Más → Exportar chat.",
  "Elegí «Con multimedia» (.zip, trae fotos y audios) o «Sin multimedia» (.txt, solo texto pero más historial).",
  "Guardá el archivo y elegilo acá abajo.",
]
function WhatsAppImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [group, setGroup] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")
  const pick = async () => {
    setErr(""); setMsg("")
    let path: string | null = null
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const sel = await open({ multiple: false, filters: [{ name: "Export de WhatsApp", extensions: ["txt", "zip"] }] })
      path = Array.isArray(sel) ? sel[0] : sel
    } catch { setErr("No pude abrir el explorador de archivos."); return }
    if (!path) return
    const isZip = /\.zip$/i.test(path)
    const name = chatNameFromFile(path.split(/[\\/]/).pop() || "")
    const tz = -new Date().getTimezoneOffset()
    setBusy(true); setMsg("Leyendo el archivo…")
    try {
      const b64 = await readFileB64(path)
      setMsg(isZip ? "Importando (con fotos y audios)… puede tardar." : "Importando…")
      const r = isZip ? await importWhatsAppZipB64(b64, { name, order: "auto", tz, group }) : await importWhatsAppB64(b64, { name, order: "auto", tz, group })
      setBusy(false)
      if (!r || r.error) { setMsg(""); setErr((r && r.error) || "Revisá que sea un export de WhatsApp (.txt o .zip)."); return }
      const extra = r.skipped ? ` (${r.skipped} ya estaban)` : ""
      const withMedia = r.media ? ` · ${r.media} con foto/audio` : ""
      setMsg(`✓ ${r.inserted || 0} mensajes agregados a tu historial${withMedia}${extra}.`)
      setTimeout(onDone, 1600)
    } catch (e: any) { setBusy(false); setMsg(""); setErr(String((e && e.message) || e) || "Error al importar.") }
  }
  return (
    <div className="modalbg" onClick={busy ? undefined : onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>📤 Importar historial de WhatsApp</h3>
      <p className="modalsub">WhatsApp guarda tus chats cifrados y no deja que otra app los lea — pero podés traerlos vos con «Exportar chat». Se agrega sin duplicar lo que ya tenés.</p>
      <div style={{ margin: "4px 0 12px" }}>
        {WA_STEPS.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 9 }}>
            <span style={{ width: 20, height: 20, borderRadius: 10, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: "var(--ink)" }}>{s}</span>
          </div>
        ))}
      </div>
      <label className="modallabel" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> Es un grupo (varios participantes)
      </label>
      {err ? <div className="err" style={{ marginTop: 10 }}>{err}</div> : null}
      {msg ? <div className="modalsub" style={{ marginTop: 10, color: "var(--accent-ink)" }}>{msg}</div> : null}
      <div className="modalrow" style={{ marginTop: 14 }}>
        <button className="mbtn" onClick={pick} disabled={busy}>{busy ? "Importando…" : "Elegir archivo (.txt o .zip)"}</button>
        <button className="mbtn ghost" onClick={onClose} disabled={busy}>Cerrar</button>
      </div>
    </div></div>
  )
}
// hoja de 3 opciones al enviar con el corrector ✨ (tal cual / corregido / mejorado) — igual que web/mobile
function SendOptions({ opts, onPick, onClose }: { opts: any; onPick: (t: string) => void; onClose: () => void }) {
  const rows = [
    { k: "Corregido", t: opts.corrected, sub: "ortografía y tildes arregladas" },
    opts.alternative ? { k: "Otra forma", t: opts.alternative, sub: "mejor redactado" } : null,
    { k: "Tal cual lo dijiste", t: opts.original, sub: "sin cambios" },
  ].filter(Boolean) as { k: string; t: string; sub: string }[]
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>Elegí qué enviar</h3>
      {rows.map((r, i) => (
        <div key={i} className="sendopt" onClick={() => onPick(r.t)}>
          <div className="sok">{r.k} <span>· {r.sub}</span></div>
          <div className="sot">{r.t}</div>
        </div>
      ))}
    </div></div>
  )
}

function Messages({ msgs, onFeedback }: { msgs: Msg[]; onFeedback?: (m: Msg) => void }) {
  if (!msgs.length) return <div className="center">Sin mensajes</div>
  const out: JSX.Element[] = []
  let lastCh = ""
  msgs.forEach((m, i) => {
    if (m.channel === "ai-summary") { out.push(<div key={m.id} className="aisum">✦ {m.text}</div>); lastCh = ""; return } // resumen IA como tarjeta, no como burbuja rota
    if (m.channel && m.channel !== lastCh) { lastCh = m.channel; const ci = CH[m.channel]; out.push(<div key={"c" + i} className="chanlabel"><span style={{ width: 7, height: 7, borderRadius: 9, background: ci?.c || "#ccc", display: "inline-block" }} />{ci?.label || m.channel}</div>) }
    if (m.channel === "email") {
      out.push(<div key={m.id} className="emailcard"><div className="et">✉️ {(m.text || "").split(" — ")[0].slice(0, 60)}</div>{(m as any).summary && <div className="esum">✦ {(m as any).summary}</div>}</div>)
    } else {
      out.push(<Bubble key={m.id} m={m} onFeedback={onFeedback} />)
    }
  })
  return <>{out}</>
}

function Login({ onOk }: { onOk: () => void }) {
  const [hub, setHub] = useState(getBase())
  const [pin, setPin] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!hub.trim()) { setErr("Escribí la dirección de tu hub"); return }
    setBusy(true); setErr("")
    setBase(hub) // guarda el hub del usuario (como en el mobile)
    try { const r = await login(pin); if (r.ok) onOk(); else setErr(r.error || "PIN incorrecto") }
    catch { setErr("No pude conectar a ese hub. Revisá la dirección.") }
    setBusy(false)
  }
  return (
    <div className="login"><div className="card">
      <div className="logo" />
      <h1>Pipe</h1>
      <p>Conectá tu propio hub. Escribí su dirección y tu PIN.</p>
      {err && <div className="err">{err}</div>}
      <input type="text" value={hub} onChange={(e) => setHub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (document.getElementById("pinf") as HTMLInputElement)?.focus()} placeholder="mi-hub.midominio.com" autoFocus spellCheck={false} autoCapitalize="none" style={{ letterSpacing: 0, textAlign: "left", fontSize: 14 }} />
      <input id="pinf" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="PIN" />
      <button onClick={submit} disabled={busy}>{busy ? "Conectando…" : "Entrar"}</button>
      <p style={{ marginTop: 14, fontSize: 11.5 }}>Tu hub es tu servidor Pipe (self-hosted o el que te instalaron).</p>
    </div></div>
  )
}
