// i18n de la app de ESCRITORIO.
//
// Misma estrategia que el PWA (y los MISMOS diccionarios, ver src/i18n/): el ESPAÑOL es la fuente — las ~400 cadenas viven
// escritas en español dentro de App.tsx — y acá se traducen sobre el DOM con un MutationObserver. Se eligió así en vez de
// migrar los ~400 call-sites a t("clave") porque:
//   · permite sumar idiomas sin volver a tocar la app,
//   · comparte diccionario con la web, así una traducción sirve para las dos superficies,
//   · React re-renderiza y el observer vuelve a traducir solo (mutamos nodeValue, que React no rompe).
//
// Una cadena sin traducir queda en español: fallback deliberado, mejor eso que un hueco.
export type Dict = { MAP: Record<string, string>; RULES: [RegExp, string][] }

export type Lang = "es" | "en" | "pt" | "fr" | "de" | "zh" | "ja"
export const LANG_NAMES: Record<Lang, string> = {
  es: "Español", en: "English", pt: "Português", fr: "Français", de: "Deutsch", zh: "中文", ja: "日本語",
}
// Sólo se ofrecen los idiomas que TIENEN diccionario. Listar uno sin traducir sería ofrecer algo que no hace nada.
export const LANGS: Lang[] = ["es", "en", "pt"]

const KEY = "lang"

export function currentLang(): Lang {
  try { const s = localStorage.getItem(KEY) as Lang | null; if (s && (LANGS as readonly string[]).includes(s)) return s } catch { /* sin storage */ }
  try {
    const n = (navigator.language || "es").slice(0, 2).toLowerCase()
    return (LANGS as readonly string[]).includes(n) ? (n as Lang) : "es"
  } catch { return "es" }
}

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l) } catch { /* sin storage */ }
  location.reload() // recargar es lo más simple y seguro: no hay que re-traducir texto ya mutado
}

let MAP: Record<string, string> = {}
let RULES: [RegExp, string][] = []

function trStr(raw: string): string | null {
  const key = raw.trim(); if (!key) return null
  if (MAP[key]) return raw.replace(key, MAP[key])
  for (const [re, rep] of RULES) {
    if (re.test(key)) { const out = key.replace(re, rep); if (out !== key) return raw.replace(key, out) }
  }
  return null
}

const ATTRS = ["placeholder", "title", "aria-label", "alt", "data-tip"] // data-tip: los tooltips propios del escritorio
function trEl(el: Element) {
  for (const a of ATTRS) {
    if (!el.hasAttribute?.(a)) continue
    const v = el.getAttribute(a); const k = v?.trim()
    if (k && MAP[k]) el.setAttribute(a, v!.replace(k, MAP[k]))
  }
}

function walk(node: Node) {
  if (!node) return
  if (node.nodeType === 3) { const t = trStr(node.nodeValue || ""); if (t != null) node.nodeValue = t; return }
  if (node.nodeType !== 1) return
  const el = node as Element
  const tag = el.tagName
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "SVG" || tag === "PATH" || tag === "TEXTAREA" || tag === "INPUT") { trEl(el); return }
  trEl(el)
  for (let c = node.firstChild; c; c = c.nextSibling) walk(c)
}

function observe() {
  try {
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") m.addedNodes.forEach((n) => walk(n))
        else if (m.type === "characterData" && m.target) {
          const t = trStr(m.target.nodeValue || "")
          if (t != null && t !== m.target.nodeValue) m.target.nodeValue = t
        }
      }
    })
    obs.observe(document.body, { childList: true, subtree: true, characterData: true })
  } catch { /* sin observer: al menos queda la pasada inicial */ }
}

// Los diccionarios se cargan bajo demanda: el bundle no arrastra los 6 idiomas.
// Agregar un idioma = copiar su diccionario a src/i18n/ (los comparte con la web), sumarlo acá y a LANGS.
const DICTS: Record<string, () => Promise<{ default: Dict }>> = {
  en: () => import("./i18n/en.js"),
  pt: () => import("./i18n/pt.js"),
}

/** Arranca la traducción. Llamar UNA vez, antes de montar React. */
export async function initI18n() {
  const lang = currentLang()
  try { document.documentElement.lang = lang } catch { /* da igual */ }
  if (lang === "es") return // fuente: nada que traducir
  const load = DICTS[lang]
  if (!load) return
  try {
    const d = (await load()).default
    MAP = d.MAP || {}; RULES = d.RULES || []
    if (document.body) walk(document.body)
    observe()
  } catch { /* idioma sin traducir todavía → queda español */ }
}

/** Traduce una cadena suelta (para texto que no pasa por el DOM: alert(), notificaciones del sistema…). */
export function t(es: string): string {
  const out = trStr(es)
  return out == null ? es : out
}
