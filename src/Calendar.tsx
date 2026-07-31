import { useEffect, useMemo, useState } from "react"
import { getCalendar, getMeeting } from "./api"

const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const pad = (n: number) => String(n).padStart(2, "0")
const startMin = (e: any) => { const [h, m] = String(e.t1 || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0) }
const parseD = (s: string) => new Date(s + "T12:00:00")

// reparte los eventos que se solapan en columnas paralelas (como Google Calendar)
function layoutDay(list: any[]) {
  const s = [...list].sort((a, b) => startMin(a) - startMin(b) || (b.durationMin || 30) - (a.durationMin || 30))
  const colEnd: number[] = []
  for (const e of s) {
    const sm = startMin(e), em = sm + (e.durationMin || 30)
    let c = 0; while (c < colEnd.length && sm < colEnd[c]) c++
    e._col = c; colEnd[c] = em
  }
  const tot = Math.max(1, colEnd.length); s.forEach((e) => (e._cols = tot))
  return s
}

export default function Calendar({ onOpenContact, onOpenMeeting }: { onOpenContact?: (name: string) => void; onOpenMeeting?: (id: string) => void }) {
  const [view, setView] = useState<"dia" | "laboral" | "semana" | "mes">("semana")
  const [date, setDate] = useState("")
  const [d, setD] = useState<any>(null)
  const [ev, setEv] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [calOff, setCalOff] = useState<Set<string>>(new Set()) // calendarios/categorías apagados
  const [now, setNow] = useState(() => new Date())             // hora actual → línea "ahora" en la grilla (se refresca cada minuto)

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id) }, [])
  useEffect(() => { getCalendar(view, date).then(setD).catch(() => {}) }, [view, date])
  useEffect(() => { setDetail(null); if (ev?.id) getMeeting(ev.id).then(setDetail).catch(() => {}) }, [ev])

  const days: string[] = (d?.days || [])
  const evs: any[] = (d?.events || []).filter((e: any) => !calOff.has(e.catLabel)) // filtro por calendario seleccionado
  const k = d?.kpis || {}
  const base = d ? parseD(d.base || d.today) : new Date()
  const isWeek = view !== "dia"
  const step = view === "semana" ? 7 : view === "laboral" ? 7 : view === "mes" ? 30 : 1
  const shift = (dir: number) => { const b = new Date((d?.base || new Date().toISOString().slice(0, 10)) + "T12:00:00"); b.setDate(b.getDate() + dir * step); setDate(b.toISOString().slice(0, 10)); setEv(null) }

  // rango de horas de la grilla (según eventos)
  const { H0, H1, rowH } = useMemo(() => {
    let h0 = 8, h1 = 19
    for (const e of evs) { const sm = startMin(e), em = sm + (e.durationMin || 30); h0 = Math.min(h0, Math.floor(sm / 60)); h1 = Math.max(h1, Math.ceil(em / 60)) }
    return { H0: Math.max(6, h0), H1: Math.min(23, h1), rowH: 46 }
  }, [evs])
  const hours = []; for (let h = H0; h <= H1; h++) hours.push(h)

  const title = d ? (isWeek && days.length ? `${parseD(days[0]).getDate()}–${parseD(days[days.length - 1]).getDate()} ${MES[parseD(days[days.length - 1]).getMonth()]}` : `${base.getDate()} ${MES[base.getMonth()]}`) : ""
  const gridDays = isWeek ? days : [d?.base].filter(Boolean)

  return (
    <div className="cal">
      {/* sidebar del calendario */}
      <div className="calside">
        <button className="newbtn" style={{ marginBottom: 14 }}>＋ Nuevo evento</button>
        <MiniMonth base={base} today={d?.today} />
        <div className="calkpis">
          <div className="calkpi"><b>{k.count ?? "—"}</b><span>eventos</span></div>
          <div className="calkpi"><b>{k.freeH != null ? k.freeH + "h" : "—"}</b><span>libre</span></div>
          <div className="calkpi"><b>{k.busyH != null ? k.busyH + "h" : "—"}</b><span>ocupado</span></div>
          <div className={"calkpi" + (k.overlaps > 0 ? " amber" : "")}><b>{k.overlaps ?? 0}</b><span>se pisan</span></div>
        </div>
        <div className="cgrp">Calendarios</div>
        {(k.catBars || []).map((c: any) => (
          <div key={c.label} className={"callist" + (calOff.has(c.label) ? " off" : "")} onClick={() => setCalOff((p) => { const n = new Set(p); n.has(c.label) ? n.delete(c.label) : n.add(c.label); return n })}>
            <span className="cbx" style={{ background: c.color }} />{c.label}<span className="ch">{c.h}h</span>
          </div>
        ))}
        {!(k.catBars || []).length && ["Trabajo", "Familia", "Salud"].map((l, i) => (
          <div key={l} className="callist"><span className="cbx" style={{ background: ["#6366f1", "#e0872b", "#22a06b"][i] }} />{l}</div>
        ))}
        <div className="cgrp">Prioridad</div>
        {[["Muy importante", "#e2483d"], ["Importante", "#e0872b"], ["Flexible", "#22a06b"]].map(([l, c]) => (
          <div key={l} className="callist"><span className="pbar" style={{ background: c }} />{l}</div>
        ))}
      </div>

      {/* grilla */}
      <div className="calmain">
        <div className="calhead">
          <button className="newbtn" style={{ width: "auto", padding: "8px 14px" }}>＋ Nuevo evento</button>
          <button className="cnav" onClick={() => shift(-1)}>‹</button>
          <button className="cnav" onClick={() => shift(1)}>›</button>
          <div className="ctitle">{title}</div>
          {date && <button className="chip2" onClick={() => { setDate(""); setEv(null) }}>Hoy</button>}
          <div className="ctabs">
            {(["dia", "semana", "mes"] as const).map((v) => <button key={v} className={"ctab" + (view === v ? " on" : "")} onClick={() => { setView(v); setEv(null) }}>{v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}</button>)}
          </div>
          <button className="optbtn">✦ Optimizar semana</button>
        </div>

        <div className="wkscroll">
          <div className="wkhead">
            <div className="wkaxis-sp" />
            {gridDays.map((day) => { const dt = parseD(day); const on = day === d?.today; return (
              <div key={day} className={"wkh" + (on ? " on" : "")}><span>{WD[dt.getDay()]}</span><b>{dt.getDate()}</b></div>
            )})}
          </div>
          <div className="wkgrid" style={{ height: (H1 - H0) * rowH + 20 }}>
            <div className="wkaxis">{hours.map((h, i) => <div key={h} className="wkhr" style={{ top: i * rowH }}>{h}:00</div>)}</div>
            <div className="wkcols" style={{ gridTemplateColumns: `repeat(${gridDays.length},1fr)` }}>
              {gridDays.map((day) => {
                const list = layoutDay(evs.filter((e) => e.day === day))
                const isToday = day === d?.today
                const nowMin = now.getHours() * 60 + now.getMinutes()
                const showNow = isToday && nowMin >= H0 * 60 && nowMin <= H1 * 60
                return (
                  <div key={day} className="wkcol">
                    {hours.map((h, i) => <div key={h} className="wkline" style={{ top: i * rowH }} />)}
                    {showNow ? <div className="wknow" style={{ top: (nowMin - H0 * 60) * rowH / 60 }}><span className="wknow-dot" /></div> : null}
                    {list.map((e) => {
                      const sm = startMin(e), top = (sm - H0 * 60) * rowH / 60, h = Math.max(22, (e.durationMin || 30) * rowH / 60)
                      const w = 100 / (e._cols || 1), left = (e._col || 0) * w
                      return (
                        <div key={e.id} className="wkev" onClick={() => setEv(e)} style={{ top, height: h, left: `calc(${left}% + 1px)`, width: `calc(${w}% - 2px)`, background: (e.color || "#6366f1") + "22", borderLeft: `3px solid ${e.color || "#6366f1"}` }}>
                          <div className="wkev-t" style={{ color: e.color }}>{e.t1}</div>
                          <div className="wkev-ti">{e.icon} {e.title}</div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* detalle del evento */}
      {ev && (
        <div className="caldetail">
          <div className="cdeye">{ev.catLabel || "Evento"}{ev.location?.includes("Teams") ? " · Teams" : ""}</div>
          <h3>{ev.icon} {ev.title}</h3>
          <div className="cdtime">{parseD(ev.day) && `${WD[parseD(ev.day).getDay()]} ${parseD(ev.day).getDate()} ${MES[parseD(ev.day).getMonth()]}`} · {ev.t1}–{ev.t2}</div>
          {ev.url ? <a className="joinbtn" href={ev.url} target="_blank" rel="noopener">📹 Unirse</a> : (ev.location?.includes("Teams") || ev.location?.includes("Meet")) ? <button className="joinbtn">📹 Unirse</button> : null}
          <div className="rsvp">Sin responder <span className="rsvptag">RSVP</span></div>
          {(ev.objetivo || detail?.objetivo) && (<div className="cdbox obj"><div className="cdglabel">◎ Objetivo</div>{ev.objetivo?.title || detail?.objetivo?.title || detail?.objetivo}</div>)}
          <div className="cdglabel" style={{ marginTop: 18 }}>Invitados{ev.nAtt ? ` · ${ev.nAtt}` : ""}</div>
          {(detail?.attendees || []).slice(0, 8).map((a: any, i: number) => (
            <div key={i} className={"cdatt" + (onOpenContact && a.name ? " clk" : "")} onClick={() => a.name && onOpenContact?.(a.name)} title={onOpenContact ? "Abrir conversación" : ""}>
              <span className="cdav">{(a.initials || (a.name || "?")[0] || "?").toUpperCase()}</span>
              <div><div className="cdan">{a.name}</div>{a.org ? <div className="cdao">{a.org}</div> : null}</div>
              {a.status ? <span className={"cdst " + (a.status === "accepted" ? "ok" : "")}>{a.status === "accepted" ? "Aceptó" : "Sin resp."}</span> : null}
            </div>
          ))}
          {ev.location && !ev.location.includes("Teams") && !ev.location.includes("Meet") && <div className="cdbox" style={{ marginTop: 14 }}>📍 {ev.location}</div>}
          {ev.prepReady && <div className="cdbox" style={{ marginTop: 14, color: "var(--accent-ink)" }}>✦ Preparación lista</div>}
          {ev.id && onOpenMeeting && <button className="mbtn" style={{ marginTop: 16, width: "100%" }} onClick={() => onOpenMeeting(ev.id)}>Ver detalles de la reunión</button>}
        </div>
      )}
    </div>
  )
}

function MiniMonth({ base, today }: { base: Date; today?: string }) {
  const y = base.getFullYear(), m = base.getMonth()
  const first = new Date(y, m, 1), start = (first.getDay() + 6) % 7 // lunes primero
  const dim = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < start; i++) cells.push(null)
  for (let dd = 1; dd <= dim; dd++) cells.push(dd)
  const todayN = today && parseD(today).getMonth() === m ? parseD(today).getDate() : -1
  return (
    <div className="mini">
      <div className="mtitle">{["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][m]} {y}</div>
      <div className="mgrid">
        {["L", "M", "M", "J", "V", "S", "D"].map((w, i) => <span key={i} className="mwd">{w}</span>)}
        {cells.map((c, i) => <span key={i} className={"mday" + (c === todayN ? " on" : "") + (c === base.getDate() ? " sel" : "")}>{c || ""}</span>)}
      </div>
    </div>
  )
}
