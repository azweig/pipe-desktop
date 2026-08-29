// Cliente del hub. Como el mobile: NO hay servidor hardcodeado — el usuario escribe su HUB en el login y queda guardado.
// La red sale por un comando NATIVO en Rust (invoke "hub_fetch") → sin CORS y sin Origin de browser, pasa el gate del hub.
// El sid de sesión llega en el body de /api/auth y se reenvía como Cookie en cada llamada.
import { invoke } from "@tauri-apps/api/core"

export const isDesktopApp = typeof (window as any).__TAURI_INTERNALS__ !== "undefined"

let BASE = localStorage.getItem("hubUrl") || ""
let SID = localStorage.getItem("sid") || ""

// 🔒 CUENTAS SECRETAS: token de la sesión secreta (2º PIN) SOLO en memoria — nunca a localStorage/disco. Al desbloquear se llena;
// al bloquear/perder foco se vacía. Viaja como header x-secret-token por el lado nativo (Rust) en CADA llamada (hub_fetch/hub_upload).
let SECRET: string | null = null
// hay un 2º PIN configurado en este hub → NO cachear/persistir mensajes en local (una línea oculta no debe quedar en disco). El server filtra.
let SECRET_PIN_SET = false
export const getSecretToken = () => SECRET
export const setSecretToken = (t: string | null) => { SECRET = t }
export const secretOn = () => !!SECRET
export const isSecretPinSet = () => SECRET_PIN_SET
export const setSecretPinSet = (b: boolean) => { SECRET_PIN_SET = b }

export const getBase = () => BASE
export function setBase(url: string) {
  BASE = String(url || "").trim().replace(/\/+$/, "")
  if (BASE && !/^https?:\/\//.test(BASE)) BASE = "https://" + BASE
  localStorage.setItem("hubUrl", BASE)
  return BASE
}

async function j(path: string, opts: { method?: string; body?: string } = {}) {
  if (!isDesktopApp) throw new Error("Abrí la app Pipe (ventana nativa), no el navegador.")
  const r = (await invoke("hub_fetch", {
    url: BASE + path,
    base: BASE, // 🔒 Rust valida url==hub: cookie/token secreto SOLO viajan al hub configurado (anti-exfiltración)
    method: opts.method || "GET",
    body: opts.body ?? null,
    cookie: SID || null,
    secret: SECRET, // 🔒 header x-secret-token cuando está desbloqueado (null = no se manda)
  })) as { status: number; body: string }
  if (r.status === 401) { const e: any = new Error("no autorizado"); e.code = 401; throw e }
  // El hub explica POR QUÉ falló en {error}. Tirar solo "HTTP 400" convertía cualquier fallo en un misterio
  // (p.ej. un envío rechazado por falta de canal). Si el cuerpo trae error, ese es el mensaje.
  if (r.status >= 400) {
    let msg = "HTTP " + r.status
    try { const b = JSON.parse(r.body || "{}"); if (b && b.error) msg = String(b.error) } catch { /* cuerpo no-JSON: nos quedamos con el código HTTP */ }
    const e: any = new Error(msg); e.code = r.status; throw e
  }
  try { return JSON.parse(r.body || "{}") } catch { return {} }
}

// SUBIDA BINARIA (audio/adjuntos): el body va como base64 → Rust lo decodifica y POSTea bytes crudos con el Content-Type real.
async function jUpload(path: string, contentType: string, bytesB64: string) {
  if (!isDesktopApp) throw new Error("Abrí la app Pipe (ventana nativa).")
  const r = (await invoke("hub_upload", {
    url: BASE + path, base: BASE, method: "POST", contentType, bodyB64: bytesB64, cookie: SID || null, secret: SECRET, // 🔒 base: solo el hub
  })) as { status: number; body: string }
  if (r.status >= 400) { const e: any = new Error("HTTP " + r.status); e.code = r.status; throw e }
  try { return JSON.parse(r.body || "{}") } catch { return {} }
}
// Blob → base64 (sin el prefijo data:) para pasarlo por IPC a Rust
export function blobToB64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(blob) })
}
const q = (o: Record<string, any>) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&")

