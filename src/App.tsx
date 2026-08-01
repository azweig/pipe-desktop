import { useEffect, useState, useCallback, useRef } from "react"
import type { ChangeEvent, UIEvent } from "react"
import { authStatus, login, setBase, getBase, getThreads, getThread, getThreadDelta, markSeen, getThreadBefore, getThreadSync, getPerson, getDirectory, searchContent, routerSearch, getCoach, coachAction, getNotesDigest, getNotes, getNotesChat, notesChat, noteAction, getNotesClips, clipPin, clipArchive, mergeContacts, hubImage, hubOpenFile, getTargets, sendMsg, setPin, setArchive, setSilence, logout, getAutopilot, setAutopilot, autopilotFeedback, getAutopilotPolicy, setAutopilotPolicy, correctText, summarizeThread, getSchedule, createSchedule, sttB64, sendAudioB64, sendMediaB64, sendStickerB64, blobToB64, getCovert, setCovert, openExternal, summarizeMedia, readFileB64, importWhatsAppB64, importWhatsAppZipB64, getHubConfig, getAccounts, addEmailAccount, removeEmailAccount, getLlmConfig, testLlm, saveLlm, getNotifPrefs, saveNotifPrefs, getHome, getHomeAudio, askBrain, replyDraft, actionDone, getObjetivos, getCompanies, saveObjetivo, deleteObjetivo, suggestObjetivos, getEspacios, getEspacioView, saveEspacio, addEspacioRule, delEspacioRule, addEspacioException, delEspacioException, getMeeting, getApifyAccounts, addApifyAccount, removeApifyAccount, setApifyActors, getContactSocial, setContactLinks, investigateContact, getCouncil, setCouncil, isDesktopApp, Thread, Msg, ApifyAccount, SocialLinks, ContactSocial , Council } from "./api"
import { suggestReply } from "./api"
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
const fmtDur = (s?: number) => { if (!s || !isFinite(s)) return ""; s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") }
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
// baja CUALQUIER media del hub (foto/audio/imagen/video) autenticada → data URI.
// LAZY: la descarga (round-trip nativo a Rust vía hubImage) SOLO se dispara cuando el elemento entra/está cerca del viewport
// (IntersectionObserver). Antes cada avatar/imagen bajaba al montar → la bandeja con cientos de avatares lanzaba cientos de
// fetches nativos a la vez y jankeaba todo. El `_mediaCache` hace que lo ya bajado se pinte al instante y NUNCA se re-pida.
function useHubMedia(path?: string) {
  const [src, setSrc] = useState<string>(() => (path && _mediaCache.get(path)) || "")
  const ref = useRef<any>(null) // se engancha al elemento (placeholder/img) para observar su visibilidad
  useEffect(() => {
    if (!path) { setSrc(""); return }
    if (_mediaCache.has(path)) { setSrc(_mediaCache.get(path)!); return } // ya en cache → instantáneo, sin fetch ni flash
    setSrc("")
    let alive = true
    const fetchNow = () => {
      if (_mediaCache.has(path)) { if (alive) setSrc(_mediaCache.get(path)!); return }
      hubImage(path).then((d) => { if (d) { _mediaCache.set(path, d); if (alive) setSrc(d) } }).catch(() => {})
    }
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") { fetchNow(); return () => { alive = false } } // sin nodo/IO → eager como antes
    const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) { io.disconnect(); fetchNow() } }, { rootMargin: "300px" }) // 300px antes de entrar → pre-carga suave
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [path])
  return { src, ref }
}
function Avatar({ name, photo, size = 40 }: { name: string; photo?: string; size?: number }) {
  const { src, ref } = useHubMedia(photo) // baja la foto real del hub SOLO cuando es visible; si no hay, cae a las iniciales
  if (src) return <img ref={ref} className="avatar" src={src} style={{ width: size, height: size }} alt="" />
  return <div ref={ref} className="avatar" style={{ width: size, height: size, background: colorOf(name), fontSize: size / 2.8 }}>{initials(name)}</div>
}
const PLACEHOLDER = /^(🖼|📹|🎤|📄|🌟|📎|📍|👤|🖼️)/
// VIDEO: NO lo bajamos como base64 (pesado/lento, se colgaba). Mostramos un póster con "▶ Descargar y reproducir": al click, el lado
// nativo (hub_open_file) baja el video autenticado a un archivo temporal y lo abre con el reproductor por defecto del SO. Trae el
// video LOCAL sin martillar el webview con un data-URI gigante. Antes de bajar, siempre hay un póster clickeable (no un spinner eterno).
function VideoCard({ path, filename, dur }: { path: string; filename?: string; dur?: number }) {
  const [state, setState] = useState<"" | "load" | "err">("")
  const play = async () => {
    if (state === "load") return
    setState("load")
    try { await hubOpenFile(path, filename || "video.mp4"); setState("") } catch { setState("err") }
  }
  return (
    <div className="videocard" onClick={play} data-tip="Descargar y reproducir con el reproductor del sistema">
      <div className="vcposter"><span className="vcplay">{state === "load" ? <span className="spin" style={{ width: 20, height: 20, borderWidth: 2 }} /> : "▶"}</span></div>
      <div className="vcmeta">
        <span className="vcname">{filename || "Video"}</span>
        <span className="vcsub">{state === "err" ? "No se pudo — reintentá" : state === "load" ? "Descargando…" : "▶ Descargar y reproducir"}{dur ? " · " + fmtDur(dur) : ""}</span>
      </div>
    </div>
  )
}
function MediaView({ id, path, kind, filename, dur }: { id: string; path: string; kind: string; filename?: string; dur?: number }) {
  const { src, ref } = useHubMedia(kind === "video" ? undefined : path) // el video no se pre-baja (ver VideoCard); imágenes/audio bajan LAZY al ser visibles
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
  if (kind !== "video" && !src) return <div ref={ref} className="mediaload"><div className="spin" style={{ width: 18, height: 18, borderWidth: 2 }} /></div>
  const player = kind === "video" ? <VideoCard path={path} filename={filename} dur={dur} />
    : kind === "image" ? <img ref={ref} className="mediaimg" src={src} alt="" />
    : kind === "audio" ? <audio ref={ref} controls src={src} style={{ width: 250, height: 38 }} /> : null
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
// tarjeta de ARCHIVO/DOCUMENTO (pdf/docx/xlsx/…): igual que la web ("📄 nombre · Abrir / descargar"). Al click, el lado nativo
// baja el archivo autenticado, lo guarda y lo abre con la app por defecto del SO (el webview no puede descargar con la cookie).
function FileCard({ path, filename }: { path: string; filename: string }) {
  const [state, setState] = useState<"" | "load" | "err">("")
  const open = async () => {
    if (state === "load") return
    setState("load")
    try { await hubOpenFile(path, filename === "Documento" ? "" : filename); setState("") } catch { setState("err") }
  }
  return (
    <div className="filecard" onClick={open} data-tip="Abrir / descargar">
      <span className="fca">{state === "load" ? "⏳" : "📄"}</span>
      <div className="fcb">
        <div className="fcn">{filename}</div>
        <div className="fcm">{state === "err" ? "No se pudo abrir — reintentá" : state === "load" ? "Descargando…" : "Abrir / descargar"}</div>
      </div>
    </div>
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
// 🤖 tarjeta de resultado del buscador con IA (router-search). Espeja mobile AiCard: ⚡ facetas vs 🧠 RAG, lista "find" o respuesta RAG + fuentes.
function AiSearchCard({ res, onOpen }: { res: any; onOpen: (key: string, name?: string) => void }) {
  if (!res) return null
  if (res.loading) return <div className="aicard" style={{ flexDirection: "row", alignItems: "center" }}><div className="spin" style={{ width: 16, height: 16, borderWidth: 2 }} /><span style={{ marginLeft: 10, color: "var(--muted)" }}>Buscando en tus mensajes…</span></div>
  if (res.error) return <div className="aicard"><span style={{ color: "var(--muted)" }}>No pude buscar eso ahora — probá de nuevo.</span></div>
  const fast = res.mode === "facets"
  const chip = <span className="aichip" style={{ background: fast ? "#0ea5e9" : "var(--accent)" }}>{fast ? `⚡ ${res.engine || "facetas"}` : "🧠 IA · RAG"}</span>
  const srcs = (res.threads || []).slice(0, 5)
  const sources = srcs.length ? <div className="aisrcs">{srcs.map((s: any) => <span key={s.key} className="aisrc" onClick={() => onOpen(s.key, s.name)} title={s.summary || ""}>{s.name || s.key}</span>)}</div> : null
  if (res.type === "find") {
    const results = res.results || []
    return (
      <div className="aicard">
        <div className="aihead"><span className="aiht">🔎 {results.length} resultado{results.length === 1 ? "" : "s"}</span>{chip}</div>
        {results.length ? results.slice(0, 30).map((m: any, i: number) => {
          const label = m.filename || m.text || m.mediaType || "archivo"
          return (
            <div key={m.id || i} className="airow" onClick={() => onOpen(m.key, m.name)}>
              <div className="airl">{String(label).slice(0, 90)}</div>
              <div className="airm">{m.name || ""}{m.ts ? " · " + ago(m.ts) : ""}</div>
            </div>
          )
        }) : <span style={{ color: "var(--muted)" }}>No encontré nada con eso.</span>}
        {sources}
      </div>
    )
  }
  return (
    <div className="aicard">
      <div className="aihead"><span className="aiht">Respuesta de tu cerebro</span>{chip}</div>
      <div className="aians"><Linkified text={res.answer || "No pude responder eso — probá reformular."} /></div>
      {sources ? <><div className="aifl">Fuentes</div>{sources}</> : null}
    </div>
  )
}
function Bubble({ m, isGroup, onFeedback }: { m: Msg; isGroup?: boolean; onFeedback?: (m: Msg) => void }) {
  const out = m.dir === "out"
  const [reveal, setReveal] = useState(false) // modo encubierto: ver la tapadera original (lo que ve WhatsApp)
  const hasMedia = m.media && /^(image|audio|video|sticker)$/.test(m.mediaType || "")
  const isFile = m.mediaType === "file" && !!m.media
  const fileName = (m as any).filename || (m.text && !PLACEHOLDER.test(m.text) ? m.text : "") || "Documento"
  const caption = m.text && !PLACEHOLDER.test(m.text) ? m.text : ""
  return (
    <div className={"bubble " + (out ? "out" : "in")}>
      {/* en GRUPOS: quién mandó cada mensaje entrante (como cualquier chat grupal), con color por nombre. No en 1:1 ni en salientes. */}
      {!out && isGroup && m.name ? <div className="bsender" style={{ color: colorOf(m.name) }}>{m.name}</div> : null}
      {m.covert ? (
        <>
          <Linkified text={reveal ? (m.text || "") : m.covert.text} />
          <div className="covertbadge" onClick={() => setReveal((v) => !v)} title="Modo encubierto — lo que ve WhatsApp es la tapadera">🕊️ {reveal ? "ver descifrado" : "descifrado · ver original"}</div>
        </>
      ) : hasMedia ? <MediaView id={m.id} path={m.media!} kind={m.mediaType!} filename={(m as any).filename} dur={(m as any).dur} /> : isFile ? <FileCard path={m.media!} filename={fileName} /> : (m.text ? <Linkified text={m.text} /> : (m.mediaType === "file" ? "📄 Documento" : ""))}
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

type Pane = "home" | "mensajes" | "calendario" | "radar" | "objetivos" | "jarvis" | "notas" | "espacios" | "contactos"
// historial de Jarvis a nivel de módulo → persiste al cambiar de pane y se puede sembrar desde la Home (igual que la web)
let jarvisHistory: { role: "me" | "ai"; text: string }[] = []

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
  const [pane, setPane] = useState<Pane>("home") // vista del rail — arranca en la Home (resumen del día)
  const [meetingId, setMeetingId] = useState<string | null>(null) // detalle de reunión (modal) abierto desde agenda/calendario
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
  const [aiRes, setAiRes] = useState<any>(null)              // 🤖 resultado del buscador con IA (router-search: ⚡ facetas / 🧠 RAG)
  const [syncMsg, setSyncMsg] = useState("")                 // indicador del sync de texto completo ("Guardando historial…")
  const [toast, setToast] = useState("")                     // aviso efímero de éxito (se va solo)
  const [avatarMenu, setAvatarMenu] = useState(false)        // menú del avatar (AZ) abajo-izquierda: Configuración / Cerrar sesión

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
  const ctxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)   // timer del contexto diferido (persona/targets/agenda/encubierto) — se cancela si cambiás de hilo rápido
  const ctxCacheRef = useRef<Map<string, { person: any; targets: any[]; sched: any; covert: string | null; t: number }>>(new Map()) // último contexto por hilo → reabrir el mismo enseguida no re-pide
  const msgsRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)                 // ¿el scroll del hilo está cerca del fondo? (para no arrastrar al usuario si subió a leer)
  const scrollKeyRef = useRef("")                    // último hilo cuyo scroll llevamos al fondo (para distinguir "cambié de hilo" de "llegó un mensaje")
  // notificaciones locales: detectar mensajes nuevos entrantes con un poll liviano y avisar si la app NO está enfocada
  const threadsRef = useRef<Thread[]>([])            // últimos threads (para abrir el hilo desde el click de la notificación)
  const seenTsRef = useRef<Map<string, number>>(new Map()) // último ts visto por hilo (para detectar lo nuevo)
  const focusedRef = useRef(true)                    // ¿la ventana está enfocada? (no notifico si el usuario ya está mirando)
  const notifOkRef = useRef(false)                   // ¿el SO concedió permiso de notificaciones?
  const pendingNotifKeyRef = useRef<string>("")      // hilo de la última notificación (para abrirlo al hacer click)
  useEffect(() => { threadsRef.current = threads }, [threads])
  // scroll al FONDO (lo más nuevo) al abrir un hilo o cuando llega un mensaje nuevo; NO al "cargar anteriores" (loadOlder prepende arriba)
  const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : ""
  // auto-scroll al fondo SOLO cuando corresponde: al ABRIR un hilo (siempre), o al llegar un mensaje nuevo PERO solo si el
  // usuario ya estaba abajo. Si subió a leer historial, no lo arrastramos (evita el "tirón" y el thrash con hilos largos).
  const scrollToBottom = () => requestAnimationFrame(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight })
  useEffect(() => {
    if (!msgsRef.current || loadingMore) return
    const k = sel?.key || ""
    const threadChanged = scrollKeyRef.current !== k
    scrollKeyRef.current = k
    if (threadChanged || loadingThread) { nearBottomRef.current = true; scrollToBottom(); return } // abrí/cambié de hilo → al fondo
    if (nearBottomRef.current) scrollToBottom()                                                     // mensaje nuevo y estaba abajo → seguí abajo
  }, [sel?.key, lastMsgId, loadingThread, loadingMore])
  const onMsgsScroll = (e: UIEvent<HTMLDivElement>) => { const el = e.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140 }
  useEffect(() => { if (!undoArchive) return; const id = setTimeout(() => setUndoArchive(null), 6000); return () => clearTimeout(id) }, [undoArchive]) // el toast de deshacer se va solo
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 3000); return () => clearTimeout(id) }, [toast]) // aviso de éxito se va solo
  // buscador CONTEXTUAL (debounced): busca dentro del cuerpo de los mensajes
  useEffect(() => {
    const q = query.trim(); if (q.length < 2) { setMsgHits([]); return }
    const id = setTimeout(() => { searchContent(q).then((r) => setMsgHits(Array.isArray(r) ? r : r?.items || [])).catch(() => setMsgHits([])) }, 300)
    return () => clearTimeout(id)
  }, [query])

  const refreshThreads = () => getThreads().then((d) => { const arr = Array.isArray(d) ? d : d.threads || []; setThreads(arr); try { localStorage.setItem("pipe_threads", JSON.stringify(arr)) } catch {} }).catch(() => {})
  // 🤖 buscador con IA: hits el router (⚡ facetas / 🧠 RAG). Muestra una tarjeta arriba de la lista, como mobile/web.
  const runAi = useCallback(async () => {
    const qq = query.trim(); if (!qq) { setAiRes(null); return }
    setAiRes({ loading: true })
    try { const r = await routerSearch(qq); setAiRes(r && (r.answer || r.results || r.threads) ? r : { error: true }) }
    catch { setAiRes({ error: true }) }
  }, [query])
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
          // cap DURO: 300 páginas × 800 = 240k mensajes por hilo. Un hilo gigante (email con miles) no puede secuestrar el loop
          // ni martillar el hub/IndexedDB indefinidamente — se marca resumible y sigue en el próximo arranque.
          while (guard++ < 300) {
            const d = await getThreadSync(t.key, before).catch(() => null)
            if (!d || !(d.items || []).length) { await cacheSave(t.key, [], { syncDone: true }); break }
            await cacheSave(t.key, d.items, { syncOldest: d.oldestTs })
            before = d.oldestTs
            if (!d.hasMore) { await cacheSave(t.key, [], { syncDone: true }); break }
            await new Promise((r) => setTimeout(r, 180)) // throttle amplio: cede el hilo, no satura el hub ni congela la UI
          }
        }
        await new Promise((r) => setTimeout(r, 120))
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
    // reabrir el MISMO hilo hace poco → reusamos su contexto (persona/targets/agenda/encubierto) en vez de re-pedirlo
    const cx = ctxCacheRef.current.get(t.key)
    const freshCx = !!cx && Date.now() - cx.t < 60000
    setSel(t); setShowCtx(false); setDraft(""); setThreadAuto(false); setThreadErr(""); setSumCard(""); setCovertOn(false); setHasMore(false); setOldestTs(0)
    setPerson(freshCx ? cx!.person : null); setTargets(freshCx ? cx!.targets : []); setSched(freshCx ? cx!.sched : null); setThreadCovert(freshCx ? cx!.covert : null)
    // 1) LOCAL primero (IndexedDB) → los mensajes viejos aparecen al instante, sin re-descargar
    const local = await cacheLoad(t.key)
    const haveLocal = local.items.length > 0
    // hasMore por CANTIDAD (no confío en el flag cacheado: un grupo pudo tener pocos msgs al cachearse y ahora miles) → se auto-corrige en loadOlder
    if (haveLocal) { setMsgs(local.items); setOldestTs(local.items[0]?.ts || 0); setHasMore(local.items.length >= 20); setLoadingThread(false) } else { setMsgs([]); setLoadingThread(true) }
    // 2) de la RED: si ya tengo cache → solo el DELTA (rev > maxRev); si es la 1ra vez → carga completa
    try {
      if (haveLocal) {
        const lm = local.meta || {}
        // SIEMPRE los últimos ~60 del server (getThread), NO el delta por rev: tras merges/rekeys server-side el rev del cache
        // se desincroniza → el delta deja HUECOS (mensajes recientes que no aparecen, ej. FedEx). getThread trae la ventana
        // reciente COMPLETA; el cache solo aporta el historial viejo al instante. Costo similar al delta, y siempre correcto.
        const d = await getThread(t.key)
        const byId = new Map(local.items.map((i) => [i.id, i])); for (const it of (d.items || [])) byId.set(it.id, it)
        const merged = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0))
        setMsgs(merged); setOldestTs(merged[0]?.ts || 0); setHasMore(merged.length >= 20)
        setThreadAuto(!!d.autopilot)
        cacheSave(t.key, d.items || [], { maxRev: d.maxRev != null ? d.maxRev : (lm.maxRev || 0) })
      } else {
        const d = await getThread(t.key)
        setMsgs(d.items || []); setThreadAuto(!!d.autopilot)
        setOldestTs((d.items || [])[0]?.ts || 0); setHasMore(!!d.hasMore)
        cacheSave(t.key, d.items || [], { maxRev: d.maxRev || 0, autopilot: !!d.autopilot, hasMore: !!d.hasMore, oldestTs: d.oldestTs || 0 })
      }
    } catch (e: any) { if (!haveLocal) setThreadErr(e?.code === 401 ? "Sesión expirada — reconectá." : "No pude cargar los mensajes. Reintentá.") }
    setLoadingThread(false)
    // ✅ marcar LEÍDO: el desktop nunca llamaba al endpoint /seen → el punto de "no leído" jamás se iba. Web/mobile sí lo hacen al abrir.
    markSeen(t.key, t.ts || Date.now()).catch(() => {})
    setThreads((ts) => ts.map((x) => x.key === t.key ? { ...x, unread: 0, unseen: 0 } : x)) // limpio el punto YA (optimista); el próximo getThreads ya lo trae leído
    // 2b) CONTEXTO NO crítico (persona/targets/agenda/encubierto): DIFERIDO, no compite con el render de los mensajes.
    //     getSchedule en particular es lento → nunca debe atrasar mostrar el hilo. Si reabrís el mismo hilo enseguida (freshCx), no se re-pide.
    if (ctxTimerRef.current) clearTimeout(ctxTimerRef.current)
    if (!freshCx) {
      // 📅 el detector de agenda es SOLO para chats (no email): correo no coordina reuniones así.
      const isEmailThread = /^email:/i.test(t.key) || (!!(t.channels || []).length && (t.channels || []).every((c) => c === "email"))
      ctxTimerRef.current = setTimeout(() => {
        const entry: { person: any; targets: any[]; sched: any; covert: string | null; t: number } = { person: null, targets: [], sched: null, covert: null, t: Date.now() }
        ctxCacheRef.current.set(t.key, entry)
        getPerson(t.name).then((p) => { entry.person = p; setPerson(p) }).catch(() => {})
        getTargets(t.key).then((r) => { entry.targets = r?.targets || []; setTargets(entry.targets) }).catch(() => {})
        if (!isEmailThread) getSchedule(t.key).then((r) => { if (r && r.found) { entry.sched = r; setSched(r) } }).catch(() => {})
        getCovert(t.key).then((c) => { const st = c?.enabled ? (c.style || "poema") : null; entry.covert = st; setThreadCovert(st) }).catch(() => {}) // 🕊️ ¿modo encubierto?
      }, 200)
    }
  }, [])
  // abrir una conversación desde cualquier pane (radar/notas/contactos/búsqueda IA): vuelve a Mensajes y abre el hilo
  const openByKey = useCallback((key: string, name?: string, photo?: string) => {
    setPane("mensajes")
    const t = threads.find((x) => x.key === key)
    open(t || ({ key, name: name || key, photo } as Thread))
  }, [threads, open])
  // desde Radar: abre el hilo y precarga un borrador de respuesta sugerido por la IA
  const openWithDraft = useCallback(async (key: string, name?: string) => {
    openByKey(key, name)
    const r = await suggestReply(key).catch(() => null)
    if (r?.draft) setDraft(r.draft)
  }, [openByKey])

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
  // 🔕 silenciar / reactivar: mueve el hilo a (o lo saca de) la categoría "Silenciados". Optimista + refresco.
  const toggleSilence = async () => {
    if (!sel) return
    const on = !sel.silenced
    setSel({ ...sel, silenced: on })
    setThreads((ts) => ts.map((t) => (t.key === sel.key ? { ...t, silenced: on } : t)))
    await setSilence(sel.key, on).catch(() => { setSel({ ...sel, silenced: !on }); setThreads((ts) => ts.map((t) => (t.key === sel.key ? { ...t, silenced: !on } : t))) })
    setToast(on ? "🔕 Conversación silenciada" : "🔔 Avisos reactivados")
    refreshThreads()
  }
  // cerrar sesión: invalida el sid, limpia el estado local y vuelve al Login (el hub queda guardado → solo re-pedir PIN)
  const doLogout = async () => {
    setAvatarMenu(false)
    await logout().catch(() => {})
    try { localStorage.removeItem("pipe_threads") } catch {}
    setSel(null); setThreads([]); setMsgs([]); setAuthed(false)
  }

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
    <div className={"app" + (pane === "calendario" ? " cal" : pane !== "mensajes" ? " full" : (sel ? " topen" + (showCtx ? " copen" : "") : ""))}>
      {/* rail */}
      <div className="rail">
        <div className="brand" />
        <button className={"tipright" + (pane === "home" ? " on" : "")} onClick={() => setPane("home")} data-tip="Inicio">🏠</button>
        <button className={"tipright" + (pane === "mensajes" ? " on" : "")} onClick={() => setPane("mensajes")} data-tip="Mensajes">💬</button>
        <button className={"tipright" + (pane === "calendario" ? " on" : "")} onClick={() => setPane("calendario")} data-tip="Calendario">🗓</button>
        <button className={"tipright" + (pane === "radar" ? " on" : "")} onClick={() => setPane("radar")} data-tip="Radar">✦</button>
        <button className={"tipright" + (pane === "objetivos" ? " on" : "")} onClick={() => setPane("objetivos")} data-tip="Objetivos">🎯</button>
        <button className={"tipright" + (pane === "jarvis" ? " on" : "")} onClick={() => setPane("jarvis")} data-tip="Jarvis">🧠</button>
        <button className={"tipright" + (pane === "notas" ? " on" : "")} onClick={() => setPane("notas")} data-tip="Notas">📄</button>
        <button className={"tipright" + (pane === "espacios" ? " on" : "")} onClick={() => setPane("espacios")} data-tip="Espacios">◆</button>
        <button className={"tipright" + (pane === "contactos" ? " on" : "")} onClick={() => setPane("contactos")} data-tip="Contactos">👤</button>
        <div className="spacer" />
        <button className="me tipright" data-tip="Cuenta y ajustes" onClick={() => setAvatarMenu((v) => !v)}>AZ</button>
      </div>

      {avatarMenu && (<>
        <div className="avmenu-bg" onClick={() => setAvatarMenu(false)} />
        <div className="avmenu">
          <button onClick={() => { setAvatarMenu(false); setModal("settings") }}><span>⚙️</span>Configuración</button>
          <button className="danger" onClick={doLogout}><span>↩</span>Cerrar sesión</button>
        </div>
      </>)}

      {pane === "home" ? <Home onOpen={openByKey} onDraft={openWithDraft} onNav={setPane} onOpenMeeting={setMeetingId} />
      : pane === "calendario" ? <Calendar onOpenContact={(name) => {
        const nn = name.trim().toLowerCase()
        const t = threads.find((x) => (x.name || "").trim().toLowerCase() === nn) || threads.find((x) => (x.name || "").toLowerCase().includes(nn.split(" ")[0]))
        setPane("mensajes"); if (t) open(t)
      }} onOpenMeeting={setMeetingId} />
      : pane === "radar" ? <Radar onOpen={openByKey} onDraft={openWithDraft} />
      : pane === "objetivos" ? <Objetivos onToast={setToast} />
      : pane === "jarvis" ? <Jarvis onHome={() => setPane("home")} />
      : pane === "notas" ? <Notas />
      : pane === "espacios" ? <Espacios onOpen={openByKey} />
      : pane === "contactos" ? <Contactos threads={threads} onOpen={openByKey} onToast={setToast} onMerged={refreshThreads} />
      : <>

      {/* sidebar */}
      <div className="side">
        <button className="newbtn">＋ Nuevo</button>
        <div className="search"><span style={{ opacity: .6 }}>🔎</span><input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setAiRes(null) }} onKeyDown={(e) => { if (e.key === "Enter") runAi() }} placeholder="Buscar — nombre, teléfono, email…" />{query ? <span onClick={() => { setQuery(""); setAiRes(null) }} style={{ cursor: "pointer", opacity: .6 }}>✕</span> : null}<button className="aibtn" data-tip="Preguntá a la IA — busca en TODO (⚡ facetas / 🧠 RAG)" onClick={runAi} disabled={!query.trim()}>🤖</button></div>
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
        {threads.some((t: any) => t.espacio) ? <>
          <div className="grp">Espacios</div>
          {threads.filter((t: any) => t.espacio).map((t) => (
            <div key={t.key} className={"navitem" + (sel?.key === t.key ? " on" : "")} onClick={() => open(t)}><span className="ico">◆</span>{t.name}</div>
          ))}
        </> : null}
        <div className="grp">Canales <span className="sep">Separar</span></div>
        {["whatsapp", "teams", "email", "telegram"].map((c) => (
          <div key={c} className="chan" style={{ cursor: "pointer" }} onClick={() => setChOff((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n })}>
            <span className="dot" style={{ background: CH[c].c }} />{CH[c].label}<span className={"sw" + (chOff.has(c) ? " off" : "")} />
          </div>
        ))}
        <div className="grp">Herramientas</div>
        <div className="navitem" onClick={() => setModal("waimport")}><span className="ico">📤</span>Importar WhatsApp</div>
        <div className="navitem" onClick={() => setModal("appolicy")}><span className="ico">🏖️</span>Piloto: qué escalar</div>
        {syncMsg ? <div className="syncline" title="Guardando todo el texto en tu Mac (offline). Las imágenes quedan on-demand.">💾 {syncMsg}</div> : null}
      </div>

      {/* list */}
      <div className="list">
        <div className="lhead"><h2>{query.trim() ? "Resultados" : "Conversaciones"}</h2><span style={{ color: "var(--muted2)" }}>⚟</span></div>
        {query.trim() && aiRes ? <AiSearchCard res={aiRes} onOpen={openByKey} /> : null}
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
              <button data-tip={sel.silenced ? "Silenciada — reactivar avisos" : "Silenciar esta conversación"} onClick={toggleSilence} style={sel.silenced ? { color: "var(--accent)" } : undefined}>{sel.silenced ? "🔔" : "🔕"}</button>
              <button data-tip={sel.pinned ? "Fijada arriba — desfijar" : "Fijar arriba"} onClick={togglePin} style={sel.pinned ? { color: "#fff", background: "var(--accent)", borderRadius: 8 } : undefined}>📌</button>
              <button data-tip="Archivar" onClick={archive}>🗄</button>
            </div>
          </div>
          <div className="msgs" ref={msgsRef} onScroll={onMsgsScroll}>
            {!loadingThread && !threadErr && hasMore ? <div className="loadolder" onClick={loadOlder}>{loadingMore ? "Cargando…" : "▲ Cargar mensajes anteriores"}</div> : null}
            {loadingThread ? <div className="center"><div className="spin" /></div>
              : threadErr ? <div className="center" style={{ flexDirection: "column", gap: 10 }}><span style={{ color: "var(--muted)" }}>{threadErr}</span><button className="mbtn" onClick={() => open(sel)}>Reintentar</button></div>
              : <Messages key={sel.key} msgs={msgs} isGroup={!!sel.group} onFeedback={(m) => setModal({ fb: m.id, original: m.text || "" })} />}
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
      {modal === "appolicy" && <AutopilotPolicyModal onClose={() => setModal(null)} onSaved={(msg: string) => { setToast(msg); setModal(null) }} />}
      {undoArchive && <div className="toast"><span>🗄 Archivaste <b>{undoArchive.name}</b></span><button onClick={doUndoArchive}>Deshacer</button></div>}
      </>}

      {/* globales (visibles desde cualquier pane): configuración, detalle de reunión, avisos efímeros */}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} onOpenAutopilot={() => { setPane("mensajes"); setModal("appolicy") }} onToast={(m: string) => setToast(m)} />}
      {meetingId && <MeetingModal id={meetingId} onClose={() => setMeetingId(null)} onOpenConv={(k, n) => { setMeetingId(null); openByKey(k, n) }} onOpenPerson={(n) => { setMeetingId(null); setPane("contactos"); void n }} />}
      {toast && <div className="toast"><span>{toast}</span></div>}
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
// política GLOBAL del piloto: qué temas escala a vos (checkboxes de presets + temas libres). No es por-contacto.
const AP_PRESET_LABELS: Record<string, string> = {
  money: "Plata / pagos", resign: "Renuncias", hire: "Contrataciones",
  meeting: "Reuniones o llamadas con hora", appointment: "Citas / turnos",
  legal: "Temas legales / contratos", emotional: "Temas personales serios", health: "Salud",
}
function AutopilotPolicyModal({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const [avail, setAvail] = useState<string[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    getAutopilotPolicy()
      .then((p) => { setAvail(p.presets_available || []); setChecked(new Set(p.presets || [])); setCustom((p.custom || []).join(", ")) })
      .catch(() => setAvail(Object.keys(AP_PRESET_LABELS)))
      .finally(() => setLoading(false))
  }, [])
  const toggle = (k: string) => setChecked((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const save = async () => {
    setSaving(true)
    const customArr = custom.split(",").map((s) => s.trim()).filter(Boolean)
    const presets = avail.filter((k) => checked.has(k))
    const r = await setAutopilotPolicy(presets, customArr).catch(() => null)
    setSaving(false)
    if (!r) { alert("No se pudo guardar — reintentá."); return }
    onSaved("✓ Guardado — el piloto te va a escalar esos temas.")
  }
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>🏖️ Qué escala el piloto</h3>
      <p className="modalsub">El piloto responde todo, MENOS estos temas — esos te los deja a vos.</p>
      {loading ? <div className="center" style={{ height: 120 }}><div className="spin" /></div> : (<>
        <div style={{ margin: "6px 0 12px" }}>
          {avail.map((k) => (
            <label key={k} className="modallabel" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 9 }}>
              <input type="checkbox" checked={checked.has(k)} onChange={() => toggle(k)} /> {AP_PRESET_LABELS[k] || k}
            </label>
          ))}
        </div>
        <label className="modallabel">Otros temas — separados por coma</label>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ej: mudanza, herencia, socios" className="modalinput" />
        <div className="modalrow" style={{ marginTop: 14 }}>
          <button className="mbtn" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          <button className="mbtn ghost" onClick={onClose} disabled={saving}>Cerrar</button>
        </div>
        <div style={{ height: 1, background: "var(--line)", margin: "20px 0 4px" }} />
        <CouncilConfig onSaved={onSaved} />
      </>)}
    </div></div>
  )
}
// 🧠 COUNCIL: varios modelos locales redactan y un chairman elige el mejor. Config compartida con web/mobile (/api/autopilot/council).
function CouncilConfig({ onSaved }: { onSaved: (m: string) => void }) {
  const [c, setC] = useState<Council | null>(null)
  const [mem, setMem] = useState<Set<string>>(new Set())
  const [chair, setChair] = useState("")
  const [on, setOn] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { getCouncil().then((r) => { setC(r); setMem(new Set(r.members || [])); setChair(r.chairman || ""); setOn(!!r.enabled) }).catch(() => {}) }, [])
  const avail = (c?.available || []).filter((m) => !/deepseek|embed|:3b/.test(m))
  const toggleM = (m: string) => setMem((p) => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n })
  const save = async () => {
    const members = [...mem]
    if (on && members.length < 2) { alert("Elegí al menos 2 modelos para el council."); return }
    setSaving(true)
    const r = await setCouncil({ enabled: on, members, chairman: chair }).catch(() => null)
    setSaving(false)
    onSaved(r ? "✓ Council guardado" : "No se pudo guardar el council")
  }
  if (!c) return <div className="center" style={{ height: 40 }}><div className="spin" /></div>
  return (
    <div>
      <label className="modallabel" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", margin: "4px 0 6px" }}>
        <input type="checkbox" checked={on} onChange={() => setOn(!on)} /> 🧠 Council de modelos</label>
      <p className="modalsub" style={{ margin: "0 0 8px" }}>Varios modelos locales redactan y uno elige el mejor. Más calidad, pero más lento. Elegí 2+.</p>
      {avail.length ? avail.map((m) => (
        <label key={m} className="modallabel" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 7, fontSize: 13.5 }}>
          <input type="checkbox" checked={mem.has(m)} onChange={() => toggleM(m)} /> {m}
        </label>
      )) : <div className="modalsub">No hay modelos locales (GPU box) disponibles.</div>}
      <label className="modallabel" style={{ marginTop: 8 }}>Chairman (el que elige)</label>
      <select value={chair} onChange={(e) => setChair(e.target.value)} className="modalinput">
        <option value="">(automático)</option>
        {avail.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <div className="modalrow" style={{ marginTop: 12 }}><button className="mbtn" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar council"}</button></div>
    </div>
  )
}
// ⚙️ Configuración: canales/cuentas · motor de IA (BYOK) · notificaciones. Mismos endpoints que web/mobile.
const AI_PROV: [string, string][] = [["openai", "OpenAI"], ["anthropic", "Anthropic (Claude)"], ["gemini", "Google Gemini"]]
const PLABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", ollama: "Ollama (local)", gestionado: "GPU box (gestionado)" }
function SettingsModal({ onClose, onOpenAutopilot, onToast }: { onClose: () => void; onOpenAutopilot: () => void; onToast: (m: string) => void }) {
  const [tab, setTab] = useState<"canales" | "ia" | "notif" | "apify">("canales")
  const [hub, setHub] = useState<any>(null)
  const [accts, setAccts] = useState<any>({ email: [] })
  const [llm, setLlm] = useState<any>(null)
  const [notif, setNotif] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [em, setEm] = useState({ name: "", user: "", pass: "" }); const [showEmail, setShowEmail] = useState(false)
  const [key, setKey] = useState({ provider: "openai", name: "", token: "", test: "" }); const [showKey, setShowKey] = useState(false)
  // ── Enriquecimiento (Apify): cuentas rotativas + config avanzada de actors por plataforma ──
  const [apify, setApify] = useState<{ accounts: ApifyAccount[]; actors?: Record<string, string>; month?: string } | null>(null)
  const [ap, setAp] = useState({ name: "", token: "" }); const [showAp, setShowAp] = useState(false); const [apBusy, setApBusy] = useState(false)
  const [showActors, setShowActors] = useState(false); const [actorsDraft, setActorsDraft] = useState(""); const [actorsErr, setActorsErr] = useState("")
  const loadApify = async () => { const r = await getApifyAccounts().catch(() => ({ accounts: [] } as any)); setApify(r || { accounts: [] }) }
  useEffect(() => { if (tab === "apify" && !apify) loadApify() }, [tab])
  const addAp = async () => {
    if (!ap.name.trim() || !ap.token.trim()) { onToast("Falta el nombre o el token de Apify."); return }
    setApBusy(true)
    const r = await addApifyAccount(ap.name.trim(), ap.token.trim()).catch(() => null)
    setApBusy(false)
    if (r && r.accounts) { setApify(r); setAp({ name: "", token: "" }); setShowAp(false); onToast("✓ Cuenta Apify agregada") }
    else onToast("No se pudo — revisá el token")
  }
  const removeAp = async (id: string) => { setApBusy(true); const r = await removeApifyAccount(id).catch(() => null); setApBusy(false); if (r && r.accounts) setApify(r) }
  const openActors = () => { setActorsDraft(JSON.stringify(apify?.actors || {}, null, 2)); setActorsErr(""); setShowActors(true) }
  const saveActors = async () => {
    let parsed: Record<string, string>
    try { parsed = JSON.parse(actorsDraft) } catch { setActorsErr("JSON inválido"); return }
    setApBusy(true); const r = await setApifyActors(parsed).catch(() => null); setApBusy(false)
    if (r && r.accounts) { setApify(r); setShowActors(false); onToast("✓ Config guardada") } else setActorsErr("No se pudo guardar")
  }

  const load = async () => {
    const [h, a, l, n] = await Promise.all([
      getHubConfig().catch(() => ({})), getAccounts().catch(() => ({ email: [] })),
      getLlmConfig().catch(() => ({})), getNotifPrefs().catch(() => ({})),
    ])
    setHub(h || {}); setAccts(a || { email: [] }); setLlm(l || {}); setNotif(n || {}); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const addEmail = async () => {
    if (!em.user.trim() || !em.pass.trim()) { onToast("Falta el correo o la contraseña de aplicación."); return }
    setBusy(true)
    const r = await addEmailAccount({ user: em.user.trim(), pass: em.pass.trim(), name: em.name.trim() }).catch(() => ({ error: "error" }))
    setBusy(false)
    if (r && r.ok) { setEm({ name: "", user: "", pass: "" }); setShowEmail(false); onToast("✓ Cuenta conectada"); load() }
    else onToast((r && r.error) || "No se pudo — revisá las credenciales")
  }
  const removeEmail = async (label: string) => { setBusy(true); await removeEmailAccount(label).catch(() => {}); setBusy(false); load() }
  // al reguardar keys nunca reenvío tokens existentes (van vacíos → el server conserva los cifrados). Igual que mobile.
  const existingKeys = () => (llm?.keysList || []).map((k: any) => (k.provider === "ollama" || k.provider === "gestionado") ? { id: k.id, provider: k.provider, name: k.name } : { id: k.id, provider: k.provider, name: k.name, token: "" })
  const testKey = async () => {
    if (!key.token.trim()) return
    setKey((k) => ({ ...k, test: "…" }))
    const r = await testLlm({ provider: key.provider, token: key.token.trim() }).catch(() => null)
    setKey((k) => ({ ...k, test: r && r.ok ? "✓ anda (" + (r.model || "") + ")" : "✗ " + ((r && r.error) || "no responde") }))
  }
  const saveKey = async () => {
    if (!key.token.trim()) { onToast("Falta la API key"); return }
    setBusy(true)
    const nk = { id: key.provider + "-" + Date.now().toString(36), provider: key.provider, name: key.name.trim() || PLABEL[key.provider], token: key.token.trim() }
    const r = await saveLlm({ keysList: [...existingKeys(), nk], routing: llm?.routing || {}, stt: llm?.stt, ollamaHost: llm?.ollamaHost }).catch(() => null)
    setBusy(false)
    if (r && r.ok) { setKey({ provider: "openai", name: "", token: "", test: "" }); setShowKey(false); onToast("✓ Key agregada"); load() }
    else onToast((r && r.error) || "No se pudo guardar")
  }
  const saveQuiet = async (patch: any) => { const p = { ...notif, ...patch }; setNotif(p); await saveNotifPrefs({ quietStart: p.quietStart ?? null, quietEnd: p.quietEnd ?? null }).catch(() => {}) }

  const HOURS = ["—", ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))]
  const hourRow = (val: number | null | undefined, onSet: (h: number | null) => void) => (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "4px 0 12px" }}>
      {HOURS.map((lbl, i) => { const h = i === 0 ? null : i - 1; const on = (val ?? null) === h
        return <button key={lbl} onClick={() => onSet(h)} className="hchip" style={{ background: on ? "var(--accent)" : "var(--panel2)", color: on ? "#fff" : "var(--muted)" }}>{lbl}</button> })}
    </div>
  )

  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div className="avatar" style={{ width: 40, height: 40, background: "var(--accent)", fontSize: 15 }}>{initials(hub?.ownerName || "Pipe")}</div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{hub?.ownerName || "Mi hub"}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{hub?.company || hub?.domain || getBase().replace(/^https?:\/\//, "") || "pipe.one"}</div></div>
        <button onClick={onClose} style={{ fontSize: 20, color: "var(--muted)", width: 30, height: 30 }}>✕</button>
      </div>
      <div className="segtabs">
        {([["canales", "📥 Canales"], ["ia", "🤖 IA"], ["apify", "🔍 Enriquecer"], ["notif", "🔔 Avisos"]] as [string, string][]).map(([id, l]) =>
          <button key={id} className={"segtab" + (tab === id ? " on" : "")} onClick={() => setTab(id as any)}>{l}</button>)}
      </div>
      {loading ? <div className="center" style={{ height: 120 }}><div className="spin" /></div> : (<>
        {tab === "canales" && (<>
          <label className="modallabel" style={{ marginTop: 6 }}>Cuentas de correo</label>
          {(accts.email || []).length ? (accts.email || []).map((e: any) => (
            <div key={e.label} className="setrow">
              <span style={{ fontSize: 17 }}>✉️</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.user}</div><div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{e.host || ""}{e.count ? ` · ${e.count} correos` : ""}</div></div>
              {e.kind === "imap" ? <button onClick={() => removeEmail(e.label)} style={{ color: "var(--danger)", fontSize: 15 }} data-tip="Quitar">✕</button> : null}
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px 10px" }}>Todavía no conectaste ninguna bandeja.</div>}
          {showEmail ? (
            <div className="setform">
              <div className="modalsub" style={{ marginBottom: 10 }}>Gmail/Outlook: usá una <b>contraseña de aplicación</b> (16 letras), no la de tu cuenta.</div>
              <input className="modalinput" placeholder="Nombre (opcional, ej: Trabajo)" value={em.name} onChange={(e) => setEm((s) => ({ ...s, name: e.target.value }))} />
              <input className="modalinput" placeholder="tu@correo.com" value={em.user} onChange={(e) => setEm((s) => ({ ...s, user: e.target.value }))} autoCapitalize="none" spellCheck={false} />
              <input className="modalinput" placeholder="Contraseña de aplicación" type="password" value={em.pass} onChange={(e) => setEm((s) => ({ ...s, pass: e.target.value }))} />
              <div className="modalrow"><button className="mbtn" onClick={addEmail} disabled={busy}>{busy ? "Conectando…" : "Conectar"}</button><button className="mbtn ghost" onClick={() => setShowEmail(false)}>Cancelar</button></div>
            </div>
          ) : <button className="setadd" onClick={() => setShowEmail(true)}>➕ Agregar cuenta de correo</button>}
          <div className="cfg-note2">Los demás canales (WhatsApp, Telegram, Teams, Slack, calendarios) se vinculan desde el <b>servidor</b> de tu hub o desde la app web. Importar historial de WhatsApp está en la barra lateral, en Herramientas.</div>
        </>)}
        {tab === "ia" && (<>
          <label className="modallabel" style={{ marginTop: 6 }}>Motor de IA — tus keys (BYOK)</label>
          {(llm?.keysList || []).length ? (llm.keysList || []).map((k: any) => (
            <div key={k.id} className="setrow">
              <span style={{ fontSize: 17 }}>{k.provider === "ollama" || k.provider === "gestionado" ? "🖥️" : "🔑"}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{k.name || k.provider}</div><div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{PLABEL[k.provider] || k.provider}{k.hint ? ` · ${k.hint}` : ""}</div></div>
              {k.hasToken ? <span style={{ color: "var(--ok)", fontSize: 14 }}>✓</span> : null}
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px 10px" }}>Sin motor — pegá un token para que la IA funcione.</div>}
          {showKey ? (
            <div className="setform">
              <div className="modalrow" style={{ marginBottom: 10 }}>{AI_PROV.map(([id, l]) => <button key={id} className={"mbtn" + (key.provider === id ? "" : " ghost")} style={{ flex: 1, padding: "8px 4px", fontSize: 12 }} onClick={() => setKey((k) => ({ ...k, provider: id }))}>{l}</button>)}</div>
              <input className="modalinput" placeholder="Nombre (opcional)" value={key.name} onChange={(e) => setKey((k) => ({ ...k, name: e.target.value }))} />
              <input className="modalinput" placeholder="Pegá tu API key" type="password" value={key.token} onChange={(e) => setKey((k) => ({ ...k, token: e.target.value, test: "" }))} autoCapitalize="none" spellCheck={false} />
              {key.test ? <div style={{ fontSize: 12.5, marginBottom: 10, color: key.test.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>{key.test}</div> : null}
              <div className="modalrow"><button className="mbtn ghost" style={{ flex: 1 }} onClick={testKey}>Probar</button><button className="mbtn" onClick={saveKey} disabled={busy}>{busy ? "…" : "Agregar"}</button></div>
              <button className="setcancel" onClick={() => setShowKey(false)}>Cancelar</button>
            </div>
          ) : <button className="setadd" onClick={() => setShowKey(true)}>➕ Agregar key de IA</button>}
          <div className="cfg-note2">Tus tokens se guardan cifrados en tu servidor y nunca se muestran. Elegí qué motor usa cada tarea desde la app web.</div>
        </>)}
        {tab === "apify" && (<>
          <label className="modallabel" style={{ marginTop: 6 }}>Cuentas Apify</label>
          <div className="modalsub" style={{ marginBottom: 12 }}>Perfiles sociales anónimos (no usa tus cookies). Cargá una o varias cuentas Apify — rota entre ellas y si una llega al límite mensual pasa a la siguiente.</div>
          {!apify ? <div className="center" style={{ height: 80 }}><div className="spin" /></div> : (<>
            {(apify.accounts || []).length ? (apify.accounts || []).map((a) => (
              <div key={a.id} className="setrow">
                <span style={{ fontSize: 17 }}>🔍</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>{a.name}{a.exhausted ? <span className="apbadge">AGOTADA</span> : null}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{a.runs || 0} runs · ${(a.usd || 0).toFixed ? (a.usd || 0).toFixed(2) : a.usd}{a.hint ? ` · ••••${a.hint}` : ""}</div>
                </div>
                <button onClick={() => removeAp(a.id)} disabled={apBusy} style={{ color: "var(--danger)", fontSize: 15 }} data-tip="Quitar">✕</button>
              </div>
            )) : <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px 10px" }}>Sin cuentas — agregá una para investigar contactos.</div>}
            {showAp ? (
              <div className="setform">
                <div className="modalsub" style={{ marginBottom: 10 }}>Creá un token gratis en <b>apify.com</b> (Settings → Integrations) y pegalo acá.</div>
                <input className="modalinput" placeholder="Nombre (ej: Apify 1)" value={ap.name} onChange={(e) => setAp((s) => ({ ...s, name: e.target.value }))} />
                <input className="modalinput" placeholder="Token de Apify (apify_api_…)" type="password" value={ap.token} onChange={(e) => setAp((s) => ({ ...s, token: e.target.value }))} autoCapitalize="none" spellCheck={false} />
                <div className="modalrow"><button className="mbtn" onClick={addAp} disabled={apBusy}>{apBusy ? "Agregando…" : "Agregar"}</button><button className="mbtn ghost" onClick={() => setShowAp(false)}>Cancelar</button></div>
              </div>
            ) : <button className="setadd" onClick={() => setShowAp(true)}>➕ Agregar cuenta Apify</button>}
            <button className="setrow tap" style={{ width: "100%", textAlign: "left", background: "none", marginTop: 6 }} onClick={() => showActors ? setShowActors(false) : openActors()}>
              <span style={{ fontSize: 17 }}>⚙️</span><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>Avanzado</div><div style={{ fontSize: 11.5, color: "var(--muted2)" }}>Actor de Apify por plataforma (JSON)</div></div><span style={{ color: "var(--muted2)" }}>{showActors ? "⌄" : "›"}</span>
            </button>
            {showActors ? (
              <div className="setform">
                <textarea className="modalinput" style={{ minHeight: 130, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, resize: "vertical", marginBottom: 10 }} value={actorsDraft} onChange={(e) => { setActorsDraft(e.target.value); setActorsErr("") }} spellCheck={false} />
                {actorsErr ? <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10 }}>{actorsErr}</div> : null}
                <div className="modalrow"><button className="mbtn" onClick={saveActors} disabled={apBusy}>{apBusy ? "…" : "Guardar"}</button><button className="mbtn ghost" onClick={() => setShowActors(false)}>Cerrar</button></div>
              </div>
            ) : null}
          </>)}
          <div className="cfg-note2">La investigación corre de forma anónima con estas cuentas. Se usa desde el perfil de cada contacto, en Contactos.{apify?.month ? ` Uso de ${apify.month}.` : ""}</div>
        </>)}
        {tab === "notif" && (<>
          <label className="modallabel" style={{ marginTop: 6 }}>🌙 Horas de silencio — no te aviso en ese rango</label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Desde</div>
          {hourRow(notif.quietStart, (h) => saveQuiet({ quietStart: h }))}
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Hasta</div>
          {hourRow(notif.quietEnd, (h) => saveQuiet({ quietEnd: h }))}
          <div className="cfg-note2">Para silenciar una conversación puntual, usá el 🔕 en su cabecera.</div>
        </>)}
        <div style={{ borderTop: "1px solid var(--line)", margin: "14px 0 0", paddingTop: 12 }}>
          <button className="setrow tap" style={{ width: "100%", textAlign: "left", background: "none" }} onClick={onOpenAutopilot}>
            <span style={{ fontSize: 17 }}>🏖️</span><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>Piloto: qué escala</div><div style={{ fontSize: 11.5, color: "var(--muted2)" }}>Qué temas te deja a vos en vez de responder solo</div></div><span style={{ color: "var(--muted2)" }}>›</span>
          </button>
          <div className="cfg-note2" style={{ marginTop: 8 }}>🕊️ El modo encubierto (El Santo) se configura por conversación, desde el 🕊️ en su cabecera.</div>
        </div>
      </>)}
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

const RENDER_CAP = 60   // PRIMER lote: pintamos solo las últimas 60 burbujas → primer render rapidísimo al cambiar de hilo (antes 200 jankeaba en hilos con media)
const RENDER_STEP = 200 // cada "ver anteriores" suma 200: un hilo de miles (email/grupo) NO explota el DOM ni molesta con mil clicks
function Messages({ msgs, isGroup, onFeedback }: { msgs: Msg[]; isGroup?: boolean; onFeedback?: (m: Msg) => void }) {
  const [cap, setCap] = useState(RENDER_CAP)
  if (!msgs.length) return <div className="center">Sin mensajes</div>
  const overflow = msgs.length > cap
  const shown = overflow ? msgs.slice(msgs.length - cap) : msgs // las MÁS NUEVAS (el resto queda tras el botón "ver anteriores")
  const out: JSX.Element[] = []
  let lastCh = ""
  if (overflow) out.push(<div key="cap" className="loadolder" onClick={() => setCap((c) => c + RENDER_STEP)}>▲ Ver {msgs.length - cap} mensajes anteriores</div>)
  shown.forEach((m, i) => {
    if (m.channel === "ai-summary") { out.push(<div key={m.id} className="aisum">✦ {m.text}</div>); lastCh = ""; return } // resumen IA como tarjeta, no como burbuja rota
    if (m.channel && m.channel !== lastCh) { lastCh = m.channel; const ci = CH[m.channel]; out.push(<div key={"c" + i} className="chanlabel"><span style={{ width: 7, height: 7, borderRadius: 9, background: ci?.c || "#ccc", display: "inline-block" }} />{ci?.label || m.channel}</div>) }
    if (m.channel === "email") {
      out.push(<div key={m.id} className="emailcard"><div className="et">✉️ {(m.text || "").split(" — ")[0].slice(0, 60)}</div>{(m as any).summary && <div className="esum">✦ {(m as any).summary}</div>}</div>)
    } else {
      out.push(<Bubble key={m.id} m={m} isGroup={isGroup} onFeedback={onFeedback} />)
    }
  })
  return <>{out}</>
}

// ── RADAR: feed proactivo (coach). Espera de vos + vale la pena + prometiste. Acciones done/snooze/dismiss + abrir/borrador. ──
function Radar({ onOpen, onDraft }: { onOpen: (key: string, name?: string) => void; onDraft: (key: string, name?: string) => void }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [gone, setGone] = useState<Set<string>>(new Set()) // items despachados → fuera de la vista
  useEffect(() => { getCoach().then((r) => setD(r || {})).catch(() => setD({})).finally(() => setLoading(false)) }, [])
  const act = async (key: string, action: string) => { if (key) setGone((p) => new Set(p).add(key)); await coachAction(key, action).catch(() => {}) }
  if (loading) return <div className="pane"><div className="center"><div className="spin" /></div></div>
  const waiting = (d?.waiting || []).filter((w: any) => !gone.has(w.thread || w.key || ""))
  const questions = (d?.questions || []).filter((qz: any) => !gone.has(qz.thread || qz.key || ""))
  const esperan = [
    ...waiting.map((w: any) => ({ ...w, who: w.name || w.who, key: w.thread || w.key, kind: "waiting" })),
    ...questions.map((qz: any) => ({ ...qz, who: qz.who || qz.name, key: qz.thread || qz.key, kind: "question" })),
  ].sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))
  const cards = [...(d?.proposals || []), ...(d?.nudges || []).filter((n: any) => n.type === "reconectar")].filter((n: any) => !gone.has(n.key || n.convKey || ""))
  const promesas = (d?.promises || []).filter((p: any) => p.stillOpen !== false && !gone.has(p.thread || p.key || ""))
  const hero = esperan[0] || null
  const empty = !esperan.length && !cards.length && !promesas.length
  return (
    <div className="pane">
      <div className="panehead"><h1>Radar</h1><span className="panesub">{esperan.length} {esperan.length === 1 ? "pendiente" : "pendientes"} · {cards.length} {cards.length === 1 ? "vale" : "valen"} la pena hoy</span></div>
      <div className="panebody">
        {empty ? <div className="center" style={{ height: 220, color: "var(--muted)" }}>Nada en el radar ahora — lo urgente ya está en Mensajes.</div> : null}
        {hero ? (
          <div className="rhero">
            <div className="rherolab">✦ Empezá por acá</div>
            <div className="rheroname">{hero.who || "—"}{hero.ageDays ? <span className="rage"> · hace {hero.ageDays}d</span> : null}</div>
            {hero.text ? <div className="rherotext">“{String(hero.text).slice(0, 180)}”</div> : null}
            <div className="rherobtns">
              <button className="mbtn" style={{ flex: "0 0 auto", padding: "9px 16px" }} onClick={() => onDraft(hero.key, hero.who)}>➤ Ver y responder</button>
              <button className="rghost" onClick={() => act(hero.key, "snooze")}>⏰ Después</button>
            </div>
          </div>
        ) : null}
        {esperan.length ? <div className="rsec">Esperan de vos</div> : null}
        {esperan.slice(0, 12).map((w: any, i: number) => (
          <div key={"e" + i} className="rcard" onClick={() => onOpen(w.key, w.who)}>
            <Avatar name={w.who || "?"} photo={w.photo} size={38} />
            <div className="rcbody">
              <div className="rctop"><span className="rcname">{w.who || "—"}</span>{w.ageDays ? <span className="rcage">{w.ageDays}d</span> : null}</div>
              <div className="rctext">{w.kind === "question" ? "❓ " : ""}{String(w.text || "").slice(0, 140)}</div>
            </div>
            <button className="rreply" onClick={(e) => { e.stopPropagation(); onDraft(w.key, w.who) }} data-tip="Responder con IA">➤</button>
          </div>
        ))}
        {cards.length ? <div className="rsec">Vale la pena mirar</div> : null}
        {cards.slice(0, 12).map((n: any, i: number) => (
          <div key={"c" + i} className="rcard col">
            <div className="rcsub">{n.subject || n.insight || "Sugerencia"}</div>
            {n.insight && n.subject ? <div className="rctext" style={{ marginTop: 4 }}>{n.insight}</div> : null}
            <div className="rcactions">
              {n.convKey ? <button className="rminibtn" onClick={() => onDraft(n.convKey, n.subject)}>Escribir</button> : <button className="rminibtn" onClick={() => act(n.key, "done")}>Listo</button>}
              <button className="rminibtn ghost" onClick={() => act(n.key, "snooze")}>Después</button>
              <button className="rminibtn ghost" onClick={() => act(n.key, "dismiss")}>✕</button>
            </div>
          </div>
        ))}
        {promesas.length ? <div className="rsec">Prometiste</div> : null}
        {promesas.slice(0, 8).map((p: any, i: number) => (
          <div key={"p" + i} className="rcard" onClick={() => onOpen(p.thread || p.key, p.name)}>
            <div className="rcbody"><div className="rctop"><span className="rcname">{p.name || "—"}</span></div><div className="rctext">🤝 {String(p.promesa || p.text || "").slice(0, 140)}</div></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── NOTAS: segundo cerebro. Feed (digest IA + categorías + tarjetas) y Chat sobre tus notas. ──
const NT_QUICK = ["Resumí mis notas de esta semana", "¿Qué estoy postergando?", "¿Qué links guardé para leer?"]
function NoteImg({ path }: { path: string }) {
  const { src, ref } = useHubMedia(path)
  if (!src) return <span ref={ref} style={{ display: "block", height: 1 }} /> // ancla para el IntersectionObserver hasta que la imagen se baje
  return <img ref={ref} className="ntcimg" src={src} alt="" />
}
function NoteCard({ n, onAct, junk }: { n: any; onAct: (id: string, a: string) => void; junk: boolean }) {
  const title = n.clip_title || n.title || (n.text || "").slice(0, 100) || "Nota"
  return (
    <div className="ntcard">
      <div className="ntchead">
        <span className="ntcat-badge">{n.category || n.channel || "nota"}</span>
        <span className="ntctime">{ago(n.ts)}</span>
        {junk ? <button className="ntcbtn" onClick={() => onAct(n.id, "approve")} data-tip="Restaurar">↩</button> : (<>
          <button className="ntcbtn" onClick={() => onAct(n.id, n.pinned ? "unpin" : "pin")} data-tip={n.pinned ? "Desfijar" : "Fijar"} style={n.pinned ? { color: "var(--accent)" } : undefined}>📌</button>
          <button className="ntcbtn" onClick={() => onAct(n.id, "discard")} data-tip="Descartar">✕</button>
        </>)}
      </div>
      <div className="ntctitle">{title}</div>
      {n.para && n.para !== title ? <div className="ntcpara">{n.para}</div> : null}
      {n.media && /^(image|sticker)$/.test(n.mediaType || "") ? <NoteImg path={n.media} /> : null}
      {n.summary ? <div className="msgsum" style={{ borderTop: 0, paddingTop: 0 }}>✦ {n.summary}</div> : null}
    </div>
  )
}
// ── CLIP: un link / mensaje ORIGINAL que te guardaste (thread='self'). Muestra el dominio (clickeable), el título, el texto
// original y, si es foto/doc, la media. Acciones fijar/archivar via /api/clip/pin + /api/clip/archive (igual que la web). ──
const CLIP_ICON: Record<string, string> = { link: "🔗", text: "💡", todo: "✅", photo: "🖼", video: "🎥", audio: "🎤", doc: "📄" }
const CLIP_TABS: [string, string][] = [["all", "Todo"], ["link", "🔗 Links"], ["text", "💡 Notas"], ["media", "📸 Media"], ["archived", "🗄 Archivados"]]
function ClipCard({ c, onPin, onArchive }: { c: any; onPin: (id: string, on: boolean) => void; onArchive: (id: string, on: boolean) => void }) {
  const dom = c.url ? ((c.url.match(/https?:\/\/([^/]+)/) || [])[1] || "link").replace(/^www\./, "") : ""
  const title = c.title || c.text || "Clip"
  const openIt = () => { if (c.url) openExternal(c.url) } // abre el LINK en el navegador del sistema
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <div className={"clipcard" + (c.pinned ? " pinned" : "") + (c.url ? " tap" : "")} onClick={openIt}>
      <div className="clipic">{c.pinned ? "📌" : (CLIP_ICON[c.kind] || "📌")}</div>
      <div className="clipbody">
        <div className="cliptitle">{title}</div>
        {c.para ? <div className="ntcpara">{c.para}</div> : (!c.enriched ? <div className="ntcpara" style={{ opacity: .6 }}>analizando…</div> : null)}
        {c.text && c.text !== title ? <div className="cliporig">{c.text}</div> : null}
        {c.kind === "doc" && c.media ? <div style={{ marginTop: 8 }} onClick={stop}><FileCard path={c.media} filename={c.title || "Documento"} /></div> : null}
        {c.kind === "photo" && c.media ? <NoteImg path={c.media} /> : null}
        <div className="clipmeta">{dom ? <a className="clipdom" onClick={(e) => { e.stopPropagation(); openExternal(c.url) }}>🔗 {dom}</a> : null}<span>{ago(c.ts)}</span></div>
      </div>
      <div className="clipacts" onClick={stop}>
        <button className="ntcbtn" onClick={() => onPin(c.id, !c.pinned)} data-tip={c.pinned ? "Desfijar" : "Fijar arriba"} style={c.pinned ? { color: "var(--accent)" } : undefined}>📌</button>
        <button className="ntcbtn" onClick={() => onArchive(c.id, !c.archived)} data-tip={c.archived ? "Desarchivar" : "Archivar"}>{c.archived ? "↩" : "🗄"}</button>
      </div>
    </div>
  )
}
function Notas() {
  const [mode, setMode] = useState<"feed" | "clips" | "chat">("feed")
  const [dig, setDig] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [cats, setCats] = useState<any[]>([])
  const [junk, setJunk] = useState(0)
  const [cat, setCat] = useState("all")
  const [status, setStatus] = useState<"active" | "junk">("active")
  const [loading, setLoading] = useState(true)
  const [chat, setChat] = useState<any[]>([])
  const [q, setQ] = useState("")
  const [asking, setAsking] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  // CLIPS: los links / mensajes originales guardados. Se cargan al entrar a la pestaña, paginables hacia atrás.
  const [clips, setClips] = useState<any[]>([])
  const [clipKind, setClipKind] = useState("all")
  const [clipMore, setClipMore] = useState(false)
  const [clipLoading, setClipLoading] = useState(false)
  const [clipsInit, setClipsInit] = useState(false)
  const loadList = async (c: string, s: string) => { const nl = await getNotes(c, s).catch(() => null); if (nl) { setItems(nl.items || []); if (nl.categories) setCats(nl.categories); if (nl.junk != null) setJunk(nl.junk) } }
  const loadClips = async (kind: string) => {
    setClipKind(kind); setClipLoading(true)
    const r = await getNotesClips(kind, 0).catch(() => null)
    setClips((r && r.items) || []); setClipMore(!!(r && r.hasMore)); setClipLoading(false)
  }
  const moreClips = async () => {
    const oldest = clips.length ? clips[clips.length - 1].ts : 0
    const r = await getNotesClips(clipKind, oldest).catch(() => null)
    setClips((c) => [...c, ...((r && r.items) || [])]); setClipMore(!!(r && r.hasMore))
  }
  const onClipPin = async (id: string, on: boolean) => { setClips((cur) => cur.map((c) => c.id === id ? { ...c, pinned: on } : c)); await clipPin(id, on).catch(() => {}) }
  const onClipArchive = async (id: string, on: boolean) => { setClips((cur) => cur.filter((c) => c.id !== id)); await clipArchive(id, on).catch(() => {}) } // sale de la vista actual (archivar o desarchivar desde la pestaña de archivados)
  useEffect(() => {
    Promise.all([getNotesDigest().catch(() => ({})), getNotesChat().catch(() => ({}))]).then(([dg, ch]: any[]) => { setDig(dg || {}); setChat((ch && ch.history) || []) })
    loadList("all", "active").finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadList(cat, status) }, [cat, status])
  useEffect(() => { if (mode === "clips" && !clipsInit) { setClipsInit(true); loadClips("all") } }, [mode])
  const send = async (preset?: string) => {
    const txt = (preset || q).trim(); if (!txt) return
    setQ(""); setChat((c) => [...c, { role: "user", text: txt }]); setAsking(true)
    const r = await notesChat(txt).catch(() => null); setAsking(false)
    setChat((c) => (r && r.history) ? r.history : [...c, { role: "ai", text: (r && r.answer) || "No pude responder ahora." }])
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, 120)
  }
  const onAct = async (id: string, action: string) => {
    setItems((cur) => (action === "discard" || action === "archive") ? cur.filter((n) => n.id !== id) : cur.map((n) => n.id === id ? { ...n, pinned: action === "pin" } : n))
    await noteAction(id, action).catch(() => {})
  }
  return (
    <div className="pane">
      <div className="panehead"><h1>Notas</h1><div className="ntmodes"><button className={mode === "feed" ? "on" : ""} onClick={() => setMode("feed")}>📝 Notas</button><button className={mode === "clips" ? "on" : ""} onClick={() => setMode("clips")}>🔗 Clips</button><button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")}>💬 Preguntar</button></div></div>
      {mode === "clips" ? (
        <div className="panebody">
          <div className="ntcats">
            {CLIP_TABS.map(([k, l]) => <button key={k} className={"ntcat" + (clipKind === k ? " on" : "")} onClick={() => loadClips(k)}>{l}</button>)}
          </div>
          {clipLoading ? <div className="center" style={{ height: 160 }}><div className="spin" /></div> : (
            clips.length ? (<>
              {clips.map((c: any) => <ClipCard key={c.id} c={c} onPin={onClipPin} onArchive={onClipArchive} />)}
              {clipMore ? <button className="mbtn ghost" style={{ width: "100%", marginTop: 4 }} onClick={moreClips}>Cargar más</button> : null}
            </>) : <div className="center" style={{ height: 140, color: "var(--muted)", textAlign: "center" }}>No hay clips acá.<br />Mandate un link o una idea a vos mismo y aparece aquí.</div>
          )}
        </div>
      ) : mode === "feed" ? (
        <div className="panebody">
          {loading ? <div className="center" style={{ height: 160 }}><div className="spin" /></div> : (<>
            {dig && (dig.reflexion || dig.resumen) ? (
              <div className="ntdigest">
                <div className="ntdlab">✦ La IA piensa</div>
                {dig.resumen ? <div className="ntdtext">{dig.resumen}</div> : null}
                {dig.reflexion ? <div className="ntdtext" style={{ marginTop: 6 }}>{dig.reflexion}</div> : null}
                {(dig.temas || []).length ? <div className="nttemas">{dig.temas.map((t: string, i: number) => <span key={i} className="nttema">{t}</span>)}</div> : null}
                {dig.count != null ? <div className="ntdmeta">{dig.count} notas · últimos 30 días</div> : null}
              </div>
            ) : null}
            <div className="ntcats">
              <button className={"ntcat" + (cat === "all" && status === "active" ? " on" : "")} onClick={() => { setCat("all"); setStatus("active") }}>Todas</button>
              {cats.map((c: any) => <button key={c.category} className={"ntcat" + (cat === c.category && status === "active" ? " on" : "")} onClick={() => { setCat(c.category); setStatus("active") }}>{c.category} {c.n}</button>)}
              {junk ? <button className={"ntcat" + (status === "junk" ? " on" : "")} onClick={() => { setStatus("junk"); setCat("all") }}>🗑 Descartadas {junk}</button> : null}
            </div>
            {items.length ? items.map((n: any) => <NoteCard key={n.id} n={n} onAct={onAct} junk={status === "junk"} />) : <div className="center" style={{ height: 140, color: "var(--muted)" }}>No hay notas acá.</div>}
          </>)}
        </div>
      ) : (
        <div className="ntchatwrap">
          <div className="ntchat" ref={chatRef}>
            {!chat.length ? <div className="ntquick">{NT_QUICK.map((p, i) => <button key={i} onClick={() => send(p)}>{p}</button>)}</div> : null}
            {chat.map((m: any, i: number) => <div key={i} className={"ntmsg " + (m.role === "user" ? "user" : "ai")}>{m.text}</div>)}
            {asking ? <div className="ntmsg ai"><span style={{ color: "var(--muted)" }}>pensando…</span></div> : null}
          </div>
          <div className="ntcompose">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send() }} placeholder="Preguntá sobre tus notas…" />
            <button className="send" onClick={() => send()} disabled={!q.trim()}>➤</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CONTACTOS: directorio (desde los hilos) + perfil (getPerson: bio/temas/datos/canales/stats). ──
type Contact = { name: string; key?: string; photo?: string; channels?: string[]; group?: boolean; role?: string }
function Contactos({ threads, onOpen, onToast, onMerged }: { threads: Thread[]; onOpen: (key: string, name?: string, photo?: string) => void; onToast: (msg: string) => void; onMerged: () => void }) {
  const [q, setQ] = useState("")
  const [selName, setSelName] = useState<string | null>(null)
  const [selKey, setSelKey] = useState<string | undefined>(undefined) // key REAL del hilo del contacto (autoritativa: ahí están los msgs)
  const [p, setP] = useState<any>(null)
  const [pLoading, setPLoading] = useState(false)
  const [dir, setDir] = useState<any[] | null>(null) // DIRECTORIO completo del vault (todos los contactos, no solo los ~200 hilos recientes)
  // MODO SELECCIÓN: elegir 2+ contactos y fusionarlos (dedupe). El primero seleccionado es el que se CONSERVA.
  const [selMode, setSelMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)
  useEffect(() => { getDirectory().then((d) => setDir(d?.people || [])).catch(() => setDir([])) }, [])
  // MERGE hilos + directorio: los hilos aportan clave/foto/canales (para abrir y fusionar); el directorio aporta TODOS los nombres
  // (contactos sin conversación reciente). Indexado por nombre normalizado → sin duplicar. Así se ven TODOS, no solo los recientes.
  const nrm = (s: string) => (s || "").trim().toLowerCase()
  const byName = new Map<string, Contact>()
  for (const t of threads) {
    if (t.key === "self" || (t as any).espacio || t.bucket === "spam") continue
    byName.set(nrm(t.name), { name: t.name, key: t.key, photo: t.photo, channels: t.channels, group: t.group })
  }
  for (const d of (dir || [])) {
    const k = nrm(d.name); if (!k) continue
    const ex = byName.get(k)
    if (!ex) byName.set(k, { name: d.name, role: d.role })            // contacto del vault sin hilo → igual aparece
    else if (d.role && !ex.role) ex.role = d.role                     // ya hay hilo → le sumo el rol del vault
  }
  const people = [...byName.values()]
    .filter((c) => { const nq = q.trim().toLowerCase(); if (!nq) return true; return (`${c.name || ""} ${c.key || ""}`).toLowerCase().includes(nq) })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"))
  const selThread = threads.find((t) => t.name === selName)
  const openProfile = (t: { name: string; key?: string }) => { setSelName(t.name); setSelKey(t.key); setP(null); setPLoading(true); getPerson(t.name).then((r) => setP(r || {})).catch(() => setP({})).finally(() => setPLoading(false)) }
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const exitSel = () => { setSelMode(false); setSelected(new Set()) }
  // id de selección: hilo → su key; contacto del vault SIN hilo → "contact:<nombre>" (así TODOS son seleccionables, no solo los que tienen conversación)
  const idOf = (t: Contact) => t.key || ("contact:" + t.name)
  const selItems = people.filter((t) => selected.has(idOf(t)))
  // target = el que se CONSERVA: preferimos uno CON hilo (para que los mensajes tengan hogar); si no, el 1ro. canonical = su nombre.
  const targetItem = selItems.find((t) => t.key) || selItems[0]
  const targetName = targetItem?.name || ""
  const doMerge = async () => {
    if (selItems.length < 2 || merging || !targetItem) return
    const target = targetItem.key || targetItem.name
    const keys = selItems.filter((t) => t.key && (t.key !== targetItem.key)).map((t) => t.key!) // hilos-fuente cuyos mensajes se mueven
    const aliases = selItems.map((t) => t.name) // TODOS los nombres → el backend registra alias (canonical se ignora solo)
    setMerging(true)
    const r = await mergeContacts(target, keys, { canonical: targetName, aliases }).catch(() => null)
    setMerging(false); exitSel()
    onMerged() // refresca la lista de hilos en el padre
    onToast(r ? `✅ ${selItems.length} contactos fusionados en ${targetName}` : "No se pudo fusionar — probá de nuevo")
  }
  return (
    <div className="ctdir">
      <div className="ctlist">
        <div className="search" style={{ margin: "0 0 10px" }}><span style={{ opacity: .6 }}>🔎</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto…" />{q ? <span onClick={() => setQ("")} style={{ cursor: "pointer", opacity: .6 }}>✕</span> : null}</div>
        <div className="ctcount"><span>{people.length} contactos</span><button className="ctselbtn" onClick={() => selMode ? exitSel() : setSelMode(true)}>{selMode ? "Cancelar" : "Seleccionar"}</button></div>
        {selMode ? (
          <div className="ctmergebar">
            <span className="ctmergeinfo">{selItems.length < 2 ? "Elegí 2 o más para fusionar" : <>Fusionar {selItems.length} · se conserva <b>{targetName}</b></>}</span>
            <button className="mbtn" style={{ flex: "0 0 auto", padding: "8px 14px" }} disabled={selItems.length < 2 || merging} onClick={doMerge}>{merging ? "Fusionando…" : "🔗 Fusionar"}</button>
          </div>
        ) : null}
        {people.map((t) => (
          <div key={idOf(t)} className={"ctrow" + (!selMode && selName === t.name ? " on" : "") + (selMode && selected.has(idOf(t)) ? " sel" : "")} onClick={() => selMode ? toggleSel(idOf(t)) : openProfile(t)}>
            {selMode ? <input type="checkbox" className="ctcheck" checked={selected.has(idOf(t))} onChange={() => toggleSel(idOf(t))} onClick={(e) => e.stopPropagation()} /> : null}
            <Avatar name={t.name} photo={t.photo} size={38} />
            <div className="ctmid"><div className="ctname">{t.name}</div><div className="ctsub">{(t.channels || []).map((c) => CH[c]?.label || c).join(" · ") || (t.group ? "Grupo" : t.role || "Contacto")}</div></div>
          </div>
        ))}
        {!people.length ? <div className="center" style={{ height: 140, color: "var(--muted)" }}>Sin contactos</div> : null}
      </div>
      <div className="ctprofile">
        {!selName ? <div className="center" style={{ color: "var(--muted)" }}>Elegí un contacto para ver su perfil</div> : pLoading ? <div className="center"><div className="spin" /></div> : (
          <div className="ctpinner">
            <div className="cav" style={{ background: colorOf(selName), width: 72, height: 72, fontSize: 24 }}>{initials(selName)}</div>
            <div className="ctpname">{selName}</div>
            <div className="ctprole">{p?.role || [p?.orgs].filter(Boolean).join(" · ") || (selThread?.channels || []).map((c) => CH[c]?.label || c).join(" · ")}</div>
            <button className="mbtn" style={{ marginTop: 14 }} onClick={() => onOpen((selKey || selThread?.key || p?.canon || selName), selName || undefined, selThread?.photo)}>💬 Abrir conversación</button>
            {p?.bio ? <><div className="ctpgrp">Quién es</div><div className="cbox">{p.bio}</div></> : null}
            {(p?.topics || []).length ? <><div className="ctpgrp">De qué hablan</div><div className="cbox">{p.topics.slice(0, 6).join(" · ")}</div></> : null}
            {((p?.contacts?.phones || []).length || (p?.contacts?.emails || []).length) ? (<>
              <div className="ctpgrp">Datos de contacto</div>
              <div className="ctchips">
                {(p.contacts.phones || []).map((ph: string, i: number) => <span key={"ph" + i} className="ctchip">📞 {ph}</span>)}
                {(p.contacts.emails || []).map((em: string, i: number) => <span key={"em" + i} className="ctchip clk" onClick={() => openExternal("mailto:" + em)}>✉️ {em}</span>)}
              </div>
            </>) : null}
            {(p?.channels || []).length ? (<>
              <div className="ctpgrp">Canales</div>
              {p.channels.map((c: any, i: number) => <div key={i} className="ctchan"><span style={{ width: 8, height: 8, borderRadius: 9, background: CH[c.channel]?.c || "#ccc", display: "inline-block", flexShrink: 0 }} />{CH[c.channel]?.label || c.channel}{c.last ? <span className="ctchanago">{ago(c.last)}</span> : null}</div>)}
            </>) : null}
            {p?.stats ? <div className="ctstats">{p.stats.respMin != null ? <div className="ctstat"><b>{p.stats.respMin}m</b><span>responde</span></div> : null}{p.stats.messages != null ? <div className="ctstat"><b>{p.stats.messages}</b><span>mensajes</span></div> : null}</div> : null}
            <ContactEnrich key={selKey || selThread?.key || p?.canon || selName} contactKey={selKey || selThread?.key || p?.canon || selName!} name={selName!} onToast={onToast} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── ENRIQUECIMIENTO SOCIAL: pega links (LinkedIn/IG/FB/X), "Investigar" (Apify anónimo) y ego-grafo radial tipo Obsidian. ──
const REL_COLORS: Record<string, string> = { colega: "#3b82f6", empresa: "#8b5cf6", socio: "#22a06b", amigo: "#e0872b", familia: "#e2483d" }
const relColor = (t: string) => REL_COLORS[(t || "").toLowerCase()] || "#7c8398"
const SOCIAL_FIELDS: [keyof SocialLinks, string, string][] = [
  ["linkedin", "🔗", "linkedin.com/in/…"], ["instagram", "📷", "instagram.com/…"],
  ["facebook", "📘", "facebook.com/…"], ["x", "✖️", "x.com/…"],
]
function EgoGraph({ center, relations }: { center: string; relations: { name: string; type: string }[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const W = 420, H = 300; cv.width = W * dpr; cv.height = H * dpr
    const ctx = cv.getContext("2d"); if (!ctx) return
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H)
    const css = getComputedStyle(document.documentElement)
    const line = css.getPropertyValue("--line2").trim() || "#e3e5ee"
    const ink = css.getPropertyValue("--ink").trim() || "#1e2030"
    const muted = css.getPropertyValue("--muted").trim() || "#7c8398"
    const accent = css.getPropertyValue("--accent").trim() || "#6366f1"
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 46
    const rels = (relations || []).slice(0, 12)
    // 1) líneas al centro
    rels.forEach((r, i) => {
      const a = -Math.PI / 2 + (i / Math.max(rels.length, 1)) * Math.PI * 2
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.stroke()
    })
    // 2) nodos del anillo
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    rels.forEach((r, i) => {
      const a = -Math.PI / 2 + (i / Math.max(rels.length, 1)) * Math.PI * 2
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R, col = relColor(r.type)
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill()
      ctx.fillStyle = ink; ctx.font = "600 11px -apple-system, system-ui, sans-serif"
      const label = (r.name || "").length > 16 ? (r.name || "").slice(0, 15) + "…" : (r.name || "")
      const ly = y + (Math.sin(a) >= 0 ? 22 : -22)
      ctx.fillText(label, x, ly)
      if (r.type) { ctx.fillStyle = muted; ctx.font = "500 9px -apple-system, system-ui, sans-serif"; ctx.fillText(r.type, x, ly + (Math.sin(a) >= 0 ? 12 : 12)) }
    })
    // 3) nodo central
    ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill()
    ctx.fillStyle = "#fff"; ctx.font = "800 13px -apple-system, system-ui, sans-serif"
    ctx.fillText(initials(center), cx, cy)
  }, [center, JSON.stringify(relations)])
  return <canvas ref={ref} className="egocanvas" style={{ width: 420, height: 300, maxWidth: "100%" }} />
}
function ContactEnrich({ contactKey, name, onToast }: { contactKey: string; name: string; onToast: (m: string) => void }) {
  const [links, setLinks] = useState<SocialLinks>({})
  const [data, setData] = useState<ContactSocial | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getContactSocial(contactKey).then((r) => { setData(r || null); setLinks((r && r.links) || {}) }).catch(() => {})
  }, [contactKey])
  const saveLinks = async (toast = false) => { await setContactLinks(contactKey, links).catch(() => {}); if (toast) onToast("✓ Links guardados") }
  const investigate = async () => {
    setBusy(true)
    const r = await investigateContact(contactKey, links).catch(() => null)
    setBusy(false)
    if (r) { setData(r); if (r.links) setLinks(r.links); onToast("✓ Investigación lista") }
    else onToast("No se pudo investigar — revisá las cuentas Apify en Ajustes")
  }
  const prof = data?.profiles
  const rels = prof?.relationships || []
  const meta = [prof?.role, prof?.company, prof?.location].filter(Boolean).join(" · ")
  const errs = Object.entries(data?.errors || {}).filter(([, v]) => v)
  return (
    <div className="ctenrich">
      <div className="ctpgrp">Enriquecer perfil</div>
      <div className="enrfields">
        {SOCIAL_FIELDS.map(([k, icon, ph]) => (
          <div key={k} className="enrfield">
            <span className="enricon">{icon}</span>
            <input className="enrinput" placeholder={ph} value={links[k] || ""} spellCheck={false} autoCapitalize="none"
              onChange={(e) => setLinks((s) => ({ ...s, [k]: e.target.value }))} onBlur={() => saveLinks(false)} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="mbtn ghost" style={{ flex: 1 }} onClick={() => saveLinks(true)} disabled={busy}>💾 Guardar</button>
        <button className="mbtn" style={{ flex: 1 }} onClick={investigate} disabled={busy}>{busy ? "Investigando…" : "🔍 Investigar"}</button>
      </div>
      {busy ? <div className="center" style={{ height: 60, gap: 10 }}><div className="spin" /><span style={{ color: "var(--muted)", fontSize: 12.5 }}>Investigando…</span></div> : null}
      {!busy && prof ? (<>
        {prof.summary ? <><div className="ctpgrp">Resumen</div><div className="cbox">{prof.summary}</div></> : null}
        {meta ? <div className="enrmeta">{meta}</div> : null}
        {(prof.interests || []).length ? (<>
          <div className="ctpgrp">Intereses</div>
          <div className="ctchips">{(prof.interests || []).map((it, i) => <span key={i} className="ctchip">{it}</span>)}</div>
        </>) : null}
        {rels.length ? (<>
          <div className="ctpgrp">Red (ego-grafo)</div>
          <div className="egowrap"><EgoGraph center={name} relations={rels} /></div>
          <div className="egolegend">
            {[...new Set(rels.map((r) => (r.type || "").toLowerCase()).filter(Boolean))].map((t) =>
              <span key={t} className="egolegitem"><i style={{ background: relColor(t) }} />{t}</span>)}
          </div>
        </>) : null}
        {(data?.sources || []).length ? <div className="enrsources">Fuentes: {(data!.sources || []).join(" · ")}</div> : null}
      </>) : null}
      {!busy && errs.length ? <div className="enrerrs">{errs.map(([k, v]) => <div key={k} className="enrerr">⚠ {k}: {v}</div>)}</div> : null}
      {data?.updatedAt ? <div className="enrsources" style={{ marginTop: 4 }}>Actualizado {ago(data.updatedAt)}</div> : null}
    </div>
  )
}

// ── HOME: resumen del día (paridad con web viewHome/paintHome). GET /api/home → brief+audio, KPIs, news, agenda, "necesitan respuesta", to-dos, objetivos, coach. ──
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
const HZ_LABEL: Record<string, string> = { corto: "Corto", mediano: "Mediano", largo: "Largo", familiar: "Familia", otros: "Otros" }
// botón "▶ Escuchar" del brief: baja el audio TTS autenticado (GET /api/home/audio → data URI vía hub_image) y lo reproduce en un <audio> nativo
function HomeAudioBtn({ sec }: { sec: number }) {
  const [state, setState] = useState<"idle" | "load" | "play">("idle")
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const toggle = async () => {
    if (state === "play") { audioRef.current?.pause(); return }
    if (audioRef.current) { audioRef.current.play().catch(() => {}); return }
    setState("load")
    const uri = await getHomeAudio().catch(() => "")
    if (!uri) { setState("idle"); return }
    const a = new Audio(uri); audioRef.current = a
    a.onplay = () => setState("play"); a.onpause = () => setState((s) => s === "play" ? "idle" : s); a.onended = () => setState("idle")
    a.play().catch(() => setState("idle"))
  }
  return <button className="hb-listen" onClick={toggle}>{state === "load" ? "Cargando…" : state === "play" ? "⏸ Pausar" : `▶ Escuchar · ${mmss(sec)}`}</button>
}
function Home({ onOpen, onDraft, onNav, onOpenMeeting }: { onOpen: (k: string, n?: string) => void; onDraft: (k: string, n?: string) => void; onNav: (p: Pane) => void; onOpenMeeting: (id: string) => void }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [done, setDone] = useState<Set<string>>(new Set())   // items despachados (necesitan respuesta / to-dos / promesas)
  const [q, setQ] = useState(""); const [asking, setAsking] = useState(false)
  const [ans, setAns] = useState<{ q: string; a: string } | null>(null)
  useEffect(() => {
    getHome().then((r) => setD(r || {})).catch(() => setD({})).finally(() => setLoading(false))
    getHubConfig().then((h) => setName(((h?.ownerName || "").trim().split(/\s+/)[0]) || "")).catch(() => {})
  }, [])
  const hr = new Date().getHours()
  const saludo = hr < 12 ? "Buenos días" : hr < 19 ? "Buenas tardes" : "Buenas noches"
  const fecha = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()
  const ask = async () => {
    const qq = q.trim(); if (!qq || asking) return
    setAsking(true); setAns({ q: qq, a: "" })
    const r = await askBrain(qq).catch(() => null); setAsking(false)
    setAns({ q: qq, a: (r && (r.answer || r.text || r.reply)) || "No pude responder eso ahora." }); setQ("")
  }
  const seguirJarvis = () => { if (ans) jarvisHistory.push({ role: "me", text: ans.q }, { role: "ai", text: ans.a }); onNav("jarvis") }
  const dismiss = (k: string) => setDone((s) => new Set(s).add(k))
  const waitDone = (w: any) => { dismiss("w:" + w.key); markSeen(w.key, Date.now()).catch(() => {}) }
  const actDone = (kind: string, id: string, pref: string) => { dismiss(pref + ":" + id); actionDone(kind, id).catch(() => {}) }
  if (loading) return <div className="pane"><div className="center"><div className="spin" /></div></div>
  const b = d?.brief || {}, kpis = d?.kpis || [], news = d?.news || [], ag = d?.agenda || [], coach = d?.coach
  const waiting = (d?.waiting || []).filter((w: any) => !done.has("w:" + w.key))
  const calls = d?.calls || [], todos = (d?.todos || []).filter((t: any) => !done.has("t:" + t.id))
  const promesas = (d?.promesas || []).filter((p: any) => !done.has("p:" + p.id)), objetivos = d?.objetivos || []
  const kpiCard = (k: any, i: number) => {
    const up = k.delta > 0, good = k.delta == null ? true : (up === k.goodUp)
    return (
      <div key={i} className="hb-kpi" onClick={() => onNav("objetivos")}>
        <div className="hb-kpi-cat">{k.cat}</div><div className="hb-kpi-label">{k.label}</div>
        <div className="hb-kpi-val">{k.value} {k.delta != null ? <span className={"hb-kpi-delta " + (good ? "good" : "bad")}>{up ? "▲" : "▼"} {Math.abs(k.delta)}%</span> : null}</div>
        <div className="hb-kpi-bar"><i style={{ width: (k.pct || 0) + "%", background: good ? "var(--accent)" : "#e0553e" }} /></div>
      </div>
    )
  }
  const actRow = (kind: string, pref: string, a: any) => (
    <div key={pref + a.id} className="hb-act">
      <button className="hb-act-chk" onClick={() => actDone(kind, a.id, pref)} aria-label="Hecho" />
      <div style={{ flex: 1, minWidth: 0 }}><div className="hb-act-txt">{a.text}</div><div className="hb-act-sub">{a.name || ""}{a.due ? " · " + a.due : ""}</div></div>
      {a.thread ? <span className="hb-link" onClick={() => onOpen(a.thread, a.name)}>ver</span> : null}
    </div>
  )
  return (
    <div className="pane">
      <div className="panebody home">
        <div className="hb-head"><div><div className="hb-date">{fecha}</div><h1 className="hb-greet">{saludo},{name ? <><br />{name}</> : ""}</h1></div></div>

        {/* Jarvis inline (IA reactiva: vos preguntás) */}
        <div className="hb-askhead">🧠 Jarvis <span>— preguntale lo que sea sobre tus datos</span></div>
        <div className="hb-ask">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask() }} placeholder="ej: ¿quién me debe? · resumime a Ana · ¿qué quedó con la empresa X?" />
          <button onClick={ask} aria-label="Preguntar">⌕</button>
        </div>
        {ans ? <div className="hb-ask-out">{asking ? <span style={{ color: "var(--muted)" }}>Pensando…</span> : <><Linkified text={ans.a} /><div style={{ marginTop: 8 }}><span className="hb-link" onClick={seguirJarvis}>Seguir conversando en Jarvis →</span></div></>}</div> : null}

        {!d?.generatedAt ? <div className="hb-empty" style={{ textAlign: "center", margin: "10px 0" }}>Generando tu resumen del día…</div> : null}

        {b.text ? (
          <div className="hb-brief">
            <div className="hb-eyebrow"><span>✦</span>Tu día en breve</div>
            <div className="hb-brief-txt"><Linkified text={b.text} /></div>
            {b.audioSec ? <div className="hb-brief-row"><HomeAudioBtn sec={b.audioSec} /></div> : null}
          </div>
        ) : null}

        {waiting.length ? (
          <div className="hb-card">
            <div className="hb-card-head"><div className="hb-card-title">↩️ Necesitan respuesta <span className="hb-badge">{waiting.length}</span></div></div>
            {waiting.map((w: any, i: number) => (
              <div key={w.key || i} className="hb-wait">
                <div className="hb-wait-top"><Avatar name={w.name} photo={w.photo} size={38} /><div style={{ flex: 1, minWidth: 0 }}><div className="hb-wait-name">{w.name}{w.work ? <span className="hb-tag">trabajo</span> : null}<span className="hb-wait-when"> · {w.reason}</span></div><div className="hb-wait-prev">{w.preview || ""}</div></div></div>
                <div className="hb-wait-acts"><button onClick={() => onOpen(w.key, w.name)}>✍️ Responder</button><button onClick={() => onDraft(w.key, w.name)}>✨ Borrador IA</button><button onClick={() => waitDone(w)}>✓ Listo</button></div>
              </div>
            ))}
          </div>
        ) : null}

        {calls.length ? (
          <div className="hb-card">
            <div className="hb-card-head"><div className="hb-card-title">📞 Llamadas <span className="hb-badge">{calls.length}</span></div></div>
            {calls.map((c: any, i: number) => (
              <div key={c.key || i} className="hb-band-row" onClick={() => onOpen(c.key, c.name)}><Avatar name={c.name} size={38} /><div style={{ flex: 1, minWidth: 0 }}><div className="hb-band-name">{c.name}</div><div className="hb-band-prev">{c.missed ? "Llamada perdida" : "Te llamó"}{c.n > 1 ? ` · ${c.n}×` : ""} · {ago(c.ts)}</div></div><span className="hb-callret">Devolver</span></div>
            ))}
          </div>
        ) : null}

        {todos.length ? <div className="hb-card"><div className="hb-card-head"><div className="hb-card-title">✅ Por hacer <span className="hb-badge">{todos.length}</span></div></div>{todos.map((t: any) => actRow("todo", "t", t))}</div> : null}
        {promesas.length ? <div className="hb-card"><div className="hb-card-head"><div className="hb-card-title">🤝 Prometiste <span className="hb-badge">{promesas.length}</span></div></div>{promesas.map((p: any) => actRow("prom", "p", p))}</div> : null}

        <div className="hb-card">
          <div className="hb-card-head spread"><div className="hb-card-title">📅 Agenda de hoy</div><span className="hb-link" onClick={() => onNav("calendario")}>Ver semana</span></div>
          {ag.length ? ag.map((e: any, i: number) => (
            <div key={i} className={"hb-ag-row" + (e.id || e.key ? " tap" : "")} onClick={() => (e.id || e.key) && onOpenMeeting(e.id || e.key)}>
              <div className="hb-ag-time"><b>{e.time}</b>{e.dur ? <span>{e.dur}</span> : null}</div>
              <div style={{ flex: 1 }}><div className="hb-ag-title">{e.title}</div>{e.sub ? <div className="hb-ag-sub">{e.sub}</div> : null}</div>
            </div>
          )) : <div className="hb-empty">Sin eventos hoy 🎉</div>}
        </div>

        {objetivos.length ? (
          <div className="hb-card">
            <div className="hb-card-head spread"><div className="hb-card-title">🎯 Tus objetivos</div><span className="hb-link" onClick={() => onNav("objetivos")}>Ver</span></div>
            {objetivos.map((o: any, i: number) => { const pc = (o.progress != null && o.target) ? Math.min(100, Math.round(o.progress / o.target * 100)) : null
              return <div key={i} className="hb-obj" onClick={() => onNav("objetivos")}><div style={{ flex: 1, minWidth: 0 }}><div className="hb-obj-title">{o.title || ""}</div>{o.next ? <div className="hb-obj-next">→ {o.next}</div> : null}</div>{o.horizon ? <span className="hb-obj-hz">{HZ_LABEL[o.horizon] || o.horizon}</span> : null}{pc != null ? <span className="hb-obj-pc">{pc}%</span> : null}</div> })}
          </div>
        ) : null}

        {kpis.length ? <><div className="hb-section-title" onClick={() => onNav("objetivos")} style={{ cursor: "pointer" }}>📊 Tus KPIs<span className="hb-link" style={{ marginLeft: "auto" }}>Configurar ›</span></div><div className="hb-kpis">{kpis.map(kpiCard)}</div></> : null}

        {news.length ? (
          <div className="hb-card">
            <div className="hb-card-head spread"><div className="hb-card-title">📰 Para vos</div><span className="hb-link" onClick={() => onNav("radar")}>Más</span></div>
            {news.map((n: any, i: number) => (
              <div key={i} className="hb-news" onClick={() => n.url && openExternal(n.url)}><div className="hb-news-txt"><div className="hb-news-tag">{n.tag}</div><div className="hb-news-title">{n.title}</div><div className="hb-news-src">{n.source || ""}{n.ago ? " · " + n.ago : ""}</div></div><div className="hb-news-img" style={n.img ? { backgroundImage: `url(${n.img})` } : undefined} /></div>
            ))}
          </div>
        ) : null}

        {coach ? <div className="hb-coach"><div className="hb-eyebrow light"><span>◎</span>Coach · sugerencia</div><div className="hb-coach-txt">{coach.text}</div><button className="hb-coach-btn" onClick={() => coach.convKey ? onOpen(coach.convKey) : onNav("radar")}>Ver sugerencia</button></div> : null}
      </div>
    </div>
  )
}

// ── OBJETIVOS: metas/KPIs por horizonte (paridad con web viewObjetivos). /api/objetivos + /api/companies + /api/objetivo(+/delete) + /api/objetivos/suggest ──
const OBJ_HZ: [string, string][] = [["corto", "🎯 Corto plazo"], ["mediano", "📈 Mediano plazo"], ["largo", "🚀 Largo plazo"], ["familiar", "❤️ Familia"], ["otros", "📌 Otros"]]
function ObjetivoEditor({ obj, comps, onSave, onClose }: { obj: any; comps: any[]; onSave: (o: any) => void; onClose: () => void }) {
  const [f, setF] = useState({ title: obj.title || "", current: obj.current ?? 0, target: obj.target ?? 5, unit: obj.unit || "", horizon: obj.horizon || "corto", scope: obj.scope || "personal" })
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }))
  const save = () => { if (!f.title.trim()) return; onSave({ id: obj.id || undefined, title: f.title.trim(), current: +f.current || 0, target: +f.target || 0, unit: f.unit.trim(), horizon: f.horizon, scope: f.scope, source: "user" }) }
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>{obj.id ? "Editar" : "Nuevo"} objetivo</h3>
      <input className="modalinput" placeholder="Título (ej: 5 clientes nuevos)" value={f.title} onChange={(e) => set("title", e.target.value)} />
      <div className="modalrow"><input className="modalinput" type="number" placeholder="Actual" value={f.current} onChange={(e) => set("current", e.target.value)} /><input className="modalinput" type="number" placeholder="Meta" value={f.target} onChange={(e) => set("target", e.target.value)} /></div>
      <input className="modalinput" placeholder="Unidad (clientes, %, noches/semana…)" value={f.unit} onChange={(e) => set("unit", e.target.value)} />
      <select className="modalinput" value={f.horizon} onChange={(e) => set("horizon", e.target.value)}>{OBJ_HZ.filter(([k]) => k !== "otros").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select className="modalinput" value={f.scope} onChange={(e) => set("scope", e.target.value)}><option value="personal">Personal</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <div className="modalrow"><button className="mbtn" onClick={save}>Guardar</button><button className="mbtn ghost" onClick={onClose}>Cancelar</button></div>
    </div></div>
  )
}
function Objetivos({ onToast }: { onToast: (m: string) => void }) {
  const [objs, setObjs] = useState<any[]>([]); const [comps, setComps] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<any | null>(null)
  const [sug, setSug] = useState<any[] | null>(null); const [sugBusy, setSugBusy] = useState(false)
  const load = () => Promise.all([getObjetivos().catch(() => []), getCompanies().catch(() => [])]).then(([o, c]) => { setObjs(o || []); setComps(c || []) }).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  const label = (o: any) => { const co = comps.find((x) => x.id === o.scope || x.name === o.scope); return co ? co.name : "Personal" }
  const colr = (o: any) => { const co = comps.find((x) => x.id === o.scope || x.name === o.scope); return co ? co.color : "#8bb0a2" }
  const del = async (id: string) => { setObjs((cur) => cur.filter((o) => o.id !== id)); await deleteObjetivo(id).catch(() => {}) }
  const save = async (o: any) => { setEdit(null); await saveObjetivo(o).catch(() => {}); onToast("✓ Guardado"); load() }
  const doSuggest = async () => { setSugBusy(true); const s = await suggestObjetivos().catch(() => []); setSugBusy(false); setSug(s || []) }
  const addSug = async (o: any) => { setSug((s) => (s || []).filter((x) => x !== o)); await saveObjetivo({ ...o, source: "ai", current: 0 }).catch(() => {}); onToast("✓ Objetivo agregado"); load() }
  const row = (o: any) => { const pct = Math.min(100, Math.round(100 * (o.current || 0) / (o.target || 1)))
    return (
      <div key={o.id} className="objcard">
        <div className="spread"><div><span className="objscope" style={{ background: colr(o) + "22", color: colr(o) }}>{label(o)}</span> <b>{o.title}</b>{o.source === "ai" ? <span className="objai"> · sugerido</span> : null}</div><b>{o.current || 0}/{o.target || 0}</b></div>
        <div className="objbar"><i style={{ width: pct + "%", background: colr(o) }} /></div>
        <div className="objacts"><span className="objedit" onClick={() => setEdit(o)}>Editar</span><span className="objdel" onClick={() => del(o.id)}>Borrar</span></div>
      </div>
    )
  }
  return (
    <div className="pane">
      <div className="panehead"><h1>Objetivos</h1><span className="panesub">KPIs personales y de tus empresas, por horizonte</span><button className="mbtn" style={{ flex: "0 0 auto", padding: "8px 14px", marginLeft: "auto" }} onClick={() => setEdit({})}>+ Nuevo</button></div>
      <div className="panebody">
        {loading ? <div className="center" style={{ height: 160 }}><div className="spin" /></div> : (<>
          {OBJ_HZ.map(([k, lbl]) => { const g = objs.filter((o) => (o.horizon || "otros") === k); return g.length ? <div key={k}><div className="rsec">{lbl}</div>{g.map(row)}</div> : null })}
          {!objs.length ? <div className="center" style={{ height: 120, color: "var(--muted)" }}>Todavía no cargaste objetivos.</div> : null}
          <button className="mbtn ghost" style={{ width: "100%", marginTop: 14 }} onClick={doSuggest} disabled={sugBusy}>{sugBusy ? "Jarvis está pensando…" : "✦ Que Jarvis sugiera objetivos"}</button>
        </>)}
      </div>
      {edit && <ObjetivoEditor obj={edit} comps={comps} onSave={save} onClose={() => setEdit(null)} />}
      {sug && (
        <div className="modalbg" onClick={() => setSug(null)}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
          <h3>Sugerencias de Jarvis</h3><p className="modalsub">Tocá para agregar los que te sirvan.</p>
          {sug.length ? sug.map((o, i) => (
            <div key={i} className="sendopt spread" onClick={() => addSug(o)}><div><div className="sok" style={{ color: "var(--ink)", fontWeight: 700 }}>{o.title}</div><div className="sot" style={{ fontSize: 12, color: "var(--muted)" }}>{o.scope || "personal"} · meta {o.target || ""} {o.unit || ""}</div></div><span style={{ color: "var(--accent)", fontSize: 20 }}>+</span></div>
          )) : <div className="modalsub">No pude generar sugerencias ahora.</div>}
          <div className="modalrow" style={{ marginTop: 12 }}><button className="mbtn ghost" onClick={() => setSug(null)}>Cerrar</button></div>
        </div></div>
      )}
    </div>
  )
}

// ── JARVIS: chat "preguntale al cerebro" (IA reactiva). POST /api/ask. Voz vía STT (mismo backend que el dictado). ──
function Jarvis({ onHome }: { onHome: () => void }) {
  const [, force] = useState(0)
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; mime: string } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scroll = () => setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, 60)
  useEffect(() => { scroll() }, [])
  const ask = async (text?: string) => {
    const qq = (text || q).trim(); if (!qq || busy) return
    jarvisHistory.push({ role: "me", text: qq }); setQ(""); force((n) => n + 1); setBusy(true); scroll()
    const r = await askBrain(qq).catch(() => null); setBusy(false)
    jarvisHistory.push({ role: "ai", text: (r && (r.answer || r.text || r.reply)) || "No pude responder ahora." }); force((n) => n + 1); scroll()
  }
  const startVoice = async () => {
    if (recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm"
      const rec = new MediaRecorder(stream, { mimeType: mime }); const chunks: Blob[] = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setRecording(false); recRef.current = null
        const b64 = await blobToB64(new Blob(chunks, { type: mime })).catch(() => "")
        if (!b64) return
        setBusy(true); const r = await sttB64(b64, mime.split(";")[0]).catch(() => null); setBusy(false)
        const t = (r?.text || "").trim(); if (t) ask(t); else alert("No pude entender el audio.")
      }
      recRef.current = { rec, chunks, mime }; rec.start(); setRecording(true)
    } catch { alert("Necesito permiso de micrófono.") }
  }
  const stopVoice = () => recRef.current?.rec.stop()
  return (
    <div className="pane">
      <div className="panehead"><h1>🧠 Jarvis</h1><span className="panesub">Vos preguntás, él busca en tus datos · privado en tu server</span><button className="mbtn ghost" style={{ marginLeft: "auto" }} onClick={onHome}>‹ Inicio</button></div>
      <div className="jvbody" ref={bodyRef}>
        {!jarvisHistory.length ? <div className="center" style={{ color: "var(--muted)", textAlign: "center", padding: 30 }}>Preguntame lo que quieras sobre tus mensajes, gente, reuniones…<br /><br />Ej: "¿quién me debe plata?", "resumime lo de la empresa X"</div>
          : jarvisHistory.map((m, i) => <div key={i} className={"jvmsg " + (m.role === "me" ? "me" : "ai")}><Linkified text={m.text} /></div>)}
        {busy ? <div className="jvmsg ai"><span style={{ color: "var(--muted)" }}>pensando…</span></div> : null}
      </div>
      <div className="jvcompose">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask() }} placeholder="Pregúntale a Jarvis…" />
        <button className={"clip" + (recording ? " rec" : "")} data-tip={recording ? "Detener y transcribir" : "Hablar con Jarvis"} onClick={() => recording ? stopVoice() : startVoice()} style={{ color: recording ? "#e2483d" : "var(--accent)" }}>{recording ? "⏹" : "🎤"}</button>
        <button className="send" onClick={() => ask()} disabled={!q.trim()}>➤</button>
      </div>
    </div>
  )
}

// ── ESPACIOS: crear/editar agrupaciones por reglas (email/dominio/teléfono/nombre) + excepciones + subespacios. /api/espacios · /api/espacio* ──
const RULE_ICON: Record<string, string> = { email: "✉️", domain: "🌐", phone: "📱", name: "👤" }
const RULE_TYPES: [string, string][] = [["email", "Correo"], ["domain", "Dominio"], ["phone", "Teléfono"], ["name", "Nombre"]]
const RULE_PH: Record<string, string> = { email: "profesor@colegio.edu.pe", domain: "colegio.edu.pe", phone: "51999888777", name: "Nombre exacto del contacto" }
const ruleText = (r: any) => `${RULE_ICON[r.type] || "•"} ${r.type === "domain" ? "*@" + r.value : r.value}`
function EspacioForm({ title, sub, onSubmit, onClose, isRule }: { title: string; sub: string; onSubmit: (type: string, value: string) => void; onClose: () => void; isRule: boolean }) {
  const [type, setType] = useState("email"); const [value, setValue] = useState("")
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>{title}</h3><p className="modalsub">{sub}</p>
      <div className="modalrow" style={{ flexWrap: "wrap", marginBottom: 10 }}>{RULE_TYPES.map(([t, l]) => <button key={t} className={"mbtn" + (type === t ? "" : " ghost")} style={{ flex: 1, padding: "8px 4px", fontSize: 12 }} onClick={() => setType(t)}>{RULE_ICON[t]} {l}</button>)}</div>
      <input className="modalinput" placeholder={RULE_PH[type]} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className="modalrow"><button className="mbtn" onClick={() => value.trim() && onSubmit(type, value.trim())}>{isRule ? "Agregar regla" : "Agregar excepción"}</button><button className="mbtn ghost" onClick={onClose}>Cancelar</button></div>
    </div></div>
  )
}
function EspacioCreate({ parent, onCreate, onClose }: { parent: string | null; onCreate: (name: string, icon: string) => void; onClose: () => void }) {
  const [name, setName] = useState(""); const [icon, setIcon] = useState("")
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
      <h3>{parent ? "Nuevo subespacio" : "Nuevo espacio"}</h3>
      <input className="modalinput" placeholder="Nombre (ej: Trabajo, Familia, Clientes)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input className="modalinput" placeholder="Emoji (opcional, ej: 🎓)" value={icon} onChange={(e) => setIcon(e.target.value)} />
      <div className="modalrow"><button className="mbtn" onClick={() => name.trim() && onCreate(name.trim(), icon.trim())}>Crear</button><button className="mbtn ghost" onClick={onClose}>Cancelar</button></div>
    </div></div>
  )
}
function Espacios({ onOpen }: { onOpen: (k: string, n?: string) => void }) {
  const [list, setList] = useState<any[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null); const [dLoading, setDLoading] = useState(false)
  const [modal, setModal] = useState<any>(null) // {kind:"new"|"sub"|"rule"|"exc", parent?}
  const loadList = () => getEspacios().then((l) => setList(l || [])).catch(() => setList([]))
  const loadDetail = (id: string) => { setDLoading(true); getEspacioView(id).then((d) => setDetail(d || {})).catch(() => setDetail({})).finally(() => setDLoading(false)) }
  useEffect(() => { loadList() }, [])
  useEffect(() => { if (openId) loadDetail(openId) }, [openId])
  const createEsp = async (name: string, icon: string, parent: string | null) => { setModal(null); await saveEspacio({ name, icon, parent }).catch(() => {}); if (parent && openId) loadDetail(openId); else loadList() }
  const addRule = async (type: string, value: string) => { if (!openId) return; setModal(null); const r = await addEspacioRule(openId, type, value).catch(() => null); if (r && r.error) alert(r.error); loadDetail(openId) }
  const addExc = async (type: string, value: string) => { if (!openId) return; setModal(null); const r = await addEspacioException(openId, type, value).catch(() => null); if (r && r.error) alert(r.error); loadDetail(openId) }
  const delRule = async (idx: number) => { if (!openId) return; await delEspacioRule(openId, idx).catch(() => {}); loadDetail(openId) }
  const delExc = async (idx: number) => { if (!openId) return; await delEspacioException(openId, idx).catch(() => {}); loadDetail(openId) }

  if (openId) {
    const d = detail || {}
    return (
      <div className="pane">
        <div className="panehead"><button className="mbtn ghost" onClick={() => { setOpenId(null); setDetail(null) }}>‹ Espacios</button><h1 style={{ fontSize: 18 }}>{d.icon || "◆"} {d.name || "Espacio"}</h1><span className="panesub">{d.count || 0} mensajes</span></div>
        {dLoading && !detail ? <div className="center" style={{ height: 160 }}><div className="spin" /></div> : (
          <div className="panebody">
            <div className="spread" style={{ marginBottom: 8 }}><b>Reglas</b><button className="mbtn" style={{ flex: "0 0 auto", padding: "6px 12px" }} onClick={() => setModal({ kind: "rule" })}>+ Regla</button></div>
            <div className="panesub" style={{ marginBottom: 10 }}>Quién entra a este espacio: por correo, dominio (<b>*@colegio.edu.pe</b>), teléfono o nombre.</div>
            <div className="chiprow">{(d.rules || []).length ? d.rules.map((r: any, i: number) => <span key={i} className="espchip">{ruleText(r)}<span onClick={() => delRule(i)} className="espx">✕</span></span>) : <span className="panesub">Todavía sin reglas.</span>}</div>
            <div className="spread" style={{ margin: "18px 0 8px" }}><b>Excepciones</b><button className="mbtn ghost" style={{ flex: "0 0 auto", padding: "6px 12px" }} onClick={() => setModal({ kind: "exc" })}>+ Excepción</button></div>
            <div className="panesub" style={{ marginBottom: 10 }}>Quién queda <b>afuera</b> aunque cumpla una regla.</div>
            <div className="chiprow">{(d.exceptions || []).length ? d.exceptions.map((r: any, i: number) => <span key={i} className="espchip exc">🚫 {ruleText(r)}<span onClick={() => delExc(i)} className="espx">✕</span></span>) : <span className="panesub">Sin excepciones.</span>}</div>
            {(d.children || []).length ? <><div className="rsec">Subespacios</div>{d.children.map((c: any) => <div key={c.id} className="rcard" onClick={() => setOpenId(c.id)}><div className="objscope" style={{ background: "var(--panel2)" }}>{c.icon || "◆"}</div><div className="rcbody"><div className="rcname">{c.name}</div><div className="rctext">{c.members} regla{c.members === 1 ? "" : "s"}</div></div></div>)}</> : null}
            <div className="rsec">Mensajes recientes</div>
            {(d.recent || []).length ? d.recent.map((m: any, i: number) => (
              <div key={i} className={"rcard" + (m.thread ? "" : " col")} onClick={() => m.thread && onOpen(m.thread, m.name)}><Avatar name={m.name || "?"} size={34} /><div className="rcbody"><div className="rcname">{m.name || "—"} <span style={{ color: "var(--muted2)", fontWeight: 400, fontSize: 11 }}>· {ago(m.ts)}</span></div><div className="rctext">{m.dir === "out" ? "→ " : ""}{m.text}</div></div></div>
            )) : <div className="panesub">Sin mensajes que matcheen las reglas todavía.</div>}
            <button className="mbtn ghost" style={{ width: "100%", marginTop: 16 }} onClick={() => setModal({ kind: "sub" })}>+ Subespacio</button>
          </div>
        )}
        {modal?.kind === "rule" && <EspacioForm isRule title="Nueva regla" sub="Los mensajes que matcheen entran al espacio." onSubmit={addRule} onClose={() => setModal(null)} />}
        {modal?.kind === "exc" && <EspacioForm isRule={false} title="Nueva excepción" sub="Lo que matchee queda AFUERA del espacio." onSubmit={addExc} onClose={() => setModal(null)} />}
        {modal?.kind === "sub" && <EspacioCreate parent={openId} onCreate={(n, ic) => createEsp(n, ic, openId)} onClose={() => setModal(null)} />}
      </div>
    )
  }
  const roots = (list || []).filter((e) => !e.parent)
  return (
    <div className="pane">
      <div className="panehead"><h1>Espacios</h1><span className="panesub">Agrupá contactos por reglas — cada espacio aparece como un contacto en tu bandeja</span><button className="mbtn" style={{ flex: "0 0 auto", padding: "8px 14px", marginLeft: "auto" }} onClick={() => setModal({ kind: "new" })}>+ Nuevo</button></div>
      <div className="panebody">
        {list == null ? <div className="center" style={{ height: 160 }}><div className="spin" /></div>
          : roots.length ? roots.map((e) => <div key={e.id} className="rcard" onClick={() => setOpenId(e.id)}><div className="objscope" style={{ background: "var(--panel2)", fontSize: 18 }}>{e.icon || "◆"}</div><div className="rcbody"><div className="rcname" style={{ fontSize: 15 }}>{e.name}</div><div className="rctext">Espacio · {(e.members || []).length} personas</div></div><span style={{ color: "var(--muted2)" }}>›</span></div>)
          : <div className="center" style={{ height: 120, color: "var(--muted)" }}>Todavía no creaste espacios.</div>}
      </div>
      {modal?.kind === "new" && <EspacioCreate parent={null} onCreate={(n, ic) => createEsp(n, ic, null)} onClose={() => setModal(null)} />}
    </div>
  )
}

// ── DETALLE DE REUNIÓN (modal): asistentes/RSVP + unirse + objetivo + preparación. GET /api/meeting?id= (paridad con web viewMeeting). ──
function MeetingModal({ id, onClose, onOpenConv, onOpenPerson }: { id: string; onClose: () => void; onOpenConv: (k: string, n?: string) => void; onOpenPerson: (n: string) => void }) {
  const [m, setM] = useState<any>(null); const [loading, setLoading] = useState(true)
  useEffect(() => { getMeeting(id).then((x) => setM(x || {})).catch(() => setM({})).finally(() => setLoading(false)) }, [id])
  const stIcon = (s: string) => s === "yes" ? <span className="att-st ok">✓</span> : s === "no" ? <span className="att-st no">✕</span> : s === "maybe" ? <span className="att-st may">?</span> : null
  const c = m?.color || "#6366f1"
  const att = m?.attendees || [], conf = att.filter((a: any) => a.status === "yes").length
  const dur = m?.durationMin ? (m.durationMin >= 60 ? (m.durationMin / 60).toFixed(m.durationMin % 60 ? 1 : 0) + " h" : m.durationMin + " min") : ""
  const meetLabel = /meet/i.test(m?.url || "") ? "Google Meet" : /teams/i.test(m?.url || "") ? "Microsoft Teams" : /zoom/i.test(m?.url || "") ? "Zoom" : "la reunión"
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto", padding: 0 }}>
      {loading ? <div className="center" style={{ height: 160 }}><div className="spin" /></div> : (<>
        <div className="mtg-hero" style={{ background: `linear-gradient(135deg,${c},${c}dd)` }}>
          <div className="spread"><button className="mtg-back" onClick={onClose}>✕</button>{m.url ? <a className="mtg-hero-ic" onClick={(e) => { e.preventDefault(); openExternal(m.url) }}>📹</a> : null}</div>
          <div className="mtg-tags">{m.objetivo ? <span className="mtg-tag hi">🎯 {(m.objetivo.title || "").slice(0, 24)}</span> : null}<span className="mtg-tag">{m.catLabel || "Evento"}</span></div>
          <h1 className="mtg-title">{m.title || "Reunión"}</h1>
          <div className="mtg-when">🕐 {m.dayLabel || ""}{m.t1 ? " · " + m.t1 : ""}{m.t2 ? "–" + m.t2 : ""}{dur ? " · " + dur : ""}</div>
        </div>
        <div style={{ padding: 16 }}>
          {m.url ? <a className="mtg-join" onClick={(e) => { e.preventDefault(); openExternal(m.url) }}>📹 Unirse a {meetLabel}</a> : null}
          {m.objetivo ? (
            <div className="mtg-card"><div className="spread"><div className="hb-eyebrow" style={{ margin: 0 }}>◈ Aporta a este objetivo</div><span style={{ fontWeight: 800, color: "var(--accent-ink)" }}>{m.objetivo.pct || 0}%</span></div>
              <div style={{ fontWeight: 700, margin: "6px 0" }}>{m.objetivo.title || ""}</div><div className="objbar"><i style={{ width: (m.objetivo.pct || 0) + "%", background: "var(--accent)" }} /></div>
              <div className="mtg-2"><div><div className="mtg-kv-l">Avance</div><div className="mtg-kv-v">{m.objetivo.current || 0}/{m.objetivo.target || 0}{m.objetivo.unit ? " " + m.objetivo.unit : ""}</div></div><div><div className="mtg-kv-l">Ámbito</div><div className="mtg-kv-v">{m.objetivo.scope || "—"}</div></div></div></div>
          ) : null}
          {m.prep ? <div className="mtg-card"><div className="hb-eyebrow">✦ Preparación</div><div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{m.prep}</div>{(m.linked || []).length ? <div className="modalrow" style={{ marginTop: 10 }}>{m.linked.slice(0, 2).map((l: any, i: number) => <button key={i} className="mbtn ghost" onClick={() => onOpenConv(l.thread || "", (l.from || "").split(" ")[0])}>{(l.from || "hilo").split(" ")[0]} ›</button>)}</div> : null}</div> : null}
          {m.desc ? <div className="mtg-card"><div className="hb-eyebrow">Descripción</div><div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{m.desc}</div>{(m.attachments || []).map((f: any, i: number) => <div key={i} className="mtg-file">📄 {f.name || f}{f.size ? <span style={{ marginLeft: "auto", color: "var(--muted2)" }}>{f.size}</span> : null}</div>)}</div> : null}
          {att.length ? (
            <div className="mtg-card"><div className="spread" style={{ marginBottom: 10 }}><div className="hb-eyebrow" style={{ margin: 0 }}>Asistentes · {att.length}</div>{conf ? <span className="att-conf">{conf} confirmado{conf === 1 ? "" : "s"}</span> : null}</div>
              {att.map((a: any, i: number) => (
                <div key={i} className="att-row" onClick={() => a.name && onOpenPerson(a.name)}>
                  <div className="att-av"><Avatar name={a.name || "?"} size={34} />{stIcon(a.status)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="att-name">{a.name || "—"}{a.role ? <span className="att-role"> · {a.role}</span> : null}</div>{a.email ? <div className="att-sub">{a.email}</div> : null}</div>
                  <span style={{ color: "var(--muted2)" }}>›</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </>)}
    </div></div>
  )
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
