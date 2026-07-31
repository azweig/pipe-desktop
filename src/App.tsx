import { useEffect, useState, useCallback, useRef } from "react"
import type { ChangeEvent, UIEvent } from "react"
import { authStatus, login, setBase, getBase, getThreads, getThread, getThreadDelta, getThreadBefore, getThreadSync, getPerson, searchContent, routerSearch, getCoach, coachAction, getNotesDigest, getNotes, getNotesChat, notesChat, noteAction, hubImage, hubOpenFile, getTargets, sendMsg, setPin, setArchive, setSilence, logout, getAutopilot, setAutopilot, autopilotFeedback, getAutopilotPolicy, setAutopilotPolicy, correctText, summarizeThread, getSchedule, createSchedule, sttB64, sendAudioB64, sendMediaB64, sendStickerB64, blobToB64, getCovert, setCovert, openExternal, summarizeMedia, readFileB64, importWhatsAppB64, importWhatsAppZipB64, getHubConfig, getAccounts, addEmailAccount, removeEmailAccount, getLlmConfig, testLlm, saveLlm, getNotifPrefs, saveNotifPrefs, isDesktopApp, Thread, Msg } from "./api"
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
function Bubble({ m, onFeedback }: { m: Msg; onFeedback?: (m: Msg) => void }) {
  const out = m.dir === "out"
  const [reveal, setReveal] = useState(false) // modo encubierto: ver la tapadera original (lo que ve WhatsApp)
  const hasMedia = m.media && /^(image|audio|video|sticker)$/.test(m.mediaType || "")
  const isFile = m.mediaType === "file" && !!m.media
  const fileName = (m as any).filename || (m.text && !PLACEHOLDER.test(m.text) ? m.text : "") || "Documento"
  const caption = m.text && !PLACEHOLDER.test(m.text) ? m.text : ""
  return (
    <div className={"bubble " + (out ? "out" : "in")}>
      {m.covert ? (
        <>
          <Linkified text={reveal ? (m.text || "") : m.covert.text} />
          <div className="covertbadge" onClick={() => setReveal((v) => !v)} title="Modo encubierto — lo que ve WhatsApp es la tapadera">🕊️ {reveal ? "ver descifrado" : "descifrado · ver original"}</div>
        </>
      ) : hasMedia ? <MediaView id={m.id} path={m.media!} kind={m.mediaType!} /> : isFile ? <FileCard path={m.media!} filename={fileName} /> : (m.text ? <Linkified text={m.text} /> : (m.mediaType === "file" ? "📄 Documento" : ""))}
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
  const [pane, setPane] = useState<"mensajes" | "calendario" | "radar" | "notas" | "contactos">("mensajes") // vista del rail
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
    // 📅 ¿está hablando de agendar? — SOLO en chats (no en email): el detector de reuniones es para conversación de chat, no correo.
    const isEmailThread = /^email:/i.test(t.key) || (!!(t.channels || []).length && (t.channels || []).every((c) => c === "email"))
    if (!isEmailThread) getSchedule(t.key).then((r) => { if (r && r.found) setSched(r) }).catch(() => {})
    getCovert(t.key).then((c) => setThreadCovert(c?.enabled ? (c.style || "poema") : null)).catch(() => {}) // 🕊️ ¿este contacto tiene modo encubierto?
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
        <button className={"tipright" + (pane === "mensajes" ? " on" : "")} onClick={() => setPane("mensajes")} data-tip="Mensajes">💬</button>
        <button className={"tipright" + (pane === "calendario" ? " on" : "")} onClick={() => setPane("calendario")} data-tip="Calendario">🗓</button>
        <button className={"tipright" + (pane === "radar" ? " on" : "")} onClick={() => setPane("radar")} data-tip="Radar">✦</button>
        <button className={"tipright" + (pane === "notas" ? " on" : "")} onClick={() => setPane("notas")} data-tip="Notas">📄</button>
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

      {pane === "calendario" ? <Calendar onOpenContact={(name) => {
        const nn = name.trim().toLowerCase()
        const t = threads.find((x) => (x.name || "").trim().toLowerCase() === nn) || threads.find((x) => (x.name || "").toLowerCase().includes(nn.split(" ")[0]))
        setPane("mensajes"); if (t) open(t)
      }} />
      : pane === "radar" ? <Radar onOpen={openByKey} onDraft={openWithDraft} />
      : pane === "notas" ? <Notas />
      : pane === "contactos" ? <Contactos threads={threads} onOpen={openByKey} />
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
              : <Messages key={sel.key} msgs={msgs} onFeedback={(m) => setModal({ fb: m.id, original: m.text || "" })} />}
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
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} onOpenAutopilot={() => setModal("appolicy")} onToast={(m: string) => setToast(m)} />}
      {undoArchive && <div className="toast"><span>🗄 Archivaste <b>{undoArchive.name}</b></span><button onClick={doUndoArchive}>Deshacer</button></div>}
      {toast && <div className="toast"><span>{toast}</span></div>}
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
      </>)}
    </div></div>
  )
}
// ⚙️ Configuración: canales/cuentas · motor de IA (BYOK) · notificaciones. Mismos endpoints que web/mobile.
const AI_PROV: [string, string][] = [["openai", "OpenAI"], ["anthropic", "Anthropic (Claude)"], ["gemini", "Google Gemini"]]
const PLABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", ollama: "Ollama (local)", gestionado: "GPU box (gestionado)" }
function SettingsModal({ onClose, onOpenAutopilot, onToast }: { onClose: () => void; onOpenAutopilot: () => void; onToast: (m: string) => void }) {
  const [tab, setTab] = useState<"canales" | "ia" | "notif">("canales")
  const [hub, setHub] = useState<any>(null)
  const [accts, setAccts] = useState<any>({ email: [] })
  const [llm, setLlm] = useState<any>(null)
  const [notif, setNotif] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [em, setEm] = useState({ name: "", user: "", pass: "" }); const [showEmail, setShowEmail] = useState(false)
  const [key, setKey] = useState({ provider: "openai", name: "", token: "", test: "" }); const [showKey, setShowKey] = useState(false)

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
        {([["canales", "📥 Canales"], ["ia", "🤖 IA"], ["notif", "🔔 Avisos"]] as [string, string][]).map(([id, l]) =>
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

const RENDER_CAP = 200 // solo renderizamos las últimas N burbujas: un hilo de miles (email/grupo) NO explota el DOM ni congela la app
function Messages({ msgs, onFeedback }: { msgs: Msg[]; onFeedback?: (m: Msg) => void }) {
  const [cap, setCap] = useState(RENDER_CAP)
  if (!msgs.length) return <div className="center">Sin mensajes</div>
  const overflow = msgs.length > cap
  const shown = overflow ? msgs.slice(msgs.length - cap) : msgs // las MÁS NUEVAS (el resto queda tras el botón "ver anteriores")
  const out: JSX.Element[] = []
  let lastCh = ""
  if (overflow) out.push(<div key="cap" className="loadolder" onClick={() => setCap((c) => c + RENDER_CAP)}>▲ Ver {msgs.length - cap} mensajes anteriores</div>)
  shown.forEach((m, i) => {
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
  const src = useHubMedia(path)
  if (!src) return null
  return <img className="ntcimg" src={src} alt="" />
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
function Notas() {
  const [mode, setMode] = useState<"feed" | "chat">("feed")
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
  const loadList = async (c: string, s: string) => { const nl = await getNotes(c, s).catch(() => null); if (nl) { setItems(nl.items || []); if (nl.categories) setCats(nl.categories); if (nl.junk != null) setJunk(nl.junk) } }
  useEffect(() => {
    Promise.all([getNotesDigest().catch(() => ({})), getNotesChat().catch(() => ({}))]).then(([dg, ch]: any[]) => { setDig(dg || {}); setChat((ch && ch.history) || []) })
    loadList("all", "active").finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadList(cat, status) }, [cat, status])
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
      <div className="panehead"><h1>Notas</h1><div className="ntmodes"><button className={mode === "feed" ? "on" : ""} onClick={() => setMode("feed")}>📝 Notas</button><button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")}>💬 Preguntar</button></div></div>
      {mode === "feed" ? (
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
function Contactos({ threads, onOpen }: { threads: Thread[]; onOpen: (key: string, name?: string, photo?: string) => void }) {
  const [q, setQ] = useState("")
  const [selName, setSelName] = useState<string | null>(null)
  const [p, setP] = useState<any>(null)
  const [pLoading, setPLoading] = useState(false)
  const people = threads
    .filter((t) => t.key !== "self" && !((t as any).espacio) && t.bucket !== "spam")
    .filter((t) => { const nq = q.trim().toLowerCase(); if (!nq) return true; return (`${t.name || ""} ${t.email || ""} ${t.key || ""}`).toLowerCase().includes(nq) })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"))
  const selThread = threads.find((t) => t.name === selName)
  const openProfile = (t: Thread) => { setSelName(t.name); setP(null); setPLoading(true); getPerson(t.name).then((r) => setP(r || {})).catch(() => setP({})).finally(() => setPLoading(false)) }
  return (
    <div className="ctdir">
      <div className="ctlist">
        <div className="search" style={{ margin: "0 0 10px" }}><span style={{ opacity: .6 }}>🔎</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto…" />{q ? <span onClick={() => setQ("")} style={{ cursor: "pointer", opacity: .6 }}>✕</span> : null}</div>
        <div className="ctcount">{people.length} contactos</div>
        {people.map((t) => (
          <div key={t.key} className={"ctrow" + (selName === t.name ? " on" : "")} onClick={() => openProfile(t)}>
            <Avatar name={t.name} photo={t.photo} size={38} />
            <div className="ctmid"><div className="ctname">{t.name}</div><div className="ctsub">{(t.channels || []).map((c) => CH[c]?.label || c).join(" · ") || (t.group ? "Grupo" : "")}</div></div>
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
            <button className="mbtn" style={{ marginTop: 14 }} onClick={() => onOpen((p?.canon || selThread?.key || selName), selName || undefined, selThread?.photo)}>💬 Abrir conversación</button>
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
          </div>
        )}
      </div>
    </div>
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