export const authStatus = () => j("/api/auth/status")
export async function login(pin: string) {
  const r = await j("/api/auth", { method: "POST", body: JSON.stringify({ pin }) })
  if (r && r.ok && r.sid) { SID = r.sid; localStorage.setItem("sid", r.sid) }
  return r
}
export const getThreads = () => j("/api/threads?limit=600") // 600 como la web: con 200 los contactos de hace dos semanas quedaban fuera de la bandeja
// BUSCAR entre TODOS los hilos (no solo los cargados). El server resuelve por índice; devuelve filas iguales a las de la bandeja.
export const searchThreads = (q: string): Promise<Thread[]> => j("/api/threads?limit=60&q=" + encodeURIComponent(q))
export const getThread = (key: string) => j("/api/thread?key=" + encodeURIComponent(key) + "&limit=60")
export const getThreadDelta = (key: string, sinceRev = 0) => j("/api/thread/delta?key=" + encodeURIComponent(key) + "&sinceRev=" + (sinceRev || 0))
// marca el hilo como LEÍDO (paridad con web/mobile, que lo llaman al abrir) → limpia el punto de "no leído" en el server
export const markSeen = (key: string, ts: number) => j("/api/thread/seen", { method: "POST", body: JSON.stringify({ key, ts: ts || Date.now() }) })
// mensajes MÁS ANTIGUOS (paginación hacia atrás): trae los previos a `before` (un ts)
export const getThreadBefore = (key: string, before: number) => j("/api/thread?key=" + encodeURIComponent(key) + "&limit=60&before=" + (before || 0))
// SYNC de texto completo (backfill grande, liviano): página de 800 hacia atrás → {items, oldestTs, hasMore}
export const getThreadSync = (key: string, before = 0) => j("/api/thread/sync?key=" + encodeURIComponent(key) + "&before=" + (before || 0) + "&limit=800")
// CUERPO COMPLETO de un email/transcripción (HTML crudo) → { body } · se renderiza en un iframe sandboxeado
export const getEmailBody = (id: string): Promise<{ body?: string }> => j("/api/email/body?id=" + encodeURIComponent(id))
// ✍️ firmas de correo, por cuenta ("*" = la de por defecto)
export const getSignatures = (): Promise<{ signatures?: Record<string, { text?: string }>; fallback?: { text?: string } }> => j("/api/signatures")
export const saveSignature = (account: string, text: string) => j("/api/signature", { method: "POST", body: JSON.stringify({ account, text }) })
// 🤖 asistente en TU propio chat (distinto del piloto: te habla A VOS, no se hace pasar por vos)
export const getAssistant = (): Promise<{ enabled?: boolean; web?: boolean; maxPerDay?: number; state?: any }> => j("/api/assistant")
export const setAssistant = (b: { enabled?: boolean; web?: boolean; maxPerDay?: number }) => j("/api/assistant", { method: "POST", body: JSON.stringify(b) })
export const tryAssistant = (q: string): Promise<{ text?: string; usedWeb?: boolean; ownMatches?: number }> => j("/api/assistant/try", { method: "POST", body: JSON.stringify({ q }) })
export const getPerson = (name: string) => j("/api/person?name=" + encodeURIComponent(name))
// ficha de un GRUPO: quién habla más, de qué se habla y cuánto participás
export const getGrupo = (key: string): Promise<any> => j("/api/group?key=" + encodeURIComponent(key))
// cuánto falta para la próxima reunión (para no tener que abrir la agenda)
export const getProximaReunion = (): Promise<any> => j("/api/next-meeting")
// DIRECTORIO COMPLETO de contactos (nodos del vault, no solo los hilos recientes) → { people:[{name,role,tags,initials}], companies:[{name,relation,tags}] }
export const getDirectory = (): Promise<{ people?: any[]; companies?: any[] }> => j("/api/directory")
// buscador CONTEXTUAL: busca dentro del CUERPO de los mensajes (no solo nombres) → [{key,who,ts,dir,text}]
export const searchContent = (q: string) => j("/api/search?q=" + encodeURIComponent(q))
// 🤖 buscador con IA (router): ⚡ facetas (0 tokens) o 🧠 RAG. Mismo endpoint que web/mobile.
// → { mode:"facets"|"rag", type:"find"|…, engine, answer, results:[{key,name,ts,text,media,mediaType,filename}], threads:[{key,name,summary,path}], matches, ragMode, degraded }
export const routerSearch = (q: string) => j("/api/router-search", { method: "POST", body: JSON.stringify({ q, via: "escritorio" }) })
// ── RADAR (coach) — feed proactivo: { promises[], questions[], waiting[], proposals[], nudges[], brief } ──
export const getCoach = () => j("/api/coach")
export const coachAction = (key: string, action: string) => j("/api/coach/action", { method: "POST", body: JSON.stringify({ key, action }) })
// ── NOTAS (segundo cerebro) ──
export const getNotesDigest = () => j("/api/notes/digest")
export const getNotes = (cat = "all", status = "active") => j("/api/notes/list?cat=" + encodeURIComponent(cat) + "&status=" + status + "&limit=120")
export const getNotesChat = () => j("/api/notes/chat")
export const notesChat = (q: string) => j("/api/notes/chat", { method: "POST", body: JSON.stringify({ q }) })
export const noteAction = (id: string, action: string) => j("/api/notes/action", { method: "POST", body: JSON.stringify({ id, action }) })
// ── CLIPS (los LINKS y mensajes ORIGINALES que te guardaste a vos mismo) — paridad con la web ──
// lista paginada hacia atrás por tipo (all|link|text|media|todo|archived) → { items, hasMore, oldest }
export const getNotesClips = (kind = "all", before = 0) =>
  j("/api/notes/clips?kind=" + encodeURIComponent(kind) + "&before=" + (before || 0) + "&limit=40")
