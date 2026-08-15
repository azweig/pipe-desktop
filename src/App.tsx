import { useEffect, useState, useCallback, useRef, Fragment } from "react"
import type { ChangeEvent, UIEvent, ReactNode } from "react"
import { currentLang, setLang, LANGS, LANG_NAMES, type Lang } from "./i18n"
import { nuevaConversacion, canalesNuevaConv, getOnboarding, authStatus, login, setBase, getBase, getThreads, searchThreads, getThread, getThreadDelta, markSeen, getThreadBefore, getThreadSync, getEmailBody, getPerson, getDirectory, searchContent, routerSearch, getCoach, coachAction, getNotesDigest, getNotes, getNotesChat, notesChat, noteAction, getNotesClips, clipPin, clipArchive, mergeContacts, hubImage, hubOpenFile, getTargets, sendMsg, setPin, setArchive, setSilence, logout, getAutopilot, setAutopilot, autopilotFeedback, getAutopilotPolicy, setAutopilotPolicy, correctText, summarizeThread, getSchedule, createSchedule, sttB64, sendAudioB64, sendMediaB64, sendStickerB64, blobToB64, getCovert, setCovert, openExternal, summarizeMedia, readFileB64, importWhatsAppB64, importWhatsAppZipB64, getHubConfig, getAccounts, getSignatures, saveSignature, getAssistant, setAssistant, tryAssistant, addEmailAccount, removeEmailAccount, getLlmConfig, testLlm, saveLlm, getNotifPrefs, saveNotifPrefs, getWaStatus, getStatus, getChannelsCatalog, ChannelDef, getMatrixLogins, getIntegrations, setSlack, removeSlack, setSignal, removeSignal, matrixLink, matrixStatus, matrixQrImage, matrixLinkToken, telegramStatus, telegramStart, telegramCode, telegramPassword, telegramConnected, getHome, getHomeAudio, askBrain, replyDraft, actionDone, getObjetivos, getCompanies, saveObjetivo, deleteObjetivo, suggestObjetivos, getEspacios, getEspacioView, saveEspacio, addEspacioRule, delEspacioRule, addEspacioException, delEspacioException, getMeeting, getApifyAccounts, addApifyAccount, removeApifyAccount, setApifyActors, getContactSocial, setContactLinks, investigateContact, getCouncil, setCouncil, getTrainCard, getVoiceProfile, buildVoiceProfile, isDesktopApp, Thread, Msg, ApifyAccount, SocialLinks, ContactSocial , Council, TrainCard, VoiceProfile } from "./api"
import { suggestReply } from "./api"
// 🔒 CUENTAS SECRETAS: token en memoria (api.ts), estado del 2º PIN, y wrappers de los endpoints
import { getSecretToken, setSecretToken, setSecretPinSet, getSecretStatus, secretSetup, secretUnlock, secretLock, getSecretState, secretSetWa, secretSetAccount } from "./api"
import { chooseAndSendMedia, b64ToBlob, mimeFromName } from "./media"
import { cacheLoad, cacheSave, cachePurge } from "./cache"
import Calendar from "./Calendar"
// Pure display helpers (colorOf/initials/hhmm/fmtDur/ago) live in ./lib/format so they can be unit-tested.
import { colorOf, initials, hhmm, fmtDur, ago } from "./lib/format"

