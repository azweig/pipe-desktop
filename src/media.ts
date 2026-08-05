// 🖼️ Edición de media para el escritorio: collage (canvas), recortar (crop) y el selector — paridad con la app mobile y la web.
// Imperativo (DOM/canvas) para reusar exactamente la lógica de la web dentro del webview de Tauri, sin componentes React.
// Trabaja con Blob (la foto puede venir de un <input type=file> o de un archivo arrastrado leído por Rust → b64 → Blob).

export type MediaItem = { blob: Blob; mime: string; name: string }
type SendOne = (blob: Blob, mime: string, name: string) => Promise<void>

export function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64); const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
export function mimeFromName(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase()
  const M: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", bmp: "image/bmp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", "3gp": "video/3gpp" }
  return M[ext] || "application/octet-stream"
}
const isImg = (m: string) => /^image\//.test(m || "")

function loadImg(blob: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((res, rej) => { const url = URL.createObjectURL(blob); const i = new Image(); i.onload = () => res({ img: i, url }); i.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")) }; i.src = url })
}
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height, cr = w / h; let sw: number, sh: number, sx: number, sy: number
  if (ir > cr) { sh = img.height; sw = sh * cr; sx = (img.width - sw) / 2; sy = 0 } else { sw = img.width; sh = sw / cr; sx = 0; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}
function canvasToBlob(cv: HTMLCanvasElement): Promise<Blob | null> { return new Promise((r) => cv.toBlob((b) => r(b), "image/jpeg", 0.9)) }

// COLLAGE: 2–6 fotos → una sola imagen en grilla (celdas cuadradas, última fila centrada). Misma grilla que la web.
export async function makeCollage(blobs: Blob[], size = 1080, gap = 8, bg = "#ffffff"): Promise<Blob | null> {
  const loaded = await Promise.all(blobs.slice(0, 6).map((b) => loadImg(b).catch(() => null)))
  const imgs = loaded.filter(Boolean) as { img: HTMLImageElement; url: string }[]
  if (!imgs.length) return null
  const n = imgs.length
  const cols = n <= 1 ? 1 : n === 2 ? 2 : n === 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const cell = (size - gap * (cols + 1)) / cols
  const cw = size, ch = Math.round(gap * (rows + 1) + cell * rows)
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch
  const ctx = cv.getContext("2d")!; ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch)
  imgs.forEach((o, i) => {
    const r = Math.floor(i / cols), c = i % cols
    const inRow = Math.min(cols, n - r * cols)
    const rowW = inRow * cell + (inRow - 1) * gap
    const offX = (cw - rowW) / 2
    drawCover(ctx, o.img, offX + c * (cell + gap), gap + r * (cell + gap), cell, cell)
  })
  loaded.forEach((o) => o && URL.revokeObjectURL(o.url))
  return canvasToBlob(cv)
}

// RECORTAR: modal con la foto + rectángulo (mover + 4 esquinas). Devuelve Blob recortado o null si cancelás.
export function cropImage(blob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    loadImg(blob).then(({ img, url }) => {
      const ov = document.createElement("div"); ov.style.cssText = "position:fixed;inset:0;z-index:10000;background:#0e0e14;display:flex;flex-direction:column"
      const stage = document.createElement("div"); stage.style.cssText = "flex:1;display:flex;align-items:center;justify-content:center;padding:14px;overflow:hidden"
      const wrap = document.createElement("div"); wrap.style.cssText = "position:relative;touch-action:none;line-height:0"
      const im = document.createElement("img"); im.src = url; im.style.cssText = "display:block;max-width:92vw;max-height:74vh;user-select:none;-webkit-user-drag:none"
      const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:10px;padding:12px 16px;justify-content:space-between;background:#15151f"
      const bs = "flex:1;padding:12px;border-radius:12px;border:0;font-size:15px;font-weight:700;cursor:pointer"
      bar.innerHTML = `<button id="_crCancel" style="${bs};background:#2a2a38;color:#eee">Cancelar</button><button id="_crOk" style="${bs};background:var(--accent,#6c63ff);color:#fff">✂️ Recortar y enviar</button>`
      wrap.appendChild(im); stage.appendChild(wrap); ov.appendChild(stage); ov.appendChild(bar); document.body.appendChild(ov)
      requestAnimationFrame(() => {
        const dw = im.clientWidth, dh = im.clientHeight
        const box = document.createElement("div"); box.style.cssText = "position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.5);box-sizing:border-box;cursor:move"
        let cx = dw * 0.08, cy = dh * 0.08, cw = dw * 0.84, ch = dh * 0.84
        const apply = () => { box.style.left = cx + "px"; box.style.top = cy + "px"; box.style.width = cw + "px"; box.style.height = ch + "px" }
        for (const pos of ["nw", "ne", "sw", "se"]) { const h = document.createElement("div"); h.dataset.h = pos; const yg = pos[0] === "n" ? "top:-9px" : "bottom:-9px", xg = pos[1] === "w" ? "left:-9px" : "right:-9px"; h.style.cssText = `position:absolute;width:18px;height:18px;background:#fff;border-radius:50%;${yg};${xg};cursor:${pos}-resize`; box.appendChild(h) }
        wrap.appendChild(box); apply()
        let drag: any = null
        const clamp = () => { cw = Math.max(30, Math.min(cw, dw)); ch = Math.max(30, Math.min(ch, dh)); cx = Math.max(0, Math.min(cx, dw - cw)); cy = Math.max(0, Math.min(cy, dh - ch)) }
        box.addEventListener("pointerdown", (e: any) => { e.preventDefault(); const h = e.target?.dataset?.h; drag = { mode: h || "move", sx: e.clientX, sy: e.clientY, cx, cy, cw, ch }; box.setPointerCapture?.(e.pointerId) })
        wrap.addEventListener("pointermove", (e: any) => {
          if (!drag) return; const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
          if (drag.mode === "move") { cx = drag.cx + dx; cy = drag.cy + dy }
          else { const w = drag.mode[1] === "w", nn = drag.mode[0] === "n"
            if (w) { cx = drag.cx + dx; cw = drag.cw - dx } else { cw = drag.cw + dx }
            if (nn) { cy = drag.cy + dy; ch = drag.ch - dy } else { ch = drag.ch + dy } }
          clamp(); apply()
        })
        wrap.addEventListener("pointerup", () => { drag = null })
        const finish = (ok: boolean) => { try { document.body.removeChild(ov) } catch {} URL.revokeObjectURL(url)
          if (!ok) return resolve(null)
          const scX = img.naturalWidth / dw, scY = img.naturalHeight / dh
          const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(cw * scX)); cv.height = Math.max(1, Math.round(ch * scY))
          cv.getContext("2d")!.drawImage(img, cx * scX, cy * scY, cw * scX, ch * scY, 0, 0, cv.width, cv.height)
          canvasToBlob(cv).then(resolve)
        }
        ;(ov.querySelector("#_crCancel") as HTMLElement).onclick = () => finish(false)
        ;(ov.querySelector("#_crOk") as HTMLElement).onclick = () => finish(true)
      })
    }).catch(() => resolve(null))
  })
}