// acciones de un clip (igual que la web): fijar arriba / archivar. Persisten en la tabla `clips`.
// OJO: los clips NO usan /api/notes/action (eso opera sobre note_meta = las tarjetas de nota); usan estos endpoints dedicados.
export const clipPin = (id: string, on: boolean) => j("/api/clip/pin", { method: "POST", body: JSON.stringify({ id, on }) })
export const clipArchive = (id: string, on: boolean) => j("/api/clip/archive", { method: "POST", body: JSON.stringify({ id, on }) })
export const getGroups = () => j("/api/groups")
export const getCalendar = (view = "semana", date = "") => j("/api/calendar?view=" + view + (date ? "&date=" + date : ""))
export const getMeeting = (id: string) => j("/api/meeting?id=" + encodeURIComponent(id))
// ── HOME (resumen del día) — mismo endpoint que web/mobile ──
// → { brief:{text,audioSec}, kpis:[{cat,label,value,delta,goodUp,pct}], news:[{tag,title,source,ago,url,img}],
//     agenda:[{time,dur,title,sub}], waiting:[{key,name,photo,work,reason,preview}], calls:[{key,name,missed,n,ts}],
//     todos:[{id,text,name,due,thread}], promesas:[{id,text,name,due,thread}], objetivos:[{title,next,horizon,progress,target}], coach:{text,convKey}, generatedAt }
export const getHome = () => j("/api/home")
// audio TTS del brief: bytes autenticados → data URI (reusa hub_image, que devuelve data:<ct>;base64) → se pasa a un <audio>
export const getHomeAudio = (): Promise<string> => hubImage("/api/home/audio")
// 🧠 Jarvis / Ask-the-brain (IA REACTIVA: vos preguntás) → { answer }
export const askBrain = (q: string): Promise<{ answer?: string; text?: string; reply?: string }> => j("/api/ask", { method: "POST", body: JSON.stringify({ q }) })
// JARVIS con memoria: la charla vive en el hub (no en la app), así es la MISMA desde la web, el escritorio, el
// celular y hasta lo que le preguntás por WhatsApp. Y usa el buscador completo, no solo el RAG de mensajes.
export const jarvisHistorial = (): Promise<any> => j("/api/jarvis?limit=80")
export const jarvisPreguntar = (q: string): Promise<any> => j("/api/jarvis", { method: "POST", body: JSON.stringify({ q, via: "escritorio" }) })
export const jarvisLimpiar = (): Promise<any> => j("/api/jarvis/clear", { method: "POST", body: "{}" })
// borrador de respuesta para un contacto (Home "Borrador IA") → { draft }
export const replyDraft = (name: string, key: string): Promise<{ draft?: string; text?: string; reply?: string }> => j("/api/reply", { method: "POST", body: JSON.stringify({ name, key }) })
// marcar una acción de la Home (to-do / promesa) como hecha
export const actionDone = (kind: string, id: string) => j("/api/action/done", { method: "POST", body: JSON.stringify({ kind, id }) })
// ── OBJETIVOS (metas + KPIs) ──
export const getObjetivos = (): Promise<any[]> => j("/api/objetivos")
export const getCompanies = (): Promise<any[]> => j("/api/companies")
export const saveObjetivo = (o: any) => j("/api/objetivo", { method: "POST", body: JSON.stringify(o) })
export const deleteObjetivo = (id: string) => j("/api/objetivo/delete", { method: "POST", body: JSON.stringify({ id }) })
export const suggestObjetivos = (): Promise<any[]> => j("/api/objetivos/suggest")
// ── ESPACIOS (agrupar contactos por reglas: email/dominio/teléfono/nombre) ──
export const getEspacios = (): Promise<any[]> => j("/api/espacios")
export const getEspacioView = (id: string) => j("/api/espacio/view?id=" + encodeURIComponent(id))
export const saveEspacio = (b: { name: string; icon?: string; parent?: string | null }) => j("/api/espacio", { method: "POST", body: JSON.stringify(b) })
export const deleteEspacio = (id: string) => j("/api/espacio/delete", { method: "POST", body: JSON.stringify({ id }) })
export const addEspacioRule = (id: string, type: string, value: string) => j("/api/espacio/rule", { method: "POST", body: JSON.stringify({ id, type, value }) })
export const delEspacioRule = (id: string, idx: number) => j("/api/espacio/rule/delete", { method: "POST", body: JSON.stringify({ id, idx }) })
export const addEspacioException = (id: string, type: string, value: string) => j("/api/espacio/exception", { method: "POST", body: JSON.stringify({ id, type, value }) })
export const delEspacioException = (id: string, idx: number) => j("/api/espacio/exception/delete", { method: "POST", body: JSON.stringify({ id, idx }) })
export const getTargets = (key: string) => j("/api/thread/targets?key=" + encodeURIComponent(key))
// `msgId` (opcional pero lo manda siempre la cola): el server lo reserva antes de enviar, así un reintento tras un
// 502 no manda el mensaje dos veces. Ver src/outbox.ts.
export const sendMsg = (key: string, text: string, t?: any, covert = false, msgId?: string) =>
  j("/api/send", { method: "POST", body: JSON.stringify({ key, text, channel: t?.channel, target: t?.target, covert, msgId }) })