const CH: Record<string, { c: string; label: string }> = {
  whatsapp: { c: "var(--wa)", label: "WhatsApp" }, teams: { c: "var(--teams)", label: "Teams" },
  email: { c: "var(--gmail)", label: "Gmail" }, telegram: { c: "var(--tg)", label: "Telegram" },
  slack: { c: "#611f69", label: "Slack" }, signal: { c: "#3a76f0", label: "Signal" }, meeting: { c: "var(--accent)", label: "Reunión" },
}
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
function Bubble({ m, isGroup, onFeedback, onOpenSender }: { m: Msg; isGroup?: boolean; onFeedback?: (m: Msg) => void; onOpenSender?: (name: string) => void }) {
  const out = m.dir === "out"
  const [reveal, setReveal] = useState(false) // modo encubierto: ver la tapadera original (lo que ve WhatsApp)
  const hasMedia = m.media && /^(image|audio|video|sticker)$/.test(m.mediaType || "")
  const isFile = m.mediaType === "file" && !!m.media
  const fileName = (m as any).filename || (m.text && !PLACEHOLDER.test(m.text) ? m.text : "") || "Documento"
  const caption = m.text && !PLACEHOLDER.test(m.text) ? m.text : ""
  return (
    <div className={"bubble " + (out ? "out" : "in") + (m.secret ? " secret" : "")}>
      {/* en GRUPOS: quién mandó cada mensaje entrante (como cualquier chat grupal), con color por nombre. No en 1:1 ni en salientes.
          Clickeable → abre el 1:1 con esa persona (para responderle aparte del grupo). */}
      {!out && isGroup && m.name ? (
        <div
          className={"bsender" + (onOpenSender ? " clickable" : "")}
          style={{ color: colorOf(m.name) }}
          onClick={onOpenSender ? () => onOpenSender(m.name as string) : undefined}
          title={onOpenSender ? `Abrir chat con ${m.name}` : undefined}
        >{m.name}</div>
      ) : null}
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

type Pane = "home" | "mensajes" | "calendario" | "radar" | "objetivos" | "jarvis" | "notas" | "espacios" | "contactos" | "entrena"
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
  const [tgtCh, setTgtCh] = useState<string | null>(null) // canal elegido a mano (ej. "Responder" desde un email) — pisa el default
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
  const [remoteHits, setRemoteHits] = useState<Thread[]>([]) // resultados del SERVER: contactos fuera de la ventana cargada
  const [msgHits, setMsgHits] = useState<any[]>([])          // resultados del buscador CONTEXTUAL (dentro de los mensajes)
  const [aiRes, setAiRes] = useState<any>(null)              // 🤖 resultado del buscador con IA (router-search: ⚡ facetas / 🧠 RAG)
  const [syncMsg, setSyncMsg] = useState("")                 // indicador del sync de texto completo ("Guardando historial…")
  const [toast, setToast] = useState("")                     // aviso efímero de éxito (se va solo)
  const [avatarMenu, setAvatarMenu] = useState(false)        // menú del avatar (AZ) abajo-izquierda: Configuración / Cerrar sesión
  // 🔒 CUENTAS SECRETAS — token en api.ts (memoria); acá el reflejo de UI + estado de cuentas marcadas
  const [secretUnlocked, setSecretUnlocked] = useState(false)                          // ¿hay sesión secreta abierta ahora? (token presente)
  const [secretState, setSecretState] = useState<{ accounts: { channel: string; account: string }[]; numbers: string[] } | null>(null)
  const [pinPrompt, setPinPrompt] = useState<{ title: string; sub: string } | null>(null) // hoja de PIN (crear/ingresar)
  const secretPinSetRef = useRef(false)                      // ¿hay 2º PIN configurado? (gate para NO cachear en local) — ref para leer fresco en callbacks
  const secretIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null)   // timer de 5 min inactivo → bloquea
  const secretBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // debounce de 6s al perder foco
  const secretUnlockedAtRef = useRef(0)                      // cuándo desbloqueaste (gracia de 1 min contra popups que roban el foco)
  const selRef = useRef<Thread | null>(null)                 // hilo abierto (para re-pintar al bloquear/desbloquear sin closures viejos)
  const pinResolveRef = useRef<((v: string | null) => void) | null>(null)    // resuelve la promesa del prompt de PIN
  const secretLockFnRef = useRef<() => void>(() => {})       // doSecretLock estable para los listeners del effect []-deps
  const resetSecretIdleRef = useRef<() => void>(() => {})    // resetSecretIdle estable para los listeners de actividad

  useEffect(() => {
    if (!getBase()) { setAuthed(false); return } // sin hub configurado → login (con campo de hub)
    authStatus().then((s) => setAuthed(!!s.authed)).catch(() => setAuthed(false))
  }, [])
  useEffect(() => {
    if (!authed) return
    const cached = localStorage.getItem("pipe_threads") // la bandeja del último arranque → aparece al instante
    if (cached && !secretPinSetRef.current) { try { setThreads(JSON.parse(cached)) } catch {} } // 🔒 con 2º PIN: no mostrar cache (puede tener previews ocultos)
    getThreads().then((d) => {
      const arr = Array.isArray(d) ? d : d.threads || []
      setThreads(arr); saveThreadsCache(arr)
      setTimeout(() => fullTextSync(arr), 4000) // arranca el backfill de texto completo unos segundos después (UI primero)
    }).catch(() => {})
  }, [authed])
  // 🔒 al arrancar: ¿hay 2º PIN configurado? → modo "no cachear en local" + PURGAR lo que haya quedado (de cuando estaban visibles)
  useEffect(() => {
    if (!authed) return
    getSecretStatus().then((s) => {
      if (s && s.pinSet) {
        secretPinSetRef.current = true; setSecretPinSet(true)
        cachePurge().catch(() => {})
        try { localStorage.removeItem("pipe_threads") } catch {}
      }
    }).catch(() => {})
  }, [authed])

  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; t0: number; ai: boolean } | null>(null)
  const composerRef = useRef<HTMLInputElement>(null) // para enfocar el compositor al tocar "Responder" en el visor de email
  const fileRef = useRef<HTMLInputElement>(null)
  const stickerRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false) // 🖼️ overlay al arrastrar archivos a la conversación
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
  useEffect(() => { selRef.current = sel }, [sel]) // 🔒 hilo abierto accesible desde los handlers de bloqueo (sin closures viejos)
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

  // 🔒 persistir la bandeja SOLO si no hay 2º PIN (un preview de una línea oculta no debe quedar en disco)
  const saveThreadsCache = (arr: Thread[]) => { if (secretPinSetRef.current) return; try { localStorage.setItem("pipe_threads", JSON.stringify(arr)) } catch {} }
  const refreshThreads = () => getThreads().then((d) => { const arr = Array.isArray(d) ? d : d.threads || []; setThreads(arr); saveThreadsCache(arr) }).catch(() => {})
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
    if (secretPinSetRef.current) return // 🔒 con 2º PIN no se archiva nada en local (cacheSave es no-op igual) → evita churn de red inútil
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

  // El botón "＋ Nuevo" existía pero no hacía NADA: sólo se podía responderle a quien ya te había escrito.
  // Va en un modal propio y NO en prompt()/alert(): el traductor de esta app trabaja observando el DOM (ver i18n.ts),
  // así que el texto de un prompt del navegador se quedaría en español en las demás lenguas. Y el mensaje de error lo
  // pone el hub ("ese es tu propio número", "falta el código de país"): tragárselo con un texto genérico era perder
  // justo la parte útil.
  // Checklist de primer arranque, igual que en la web. Esta app NO puede conectar cuentas (no tiene los flujos de QR ni
  // de contraseña de aplicación), así que muestra QUÉ falta y manda a la web del hub a resolverlo. Ocultarlo del todo
  // era peor: el usuario de escritorio no se enteraba de que le faltaba conectar el correo.
  const [onb, setOnb] = useState<any>(null)
  const cargarOnb = useCallback(() => { getOnboarding().then(setOnb).catch(() => setOnb(null)) }, [])
  useEffect(() => { if (!authed) return; cargarOnb(); const id = setInterval(cargarOnb, 120000); return () => clearInterval(id) }, [authed, cargarOnb])

  const [nuevoChat, setNuevoChat] = useState(false)
  const [destino, setDestino] = useState("")
  const [destErr, setDestErr] = useState("")
  const [canales, setCanales] = useState<any[]>([])
  const [canal, setCanal] = useState("")
  useEffect(() => {
    if (!nuevoChat) return
    canalesNuevaConv().then((r: any) => {
      const cs = r?.channels || []
      setCanales(cs)
      // si el canal que quedó elegido de una vez anterior ya no está (se desconectó), volver al default: si no, el
      // selector mostraba "Teléfono o correo" y se seguía mandando el canal viejo.
      setCanal((c) => (cs.some((x: any) => x.id === c) ? c : ""))
    }).catch(() => { setCanales([]); setCanal("") })
  }, [nuevoChat])
  const abrirNuevoChat = useCallback(async () => {
    const v = destino.trim()
    if (!v) { setDestErr("Escribí un teléfono, un correo o un usuario."); return }
    setDestErr("")
    try {
      const r: any = await nuevaConversacion(v, canal)
      if (!r || r.error) { setDestErr(r?.error || "No pude resolver ese destino."); return }
      setNuevoChat(false); setDestino("")
      open({ key: r.key, name: r.name, lastChannel: r.channel } as Thread)
    } catch (e: any) { setDestErr(e?.message || "No pude resolver ese destino.") } // j() TIRA con el mensaje del hub
  }, [destino, canal])

  const open = useCallback(async (t: Thread) => {
    // reabrir el MISMO hilo hace poco → reusamos su contexto (persona/targets/agenda/encubierto) en vez de re-pedirlo
    const cx = ctxCacheRef.current.get(t.key)
    const freshCx = !!cx && Date.now() - cx.t < 60000
    setSel(t); setShowCtx(false); setDraft(""); setTgtCh(null); setThreadAuto(false); setThreadErr(""); setSumCard(""); setCovertOn(false); setHasMore(false); setOldestTs(0)
    setPerson(freshCx ? cx!.person : null); setTargets(freshCx ? cx!.targets : []); setSched(freshCx ? cx!.sched : null); setThreadCovert(freshCx ? cx!.covert : null)
    // 1) LOCAL primero (IndexedDB) → los mensajes viejos aparecen al instante, sin re-descargar
    // 🔒 con 2º PIN NO uso la cache local: traigo fresco del server (que filtra las líneas ocultas cuando está bloqueado). El server es la única fuente de verdad.
    const local = secretPinSetRef.current ? { items: [] as Msg[], meta: null as any } : await cacheLoad(t.key)
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
  // abrir el 1:1 de un MIEMBRO de un grupo por su NOMBRE (click en el remitente de una burbuja o en la lista de miembros).
  // Los mensajes de grupo no traen la clave del remitente, así que resolvemos por nombre:
  //  1) match instantáneo contra tus hilos abiertos (barato),
  //  2) si no, se lo pedimos al server (getPerson) que resuelve alias/canónicos sobre 600 hilos → devuelve la clave del 1:1 real,
  //  3) si esa persona SOLO aparece en grupos (sin chat 1:1), lo decimos claro en vez de dejar una búsqueda vacía.
  const openByName = useCallback(async (name: string) => {
    const nm = (name || "").trim()
    if (!nm) return
    setPane("mensajes")
    const nn = nm.toLowerCase()
    const local = threads.find((x) => (x.name || "").trim().toLowerCase() === nn)
    if (local) { open(local); return }
    setToast(`Abriendo chat con ${nm}…`)
    const p: any = await getPerson(nm).catch(() => null)
    // pending=true → el server NO encontró un hilo REAL con esa persona: o solo aparece en grupos, o su chat está
    // guardado bajo otra identidad sin fusionar (ej. un apodo ≠ el nombre completo). NO abrimos un hilo vacío: avisamos.
    // La clave de un DM de WhatsApp es el nombre canónico, así que con pending=false abrimos por p.key || p.canon.
    const key = (p && !p.pending) ? (p.key || p.canon) : ""
    if (key) { openByKey(key, p.name || nm, p.photo); setToast("") }
    else setToast(`No encontré un chat 1:1 con ${nm} — puede estar guardado con otro nombre o solo aparecer en grupos`)
  }, [threads, open, openByKey])

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
      setThreads(arr); saveThreadsCache(arr)
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

  // POLL DE LA CONVERSACIÓN ABIERTA. El desktop no tenía ninguno: sólo refrescaba el hilo al abrirlo o después de enviar, así que
  // un mensaje que llegaba mientras lo mirabas NO aparecía (parecía que "faltaban mensajes"), y la tarjeta de 📅 agendar —que se
  // consulta una sola vez al abrir— nunca salía si el tema de la reunión surgía después. Web y mobile sí refrescan; esto empareja.
  useEffect(() => {
    const key = sel?.key
    if (!key || !authed) return
    let stop = false
    const tick = async () => {
      if (stop || document.hidden) return
      try {
        const d = await getThread(key)
        if (stop || selRef.current?.key !== key) return // cambiaste de hilo mientras tanto
        const incoming = d.items || []
        if (incoming.length) {
          setMsgs((cur) => {
            const byId = new Map<string, Msg>()
            for (const it of cur) byId.set(it.id, it)
            let changed = false
            for (const it of incoming) { if (!byId.has(it.id)) changed = true; byId.set(it.id, it) }
            if (!changed) return cur // sin novedades → no re-render (evita parpadeo)
            return [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0))
          })
          cacheSave(key, incoming, { maxRev: d.maxRev || 0 })
        }
      } catch { /* red caída: el próximo tick reintenta */ }
      // 📅 el detector de agenda mira los últimos mensajes → hay que re-preguntarlo, no sólo al abrir
      const isEmail = /^email:/i.test(key)
      if (!isEmail) {
        try { const r = await getSchedule(key); if (!stop && selRef.current?.key === key) setSched(r && r.found ? r : null) } catch { /* idem */ }
      }
    }
    const id = setInterval(tick, 8000)
    return () => { stop = true; clearInterval(id) }
  }, [sel?.key, authed])

  const target = () => (tgtCh && targets.find((x) => x.channel === tgtCh)) || targets.find((x) => x.isDefault) || targets[0]
  const doSend = async (txt: string, covert = false) => {
    if (!txt.trim() || !sel) return
    const tg = target()
    // en encubierto la burbuja muestra tu texto REAL (+ badge); WhatsApp ve la tapadera que devuelve el server
    const optId = "opt-" + Date.now()
    setMsgs((cur) => [...cur, { id: optId, dir: "out", text: txt, ts: Date.now(), channel: tg?.channel, ...(covert ? { covert: { text: txt, style: threadCovert || "poema" } } : {}) }]) // optimista
    // El server contesta {error} con HTTP 200. Antes se ignoraba la respuesta y se recargaba el hilo: la burbuja optimista
    // desaparecía sin explicación y el mensaje NUNCA había salido — el síntoma era "lo mando y no se ve". Ahora el fallo se dice.
    let r: any = null
    try { r = await sendMsg(sel.key, txt, tg, covert) } catch (e: any) { r = { error: e?.message || "sin conexión con el hub" } }
    if (r?.error) {
      setMsgs((cur) => cur.filter((m) => m.id !== optId))
      setDraft((d) => d || txt) // no te comas el texto: vuelve al compositor para reintentar
      alert("No se pudo enviar: " + r.error)
      return
    }
    await reloadThread(sel.key)
  }
  // corrector ✨: si está activo, muestro las 3 opciones (tal cual / corregido / mejorado); si no, mando tal cual.
  // NO borro el draft hasta tener la hoja abierta → si el corrector falla o cancelás, el texto NUNCA se pierde.
  const onSend = async () => {
    const txt = draft.trim(); if (!txt || !sel) return
    if (covertOn) { setDraft(""); return doSend(txt, true) } // encubierto: cifrado directo, sin corrector
    if (!correctOn) { setDraft(""); return doSend(txt) }
    setBusy("correct")
    const c = await correctText(txt, target()?.channel, sel?.key).catch(() => null)
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
          const c = await correctText(t, target()?.channel, sel?.key).catch(() => null)
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

  // envía UN blob de media (con burbuja optimista) — lo usan el picker 📎, el collage/recorte y el arrastrar
  const sendMediaBlob = async (blob: Blob, mime: string, name: string) => {
    if (!sel) return
    const kind = /^image\//.test(mime) ? "image" : /^video\//.test(mime) ? "video" : "file"
    setMsgs((cur) => [...cur, { id: "opt-" + Date.now() + "-" + name, dir: "out", text: kind === "file" ? "📄 " + name : "", ts: Date.now(), channel: target()?.channel, mediaType: kind }])
    const b64 = await blobToB64(blob).catch(() => "")
    if (b64) await sendMediaB64(sel.key, b64, mime || "application/octet-stream", name, target()).catch(() => alert("No se pudo enviar " + name))
  }
  // 📎 adjuntar — ahora pasa por el selector: 2+ fotos → collage o por separado; 1 foto → recortar; videos/mixto → directo (paridad con mobile/web)
  const onAttach = () => fileRef.current?.click()
  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])]; e.target.value = ""; if (!files.length || !sel) return
    setBusy("attach")
    const items = files.map((f) => ({ blob: f as Blob, mime: f.type || mimeFromName(f.name), name: f.name }))
    await chooseAndSendMedia(items, sendMediaBlob, { channelIsEmail: target()?.channel === "email" })
    setBusy(""); await reloadThread(sel.key)
  }
  // 🖼️ ARRASTRAR archivos a la conversación (drag-drop nativo de Tauri → da PATHS; los leo en Rust con readFileB64). Solo en el escritorio.
  useEffect(() => {
    if (!isDesktopApp || !sel || sel.key === "self") return
    let un: (() => void) | undefined, cancelled = false
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(async (ev: any) => {
        const p = ev?.payload || {}
        if (p.type === "enter" || p.type === "over") setDragOver(true)
        else if (p.type === "leave") setDragOver(false)
        else if (p.type === "drop") {
          setDragOver(false)
          const paths: string[] = p.paths || []
          setBusy("attach")
          const items = [] as { blob: Blob; mime: string; name: string }[]
          for (const path of paths) {
            const b64 = await readFileB64(path).catch(() => "")
            if (!b64) continue
            const name = path.split(/[\\/]/).pop() || "archivo"
            const mime = mimeFromName(name)
            items.push({ blob: b64ToBlob(b64, mime), mime, name })
          }
          if (items.length) await chooseAndSendMedia(items, sendMediaBlob, { channelIsEmail: target()?.channel === "email" })
          setBusy(""); await reloadThread(sel.key)
        }
      }).then((u: any) => { if (cancelled) u(); else un = u })
    }).catch(() => {})
    return () => { cancelled = true; setDragOver(false); if (un) un() }
  }, [sel?.key])
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
    // El hub devuelve {secret:true} cuando el hilo toca una línea oculta y el 2º PIN está puesto: NO es que falte
    // conversación, es que no se puede leer. Decirlo, en vez de mentir con "no hay suficiente".
    if (r?.secret) { setSumCard("🔒 Esta conversación incluye una línea oculta por tu 2º PIN. Desbloqueá con el botón PIN para poder resumirla.") ; return }
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

  // ══════════ 🔒 CUENTAS SECRETAS — desbloqueo/creación del 2º PIN, gestor de cuentas, out-of-focus lock ══════════
  // prompt de PIN (crear/ingresar): promesa que resuelve con el valor tipeado o null si cancela
  const askPin = (title: string, sub: string) => new Promise<string | null>((resolve) => { pinResolveRef.current = resolve; setPinPrompt({ title, sub }) })
  const closePin = (v: string | null) => { setPinPrompt(null); const r = pinResolveRef.current; pinResolveRef.current = null; if (r) r(v) }
  // estado de cuentas/números marcados como secretos (solo con token; el server responde 403 si está bloqueado)
  const loadSecretState = async () => {
    if (!getSecretToken()) { setSecretState(null); return null }
    const s = await getSecretState().catch(() => null)
    setSecretState(s || null); return s
  }
  const resetSecretIdle = () => {
    if (!getSecretToken()) return
    if (secretIdleRef.current) clearTimeout(secretIdleRef.current)
    secretIdleRef.current = setTimeout(() => secretLockFnRef.current(), 5 * 60000) // 5 min inactivo en foco → bloquea
  }
  function doSecretLock() {
    if (!getSecretToken()) return
    setSecretToken(null); setSecretUnlocked(false); setSecretState(null)
    if (secretIdleRef.current) { clearTimeout(secretIdleRef.current); secretIdleRef.current = null }
    secretLock().catch(() => {})     // cierra la sesión en el server
    cachePurge().catch(() => {})     // borra cualquier rastro cacheado
    setRemoteHits([])                // 🔒 lo que trajo el buscador estando DESBLOQUEADO puede incluir hilos secretos
    refreshThreads()                 // la bandeja se re-pide (el server ya no incluye lo oculto)
    const s = selRef.current; if (s) open(s) // re-pinta el hilo abierto (fresco del server, sin lo oculto) — no te expulsa
  }
  const doSecretUnlock = async () => {
    const st = await getSecretStatus().catch(() => null); if (!st) return
    if (!st.pinSet) { // primera vez: crear el 2º PIN (distinto del de entrada)
      const p1 = await askPin("Creá tu PIN", "6-12 dígitos, distinto al de entrada."); if (!p1) return
      const r = await secretSetup(p1).catch(() => ({ error: "error" } as any)); if (r && r.error) { setToast(r.error); return }
    }
    const pin = await askPin("PIN", "Ingresá tu PIN"); if (!pin) return
    const r = await secretUnlock(pin).catch(() => null) // 401 en PIN incorrecto → j() tira → null
    if (!r || r.error || !r.token) { setToast((r && r.error) || "PIN incorrecto"); return }
    setSecretToken(r.token); setSecretUnlocked(true)
    secretPinSetRef.current = true; setSecretPinSet(true)
    secretUnlockedAtRef.current = Date.now(); resetSecretIdle()
    const state = await loadSecretState()
    refreshThreads(); const s = selRef.current; if (s) open(s) // re-pinta con el token → aparecen las cuentas ocultas
    const marked = ((state?.numbers || []).length) + ((state?.accounts || []).length)
    if (!marked) setModal("secret") // todavía no ocultaste ninguna cuenta → abrí el gestor para elegir cuál
  }
  const secretToggle = () => { getSecretToken() ? doSecretLock() : doSecretUnlock() }
  secretLockFnRef.current = doSecretLock
  resetSecretIdleRef.current = resetSecretIdle
  // 🔒 OUT-OF-FOCUS: bloquear al SALIR de la app. document.hasFocus() evita bloquear cuando el foco va a un iframe INTERNO (visor de email).
  // Gracia de 1 min desde el desbloqueo (popups del SO roban el foco justo después y NO deben bloquear) + debounce de 6s (si el foco vuelve, se cancela).
  // pagehide (cerrar/refrescar) bloquea al toque. Además, 5 min de inactividad en foco bloquea.
  useEffect(() => {
    const schedule = () => {
      if (!getSecretToken() || Date.now() - secretUnlockedAtRef.current < 60000) return
      if (secretBlurTimerRef.current) clearTimeout(secretBlurTimerRef.current)
      secretBlurTimerRef.current = setTimeout(() => { if (!document.hasFocus() || document.hidden) secretLockFnRef.current() }, 6000)
    }
    const cancel = () => { if (secretBlurTimerRef.current) { clearTimeout(secretBlurTimerRef.current); secretBlurTimerRef.current = null } }
    const onBlur = () => { if (!document.hasFocus()) schedule() }
    const onVis = () => { document.hidden ? schedule() : cancel() }
    const onHide = () => secretLockFnRef.current()
    const onActivity = () => resetSecretIdleRef.current()
    window.addEventListener("blur", onBlur); window.addEventListener("focus", cancel)
    document.addEventListener("visibilitychange", onVis); window.addEventListener("pagehide", onHide)
    for (const ev of ["click", "keydown", "input"]) document.addEventListener(ev, onActivity, { passive: true } as any)
    return () => {
      window.removeEventListener("blur", onBlur); window.removeEventListener("focus", cancel)
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onHide)
      for (const ev of ["click", "keydown", "input"]) document.removeEventListener(ev, onActivity)
    }
  }, [])

  // La bandeja carga los N hilos más recientes. Con miles de conversaciones, buscar SOLO en lo cargado deja
  // afuera a cualquiera con quien no hablaste esta semana — parecía que el contacto no existía. Le preguntamos al
  // server, que busca sobre TODOS los hilos por índice (clave + nombre por FTS).
  useEffect(() => {
    const nqq = query.trim()
    if (nqq.length < 2) { setRemoteHits([]); return }
    let alive = true
    const id = setTimeout(() => { searchThreads(nqq).then((r) => { if (alive) setRemoteHits(Array.isArray(r) ? r : []) }).catch(() => {}) }, 220)
    return () => { alive = false; clearTimeout(id) }
  }, [query, secretUnlocked]) // secretUnlocked: al des/bloquear se rehace la búsqueda con el permiso vigente

  if (authed === null) return <div className="center"><div className="spin" /></div>
  if (!authed) return <Login onOk={() => setAuthed(true)} />

  // categoría del hilo — MISMA semántica que web/mobile (bucketCat): family→familia, amigos→amigos, resto→trabajo; spam/grupo fuera
  const isWork = (t: Thread) => !t.group && t.bucket !== "spam" && t.bucket !== "family" && t.bucket !== "amigos"
  const inCat = (t: Thread, id: string) => id === "familia" ? t.bucket === "family" : id === "amigos" ? t.bucket === "amigos" : id === "trabajo" ? isWork(t) : id === "silenciados" ? !!t.silenced : true
  const nq = query.trim().toLowerCase(), ndig = nq.replace(/\D/g, "")
  const matchQ = (t: Thread) => { const hay = `${t.name || ""} ${t.key || ""} ${t.email || ""} ${t.lastText || ""}`.toLowerCase(); return hay.includes(nq) || (ndig.length >= 3 && hay.replace(/\D/g, "").includes(ndig)) }
  const remoteKeys = new Set(remoteHits.map((r) => r.key))
  const pool = nq ? [...threads, ...remoteHits.filter((r) => !threads.some((t) => t.key === r.key))] : threads
  const list = pool.filter((t) => t.key !== "self" && !((t as any).espacio) && t.bucket !== "spam")
    // con búsqueda: ignora tab/categoría (busca en TODO); sin búsqueda: respeta tab
    // lo que vino del server ya matcheó allá (por clave o por nombre del remitente): no lo re-filtramos acá
    .filter((t) => nq ? (remoteKeys.has(t.key) || matchQ(t)) : nav === "sin" ? (t.lastDir !== "out" && (t.unseen || t.unread)) : nav === "grupos" ? t.group : nav === "prioritarios" ? t.pinned
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
        <button className={"tipright" + (pane === "entrena" ? " on" : "")} onClick={() => setPane("entrena")} data-tip="Entrená tu IA">🎓</button>
        <div className="spacer" />
        <button className="me tipright" data-tip="Cuenta y ajustes" onClick={() => setAvatarMenu((v) => !v)}>AZ</button>
      </div>

      {avatarMenu && (<>
        <div className="avmenu-bg" onClick={() => setAvatarMenu(false)} />
        <div className="avmenu">
          <button onClick={() => { setAvatarMenu(false); setModal("settings") }}><span>⚙️</span>Configuración</button>
          {/* idioma: el escritorio no tenía forma de cambiarlo (se creó sólo en español) */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13 }}>
            <span>🌐</span>
            <select
              aria-label="Idioma" value={currentLang()} onChange={(e) => setLang(e.target.value as Lang)}
              style={{ flex: 1, background: "var(--bg2, #f2f3f7)", color: "inherit", border: "1px solid var(--line, #e2e3ee)", borderRadius: 8, padding: "4px 6px", font: "inherit", cursor: "pointer" }}
            >
              {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </label>
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
      : pane === "entrena" ? <TrainDeck onToast={setToast} />

      : <>

      {/* sidebar */}
      <div className="side">
        <button className="newbtn" onClick={() => { setDestErr(""); setNuevoChat(true) }} title="Escribirle a alguien que todavía no te escribió">＋ Nuevo</button>
        <div className="search"><span style={{ opacity: .6 }}>🔎</span><input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setAiRes(null) }} onKeyDown={(e) => { if (e.key === "Enter") runAi() }} placeholder="Buscar — nombre, teléfono, email…" />{query ? <span onClick={() => { setQuery(""); setAiRes(null) }} style={{ cursor: "pointer", opacity: .6 }}>✕</span> : null}<button className="aibtn" data-tip="Preguntá a la IA — busca en TODO (⚡ facetas / 🧠 RAG)" onClick={runAi} disabled={!query.trim()}>🤖</button></div>
        {onb && !onb.listo ? (
          <div className="onbcard">
            <div className="onbhead"><b>Configurá tu hub</b><span>{onb.done}/{onb.total}</span></div>
            {onb.steps.map((s: any) => (
              <div key={s.id} className={"onbrow" + (s.ok ? " done" : "")}>
                <span>{s.ok ? "✓" : s.icon}</span>
                <span className="onbt">{s.title}</span>
              </div>
            ))}
            {/* openExternal (invoke open_url), como los otros links de esta app: un <a target="_blank"> no abre el
                navegador del sistema desde el WebView, y encima la CSP del Tauri bloquea navegar a otro origen. */}
            <a className="onbbtn" href={getBase()} onClick={(e) => { e.preventDefault(); openExternal(getBase()) }}>Configurar en la web ↗</a>
          </div>
        ) : null}
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
        <div className="lhead"><h2>{query.trim() ? "Resultados" : "Conversaciones"}</h2>
          {/* 🔒 CUENTAS SECRETAS: PIN (bloqueado) ↔ Ocultar (desbloqueado) */}
          <button onClick={secretToggle} title={secretUnlocked ? "Ocultar" : "Ingresá tu PIN"}
            style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 8, background: secretUnlocked ? "var(--accent)" : "var(--panel2)", color: secretUnlocked ? "#fff" : "var(--muted)" }}>
            {secretUnlocked ? "🔓 Ocultar" : "🔒 PIN"}
          </button>
        </div>
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
              <button data-tip={secretUnlocked ? "Ocultar (cuentas secretas)" : "Ingresá tu PIN (cuentas secretas)"} onClick={secretToggle} style={secretUnlocked ? { color: "var(--accent)" } : undefined}>{secretUnlocked ? "🔓" : "🔒"}</button>
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
              : <Messages key={sel.key} msgs={msgs} isGroup={!!sel.group} onFeedback={(m) => setModal({ fb: m.id, original: m.text || "" })} onOpenSender={openByName} onOpenEmail={(m) => setModal({ email: m })} />}
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
              <input ref={composerRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSend() } }} placeholder={covertOn ? "🕊️ Mensaje encubierto…" : busy === "correct" ? "Corrigiendo…" : recording ? (recAi ? "Grabando… (dictado)" : "Grabando nota de voz…") : "Escribí un mensaje…"} disabled={recording} />
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onFilePicked} />
              <input ref={stickerRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onStickerPicked} />
              {dragOver ? <div style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(18,18,28,.72)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#fff", fontSize: 21, fontWeight: 800, pointerEvents: "none", textAlign: "center" }}>📎 Soltá para adjuntar<span style={{ fontSize: 14, fontWeight: 500, opacity: .8, marginTop: 6 }}>varias fotos → collage · una → recortar</span></div> : null}
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
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><Avatar name={sel.name} photo={sel.photo || (person as any)?.photo} size={66} /></div>
          <div className="cname">{sel.name}</div>
          <div className="crole">{person?.role || (sel.channels || []).map((c) => CH[c]?.label || c).join(" · ")}</div>
          {((person as any)?.contacts?.phones || []).length > 0 ? <div className="crole" style={{ marginTop: 3 }}>📞 {(person as any).contacts.phones.map((n: string) => "+" + n).join(" · ")}</div> : null}
          <div className="cicons"><button>💬</button><button>✉️</button><button>📞</button><button>🗓</button></div>
          {/* Perfil bloqueado por el 2º PIN: el hub no puede mandar bio/temas porque se calculan sobre TODO el hilo, incluida
              la línea oculta. Antes esto se veía como un perfil vacío y parecía que Pipe no había cargado nada. */}
          {(person as any)?.secret && (<><div className="cgrp">🔒 Perfil oculto</div><div className="cbox">Este contacto incluye una línea protegida por tu 2º PIN. Desbloqueá con el botón <b>PIN</b> para ver su ficha y resumirlo.</div></>)}
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
            const members = [...new Set(msgs.filter((m) => m.dir !== "out" && m.name).map((m) => m.name as string))].sort((a, b) => a.localeCompare(b, "es"))
            return members.length ? (<>
              <div className="cgrp">Miembros del grupo · {members.length}</div>
              {members.slice(0, 60).map((nm, i) => (
                <div key={i} className="member" onClick={() => openByName(nm)} title={`Abrir chat con ${nm}`}>
                  <Avatar name={nm} size={26} />
                  <span className="mname">{nm}</span>
                </div>
              ))}
            </>) : null
          })()}
        </div>
      )}

      {/* empezar una conversación con alguien que todavía no te escribió */}
      {nuevoChat && (
        <div className="modalbg" onClick={() => setNuevoChat(false)}><div className="modalcard" onClick={(e) => e.stopPropagation()}>
          <h3>✎ Nueva conversación</h3>
          <p className="modalsub">Un teléfono con código de país (+51 999 111 222) o un correo. Si ya hablaste con esa persona, se abre la conversación que ya existe.</p>
          {canales.length > 1 ? (
            <select className="modalinput" value={canal} onChange={(e) => setCanal(e.target.value)}>
              {canales.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          ) : null}
          <input value={destino} autoFocus className="modalinput" placeholder={(canales.find((c: any) => c.id === canal) || {}).hint || "+51 999 111 222  ·  alguien@empresa.com"}
            onChange={(e) => { setDestino(e.target.value); setDestErr("") }}
            onKeyDown={(e) => { if (e.key === "Enter") abrirNuevoChat() }} />
          {destErr ? <p className="modalsub" style={{ color: "#e5484d" }}>{destErr}</p> : null}
          <div className="modalrow">
            <button className="mbtn ghost" onClick={() => setNuevoChat(false)}>Cancelar</button>
            <button className="mbtn" onClick={abrirNuevoChat}>Abrir conversación</button>
          </div>
        </div></div>
      )}
      {modal === "apcfg" && sel && <AutopilotModal sel={sel} onClose={() => setModal(null)} onSaved={(on: boolean) => { setThreadAuto(on); setModal(null); refreshThreads() }} />}
      {modal && modal.fb && sel && <FeedbackModal apkey={sel.key} original={modal.original} onClose={() => setModal(null)} />}
      {modal && modal.email && <EmailModal m={modal.email} onClose={() => setModal(null)} onReply={async (withAi: boolean) => {
        setModal(null); setTgtCh("email") // responder ese correo → el compositor apunta al canal email
        if (!withAi) return setTimeout(() => composerRef.current?.focus(), 60)
        if (!sel) return
        setToast("✨ Redactando una respuesta…")
        const r = await suggestReply(sel.key).catch(() => null)
        if (r?.draft) { setDraft(r.draft); setToast(""); setTimeout(() => composerRef.current?.focus(), 60) } else setToast("No pude redactar una respuesta ahora.")
      }} />}
      {sendOpts && <SendOptions opts={sendOpts} onPick={(t: string) => { setSendOpts(null); doSend(t) }} onClose={() => { setDraft(sendOpts.original || ""); setSendOpts(null) }} />}
      {modal === "covert" && sel && <CovertModal sel={sel} onClose={() => setModal(null)} onSaved={(style: string | null) => { setThreadCovert(style); if (!style) setCovertOn(false); setModal(null) }} />}
      {modal === "waimport" && <WhatsAppImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); refreshThreads() }} />}
      {modal === "appolicy" && <AutopilotPolicyModal onClose={() => setModal(null)} onSaved={(msg: string) => { setToast(msg); setModal(null) }} />}
      {undoArchive && <div className="toast"><span>🗄 Archivaste <b>{undoArchive.name}</b></span><button onClick={doUndoArchive}>Deshacer</button></div>}
      </>}

      {/* globales (visibles desde cualquier pane): configuración, detalle de reunión, avisos efímeros */}
      {modal === "settings" && <SettingsModal secretUnlocked={secretUnlocked} secretToggle={secretToggle} onClose={() => setModal(null)} onOpenAutopilot={() => { setPane("mensajes"); setModal("appolicy") }} onToast={(m: string) => setToast(m)} />}
      {/* 🔒 gestor de cuentas ocultas + prompt de PIN */}
      {modal === "secret" && <SecretManageModal onClose={() => setModal(null)} onLock={() => doSecretLock()} onReloadState={() => { loadSecretState() }} onToast={(m: string) => setToast(m)} />}
      {pinPrompt && <PinPromptModal title={pinPrompt.title} sub={pinPrompt.sub} onSubmit={(v: string) => closePin(v || null)} onCancel={() => closePin(null)} />}
      {meetingId && <MeetingModal id={meetingId} onClose={() => setMeetingId(null)} onOpenConv={(k, n) => { setMeetingId(null); openByKey(k, n) }} onOpenPerson={(n) => { setMeetingId(null); setPane("contactos"); void n }} />}
      {toast && <div className="toast"><span>{toast}</span></div>}
    </div>
  )
}