// modal simple de 2 opciones (imperativo) → devuelve "a" | "b" | null
function choose(title: string, sub: string, aLabel: string, bLabel: string): Promise<"a" | "b" | null> {
  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(10,10,16,.55);display:flex;align-items:flex-end;justify-content:center"
    const card = document.createElement("div"); card.style.cssText = "background:var(--bg,#fff);color:var(--ink,#111);width:min(440px,94vw);border-radius:18px 18px 0 0;padding:20px 18px 24px;margin:0 auto"
    const bs = "width:100%;padding:13px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;border:1px solid var(--line,#ddd)"
    card.innerHTML = `<h2 style="margin:0 0 4px;font-size:18px">${title}</h2><div style="color:var(--muted,#888);font-size:13px;margin:0 0 16px">${sub}</div>
      <button id="_mA" style="${bs};background:var(--accent,#6c63ff);color:#fff;border-color:transparent;margin-bottom:8px">${aLabel}</button>
      <button id="_mB" style="${bs};background:transparent;color:var(--ink,#111)">${bLabel}</button>`
    ov.appendChild(card); document.body.appendChild(ov)
    const done = (v: "a" | "b" | null) => { try { document.body.removeChild(ov) } catch {} resolve(v) }
    ov.addEventListener("click", (e) => { if (e.target === ov) done(null) })
    ;(card.querySelector("#_mA") as HTMLElement).onclick = () => done("a")
    ;(card.querySelector("#_mB") as HTMLElement).onclick = () => done("b")
  })
}

// SELECTOR: 2+ fotos → collage o por separado; 1 foto → recortar o enviar; videos/mixto → directo. Envía con el callback `send`.
export async function chooseAndSendMedia(items: MediaItem[], send: SendOne, opts: { channelIsEmail?: boolean } = {}): Promise<void> {
  const list = items.filter((it) => it && it.blob && it.blob.size)
  if (!list.length) return
  if (opts.channelIsEmail) { alert("Por ahora las fotos/videos van por WhatsApp/Telegram/etc., no por email."); return }
  const allImgs = list.every((it) => isImg(it.mime))
  const sendAll = async () => { for (const it of list) await send(it.blob, it.mime, it.name) }
  if (allImgs && list.length >= 2) {
    const c = await choose(`${list.length} fotos`, "¿Cómo las mando?", "🧩 Hacer collage (1 imagen)", `📤 Enviar por separado (${list.length})`)
    if (c === "a") { const col = await makeCollage(list.map((i) => i.blob)).catch(() => null); if (col) await send(col, "image/jpeg", "collage.jpg"); else alert("No pude armar el collage.") }
    else if (c === "b") await sendAll()
  } else if (allImgs && list.length === 1) {
    const c = await choose("Foto", "¿Querés recortarla?", "✂️ Recortar y enviar", "📤 Enviar tal cual")
    if (c === "a") { const cr = await cropImage(list[0].blob).catch(() => null); if (cr) await send(cr, "image/jpeg", "recorte.jpg") }
    else if (c === "b") await send(list[0].blob, list[0].mime, list[0].name)
  } else { await sendAll() }
}