// modo encubierto (El Santo): config por-contacto + envío cifrado
export const getCovert = (key: string) => j("/api/covert/config?key=" + encodeURIComponent(key))
export const setCovert = (key: string, pass: string, style: string) => j("/api/covert/config", { method: "POST", body: JSON.stringify({ key, pass, style }) })
// abrir un link en el navegador del sistema (no dentro del webview)
export const openExternal = (url: string) => invoke("open_url", { url }).catch(() => {})
export const setPin = (key: string, pinned: boolean) => j("/api/contact/pin", { method: "POST", body: JSON.stringify({ key, pinned }) })
// fusionar contactos duplicados en uno solo: `target` = la clave que se CONSERVA; `keys` = las otras que se absorben. → { moved }
export const mergeContacts = (target: string, keys: string[], extra: { canonical?: string; aliases?: string[] } = {}): Promise<{ moved?: number; aliased?: number }> =>
  j("/api/contact/merge", { method: "POST", body: JSON.stringify({ target, keys, ...extra }) })
export const setArchive = (key: string, on = true) => j("/api/contact/archive", { method: "POST", body: JSON.stringify({ key, on }) })
// silenciar/reactivar un contacto (ruido que no es spam → pestaña "Silenciados")
export const setSilence = (key: string, on = true) => j("/api/contact/silence", { method: "POST", body: JSON.stringify({ key, on }) })
// cerrar sesión: invalida el sid en el server y lo borra local → vuelve al Login (hub queda guardado)
export async function logout() { try { await j("/api/auth/logout", { method: "POST" }) } catch {}; SID = ""; try { localStorage.removeItem("sid") } catch {} }
// ── Configuración (paridad con web/mobile) ──
export const getHubConfig = () => j("/api/hub-config")
export const getAccounts = () => j("/api/accounts")
export const addEmailAccount = (b: { user: string; pass: string; name?: string }) => j("/api/accounts/email", { method: "POST", body: JSON.stringify(b) })
export const removeEmailAccount = (label: string) => j("/api/accounts/email/remove", { method: "POST", body: JSON.stringify({ label }) })
// ── CANALES DE MENSAJERÍA (paridad con web) ──
// estado AUTORITATIVO de canales conectados: WhatsApp (bridge=Matrix, baileys=directo), email, y "otros" (Telegram/Teams/Notion/Calendar con ok)
export type HubStatus = {
  whatsapp?: { bridge?: string[]; baileys?: { acc?: string; num?: string }[] }
  email?: any[]
  otros?: { name: string; key: string; ok: boolean; last?: number; guide?: string; rm?: boolean }[]
}
export const getStatus = (): Promise<HubStatus> => j("/api/status")
// ── CATÁLOGO DE CANALES (registro del server) — la LISTA de canales conectables ya NO va hardcodeada en el cliente ──
// El server es la fuente de verdad: qué canales existen, su etiqueta/color de marca y CÓMO se conectan (connect.method).
// connect.method: "matrix-bridge" (WhatsApp/IG/FB/LinkedIn, multi-cuenta) | "matrix-token" (Discord) | "telegram-login"
//                 | "integration" (Slack/Signal, por connect.provider) | "email-account" | "server" (Notion/M365/Google).
export type ChannelDef = {
  id: string
  label: string
  brand?: string // color de marca (para el círculo fallback si no hay emoji para este id)
  kind: string // "messaging" | "email" | … — la sección de Mensajería itera kind==="messaging"
  connect: {
    method: "matrix-bridge" | "matrix-token" | "telegram-login" | "integration" | "email-account" | "server"
    net?: string // red del bridge Matrix (whatsapp/instagram/facebook/linkedin/discord)
    provider?: string // integración concreta (slack/signal) cuando method==="integration"
    fields?: { key: string; label?: string; type?: string; placeholder?: string }[]
    multi?: boolean // multi-cuenta ("＋ Agregar cuenta")
  }
  canSend?: boolean
}
export const getChannelsCatalog = (): Promise<{ channels: ChannelDef[] }> => j("/api/channels/catalog")
// cuentas conectadas de un bridge (whatsapp/instagram/facebook/linkedin/discord). refresh=1 re-consulta el bridge (repuebla listas vacías/viejas)
export const getMatrixLogins = (net: string, refresh = false): Promise<{ net?: string; accounts?: string[] }> =>
  j("/api/matrix-logins?net=" + encodeURIComponent(net) + (refresh ? "&refresh=1" : ""))
