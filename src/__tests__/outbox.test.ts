// COLA DE ENVÍO — lo que se prueba acá es la decisión que separa los dos errores caros: reintentar para siempre
// algo que nunca va a andar, o rendirse con algo que sí habría salido. Un 502 es reintentable; un 400 no.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { clasificar, esperaReintento, nuevoMsgId } from "../outbox"

describe("clasificar el resultado de un intento", () => {
  it("sin error y sin {error} en el cuerpo → salió", () => {
    expect(clasificar(null, { ok: true })).toBe("ok")
  })
  it("el fallo de red no trae código → reintentar (el hub puede estar reiniciando)", () => {
    expect(clasificar(new Error("network"), null)).toBe("reintentar")
  })
  it("502/503 → reintentar", () => {
    expect(clasificar({ code: 502, message: "bad gateway" }, null)).toBe("reintentar")
    expect(clasificar({ code: 503, message: "no disponible" }, null)).toBe("reintentar")
  })
  it("429 y 408 → reintentar (son transitorios por definición)", () => {
    expect(clasificar({ code: 429 }, null)).toBe("reintentar")
    expect(clasificar({ code: 408 }, null)).toBe("reintentar")
  })
  it("400/403/404 → definitivo: reintentar no lo arregla y quedaría en bucle", () => {
    expect(clasificar({ code: 400, message: "sin canal" }, null)).toBe("definitivo")
    expect(clasificar({ code: 403 }, null)).toBe("definitivo")
    expect(clasificar({ code: 404 }, null)).toBe("definitivo")
  })
  it("el server avisa {pending} → esperar, NO mandar de nuevo", () => {
    expect(clasificar(null, { pending: true })).toBe("reintentar")
  })
  it("HTTP 200 con {error} adentro → definitivo (el hub responde así)", () => {
    expect(clasificar(null, { error: "no encuentro por qué canal responder" })).toBe("definitivo")
  })
  it("un envío ya deduplicado por el server cuenta como salido", () => {
    expect(clasificar(null, { ok: true, dedup: true })).toBe("ok")
  })
})

describe("espera entre reintentos", () => {
  it("crece con cada intento", () => {
    expect(esperaReintento(1)).toBe(2000)
    expect(esperaReintento(2)).toBe(4000)
    expect(esperaReintento(3)).toBe(8000)
  })
  it("tiene techo de 1 min: un hub caído no se martilla ni se abandona", () => {
    expect(esperaReintento(20)).toBe(60000)
    expect(esperaReintento(999)).toBe(60000)
  })
})

describe("msgId", () => {
  it("es distinto en cada mensaje (si se repitiera, el server dedupearía mensajes legítimos)", () => {
    const ids = new Set(Array.from({ length: 200 }, () => nuevoMsgId()))
    expect(ids.size).toBe(200)
  })
  it("funciona aunque el entorno no tenga crypto.randomUUID", () => {
    const orig = globalThis.crypto
    vi.stubGlobal("crypto", {})
    expect(typeof nuevoMsgId()).toBe("string")
    expect(nuevoMsgId().length).toBeGreaterThan(5)
    vi.stubGlobal("crypto", orig)
  })
})
