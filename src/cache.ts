// Caché local persistente (IndexedDB) — igual que web (IndexedDB) y mobile (expo-sqlite): la historia de cada hilo vive en
// el disco de la app; de la red solo se baja el DELTA (mensajes con rev > el maxRev que ya tengo). Abrir un hilo = instantáneo.
import type { Msg } from "./api"

let _db: Promise<IDBDatabase> | null = null
function idb(): Promise<IDBDatabase> {
  if (_db) return _db
  _db = new Promise((res, rej) => {
    const req = indexedDB.open("pipe", 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains("msgs")) { const s = db.createObjectStore("msgs", { keyPath: "id" }); s.createIndex("t", "t") }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "t" })
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  return _db
}
const rq = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const txDone = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error) })

// devuelve la historia local del hilo (ordenada por ts) + su metadata (maxRev, autopilot…)
export async function cacheLoad(key: string): Promise<{ items: Msg[]; meta: any }> {
  try {
    const db = await idb()
    const items = ((await rq(db.transaction("msgs").objectStore("msgs").index("t").getAll(IDBKeyRange.only(key)))) as any[]) || []
    const meta = await rq<any>(db.transaction("meta").objectStore("meta").get(key))
    items.sort((a, b) => (a.ts || 0) - (b.ts || 0))
    return { items, meta: meta || null }
  } catch { return { items: [], meta: null } }
}
// upsert por id (los optimistas "opt-" NO se persisten) + patch de la metadata del hilo
export async function cacheSave(key: string, items: Msg[], metaPatch?: any) {
  try {
    const db = await idb()
    const real = (items || []).filter((it) => it && it.id && !String(it.id).startsWith("opt-"))
    if (real.length) { const tx = db.transaction("msgs", "readwrite"); const st = tx.objectStore("msgs"); for (const it of real) st.put({ ...it, t: key }); await txDone(tx) }
    if (metaPatch) { const cur = (await rq<any>(db.transaction("meta").objectStore("meta").get(key))) || { t: key }; const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put({ ...cur, ...metaPatch, t: key }); await txDone(tx) }
  } catch {}
}