// números de WhatsApp caídos (recibís pero no podés responder → hay que revincular)
export const getWaStatus = (): Promise<{ loggedOut?: string[] }> => j("/api/wa/status")
// integraciones conectables desde la app (token/URL cifrados en el server)
export type Integrations = { slack: { configured: boolean; team: string }; signal: { configured: boolean; number: string } }
export const getIntegrations = (): Promise<Integrations> => j("/api/integrations")
export const setSlack = (token: string): Promise<{ ok?: boolean; team?: string; error?: string }> => j("/api/integrations/slack", { method: "POST", body: JSON.stringify({ token }) })
export const removeSlack = (): Promise<{ ok?: boolean }> => j("/api/integrations/slack/remove", { method: "POST", body: "{}" })
export const setSignal = (url: string, number: string): Promise<{ ok?: boolean; error?: string }> => j("/api/integrations/signal", { method: "POST", body: JSON.stringify({ url, number }) })
export const removeSignal = (): Promise<{ ok?: boolean }> => j("/api/integrations/signal/remove", { method: "POST", body: "{}" })
// ── WhatsApp: vincular vía el bridge Matrix del server (QR o código por número) ──
// arranca el proceso de vinculación (net=whatsapp); phone opcional → login por código en vez de QR
export const matrixLink = (net: string, phone = ""): Promise<{ started?: boolean; net?: string; flow?: string }> =>
  j("/api/matrix-link?" + q({ net, phone }), { method: "POST", body: "{}" })
// estado del bridge: { connected, code (login por número), qr (¿hay PNG listo?) }
export const matrixStatus = (net: string): Promise<{ connected?: boolean; code?: string; qr?: boolean }> => j("/api/matrix-status?net=" + encodeURIComponent(net))
// el PNG del QR (autenticado) como data URI para el <img>. Cache-buster para forzar refresco.
export const matrixQrImage = (net: string): Promise<string> => hubImage("/api/matrix-qr?net=" + encodeURIComponent(net) + "&t=" + Date.now())
// vinculación por TOKEN (Discord: su QR suele fallar) → arranca el login con el token; luego se pollea matrixStatus(net)
export const matrixLinkToken = (net: string, token: string): Promise<{ started?: boolean; net?: string }> =>
  j("/api/matrix-link-token?net=" + encodeURIComponent(net), { method: "POST", body: JSON.stringify({ token }) })
