// Cliente del hub. Como el mobile: NO hay servidor hardcodeado — el usuario escribe su HUB en el login y queda guardado.
// La red sale por un comando NATIVO en Rust (invoke "hub_fetch") → sin CORS y sin Origin de browser, pasa el gate del hub.
// El sid de sesión llega en el body de /api/auth y se reenvía como Cookie en cada llamada.
import { invoke } from "@tauri-apps/api/core"

export const isDesktopApp = typeof (window as any).__TAURI_INTERNALS__ !== "undefined"

let BASE = localStorage.getItem("hubUrl") || ""
let SID = localStorage.getItem("sid") || ""

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
    method: opts.method || "GET",
    body: opts.body ?? null,
    cookie: SID || null,
  })) as { status: number; body: string }
  if (r.status === 401) { const e: any = new Error("no autorizado"); e.code = 401; throw e }
  if (r.status >= 400) { const e: any = new Error("HTTP " + r.status); e.code = r.status; throw e }
  try { return JSON.parse(r.body || "{}") } catch { return {} }
}

// SUBIDA BINARIA (audio/adjuntos): el body va como base64 → Rust lo decodifica y POSTea bytes crudos con el Content-Type real.
async function jUpload(path: string, contentType: string, bytesB64: string) {
  if (!isDesktopApp) throw new Error("Abrí la app Pipe (ventana nativa).")
  const r = (await invoke("hub_upload", {
    url: BASE + path, method: "POST", contentType, bodyB64: bytesB64, cookie: SID || null,
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
export const getThreads = () => j("/api/threads?limit=200")
export const getThread = (key: string) => j("/api/thread?key=" + encodeURIComponent(key) + "&limit=60")
export const getThreadDelta = (key: string, sinceRev = 0) => j("/api/thread/delta?key=" + encodeURIComponent(key) + "&sinceRev=" + (sinceRev || 0))
// marca el hilo como LEÍDO (paridad con web/mobile, que lo llaman al abrir) → limpia el punto de "no leído" en el server
export const markSeen = (key: string, ts: number) => j("/api/thread/seen", { method: "POST", body: JSON.stringify({ key, ts: ts || Date.now() }) })
// mensajes MÁS ANTIGUOS (paginación hacia atrás): trae los previos a `before` (un ts)
export const getThreadBefore = (key: string, before: number) => j("/api/thread?key=" + encodeURIComponent(key) + "&limit=60&before=" + (before || 0))
// SYNC de texto completo (backfill grande, liviano): página de 800 hacia atrás → {items, oldestTs, hasMore}
export const getThreadSync = (key: string, before = 0) => j("/api/thread/sync?key=" + encodeURIComponent(key) + "&before=" + (before || 0) + "&limit=800")
export const getPerson = (name: string) => j("/api/person?name=" + encodeURIComponent(name))
// DIRECTORIO COMPLETO de contactos (nodos del vault, no solo los hilos recientes) → { people:[{name,role,tags,initials}], companies:[{name,relation,tags}] }
export const getDirectory = (): Promise<{ people?: any[]; companies?: any[] }> => j("/api/directory")
// buscador CONTEXTUAL: busca dentro del CUERPO de los mensajes (no solo nombres) → [{key,who,ts,dir,text}]
export const searchContent = (q: string) => j("/api/search?q=" + encodeURIComponent(q))
// 🤖 buscador con IA (router): ⚡ facetas (0 tokens) o 🧠 RAG. Mismo endpoint que web/mobile.
// → { mode:"facets"|"rag", type:"find"|…, engine, answer, results:[{key,name,ts,text,media,mediaType,filename}], threads:[{key,name,summary,path}], matches, ragMode, degraded }
export const routerSearch = (q: string) => j("/api/router-search", { method: "POST", body: JSON.stringify({ q }) })
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
export const getTargets = (key: string) => j("/api/thread/targets?key=" + encodeURIComponent(key))
export const sendMsg = (key: string, text: string, t?: any, covert = false) =>
  j("/api/send", { method: "POST", body: JSON.stringify({ key, text, channel: t?.channel, target: t?.target, covert }) })
// modo encubierto (El Santo): config por-contacto + envío cifrado
export const getCovert = (key: string) => j("/api/covert/config?key=" + encodeURIComponent(key))
export const setCovert = (key: string, pass: string, style: string) => j("/api/covert/config", { method: "POST", body: JSON.stringify({ key, pass, style }) })
// abrir un link en el navegador del sistema (no dentro del webview)
export const openExternal = (url: string) => invoke("open_url", { url }).catch(() => {})
export const setPin = (key: string, pinned: boolean) => j("/api/contact/pin", { method: "POST", body: JSON.stringify({ key, pinned }) })
// fusionar contactos duplicados en uno solo: `target` = la clave que se CONSERVA; `keys` = las otras que se absorben. → { moved }
export const mergeContacts = (target: string, keys: string[]): Promise<{ moved?: number }> =>
  j("/api/contact/merge", { method: "POST", body: JSON.stringify({ target, keys }) })
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
export const getLlmConfig = () => j("/api/llm-config")
export const testLlm = (b: { provider: string; token: string }) => j("/api/llm-config/test", { method: "POST", body: JSON.stringify(b) })
export const saveLlm = (b: any) => j("/api/llm-config/save", { method: "POST", body: JSON.stringify(b) })
export const getNotifPrefs = () => j("/api/notif-prefs")
export const saveNotifPrefs = (b: any) => j("/api/notif-prefs", { method: "POST", body: JSON.stringify(b) })
export const suggestReply = (key: string) => j("/api/thread/suggest-reply?key=" + encodeURIComponent(key))
// resumen IA de un audio/video/imagen RECIBIDO: transcribe + resume (traduce si está en otro idioma) → {summary, transcript?, lang?} | {error}
export const summarizeMedia = (id: string): Promise<{ summary?: string; transcript?: string; lang?: string; error?: string }> =>
  j("/api/media/summarize", { method: "POST", body: JSON.stringify({ id }) })
// composer rico (paridad con web/mobile)
export const correctText = (text: string, channel?: string) => j("/api/compose/correct", { method: "POST", body: JSON.stringify({ text, channel }) })
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
// piloto automático
export const getAutopilot = (key: string) => j("/api/autopilot/config?key=" + encodeURIComponent(key))
export const setAutopilot = (key: string, enabled: boolean, maxPerDay = 0) => j("/api/autopilot/config", { method: "POST", body: JSON.stringify({ key, enabled, maxPerDay }) })
export const autopilotFeedback = (key: string, good: boolean, correction = "", original = "") => j("/api/autopilot/feedback", { method: "POST", body: JSON.stringify({ key, good, correction, original }) })
// piloto automático — POLÍTICA GLOBAL (no por-contacto): qué temas escala a vos en vez de responder solo.
export type AutopilotPolicy = { presets: string[]; custom: string[]; presets_available: string[] }
export const getAutopilotPolicy = (): Promise<AutopilotPolicy> => j("/api/autopilot/policy")
export const setAutopilotPolicy = (presets: string[], custom: string[]): Promise<AutopilotPolicy> =>
  j("/api/autopilot/policy", { method: "POST", body: JSON.stringify({ presets, custom }) })
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
  invoke("hub_image", { url: /^https?:\/\//.test(path) ? path : BASE + path, cookie: SID || null }) as Promise<string>
// baja un ARCHIVO/DOCUMENTO del hub (autenticado), lo guarda y lo abre con la app por defecto del SO → devuelve la ruta local
export const hubOpenFile = (path: string, filename?: string): Promise<string> =>
  invoke("hub_open_file", { url: /^https?:\/\//.test(path) ? path : BASE + path, filename: filename || null, cookie: SID || null }) as Promise<string>

export type Thread = {
  key: string; name: string; lastText?: string; ts?: number; unread?: number; unseen?: number
  channels?: string[]; bucket?: string; photo?: string; initials?: string; email?: string; lastDir?: string; autopilot?: boolean
  group?: boolean; pinned?: boolean; silenced?: boolean; escalated?: boolean; escalatedReason?: string
}
export type Msg = { id: string; dir: string; name?: string; text?: string; ts?: number; channel?: string; media?: string | null; mediaType?: string | null; auto?: boolean; summary?: string; covert?: { text: string; style?: string } }