function AutopilotModal({ sel, onClose, onSaved }: { sel: Thread; onClose: () => void; onSaved: (on: boolean) => void }) {
  const [cfg, setCfg] = useState<any>(null)
  const [max, setMax] = useState("")
  useEffect(() => { getAutopilot(sel.key).then((c) => { setCfg(c); setMax(c.maxPerDay > 0 ? String(c.maxPerDay) : "") }).catch(() => setCfg({ enabled: false })) }, [sel.key])
  // El piloto RESPONDE EN TU NOMBRE: decir "desactivado" cuando la llamada falló es el peor error posible acá — creerías que
  // está apagado mientras sigue contestando. Por eso el estado solo cambia si el servidor confirmó.
  const save = async () => {
    const m = max.trim() ? Math.max(1, Math.min(500, parseInt(max, 10) || 0)) : 0
    try { await setAutopilot(sel.key, true, m) } catch (e: any) { alert("No se pudo activar el piloto: " + (e?.message || "error")); return }
    onSaved(true)
  }
  const disable = async () => {
    try { await setAutopilot(sel.key, false) } catch (e: any) { alert("No se pudo desactivar el piloto — seguí asumiendo que está ACTIVO: " + (e?.message || "error")); return }
    onSaved(false)
  }
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
// 🎓 ENTRENÁ TU IA — mazo de corrección: mensaje real + lo que tu IA respondería → aprobás (✓) o corregís (✍️). Cada corrección la entrena.
// 🗣️ TU VOZ: perfil auto-detectado (idiomas / dialecto-nacionalidad % / tono) de tus mensajes reales.
function VoiceCard() {
  const [v, setV] = useState<VoiceProfile | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { getVoiceProfile().then(setV).catch(() => {}) }, [])
  const build = async () => { setBusy(true); const r = await buildVoiceProfile().catch(() => null); setBusy(false); if (r && !r.error) setV(r) }
  const has = !!(v && (v.dialect || v.languages || v.summary))
  const COL = ["#6366f1", "#e0872b", "#22a06b", "#e2483d"]
  const bars = (arr?: { name: string; pct: number }[], cols = COL) => (arr || []).filter((x) => x.name).map((x, i) => {
    const p = Math.max(2, Math.min(100, x.pct || 0))
    return (<div key={i} style={{ margin: "6px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}><span>{x.name}</span><b>{p}%</b></div>
      <div style={{ height: 8, borderRadius: 6, background: "var(--panel2)", overflow: "hidden" }}><div style={{ height: "100%", width: p + "%", background: cols[i % cols.length], borderRadius: 6 }} /></div>
    </div>)
  })
  return (
    <div className="cbox" style={{ padding: 16, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🗣️ Tu voz</div>
      {has ? (<>
        {v!.summary ? <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 10 }}>{v!.summary}</div> : null}
        {(v!.dialect || []).length ? <><div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: .4, margin: "8px 0 2px" }}>DIALECTO / NACIONALIDAD</div>{bars(v!.dialect)}</> : null}
        {(v!.languages || []).length ? <><div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: .4, margin: "12px 0 2px" }}>IDIOMAS</div>{bars(v!.languages, ["#3b82f6", "#8b5cf6", "#22a06b"])}</> : null}
        {(v!.tone || []).length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>{v!.tone!.map((t, i) => <span key={i} className="ctchip">{t}</span>)}</div> : null}
      </>) : <div style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 10px" }}>La IA analiza tus mensajes y detecta tu tonalidad (idiomas, dialecto, tono).</div>}
      <button className={"mbtn" + (has ? " ghost" : "")} style={{ marginTop: 12 }} onClick={build} disabled={busy}>{busy ? "Analizando…" : has ? "🔄 Re-detectar" : "🗣️ Detectar mi voz"}</button>
    </div>
  )
}
function TrainDeck({ onToast }: { onToast: (m: string) => void }) {
  const [card, setCard] = useState<TrainCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [fix, setFix] = useState("")
  const [count, setCount] = useState(0)
  const next = async () => { setLoading(true); setEditing(false); const c = await getTrainCard().catch(() => ({ error: "x" } as TrainCard)); setCard(c); setFix(c.draft || ""); setLoading(false) }
  useEffect(() => { next() }, [])
  const ok = async () => { if (card?.key) await autopilotFeedback(card.key, true, "", card.draft || "").catch(() => {}); setCount((n) => n + 1); next() }
  const save = async () => { const t = fix.trim(); if (!t || !card?.key) return; await autopilotFeedback(card.key, false, t, card.draft || "").catch(() => {}); onToast("✓ Aprendido"); setCount((n) => n + 1); next() }
  return (
    <div className="ctprofile" style={{ maxWidth: 640, margin: "0 auto", padding: "26px 22px", overflowY: "auto" }}>
      <div className="ctpname" style={{ fontSize: 22 }}>🎓 Entrená tu IA</div>
      <div className="ctprole" style={{ marginBottom: 18 }}>Te muestro un mensaje real y lo que tu IA contestaría. Aprobalo o corregilo — así aprende tu estilo.</div>
      <VoiceCard />
      {loading ? <div className="center" style={{ height: 160 }}><div className="spin" /></div>
        : !card || card.error ? <div className="cbox">No se pudo cargar. <button className="mbtn ghost" style={{ marginLeft: 8 }} onClick={next}>Reintentar</button></div>
          : card.none ? <div className="cbox">No hay más mensajes para practicar por ahora — volvé más tarde.</div>
            : (<div className="cbox" style={{ padding: 16 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}><b>{card.name}</b> — así viene la charla:</div>
              {(card.context || []).map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.mine ? "flex-end" : "flex-start", margin: "3px 0" }}>
                  <span style={{ maxWidth: "82%", padding: "7px 11px", borderRadius: 13, fontSize: 13.5, background: m.mine ? "var(--accent)" : "var(--panel2)", color: m.mine ? "#fff" : "var(--ink)" }}>{m.text}</span>
                </div>))}
              <div style={{ display: "flex", justifyContent: "flex-start", margin: "4px 0" }}>
                <span style={{ maxWidth: "88%", padding: "8px 12px", borderRadius: 13, fontSize: 14, background: "var(--panel2)", color: "var(--ink)", border: "2px solid var(--accent)" }}>{card.incoming}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "15px 0 6px" }}>🤖 Tu IA respondería:</div>
              {editing ? <textarea value={fix} onChange={(e) => setFix(e.target.value)} autoFocus className="modalinput" style={{ minHeight: 64, width: "100%", boxSizing: "border-box" }} />
                : <div style={{ padding: "11px 13px", borderRadius: 12, background: "color-mix(in srgb, var(--accent) 9%, transparent)", fontSize: 14.5, minHeight: 20 }}>{card.draft || <span style={{ color: "var(--muted)" }}>(no pudo redactar — escribí cómo responderías vos)</span>}</div>}
              <div className="modalrow" style={{ marginTop: 13 }}>
                {editing ? <button className="mbtn" style={{ flex: 1 }} onClick={save} disabled={!fix.trim()}>💾 Guardar corrección</button>
                  : (<>
                    <button className="mbtn ghost" style={{ flex: 1 }} onClick={() => { setFix(card.draft || ""); setEditing(true) }}>✍️ Así lo diría yo</button>
                    <button className="mbtn" style={{ flex: 1 }} onClick={ok}>✓ Está bien</button>
                  </>)}
              </div>
              {!editing ? <button className="mbtn ghost" style={{ width: "100%", marginTop: 8 }} onClick={next}>⏭️ Saltar este</button> : null}
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>{count} {count === 1 ? "corregido" : "corregidos"} en esta sesión · cada uno entrena a tu IA 🧠</div>
            </div>)}
    </div>
  )
}
// ⚙️ Configuración: canales/cuentas · motor de IA (BYOK) · notificaciones. Mismos endpoints que web/mobile.
const AI_PROV: [string, string][] = [["openai", "OpenAI"], ["anthropic", "Anthropic (Claude)"], ["gemini", "Google Gemini"]]
const PLABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", ollama: "Ollama (local)", gestionado: "GPU box (gestionado)" }
// 🔒 GESTOR de cuentas ocultas: números de WhatsApp + cuentas de correo con un toggle. Toda la actividad de la marcada se oculta sin el PIN.
function SecretManageModal({ onClose, onLock, onReloadState, onToast }: { onClose: () => void; onLock: () => void; onReloadState: () => void; onToast: (m: string) => void }) {
  const [accts, setAccts] = useState<any>({ email: [], messaging: [] })
  const [state, setState] = useState<{ accounts: { channel: string; account: string }[]; numbers: string[] }>({ accounts: [], numbers: [] })
  const [loading, setLoading] = useState(true)
  const load = async () => {
    const [a, s] = await Promise.all([getAccounts().catch(() => ({} as any)), getSecretState().catch(() => ({ accounts: [], numbers: [] } as any))])
    setAccts(a || {}); setState((s as any) || { accounts: [], numbers: [] }); setLoading(false)
  }
  useEffect(() => { load() }, [])
  const isNumSecret = (n: string) => (state.numbers || []).includes(String(n).replace(/\D/g, ""))
  const isAcctSecret = (ch: string, ac: string) => (state.accounts || []).some((a) => a.channel === ch && a.account === ac)
  const mark = async (fn: () => Promise<any>, want: boolean) => {
    const r = await fn().catch(() => null)
    if (!r) { onToast("No se pudo guardar (¿conexión?). Reintentá."); return }
    if (r.error) { onToast(r.error === "bloqueado" ? "El PIN se cerró — ingresalo de nuevo." : r.error); return }
    await load(); onReloadState()
    if (want) { onClose(); onLock() } // marcaste una cuenta → esconder YA (la bandeja se bloquea y desaparece)
  }
  const toggleWa = (n: string) => { const want = !isNumSecret(n); mark(() => secretSetWa(n, want), want) }
  const toggleAcct = (ch: string, ac: string) => { const want = !isAcctSecret(ch, ac); mark(() => secretSetAccount(ch, ac, want), want) }
  const nums: string[] = accts?.messaging?.[0]?.numbers || []
  const emails: any[] = accts?.email || []
  const rowStyle = { display: "block", width: "100%", textAlign: "left" as const, marginBottom: 6, flex: "none" as const }
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard" onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto" }}>
      <h3>🔒 Cuentas ocultas</h3>
      <p className="modalsub">Marcá qué cuenta ocultar — toda su actividad se esconde sin el PIN.</p>
      {loading ? <div className="center" style={{ height: 80 }}><div className="spin" /></div> : (<>
        <div className="modallabel" style={{ marginTop: 4 }}>WhatsApp</div>
        {nums.length ? nums.map((n) => (
          <button key={n} className={"mbtn" + (isNumSecret(n) ? "" : " ghost")} onClick={() => toggleWa(n)} style={rowStyle}>
            {isNumSecret(n) ? "☑" : "☐"}  WhatsApp +{n}
          </button>
        )) : <div className="modalsub" style={{ marginBottom: 8 }}>—</div>}
        <div className="modallabel" style={{ marginTop: 12 }}>Correo</div>
        {emails.length ? emails.map((e) => (
          <button key={e.label} className={"mbtn" + (isAcctSecret("email", e.label) ? "" : " ghost")} onClick={() => toggleAcct("email", e.label)} style={rowStyle}>
            {isAcctSecret("email", e.label) ? "☑" : "☐"}  {e.name || e.user}
          </button>
        )) : <div className="modalsub" style={{ marginBottom: 8 }}>—</div>}
        <button className="mbtn" style={{ width: "100%", marginTop: 14 }} onClick={() => { onClose(); onLock() }}>Ocultar ahora</button>
      </>)}
    </div></div>
  )
}
// 🔒 hoja de PIN: crear o ingresar el 2º PIN. Enter envía; el valor vive solo en el input (nunca a disco).
function PinPromptModal({ title, sub, onSubmit, onCancel }: { title: string; sub: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState("")
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { const id = setTimeout(() => ref.current?.focus(), 60); return () => clearTimeout(id) }, [])
  const go = () => onSubmit(val.trim())
  return (
    <div className="modalbg" onClick={onCancel}><div className="modalcard" onClick={(e) => e.stopPropagation()} style={{ width: 340 }}>
      <h3>{title}</h3>
      <p className="modalsub">{sub}</p>
      <input ref={ref} type="password" inputMode="numeric" autoComplete="off" maxLength={12} placeholder="••••••"
        value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go() }}
        className="modalinput" style={{ fontSize: 20, letterSpacing: 5, textAlign: "center" }} />
      <div className="modalrow"><button className="mbtn" onClick={go}>Continuar</button></div>
    </div></div>
  )
}
// ── WhatsApp: vincular vía el bridge Matrix del server (QR o código por número), in-app ──
type Msg2 = { text: string; kind: "info" | "err" | "ok" } | null
const msgColor = (m: Msg2) => (!m ? undefined : m.kind === "err" ? "var(--danger)" : m.kind === "ok" ? "var(--ok)" : "var(--muted)")
// ── Vinculación vía bridge Matrix (WhatsApp / Instagram / Facebook / LinkedIn): QR o código por número ──
// Parametrizado por `net`: mismo flujo (matrixLink/matrixStatus/matrixQrImage) para todas las redes del bridge.
function WaLink({ onToast, onDone, net = "whatsapp", label = "WhatsApp", instr }: { onToast: (m: string) => void; onDone: () => void; net?: string; label?: string; instr?: ReactNode }) {
  const [phone, setPhone] = useState("")
  const [msg, setMsg] = useState<Msg2>(null)
  const [qr, setQr] = useState("")
  const [code, setCode] = useState("")
  const [started, setStarted] = useState(false)
  const [connected, setConnected] = useState(false)
  const doneRef = useRef(onDone); doneRef.current = onDone

  const start = async (byPhone: boolean) => {
    const v = byPhone ? phone.trim() : ""
    if (byPhone && !v) { setMsg({ text: "Poné el número primero, con código de país.", kind: "err" }); return }
    setMsg({ text: "Generando… puede tardar ~30s. No cierres esto.", kind: "info" }); setQr(""); setCode("")
    await matrixLink(net, v).catch(() => {})
    setStarted(true)
  }
  // poll de estado + refresco del QR cada ~3s (igual que la web)
  useEffect(() => {
    if (!started) return
    let alive = true, t: any
    const tick = async () => {
      const r = await matrixStatus(net).catch(() => null)
      if (!alive) return
      if (r?.connected) { setConnected(true); onToast("✓ ¡" + label + " conectado!"); setTimeout(() => doneRef.current(), 1400); return }
      setCode(r?.code || "")
      if (r?.qr) { const img = await matrixQrImage(net).catch(() => ""); if (alive && img) setQr(img) }
      if (alive) t = setTimeout(tick, 3000)
    }
    t = setTimeout(tick, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [started])

  return (
    <div className="setform">
      <div className="modalsub" style={{ marginBottom: 10 }}>{instr ?? <>En tu teléfono: WhatsApp → <b>Ajustes → Dispositivos vinculados → Vincular un dispositivo</b> → escaneá el QR (o poné el código).</>}</div>
      <input className="modalinput" placeholder="+51 999 000 000 (con código de país)" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
      <div className="modalrow"><button className="mbtn" onClick={() => start(true)}>Código por número</button><button className="mbtn ghost" style={{ flex: 1 }} onClick={() => start(false)}>QR</button></div>
      <div style={{ marginTop: 14, textAlign: "center", minHeight: 44 }}>
        {connected ? <b style={{ color: "var(--ok)" }}>✓ ¡{label} conectado!</b> : (<>
          {code ? <><div style={{ fontSize: 12, color: "var(--muted)" }}>En la app → Dispositivos vinculados → Vincular con número:</div><div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 5, color: "var(--accent)", margin: "10px 0" }}>{code}</div></> : null}
          {qr ? <img alt="QR" src={qr} style={{ width: 220, height: 220, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: 8 }} /> : null}
          {!code && !qr && msg ? <span style={{ fontSize: 12.5, color: msgColor(msg) }}>{msg.text}</span> : null}
        </>)}
      </div>
      <button className="setcancel" onClick={onDone}>Cerrar</button>
    </div>
  )
}
// ── Discord: vincula por TOKEN (su QR suele fallar) → /api/matrix-link-token, luego se pollea matrixStatus("discord") ──
function DiscordLink({ onToast, onDone, net = "discord", label = "Discord" }: { onToast: (m: string) => void; onDone: () => void; net?: string; label?: string }) {
  const [tok, setTok] = useState("")
  const [msg, setMsg] = useState<Msg2>(null)
  const [started, setStarted] = useState(false)
  const [connected, setConnected] = useState(false)
  const doneRef = useRef(onDone); doneRef.current = onDone

  const submit = async () => {
    const t = tok.trim()
    if (!t) { setMsg({ text: "Pegá el token primero.", kind: "err" }); return }
    setMsg({ text: "Vinculando…", kind: "info" })
    await matrixLinkToken(net, t).catch(() => {})
    setStarted(true)
  }
  // poll de estado cada ~3s hasta conectar (mismo patrón que WaLink)
  useEffect(() => {
    if (!started) return
    let alive = true, t: any
    const tick = async () => {
      const r = await matrixStatus(net).catch(() => null)
      if (!alive) return
      if (r?.connected) { setConnected(true); onToast("✓ ¡" + label + " conectado!"); setTimeout(() => doneRef.current(), 1400); return }
      if (alive) t = setTimeout(tick, 3000)
    }
    t = setTimeout(tick, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [started])

  return (
    <div className="setform">
      <div className="modalsub" style={{ marginBottom: 10 }}>El QR de {label} suele fallar. Lo confiable es tu <b>token</b>.</div>
      <details style={{ marginBottom: 10 }}>
        <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>🔑 ¿Cómo saco mi token?</summary>
        <ol style={{ paddingLeft: 20, fontSize: 12.5, lineHeight: 1.6, margin: "9px 0 0" }}>
          <li>Abrí <b>discord.com</b> en el navegador (logueado).</li>
          <li>Apretá <b>F12</b> → pestaña <b>Network</b>.</li>
          <li>Hacé cualquier acción; abrí un request y buscá el header <b>authorization</b>.</li>
          <li>Copiá ese valor y pegalo abajo.</li>
        </ol>
      </details>
      <textarea className="modalinput" rows={2} placeholder="Pegá tu token de Discord acá" value={tok} spellCheck={false} autoCapitalize="none" style={{ resize: "none" }} onChange={(e) => { setTok(e.target.value); setMsg(null) }} />
      <button className="mbtn" style={{ width: "100%" }} onClick={submit}>Vincular con token</button>
      <div style={{ marginTop: 12, textAlign: "center", minHeight: 30 }}>
        {connected ? <b style={{ color: "var(--ok)" }}>✓ ¡{label} conectado!</b> : (msg ? <span style={{ fontSize: 12.5, color: msgColor(msg) }}>{msg.text}</span> : null)}
      </div>
      <button className="setcancel" onClick={onDone}>Cerrar</button>
    </div>
  )
}
// ── Telegram self-service: teléfono → código → 2FA opcional (GramJS vía el server) ──
function TgLink({ configured, onToast, onDone }: { configured: boolean; onToast: (m: string) => void; onDone: () => void }) {
  const [stage, setStage] = useState<"phone" | "code" | "password">("phone")
  const [phone, setPhone] = useState(""); const [apiId, setApiId] = useState(""); const [apiHash, setApiHash] = useState("")
  const [code, setCode] = useState(""); const [pw, setPw] = useState("")
  const [msg, setMsg] = useState<Msg2>(null); const [busy, setBusy] = useState(false); const [polling, setPolling] = useState(false)
  const doneRef = useRef(onDone); doneRef.current = onDone
  const needApi = !configured

  const start = async () => {
    if (!phone.trim()) { setMsg({ text: "Poné tu teléfono con código de país.", kind: "err" }); return }
    setBusy(true); setMsg({ text: "Enviando código a tu Telegram…", kind: "info" })
    const r = await telegramStart({ phone: phone.trim(), apiId: apiId.trim(), apiHash: apiHash.trim() }).catch(() => null)
    setBusy(false)
    if (!r || r.error) { setMsg({ text: (r && r.error) || "No se pudo iniciar.", kind: "err" }); return }
    setMsg(null); setStage("code")
  }
  const submitCode = async () => {
    if (!code.trim()) { setMsg({ text: "Escribí el código.", kind: "err" }); return }
    setBusy(true); setMsg({ text: "Verificando…", kind: "info" }); await telegramCode(code.trim()).catch(() => {}); setBusy(false); setPolling(true)
  }
  const submitPw = async () => { setBusy(true); setMsg({ text: "Verificando…", kind: "info" }); await telegramPassword(pw).catch(() => {}); setBusy(false); setPolling(true) }
  useEffect(() => {
    if (!polling) return
    let alive = true, t: any
    const tick = async () => {
      const st = await telegramStatus().catch(() => null)
      if (!alive) return
      if (st?.connected) { setMsg({ text: "✓ ¡Telegram conectado!", kind: "ok" }); await telegramConnected().catch(() => {}); setTimeout(() => doneRef.current(), 1400); return }
      if (st?.stage === "password") { setPolling(false); setStage("password"); setMsg(null); return }
      if (st?.stage === "error") { setPolling(false); setMsg({ text: st.error || "Error en el login. Reintentá.", kind: "err" }); return }
      t = setTimeout(tick, 1500)
    }
    t = setTimeout(tick, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [polling])

  return (
    <div className="setform">
      {stage === "phone" && (<>
        <div className="modalsub" style={{ marginBottom: 10 }}>Poné tu teléfono; Telegram te manda un código a tu app para confirmar (solo lectura de tus chats).</div>
        {needApi ? (<>
          <div className="modalsub" style={{ marginBottom: 8 }}>Primera vez: sacá el <b>API ID</b> y <b>API Hash</b> en my.telegram.org → API development tools.</div>
          <input className="modalinput" placeholder="API ID (número)" value={apiId} inputMode="numeric" onChange={(e) => setApiId(e.target.value)} />
          <input className="modalinput" placeholder="API Hash" value={apiHash} spellCheck={false} onChange={(e) => setApiHash(e.target.value)} />
        </>) : null}
        <input className="modalinput" placeholder="+51 999 000 000 (con código de país)" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        <button className="mbtn" style={{ width: "100%" }} onClick={start} disabled={busy}>{busy ? "Enviando…" : "Enviar código"}</button>
      </>)}
      {stage === "code" && (<>
        <div className="modalsub" style={{ marginBottom: 10 }}>Telegram te mandó un código a tu <b>app</b> (no por SMS). Escribilo acá.</div>
        <input className="modalinput" style={{ textAlign: "center", fontSize: 22, letterSpacing: 6 }} placeholder="1 2 3 4 5" value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} />
        <button className="mbtn" style={{ width: "100%" }} onClick={submitCode} disabled={busy}>{busy ? "…" : "Confirmar"}</button>
      </>)}
      {stage === "password" && (<>
        <div className="modalsub" style={{ marginBottom: 10 }}>Tenés verificación en 2 pasos en Telegram. Poné tu contraseña de 2 pasos.</div>
        <input className="modalinput" type="password" placeholder="Contraseña de 2 pasos" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="mbtn" style={{ width: "100%" }} onClick={submitPw} disabled={busy}>{busy ? "…" : "Confirmar"}</button>
      </>)}
      {msg ? <div style={{ marginTop: 10, textAlign: "center", fontSize: 13.5, color: msgColor(msg) }}>{msg.text}</div> : null}
      <button className="setcancel" onClick={onDone}>Cerrar</button>
    </div>
  )
}
// ── Íconos/emoji por canal (CLIENTE): el catálogo del server trae label+brand; el emoji es cosmético y vive acá. ──
// Un canal FUTURO que el server agregue sin entrada acá cae al fallback: círculo con la inicial en color de marca.
const CH_EMOJI: Record<string, string> = {
  whatsapp: "📲", instagram: "📷", facebook: "🔵", linkedin: "🔗",
  telegram: "✈️", discord: "🎮", slack: "💼", signal: "🔒",
}
// Lista de RESPALDO si /api/channels/catalog falla: NO dejamos el panel vacío — se cae a lo que estaba hardcodeado.
const FALLBACK_CHANNELS: ChannelDef[] = [
  { id: "whatsapp", label: "WhatsApp", brand: "#25d366", kind: "messaging", connect: { method: "matrix-bridge", net: "whatsapp", multi: true }, canSend: true },
  { id: "instagram", label: "Instagram", brand: "#e1306c", kind: "messaging", connect: { method: "matrix-bridge", net: "instagram", multi: true }, canSend: true },
  { id: "facebook", label: "Facebook", brand: "#1877f2", kind: "messaging", connect: { method: "matrix-bridge", net: "facebook", multi: true }, canSend: true },
  { id: "linkedin", label: "LinkedIn", brand: "#0a66c2", kind: "messaging", connect: { method: "matrix-bridge", net: "linkedin", multi: true }, canSend: true },
  { id: "telegram", label: "Telegram", brand: "#229ed9", kind: "messaging", connect: { method: "telegram-login" }, canSend: true },
  { id: "discord", label: "Discord", brand: "#5865f2", kind: "messaging", connect: { method: "matrix-token", net: "discord", multi: true }, canSend: true },
  { id: "slack", label: "Slack", brand: "#611f69", kind: "messaging", connect: { method: "integration", provider: "slack" }, canSend: true },
  { id: "signal", label: "Signal", brand: "#3a76f0", kind: "messaging", connect: { method: "integration", provider: "signal" }, canSend: true },
]
// ── Sección "Mensajería" en Configuración → Canales. La LISTA viene del catálogo del server (registro de conectores);
//    los FLUJOS de conexión (WaLink/DiscordLink/TgLink/integraciones) NO cambian — solo cambia de dónde sale la lista. ──
function MessagingChannels({ onToast, secretUnlocked, secret, reloadSecret }: { onToast: (m: string) => void; secretUnlocked: boolean; secret: { accounts: { channel: string; account: string }[]; numbers: string[] }; reloadSecret: () => void | Promise<void> }) {
  const [channels, setChannels] = useState<ChannelDef[]>(FALLBACK_CHANNELS) // arranca con el respaldo → nunca panel vacío
  const [integ, setInteg] = useState<any>(null)
  const [waDown, setWaDown] = useState<string[]>([])
  const [tg, setTg] = useState<any>({})
  const [status, setStatus] = useState<any>(null) // /api/status — cuentas WhatsApp conectadas (autoritativo)
  const [logins, setLogins] = useState<Record<string, string[]>>({}) // cuentas conectadas por bridge (ig/fb/li/discord)
  const [open, setOpen] = useState<string | null>(null) // canal expandido (por ch.id)
  const [slkTok, setSlkTok] = useState(""); const [slkMsg, setSlkMsg] = useState<Msg2>(null); const [slkBusy, setSlkBusy] = useState(false)
  const [sgUrl, setSgUrl] = useState(""); const [sgNum, setSgNum] = useState(""); const [sgMsg, setSgMsg] = useState<Msg2>(null); const [sgBusy, setSgBusy] = useState(false)

  const reload = async () => {
    const [i, w, t, s] = await Promise.all([getIntegrations().catch(() => null), getWaStatus().catch(() => null), telegramStatus().catch(() => null), getStatus().catch(() => null)])
    if (i) setInteg(i); if (w) setWaDown(w.loggedOut || []); if (t) setTg(t); if (s) setStatus(s)
  }
  // cuentas conectadas de los bridges multi-cuenta. Los `net` salen del CATÁLOGO (bridge/token, menos whatsapp que usa /api/status).
  const reloadLogins = async () => {
    const nets = channels
      .filter((c) => (c.connect.method === "matrix-bridge" || c.connect.method === "matrix-token") && c.connect.net && c.connect.net !== "whatsapp")
      .map((c) => c.connect.net!)
    for (const net of nets) {
      const r = await getMatrixLogins(net, true).catch(() => null)
      if (r) setLogins((prev) => ({ ...prev, [net]: r.accounts || [] }))
    }
  }
  // catálogo del server = fuente de verdad de la LISTA. Si falla, queda el respaldo (resiliencia).
  useEffect(() => {
    let alive = true
    ;(async () => {
      const cat = await getChannelsCatalog().catch(() => null)
      if (alive && cat?.channels?.length) setChannels(cat.channels)
    })()
    return () => { alive = false }
  }, [])
  // al montar, al llegar el catálogo (cambia `channels`) y al desbloquear/bloquear el PIN → re-pedir estado + logins
  useEffect(() => { reload(); reloadLogins() }, [channels, secretUnlocked])
  const closePanel = () => { setOpen(null); reload(); reloadLogins() }

  const saveSlack = async () => {
    if (!slkTok.trim()) { setSlkMsg({ text: "Pegá el token primero.", kind: "err" }); return }
    setSlkBusy(true); setSlkMsg({ text: "Verificando con Slack…", kind: "info" })
    const r = await setSlack(slkTok.trim()).catch(() => null); setSlkBusy(false)
    if (!r || r.error) { setSlkMsg({ text: (r && r.error) || "No se pudo conectar.", kind: "err" }); return }
    onToast("✓ Slack conectado" + (r.team ? ` (${r.team})` : "")); setSlkTok(""); setSlkMsg(null); setOpen(null); reload()
  }
  // no cantar "desconectado" si el hub no lo confirmó: creerías que cortaste el acceso y seguiría conectado
  const disconnectSlack = async () => { try { await removeSlack() } catch (e: any) { onToast("No se pudo desconectar Slack: " + (e?.message || "error")); return } onToast("Slack desconectado"); reload() }
  const saveSignal = async () => {
    if (!sgUrl.trim() || !sgNum.trim()) { setSgMsg({ text: "Completá la URL y tu número.", kind: "err" }); return }
    setSgBusy(true); setSgMsg({ text: "Guardando…", kind: "info" })
    const r = await setSignal(sgUrl.trim(), sgNum.trim()).catch(() => null); setSgBusy(false)
    if (!r || r.error) { setSgMsg({ text: (r && r.error) || "No se pudo guardar.", kind: "err" }); return }
    onToast("✓ Signal conectado"); setSgUrl(""); setSgNum(""); setSgMsg(null); setOpen(null); reload()
  }
  const disconnectSignal = async () => { try { await removeSignal() } catch (e: any) { onToast("No se pudo desconectar Signal: " + (e?.message || "error")); return } onToast("Signal desconectado"); reload() }

  const slackOn = !!integ?.slack?.configured, signalOn = !!integ?.signal?.configured, tgOn = !!tg?.connected

  const row = (icon: ReactNode, name: string, sub: ReactNode, action: ReactNode) => (
    <div className="setrow">
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{name}</div><div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{sub}</div></div>
      {action}
    </div>
  )
  // ícono del canal: emoji del mapa cliente, o (canal desconocido) un círculo con la inicial en el color de marca del catálogo
  const iconFor = (ch: ChannelDef): ReactNode => {
    const e = CH_EMOJI[ch.id]
    if (e) return <span style={{ fontSize: 17 }}>{e}</span>
    const letter = String(ch.label || ch.id || "?").trim().charAt(0).toUpperCase()
    return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: ch.brand || "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 700, flex: "0 0 auto" }}>{letter}</span>
  }
  const linkBtn = (label: string, onClick: () => void) => <button onClick={onClick} style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12.5, flex: "0 0 auto" }}>{label}</button>
  const delBtn = (onClick: () => void) => <button onClick={onClick} style={{ color: "var(--danger)", fontSize: 12.5, fontWeight: 600, flex: "0 0 auto" }}>Desconectar</button>

  // ── Canales de bridge = MULTI-CUENTA: cada vinculación agrega otro número/cuenta ──
  const fmtAcct = (a: string) => { const s = String(a).replace(/^\+/, ""); return /^\d+$/.test(s) ? "+" + s : s }
  // WhatsApp: cuentas conectadas = bridge (Matrix) + baileys (directo)
  const waAccounts: string[] = [
    ...((status?.whatsapp?.bridge as string[]) || []),
    ...(((status?.whatsapp?.baileys as { acc?: string; num?: string }[]) || []).map((b) => b.num || b.acc || "")),
  ].filter(Boolean)
  // resumen "N conectada(s)" o neutro "Sin cuentas todavía" (las cuentas van como filas individuales debajo)
  const acctSub = (accounts: string[]): ReactNode =>
    accounts.length
      ? <span style={{ color: "var(--ok)" }}>{accounts.length} conectada{accounts.length > 1 ? "s" : ""}</span>
      : "Sin cuentas todavía"
  // ── 🔒 marcar una cuenta/número del bridge como secreta (mismo mecanismo que WhatsApp: secretSetWa) ──
  const digitsOnly = (n: string) => String(n).replace(/\D/g, "")
  const isAcctSecret = (n: string) => { const d = digitsOnly(n); return d ? (secret.numbers || []).includes(d) : (secret.numbers || []).includes(String(n)) }
  const toggleSecret = async (n: string) => {
    const want = !isAcctSecret(n)
    const r = await secretSetWa(n, want).catch(() => null)
    if (!r || (r as any).error) { onToast(((r as any) && (r as any).error) || "No se pudo guardar."); return }
    onToast(want ? "🔒 Marcada como secreta" : "Ya no es secreta")
    await reloadSecret(); reload(); reloadLogins()
  }
  // filas individuales por cuenta conectada (número). Con PIN desbloqueado, cada fila trae el toggle "🔒 secreta".
  const acctRows = (accounts: string[]) => accounts.map((a) => (
    <div key={a} className="setrow" style={{ paddingLeft: 40 }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{isAcctSecret(a) ? "🔒 " : ""}{fmtAcct(a)}</div>
      {secretUnlocked ? <button onClick={() => toggleSecret(a)} data-tip={isAcctSecret(a) ? "Dejar de ocultar" : "Marcar secreta"} style={{ fontSize: 11.5, fontWeight: 600, flex: "0 0 auto", color: isAcctSecret(a) ? "var(--accent)" : "var(--muted)" }}>{isAcctSecret(a) ? "🔒 secreta" : "☐ secreta"}</button> : null}
    </div>
  ))

  // Un canal del catálogo → su fila + flujo de conexión, elegido por connect.method (los flujos NO cambiaron).
  const renderChannel = (ch: ChannelDef): ReactNode => {
    const icon = iconFor(ch)
    const method = ch.connect.method
    const toggle = () => setOpen(open === ch.id ? null : ch.id)
    if (method === "matrix-bridge") {
      // WhatsApp/IG/FB/LinkedIn — bridge Matrix multi-cuenta. WhatsApp usa /api/status; el resto usa /api/matrix-logins.
      const net = ch.connect.net || ch.id
      const isWa = net === "whatsapp"
      const accounts = isWa ? waAccounts : (logins[net] || [])
      return (
        <Fragment key={ch.id}>
          {row(icon, ch.label, <>
            {acctSub(accounts)}
            {isWa && waDown.length ? <span style={{ color: "var(--danger)" }}>{accounts.length ? " · " : ""}⚠️ revinculá {waDown.map(fmtAcct).join(", ")}</span> : null}
          </>, linkBtn(open === ch.id ? "Cerrar" : "＋ Agregar cuenta", toggle))}
          {acctRows(accounts)}
          {open === ch.id ? <WaLink net={net} label={ch.label} onToast={onToast} onDone={closePanel}
            instr={isWa ? undefined : <>Vinculá tu cuenta de {ch.label} por el <b>bridge del servidor</b>: apretá <b>QR</b> y escaneá el código con tu app (o usá el código por número). Puede tardar ~30s.</>} /> : null}
        </Fragment>
      )
    }
    if (method === "matrix-token") {
      // Discord — vincula por token (su QR suele fallar), multi-cuenta
      const net = ch.connect.net || ch.id
      const accounts = logins[net] || []
      return (
        <Fragment key={ch.id}>
          {row(icon, ch.label, acctSub(accounts), linkBtn(open === ch.id ? "Cerrar" : "＋ Agregar cuenta", toggle))}
          {acctRows(accounts)}
          {open === ch.id ? <DiscordLink net={net} label={ch.label} onToast={onToast} onDone={closePanel} /> : null}
        </Fragment>
      )
    }
    if (method === "telegram-login") {
      return (
        <Fragment key={ch.id}>
          {row(icon, ch.label, tgOn ? <span style={{ color: "var(--ok)" }}>Conectado ✓ · solo lectura</span> : "Teléfono + código",
            tgOn ? <span style={{ color: "var(--ok)", fontSize: 14 }}>✓</span> : linkBtn(open === ch.id ? "Cerrar" : "Conectar", toggle))}
          {open === ch.id && !tgOn ? <TgLink configured={!!tg?.configured} onToast={onToast} onDone={closePanel} /> : null}
        </Fragment>
      )
    }
    if (method === "integration") {
      // Slack / Signal — token/URL cifrados en el server, seleccionados por connect.provider
      if (ch.connect.provider === "slack") {
        return (
          <Fragment key={ch.id}>
            {row(icon, ch.label, slackOn ? <span style={{ color: "var(--ok)" }}>Conectado ✓{integ?.slack?.team ? ` · ${integ.slack.team}` : ""}</span> : "Con token de app (xoxp/xoxb)",
              slackOn ? delBtn(disconnectSlack) : linkBtn(open === ch.id ? "Cerrar" : "Conectar", toggle))}
            {open === ch.id && !slackOn ? (
              <div className="setform">
                <div className="modalsub" style={{ marginBottom: 10 }}>Trae tus DMs y canales a la bandeja. Creá una app en <b>api.slack.com/apps</b>, agregá scopes de lectura (<code>channels:history</code>, <code>im:history</code>, <code>users:read</code>…) e instalala; copiá el <b>User OAuth Token</b>.</div>
                <input className="modalinput" placeholder="Pegá tu token de Slack (xoxp-… o xoxb-…)" value={slkTok} type="password" spellCheck={false} autoCapitalize="none" onChange={(e) => { setSlkTok(e.target.value); setSlkMsg(null) }} />
                <button className="mbtn" style={{ width: "100%" }} onClick={saveSlack} disabled={slkBusy}>{slkBusy ? "Verificando…" : "Conectar Slack"}</button>
                {slkMsg ? <div style={{ marginTop: 10, textAlign: "center", fontSize: 13, color: msgColor(slkMsg) }}>{slkMsg.text}</div> : null}
              </div>
            ) : null}
          </Fragment>
        )
      }
      if (ch.connect.provider === "signal") {
        return (
          <Fragment key={ch.id}>
            {row(icon, ch.label, signalOn ? <span style={{ color: "var(--ok)" }}>Conectado ✓{integ?.signal?.number ? ` · ${integ.signal.number}` : ""}</span> : "signal-cli-rest-api en tu server",
              signalOn ? delBtn(disconnectSignal) : linkBtn(open === ch.id ? "Cerrar" : "Conectar", toggle))}
            {open === ch.id && !signalOn ? (
              <div className="setform">
                <div className="modalsub" style={{ marginBottom: 10 }}>Se une al <b>mismo hilo</b> que WhatsApp/SMS de cada contacto. Necesitás <b>signal-cli-rest-api</b> corriendo en tu servidor. Poné su URL y tu número.</div>
                <input className="modalinput" placeholder="http://localhost:8080" value={sgUrl} spellCheck={false} autoCapitalize="none" onChange={(e) => { setSgUrl(e.target.value); setSgMsg(null) }} />
                <input className="modalinput" placeholder="+51 999 000 000" value={sgNum} inputMode="tel" onChange={(e) => { setSgNum(e.target.value); setSgMsg(null) }} />
                <button className="mbtn" style={{ width: "100%" }} onClick={saveSignal} disabled={sgBusy}>{sgBusy ? "Guardando…" : "Conectar Signal"}</button>
                {sgMsg ? <div style={{ marginTop: 10, textAlign: "center", fontSize: 13, color: msgColor(sgMsg) }}>{sgMsg.text}</div> : null}
              </div>
            ) : null}
          </Fragment>
        )
      }
      return null
    }
    // email-account / server u otros métodos no se conectan acá (van en la sección de correo o en el server)
    return null
  }

  return (<>
    <label className="modallabel" style={{ marginTop: 16 }}>Mensajería</label>
    {/* La LISTA sale del catálogo del server (o del respaldo si falló); los flujos por canal son los de siempre. */}
    {channels.filter((c) => c.kind === "messaging").map(renderChannel)}
    <div className="cfg-note2" style={{ marginTop: 12 }}>Otros canales se conectan desde el <b>servidor</b> de tu hub: <b>Microsoft 365</b> (Outlook/Teams entran como correo vía Graph), <b>Notion</b> y <b>Google Calendar/Drive</b> (con token/login en el servidor). Importar historial de WhatsApp está en la barra lateral, en Herramientas.</div>
  </>)
}
// ── Confirmación destructiva reutilizable: nunca borrar una cuenta en un solo click ──
function ConfirmDialog({ title, body, confirmLabel = "Eliminar cuenta", onCancel, onConfirm }: { title: ReactNode; body: ReactNode; confirmLabel?: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modalbg" onClick={onCancel} style={{ zIndex: 70 }}>
      <div className="modalcard" onClick={(e) => e.stopPropagation()} style={{ width: 360, maxWidth: "92vw" }}>
        <h3>{title}</h3>
        <p className="modalsub">{body}</p>
        <div className="modalrow" style={{ marginTop: 14 }}>
          <button className="mbtn ghost" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
          <button className="mbtn" style={{ flex: 1, background: "var(--danger)", color: "#fff" }} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
function SettingsModal({ onClose, onOpenAutopilot, onToast, secretUnlocked, secretToggle }: { onClose: () => void; onOpenAutopilot: () => void; onToast: (m: string) => void; secretUnlocked: boolean; secretToggle: () => void }) {
  const [tab, setTab] = useState<"canales" | "ia" | "notif" | "apify">("canales")
  const [hub, setHub] = useState<any>(null)
  const [accts, setAccts] = useState<any>({ email: [] })
  const [llm, setLlm] = useState<any>(null)
  const [notif, setNotif] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [em, setEm] = useState({ name: "", user: "", pass: "" }); const [showEmail, setShowEmail] = useState(false)
  const [emSecret, setEmSecret] = useState(false) // ☐ marcar la cuenta nueva como secreta (solo con PIN desbloqueado)
  const [key, setKey] = useState({ provider: "openai", name: "", token: "", test: "" }); const [showKey, setShowKey] = useState(false)
  // 🔒 cuentas/números marcados como secretos (solo se puebla con el PIN desbloqueado; el server filtra los ocultos cuando está bloqueado)
  const [secret, setSecret] = useState<{ accounts: { channel: string; account: string }[]; numbers: string[] }>({ accounts: [], numbers: [] })
  const reloadSecret = async () => { if (!secretUnlocked) { setSecret({ accounts: [], numbers: [] }); return } const s = await getSecretState().catch(() => null); if (s) setSecret(s as any) }
  const isEmailSecret = (label: string) => (secret.accounts || []).some((a) => a.channel === "email" && a.account === label)
  // confirmación destructiva pendiente (nunca borrar en un click)
  const [confirm, setConfirm] = useState<{ title: ReactNode; body: ReactNode; confirmLabel?: string; onYes: () => void } | null>(null)
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
  // al desbloquear/bloquear el PIN: re-pedir cuentas (el server ya no filtra las secretas) + el estado de "qué está oculto"
  useEffect(() => { reloadSecret(); load() }, [secretUnlocked])

  const addEmail = async () => {
    if (!em.user.trim() || !em.pass.trim()) { onToast("Falta el correo o la contraseña de aplicación."); return }
    setBusy(true)
    const user = em.user.trim(); const wantSecret = secretUnlocked && emSecret
    const r = await addEmailAccount({ user, pass: em.pass.trim(), name: em.name.trim() }).catch(() => ({ error: "error" }))
    if (r && r.ok) {
      if (wantSecret) { // buscar el label real de la cuenta recién creada y marcarla secreta
        const fresh = await getAccounts().catch(() => null)
        const match = (fresh?.email || []).find((e: any) => String(e.user || "").toLowerCase() === user.toLowerCase() || e.label === user)
        await secretSetAccount("email", match?.label || user, true).catch(() => {})
        await reloadSecret()
      }
      setBusy(false); setEm({ name: "", user: "", pass: "" }); setEmSecret(false); setShowEmail(false); onToast(wantSecret ? "✓ Cuenta conectada (🔒 secreta)" : "✓ Cuenta conectada"); load()
    } else { setBusy(false); onToast((r && r.error) || "No se pudo — revisá las credenciales") }
  }
  const removeEmail = async (label: string) => {
    setBusy(true)
    let err = ""
    try { await removeEmailAccount(label) } catch (e: any) { err = e?.message || "error" }
    setBusy(false); load(); reloadSecret()
    if (err) alert("No se pudo quitar la cuenta " + label + ": " + err) // la lista se recarga igual, así ves el estado REAL
  }
  // marcar/desmarcar una cuenta de correo como secreta (solo con PIN); queda visible con 🔒 hasta que ocultes
  const toggleEmailSecret = async (label: string) => {
    const want = !isEmailSecret(label)
    const r = await secretSetAccount("email", label, want).catch(() => null)
    if (!r || (r as any).error) { onToast(((r as any) && (r as any).error) || "No se pudo guardar."); return }
    onToast(want ? "🔒 Marcada como secreta" : "Ya no es secreta"); await reloadSecret(); load()
  }
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
          {/* 🔒 PIN/Ocultar — habilita configurar cuentas secretas en esta pestaña (mismo secretToggle de la app) */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2, marginBottom: 2 }}>
            <button onClick={secretToggle} title={secretUnlocked ? "Ocultar (cuentas secretas)" : "Ingresá tu PIN para configurar cuentas secretas"}
              style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 8, background: secretUnlocked ? "var(--accent)" : "var(--panel2)", color: secretUnlocked ? "#fff" : "var(--muted)" }}>
              {secretUnlocked ? "🔓 Ocultar" : "🔒 PIN"}
            </button>
          </div>
          <label className="modallabel" style={{ marginTop: 6 }}>Cuentas de correo</label>
          {(accts.email || []).length ? (accts.email || []).map((e: any) => (
            <div key={e.label} className="setrow">
              <span style={{ fontSize: 17 }}>{isEmailSecret(e.label) ? "🔒" : "✉️"}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.user}</div><div style={{ fontSize: 11.5, color: "var(--muted2)" }}>{e.host || ""}{e.count ? ` · ${e.count} correos` : ""}</div></div>
              {secretUnlocked ? <button onClick={() => toggleEmailSecret(e.label)} data-tip={isEmailSecret(e.label) ? "Dejar de ocultar" : "Marcar secreta"} style={{ fontSize: 11.5, fontWeight: 600, flex: "0 0 auto", color: isEmailSecret(e.label) ? "var(--accent)" : "var(--muted)" }}>{isEmailSecret(e.label) ? "🔒 secreta" : "☐ secreta"}</button> : null}
              {e.kind === "imap" ? <button onClick={() => setConfirm({ title: <>¿Eliminar la cuenta {e.user}?</>, body: "Vas a dejar de recibir sus mensajes.", onYes: () => removeEmail(e.label) })} style={{ color: "var(--danger)", fontSize: 15, flex: "0 0 auto" }} data-tip="Quitar">✕</button> : null}
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px 10px" }}>Todavía no conectaste ninguna bandeja.</div>}
          <SignatureEditor accounts={accts.email || []} />
          <AssistantCard />
          {showEmail ? (
            <div className="setform">
              <div className="modalsub" style={{ marginBottom: 10 }}>Gmail/Outlook: usá una <b>contraseña de aplicación</b> (16 letras), no la de tu cuenta.</div>
              <input className="modalinput" placeholder="Nombre (opcional, ej: Trabajo)" value={em.name} onChange={(e) => setEm((s) => ({ ...s, name: e.target.value }))} />
              <input className="modalinput" placeholder="tu@correo.com" value={em.user} onChange={(e) => setEm((s) => ({ ...s, user: e.target.value }))} autoCapitalize="none" spellCheck={false} />
              <input className="modalinput" placeholder="Contraseña de aplicación" type="password" value={em.pass} onChange={(e) => setEm((s) => ({ ...s, pass: e.target.value }))} />
              {secretUnlocked ? <button onClick={() => setEmSecret((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, margin: "2px 0 10px", color: emSecret ? "var(--accent)" : "var(--muted)" }}>{emSecret ? "☑" : "☐"} 🔒 Marcar como cuenta secreta</button> : null}
              <div className="modalrow"><button className="mbtn" onClick={addEmail} disabled={busy}>{busy ? "Conectando…" : "Conectar"}</button><button className="mbtn ghost" onClick={() => setShowEmail(false)}>Cancelar</button></div>
            </div>
          ) : <button className="setadd" onClick={() => setShowEmail(true)}>➕ Agregar cuenta de correo</button>}
          <MessagingChannels onToast={onToast} secretUnlocked={secretUnlocked} secret={secret} reloadSecret={reloadSecret} />
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
                <button onClick={() => setConfirm({ title: <>¿Quitar la cuenta Apify {a.name}?</>, body: "Se deja de usar para investigar contactos.", confirmLabel: "Quitar cuenta", onYes: () => removeAp(a.id) })} disabled={apBusy} style={{ color: "var(--danger)", fontSize: 15 }} data-tip="Quitar">✕</button>
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
      {confirm ? <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel} onCancel={() => setConfirm(null)} onConfirm={() => { const y = confirm.onYes; setConfirm(null); y() }} /> : null}
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

// adjuntos de un email: vienen como JSON string en el mensaje → [{name,mime,size,cas}]
type Att = { name?: string; mime?: string; size?: number; cas?: string; inline?: boolean; cid?: string }
const parseAtts = (m: Msg): Att[] => { try { return JSON.parse(m.attachments || "[]") || [] } catch { return [] } }
const attSize = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB")

// ✉️ TARJETA DE EMAIL (o 🎙 transcripción de reunión) — CLICKEABLE: abre el cuerpo completo, igual que en web y mobile
function EmailCard({ m, onOpen }: { m: Msg; onOpen: () => void }) {
  const mtg = m.channel === "meeting" || m.meeting
  const subject = (m.text || "").split(" — ")[0] || "(sin asunto)"
  const preview = (m.text || "").slice(subject.length + 3).trim()
  const atts = parseAtts(m)
  return (
    <div className="emailcard clk" onClick={onOpen} title={mtg ? "Abrir la transcripción completa" : "Abrir el email completo"}>
      <div className="et">{mtg ? "🎙" : "✉️"} {subject.replace(/^📅\s*/, "").slice(0, 90)}</div>
      {m.summary ? <div className="esum">✦ {m.summary}</div>
        : preview ? <div className="eprev">{preview.slice(0, 220)}</div>
        : m.hasBody ? <div className="eprev">📄 Contenido en imágenes/HTML — abrilo para verlo</div> : null}
      <div className="eopen">{atts.length ? `📎 ${atts.length} adjunto${atts.length > 1 ? "s" : ""} · ` : ""}{mtg ? "Ver transcripción completa →" : m.hasBody ? "📖 Abrir email completo →" : "Ver email completo →"}</div>
    </div>
  )
}

// visor del email: iframe SANDBOXEADO (sin scripts) + CSP que bloquea TODO recurso remoto → sin pixeles de tracking
// ni read-receipts (el remitente no se entera de que lo abriste, ni ve tu IP). Las imágenes inline (data:) sí se ven. Igual que web.
function EmailModal({ m, onClose, onReply }: { m: Msg; onClose: () => void; onReply?: (withAi: boolean) => void }) {
  const [body, setBody] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!m.hasBody)
  const [remoteOk, setRemoteOk] = useState(false) // imágenes remotas: bloqueadas hasta que VOS lo pidas (anti-tracking)
  useEffect(() => {
    if (!m.hasBody) return
    let alive = true
    getEmailBody(m.id).then((r) => { if (alive) setBody(r?.body || null) }).catch(() => {}).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [m.id, m.hasBody])
  const mtg = m.channel === "meeting" || m.meeting
  const atts = parseAtts(m).filter((a) => !a.inline) // las inline (cid:) ya se ven DENTRO del correo → no son archivos a listar
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const raw = body || `<pre style="white-space:pre-wrap;font-family:system-ui;font-size:14px">${esc(m.full || m.text || "")}</pre>`
  const hasRemote = /<img[^>]+src=["']https?:/i.test(raw)
  const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:${remoteOk ? " https:" : ""}; style-src 'unsafe-inline'; font-src data:">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">'
    + '<style>body{margin:0;padding:12px;font-family:system-ui;color:#111;line-height:1.5;word-break:break-word}img{max-width:100%!important;height:auto}table{max-width:100%!important}</style>' + raw
  return (
    <div className="modalbg" onClick={onClose}><div className="modalcard wide" onClick={(e) => e.stopPropagation()}>
      <div className="spread" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ marginBottom: 2 }}>{mtg ? "🎙 Reunión" : "📧 Email"}</h3>
          <div className="modalsub" style={{ marginBottom: 0 }}>{(m.text || "").split(" — ")[0].replace(/^📅\s*/, "")}{m.name ? " · " + m.name : ""}</div>
        </div>
        <button className="mbtn ghost" style={{ flex: "0 0 auto", padding: "6px 12px" }} onClick={onClose}>✕</button>
      </div>
      {!mtg && onReply ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="mbtn" onClick={() => onReply(false)}>✍️ Responder</button>
          <button className="mbtn ghost" onClick={() => onReply(true)}>✨ Responder con IA</button>
        </div>
      ) : null}
      {hasRemote && !remoteOk ? (
        <div className="sendopt" style={{ marginTop: 12, cursor: "pointer" }} onClick={() => setRemoteOk(true)}>
          <div className="sot">🖼 Mostrar imágenes remotas</div>
          <div className="sok">Bloqueadas para que el remitente no sepa que abriste el correo</div>
        </div>
      ) : null}
      {atts.length ? (
        <div style={{ margin: "12px 0 4px" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>📎 {atts.length} adjunto{atts.length > 1 ? "s" : ""}</div>
          {atts.map((a, i) => (
            <div key={i} className="sendopt" style={{ cursor: "pointer" }} onClick={() => a.cas && hubOpenFile(a.cas, a.name || "").catch(() => {})}>
              <div className="sot">📄 {a.name || "archivo"}</div>
              <div className="sok">{(a.mime || "").split("/").pop() || "archivo"} · {attSize(a.size || 0)} · abrir ↓</div>
            </div>
          ))}
        </div>
      ) : null}
      {loading
        ? <div className="center" style={{ height: 200 }}><div className="spin" /></div>
        : <iframe title="email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ width: "100%", height: "62vh", border: "1px solid var(--line2)", borderRadius: 10, background: "#fff", marginTop: 12 }} />}
    </div></div>
  )
}

const RENDER_CAP = 60   // PRIMER lote: pintamos solo las últimas 60 burbujas → primer render rapidísimo al cambiar de hilo (antes 200 jankeaba en hilos con media)
const RENDER_STEP = 200 // cada "ver anteriores" suma 200: un hilo de miles (email/grupo) NO explota el DOM ni molesta con mil clicks
function Messages({ msgs, isGroup, onFeedback, onOpenSender, onOpenEmail }: { msgs: Msg[]; isGroup?: boolean; onFeedback?: (m: Msg) => void; onOpenSender?: (name: string) => void; onOpenEmail?: (m: Msg) => void }) {
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
    if (m.channel === "email" || m.channel === "meeting") {
      out.push(<EmailCard key={m.id} m={m} onOpen={() => onOpenEmail?.(m)} />)
    } else {
      out.push(<Bubble key={m.id} m={m} isGroup={isGroup} onFeedback={onFeedback} onOpenSender={onOpenSender} />)
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
// ✍️ FIRMA de correo, por cuenta ("*" = la que se usa si esa cuenta no tiene la suya). Un email se responde con
// firma; un WhatsApp no. Sin configurar nada, sale una mínima armada con tu nombre y empresa.
function SignatureEditor({ accounts }: { accounts: any[] }) {
  const [data, setData] = useState<any>(null)
  const [acct, setAcct] = useState("*")
  const [text, setText] = useState("")
  const [saved, setSaved] = useState("")
  useEffect(() => { getSignatures().then((r) => setData(r || {})).catch(() => setData({})) }, [])
  useEffect(() => {
    if (!data) return
    const sigs = data.signatures || {}
    const cur = sigs[acct.toLowerCase()] || sigs[acct]
    setText(cur ? cur.text || "" : acct === "*" ? (data.fallback?.text || "") : "")
  }, [data, acct])
  if (!data) return null
  const sigs = data.signatures || {}
  const own = !!(sigs[acct.toLowerCase()] || sigs[acct])
  const save = async (t: string) => {
    const r: any = await saveSignature(acct, t).catch(() => null)
    if (r) { setData({ ...data, signatures: r.signatures || {} }); setSaved(t ? "✍️ guardada" : "quitada"); setTimeout(() => setSaved(""), 2500) }
  }
  return (
    <>
      <label className="modallabel" style={{ marginTop: 16 }}>Firma del correo {saved ? <span style={{ color: "var(--ok)" }}>· {saved}</span> : null}</label>
      <select className="modalinput" value={acct} onChange={(e) => setAcct(e.target.value)} style={{ marginBottom: 8 }}>
        <option value="*">Todas las cuentas</option>
        {(accounts || []).map((e: any) => <option key={e.label} value={e.label || e.user}>{e.name || e.user}{sigs[String(e.label || e.user).toLowerCase()] ? " ✓" : ""}</option>)}
      </select>
      <textarea className="modalinput" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"--\nTu nombre\nTu empresa"} style={{ resize: "vertical", fontFamily: "inherit" }} />
      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-6px 0 10px" }}>
        {own ? "Personalizada para esta cuenta." : acct === "*" ? "Es la de por defecto (tu nombre y empresa). Editala para fijarla." : "Sin firma propia: usa la de “Todas las cuentas”."}
      </div>
      <div className="modalrow">
        <button className="mbtn" onClick={() => save(text)}>Guardar firma</button>
        {own ? <button className="mbtn ghost" onClick={() => save("")}>Quitar</button> : null}
      </div>
    </>
  )
}

// 🤖 ASISTENTE EN TU PROPIO CHAT. Distinto del piloto: el piloto se hace pasar por vos con OTROS; esto te
// responde A VOS cuando le preguntás algo en tu propio WhatsApp. Tus notas y links no se tocan.
function AssistantCard() {
  const [a, setA] = useState<any>(null)
  const [q, setQ] = useState("")
  const [out, setOut] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { getAssistant().then((r) => setA(r || {})).catch(() => setA({})) }, [])
  if (!a) return null
  const upd = async (b: any) => { await setAssistant(b).catch(() => {}); setA(await getAssistant().catch(() => a)) }
  const probar = async () => {
    if (!q.trim()) return
    setBusy(true); setOut(null)
    const r = await tryAssistant(q).catch(() => null)
    setBusy(false); setOut(r)
  }
  return (
    <>
      <label className="modallabel" style={{ marginTop: 18 }}>🤖 Asistente en tu propio chat</label>
      <div className="modalsub" style={{ marginBottom: 10 }}>Le escribís a tu WhatsApp de siempre y, si es una <b>pregunta</b>, te responde — busca en internet y en tu historial. Tus notas y links los deja pasar. Para forzarlo, empezá con <b>“pipe”</b>.</div>
      <div className="setrow"><span style={{ fontSize: 17 }}>💬</span>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>Responderme cuando pregunte</div>
          <div style={{ fontSize: 11.5, color: "var(--muted2)" }}>Hoy respondió {a.state?.usedToday || 0} de {a.maxPerDay || 30}</div></div>
        <button className={"mbtn" + (a.enabled ? "" : " ghost")} style={{ flex: "0 0 auto", padding: "5px 12px" }} onClick={() => upd({ enabled: !a.enabled })}>{a.enabled ? "ON" : "OFF"}</button></div>
      <div className="setrow"><span style={{ fontSize: 17 }}>🌐</span>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>Puede buscar en internet</div>
          <div style={{ fontSize: 11.5, color: "var(--muted2)" }}>Precios, horarios, datos que no están en tu historial</div></div>
        <button className={"mbtn" + (a.web ? "" : " ghost")} style={{ flex: "0 0 auto", padding: "5px 12px" }} onClick={() => upd({ web: !a.web })}>{a.web ? "ON" : "OFF"}</button></div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input className="modalinput" style={{ flex: 1, marginBottom: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Probalo: ¿a cuánto está el dólar?" onKeyDown={(e) => { if (e.key === "Enter") probar() }} />
        <button className="mbtn" style={{ flex: "0 0 auto" }} onClick={probar} disabled={busy}>{busy ? "…" : "Probar"}</button>
      </div>
      {out ? <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>{out.text || "No pude responder."}{out.text ? <div style={{ fontSize: 11, marginTop: 4 }}>{out.usedWeb ? "🌐 usó internet" : "solo tu historial"} · {out.ownMatches} fragmentos tuyos</div> : null}</div> : null}
    </>
  )
}

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