// ── Telegram self-service: teléfono → código → 2FA opcional (GramJS vía el server) ──
export type TelegramStatus = { connected?: boolean; configured?: boolean; stage?: string; error?: string }
export const telegramStatus = (): Promise<TelegramStatus> => j("/api/telegram/status")
export const telegramStart = (payload: { phone: string; apiId?: string; apiHash?: string }): Promise<{ ok?: boolean; error?: string }> => j("/api/telegram/start", { method: "POST", body: JSON.stringify(payload) })
export const telegramCode = (code: string): Promise<any> => j("/api/telegram/code", { method: "POST", body: JSON.stringify({ code }) })
export const telegramPassword = (password: string): Promise<any> => j("/api/telegram/password", { method: "POST", body: JSON.stringify({ password }) })
export const telegramConnected = (): Promise<{ ok?: boolean }> => j("/api/telegram/connected", { method: "POST", body: "{}" })
export const getLlmConfig = () => j("/api/llm-config")
export const testLlm = (b: { provider: string; token: string }) => j("/api/llm-config/test", { method: "POST", body: JSON.stringify(b) })
export const saveLlm = (b: any) => j("/api/llm-config/save", { method: "POST", body: JSON.stringify(b) })
export const getNotifPrefs = () => j("/api/notif-prefs")
export const saveNotifPrefs = (b: any) => j("/api/notif-prefs", { method: "POST", body: JSON.stringify(b) })
export const suggestReply = (key: string) => j("/api/thread/suggest-reply?key=" + encodeURIComponent(key))
// ── ENRIQUECIMIENTO SOCIAL (Apify) — perfiles públicos anónimos, sin usar tus cookies ──
// cuentas Apify: rotan entre ellas y hacen failover cuando una llega al límite mensual gratis
export type ApifyAccount = { id: string; name: string; runs: number; usd: number; exhausted?: boolean; hint?: string }
export type ApifyAccounts = { accounts: ApifyAccount[]; rr?: number; actors?: Record<string, string>; month?: string }
export const getApifyAccounts = (): Promise<ApifyAccounts> => j("/api/apify/accounts")
export const addApifyAccount = (name: string, token: string): Promise<ApifyAccounts> => j("/api/apify/accounts", { method: "POST", body: JSON.stringify({ name, token }) })
export const removeApifyAccount = (id: string): Promise<ApifyAccounts> => j("/api/apify/accounts", { method: "POST", body: JSON.stringify({ remove: id }) })
export const setApifyActors = (actors: Record<string, string>): Promise<ApifyAccounts> => j("/api/apify/accounts", { method: "POST", body: JSON.stringify({ actors }) })
// perfil social de un contacto: links pegados + investigación (resumen, rol/empresa/lugar, intereses, relaciones para el ego-grafo)
export type SocialLinks = { linkedin?: string; instagram?: string; facebook?: string; x?: string }
export type SocialRelation = { name: string; type: string }
export type SocialProfiles = { summary?: string; role?: string; company?: string; location?: string; interests?: string[]; relationships?: SocialRelation[] }
export type ContactSocial = { links: SocialLinks; profiles: SocialProfiles | null; sources?: string[]; errors?: Record<string, string>; updatedAt?: number }
export const getContactSocial = (key: string): Promise<ContactSocial> => j("/api/contact/social?key=" + encodeURIComponent(key))
export const setContactLinks = (key: string, links: SocialLinks): Promise<{ ok?: boolean }> => j("/api/contact/links", { method: "POST", body: JSON.stringify({ key, links }) })
export const investigateContact = (key: string, links: SocialLinks): Promise<ContactSocial> => j("/api/contact/investigate", { method: "POST", body: JSON.stringify({ key, links }) })
// resumen IA de un audio/video/imagen RECIBIDO: transcribe + resume (traduce si está en otro idioma) → {summary, transcript?, lang?} | {error}
export const summarizeMedia = (id: string): Promise<{ summary?: string; transcript?: string; lang?: string; error?: string }> =>
  j("/api/media/summarize", { method: "POST", body: JSON.stringify({ id }) })
// composer rico (paridad con web/mobile)
// 🔒 `key` (la clave del hilo) va para que el server, si el destino es una cuenta secreta, corrija con el modelo local
// en vez de mandar lo que estás escribiendo a un tercero.
export const correctText = (text: string, channel?: string, key?: string) => j("/api/compose/correct", { method: "POST", body: JSON.stringify({ text, channel, key }) })
export const summarizeThread = (key: string, range = "today") => j("/api/thread/summarize?key=" + encodeURIComponent(key) + "&range=" + range)
export const getSchedule = (key: string) => j("/api/thread/schedule?key=" + encodeURIComponent(key))
export const createSchedule = (payload: any) => j("/api/schedule/create", { method: "POST", body: JSON.stringify(payload) })
// audio + adjuntos (binario → base64 → Rust)
export const sttB64 = (b64: string, mime: string) => jUpload("/api/stt", mime, b64)
export const sendAudioB64 = (key: string, b64: string, mime: string, dur: number, t?: any) =>
  jUpload("/api/send-audio?" + q({ key, dur, channel: t?.channel, target: t?.target }), mime, b64)
export const sendMediaB64 = (key: string, b64: string, mime: string, filename: string, t?: any) =>
  jUpload("/api/send-media?" + q({ key, filename, channel: t?.channel, target: t?.target }), mime, b64)
export const sendStickerB64 = (key: string, b64: string, mime: string, t?: any) =>
  jUpload("/api/send-sticker?" + q({ key, channel: t?.channel, target: t?.target }), mime, b64)
// enviar un CONTACTO: el server arma el vCard con los datos que ya tiene de esa persona
export const sendContact = (key: string, contacto: string, t?: { channel?: string; target?: string }) =>
  j("/api/send-contact", { method: "POST", body: JSON.stringify({ key, contacto, channel: t?.channel, target: t?.target }) })
// piloto automático
export const getAutopilot = (key: string) => j("/api/autopilot/config?key=" + encodeURIComponent(key))
export const setAutopilot = (key: string, enabled: boolean, maxPerDay = 0) => j("/api/autopilot/config", { method: "POST", body: JSON.stringify({ key, enabled, maxPerDay }) })
export const autopilotFeedback = (key: string, good: boolean, correction = "", original = "") => j("/api/autopilot/feedback", { method: "POST", body: JSON.stringify({ key, good, correction, original }) })
export type TrainCard = { key?: string; name?: string; context?: { mine: boolean; text: string }[]; incoming?: string; draft?: string; none?: boolean; error?: string }
export const getTrainCard = (): Promise<TrainCard> => j("/api/autopilot/train-card")
export type VoiceProfile = { summary?: string; languages?: { name: string; pct: number }[]; dialect?: { name: string; pct: number }[]; tone?: string[]; traits?: Record<string, string>; error?: string }
export const getVoiceProfile = (): Promise<VoiceProfile> => j("/api/autopilot/voice")
export const buildVoiceProfile = (): Promise<VoiceProfile> => j("/api/autopilot/voice", { method: "POST", body: "{}" })
// piloto automático — POLÍTICA GLOBAL (no por-contacto): qué temas escala a vos en vez de responder solo.
export type AutopilotPolicy = { presets: string[]; custom: string[]; presets_available: string[] }
export const getAutopilotPolicy = (): Promise<AutopilotPolicy> => j("/api/autopilot/policy")
export const setAutopilotPolicy = (presets: string[], custom: string[]): Promise<AutopilotPolicy> =>
  j("/api/autopilot/policy", { method: "POST", body: JSON.stringify({ presets, custom }) })
export type Council = { enabled: boolean; members: string[]; chairman: string; available?: string[] }
export const getCouncil = (): Promise<Council> => j("/api/autopilot/council")
export const setCouncil = (c: { enabled: boolean; members: string[]; chairman: string }): Promise<Council> =>
  j("/api/autopilot/council", { method: "POST", body: JSON.stringify(c) })
// IMPORT WhatsApp: el usuario elige un export (.txt = solo texto / .zip = con fotos y audios) con el diálogo nativo.
// El archivo se lee en Rust (read_file_b64) → base64 → se sube por hub_upload como cuerpo crudo (text/plain o application/zip).
export const readFileB64 = (path: string): Promise<string> => invoke("read_file_b64", { path }) as Promise<string>
type WaImportRes = { inserted?: number; skipped?: number; media?: number; error?: string }
type WaImportOpts = { name?: string; order?: string; tz?: number; group?: boolean }
export const importWhatsAppB64 = (b64: string, o: WaImportOpts = {}): Promise<WaImportRes> =>
  jUpload("/api/import/whatsapp?" + q({ name: o.name || "", order: o.order || "auto", tz: o.tz ?? 0, group: o.group ? "1" : "" }), "text/plain", b64)
export const importWhatsAppZipB64 = (b64: string, o: WaImportOpts = {}): Promise<WaImportRes> =>
  jUpload("/api/import/whatsapp-zip?" + q({ name: o.name || "", order: o.order || "auto", tz: o.tz ?? 0, group: o.group ? "1" : "" }), "application/zip", b64)
// baja una foto/avatar del hub (autenticada) como data URI, para el <img>
export const hubImage = (path: string): Promise<string> =>
  invoke("hub_image", { url: /^https?:\/\//.test(path) ? path : BASE + path, base: BASE, cookie: SID || null }) as Promise<string> // 🔒 base: Rust rechaza si no es el hub
// baja un ARCHIVO/DOCUMENTO del hub (autenticado), lo guarda y lo abre con la app por defecto del SO → devuelve la ruta local.
// Rust NO abre lo que puede ejecutar código (lo manda un tercero): en ese caso guarda el archivo y avisa, en vez de lanzarlo.
export const hubOpenFile = async (path: string, filename?: string): Promise<string> => {
  try {
    return (await invoke("hub_open_file", { url: /^https?:\/\//.test(path) ? path : BASE + path, base: BASE, filename: filename || null, cookie: SID || null })) as string
  } catch (e: any) {
    const msg = String(e?.message || e || "")
    const i = msg.indexOf("__GUARDADO_SIN_ABRIR__")
    if (i >= 0) {
      const dest = msg.slice(i + "__GUARDADO_SIN_ABRIR__".length)
      alert(`Este archivo puede ejecutar código, así que no lo abrí.\n\nLo guardé en:\n${dest}\n\nSi lo esperabas, abrilo vos desde ahí. Si no lo esperabas, borralo.`)
      return dest
    }
    throw e
  }
}

// ── 🔒 CUENTAS SECRETAS (paridad con web) — el token viaja por Rust (x-secret-token), acá solo los endpoints ──
// estado del 2º PIN: ¿está configurado? ¿hay sesión secreta abierta ahora?
export const getSecretStatus = (): Promise<{ pinSet?: boolean; unlocked?: boolean }> => j("/api/secret/status")
// crear el 2º PIN por primera vez (6-12 dígitos, distinto al de entrada)
export const secretSetup = (pin: string): Promise<{ ok?: boolean; error?: string }> => j("/api/secret/setup", { method: "POST", body: JSON.stringify({ pin }) })
// desbloquear con el 2º PIN → { ok, token } (guardar el token SOLO en memoria vía setSecretToken) | 401 { error }
export const secretUnlock = (pin: string): Promise<{ ok?: boolean; token?: string; error?: string }> => j("/api/secret/unlock", { method: "POST", body: JSON.stringify({ pin }) })
// cerrar la sesión secreta en el server (además de vaciar el token local)
export const secretLock = (): Promise<{ ok?: boolean }> => j("/api/secret/lock", { method: "POST", body: "{}" })
// cuentas/números marcados como secretos (403 si está bloqueado) → { accounts:[{channel,account}], numbers:["51999..."] }
export const getSecretState = (): Promise<{ accounts: { channel: string; account: string }[]; numbers: string[] }> => j("/api/secret/state")
// marcar/desmarcar un número de WhatsApp como secreto (403 si bloqueado)
export const secretSetWa = (number: string, secret: boolean): Promise<{ ok?: boolean; error?: string }> => j("/api/secret/wa", { method: "POST", body: JSON.stringify({ number, secret }) })
// marcar/desmarcar una cuenta (ej. email) como secreta (403 si bloqueado)
export const secretSetAccount = (channel: string, account: string, secret: boolean): Promise<{ ok?: boolean; error?: string }> => j("/api/secret/account", { method: "POST", body: JSON.stringify({ channel, account, secret }) })

export type Thread = {
  key: string; name: string; lastText?: string; ts?: number; unread?: number; unseen?: number
  channels?: string[]; bucket?: string; photo?: string; initials?: string; email?: string; lastDir?: string; autopilot?: boolean
  group?: boolean; pinned?: boolean; silenced?: boolean; escalated?: boolean; escalatedReason?: string
}
export type Msg = { id: string; dir: string; name?: string; text?: string; ts?: number; channel?: string; media?: string | null; mediaType?: string | null; auto?: boolean; summary?: string; covert?: { text: string; style?: string }; secret?: boolean; hasBody?: boolean; full?: string; attachments?: string; meeting?: boolean }

// EMPEZAR UNA CONVERSACIÓN NUEVA: el server resuelve lo que escribiste (teléfono / correo) a la clave de hilo de
// siempre. No crea nada: si ya existe conversación con ese destino, devuelve la que hay.
export const nuevaConversacion = (destino: string, channel?: string) =>
  j("/api/conversation/new", { method: "POST", body: JSON.stringify({ destino, channel }) })

// checklist de primer arranque (WhatsApp / correo / IA). El cálculo vive en el hub: una sola fuente de verdad para las
// tres apps, en vez de que cada cliente repita las reglas de "está conectado" y queden desincronizadas.
export const getOnboarding = () => j("/api/onboarding")

// canales que se pueden estrenar (sólo los CONECTADOS: ofrecer uno sin conectar sería un callejón sin salida)
export const canalesNuevaConv = () => j("/api/conversation/channels")
