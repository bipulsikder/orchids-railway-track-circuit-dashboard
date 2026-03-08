import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend,
} from "recharts";

// ─── Constants ────────────────────────────────────────────────────────────────
const V_MIN = 2.4,  V_MAX = 4.0;
const I_MIN = 0.50, I_MAX = 1.50;   // Amps – DC track circuit typical range
const MAX_HISTORY = 20;

const GPS = { lat: "19.0760", lon: "72.8777", place: "Mumbai Central Railway Yard", section: "T-14" };

function isVFault(v)  { return v < V_MIN || v > V_MAX; }
function isIFault(i)  { return i < I_MIN || i > I_MAX; }
function vFaultType(v){ return v < V_MIN ? "UNDER-VOLTAGE" : "OVER-VOLTAGE"; }
function iFaultType(i){ return i < I_MIN ? "UNDER-CURRENT" : "OVER-CURRENT"; }

function ts() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function tsDate() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// current correlates loosely with voltage (V / ~3 Ω track impedance) + noise
function currentFromVoltage(v) {
  const base = v / 2.9;
  return +Math.max(0, base + (Math.random() - 0.5) * 0.08).toFixed(3);
}
function randomNormal() { return +(2.5 + Math.random() * 1.3).toFixed(3); }
function randomFault()  {
  return Math.random() < 0.5
    ? +(1.2 + Math.random() * 1.1).toFixed(3)
    : +(4.1 + Math.random() * 1.4).toFixed(3);
}

// ─── Web-Audio alarm (single beep) ────────────────────────────────────────────
function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beepAt = (t, freq, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = "square";
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    };
    beepAt(ctx.currentTime,       880, 0.12);
    beepAt(ctx.currentTime + 0.15, 660, 0.12);
    beepAt(ctx.currentTime + 0.30, 880, 0.18);
  } catch (_) {}
}

// ─── InfoTooltip ──────────────────────────────────────────────────────────────
function InfoTooltip({ title, rows, position = "bottom" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  const pos = {
    left:   "right-full mr-2 top-1/2 -translate-y-1/2",
    right:  "left-full ml-2 top-1/2 -translate-y-1/2",
    top:    "bottom-full mb-2 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
  }[position];

  return (
    <span ref={ref} className="relative inline-flex items-center" style={{ zIndex: 50 }}>
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(p => !p)}
        className="w-4 h-4 rounded-full bg-[#30363d] hover:bg-[#00bfff]/30 border border-[#484f58] hover:border-[#00bfff]/60 text-[#8b949e] hover:text-[#00bfff] text-[9px] font-bold leading-none flex items-center justify-center transition-all duration-150 flex-shrink-0"
        style={{ fontFamily: "serif" }} aria-label="Info"
      >i</button>

      {open && (
        <div className={`absolute ${pos} w-72 bg-[#1c2333] border border-[#30363d] rounded-xl shadow-2xl pointer-events-none tooltip-enter`} style={{ zIndex: 9999 }}>
          <div className="px-3 py-2 border-b border-[#30363d] bg-[#0d1117] rounded-t-xl">
            <span className="text-[#00bfff] text-xs font-bold tracking-wide">{title}</span>
          </div>
          <div className="px-3 py-2 flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                {r.icon && <span className="text-sm flex-shrink-0 mt-0.5">{r.icon}</span>}
                <div>
                  {r.label && <div className="text-[#8b949e] text-[10px] font-semibold uppercase tracking-wider mb-0.5">{r.label}</div>}
                  <div className="text-[#c9d1d9] text-xs leading-relaxed">{r.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

// ─── LED Indicator ────────────────────────────────────────────────────────────
function LED({ on, fault, size = "md" }) {
  const sz = size === "lg" ? "w-4 h-4" : size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3";
  const color = fault ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : on ? "bg-green-400 shadow-[0_0_8px_#22c55e]" : "bg-[#30363d]";
  return (
    <span className="relative flex-shrink-0">
      <span className={`${sz} rounded-full inline-block ${color} transition-all duration-300`} />
      {fault && <span className={`${sz} rounded-full absolute inset-0 bg-red-500 animate-ping opacity-60`} />}
      {on && !fault && <span className={`${sz} rounded-full absolute inset-0 bg-green-400 animate-pulse opacity-40`} />}
    </span>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SecLabel({ text, tooltip }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <span className="text-[#8b949e] text-[10px] font-semibold uppercase tracking-widest">{text}</span>
      {tooltip && <InfoTooltip {...tooltip} />}
    </div>
  );
}

// ─── Stat card header ─────────────────────────────────────────────────────────
function CardHead({ label, tooltip, position = "bottom" }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[#8b949e] text-[10px] font-semibold uppercase tracking-widest flex-1">{label}</span>
      {tooltip && <InfoTooltip {...tooltip} position={position} />}
    </div>
  );
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────
function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1c2333] border border-[#30363d] rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-[#8b949e] font-mono mb-1.5">{d.timestamp}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-[#8b949e] text-[10px] uppercase">{p.dataKey}</span>
          <span className={`font-mono font-bold ml-auto ${p.payload.isFault ? "text-red-400" : p.color === "#00bfff" ? "text-[#00bfff]" : "text-emerald-400"}`}>
            {p.value?.toFixed(3)} {p.dataKey === "voltage" ? "V" : "A"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── LIVE dot ─────────────────────────────────────────────────────────────────
function LiveDot() {
  return (
    <span className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
      </span>
      <span className="text-green-400 text-xs font-bold tracking-widest">LIVE</span>
    </span>
  );
}

// ─── Signal bars ──────────────────────────────────────────────────────────────
function SigBars() {
  return (
    <span className="flex items-end gap-[2px] h-4">
      {[4,7,10,13].map((h,i)=>(
        <span key={i} className="w-1.5 rounded-sm bg-green-400" style={{height:`${h}px`}} />
      ))}
    </span>
  );
}

// ─── Alarm Banner ─────────────────────────────────────────────────────────────
function AlarmBanner({ active, faults }) {
  if (!active) return null;
  return (
    <div className="alarm-flash flex items-center gap-3 bg-red-500/10 border border-red-500/50 rounded-xl px-4 py-3">
      <div className="relative flex-shrink-0">
        <span className="text-3xl">🚨</span>
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
      </div>
      <div className="flex-1">
        <div className="text-red-400 font-bold text-sm tracking-wide">⚠ ALARM ACTIVE — FAULT DETECTED</div>
        <div className="text-red-300/70 text-[10px] mt-0.5 font-mono">
          {faults.join(" · ")}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[#8b949e] text-[10px]">SMS dispatched</div>
        <div className="text-green-400 text-[10px] font-semibold">📱 Maintenance notified</div>
      </div>
    </div>
  );
}

// ─── SMS Preview Card ─────────────────────────────────────────────────────────
function SMSCard({ log }) {
  if (!log) return null;
  return (
    <div className="bg-[#0d1117] border border-green-500/30 rounded-xl p-3 font-mono text-[10px] leading-relaxed">
      <div className="flex items-center gap-2 mb-2 border-b border-[#21262d] pb-2">
        <span className="text-lg">📱</span>
        <div>
          <div className="text-green-400 font-bold text-xs">SMS Dispatched</div>
          <div className="text-[#484f58]">To: Maintenance Officer +91-XXXX-XXXXX</div>
        </div>
        <span className="ml-auto bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/30 text-[10px]">SENT ✓</span>
      </div>
      <div className="text-[#8b949e] whitespace-pre-wrap leading-5">
        <span className="text-[#00bfff]">[ALERT]</span> Indian Railways Track Circuit{"\n"}
        <span className="text-[#8b949e]">Location :</span> <span className="text-[#c9d1d9]">{GPS.place}</span>{"\n"}
        <span className="text-[#8b949e]">Section  :</span> <span className="text-[#c9d1d9]">Track {GPS.section}</span>{"\n"}
        <span className="text-[#8b949e]">GPS      :</span> <span className="text-[#c9d1d9]">{GPS.lat}°N, {GPS.lon}°E</span>{"\n"}
        <span className="text-[#8b949e]">Voltage  :</span> <span className="text-red-400 font-bold">{log.voltage?.toFixed(3)} V</span>{"\n"}
        <span className="text-[#8b949e]">Current  :</span> <span className="text-red-400 font-bold">{log.current?.toFixed(3)} A</span>{"\n"}
        <span className="text-[#8b949e]">Fault    :</span> <span className="text-orange-400 font-bold">{log.faultType}</span>{"\n"}
        <span className="text-[#8b949e]">Time     :</span> <span className="text-[#c9d1d9]">{log.dateTime}</span>{"\n"}
        <span className="text-[#484f58]">Respond immediately. Relay DE-ENERGISED.</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [history, setHistory]       = useState([]);
  const [voltage, setVoltage]       = useState(3.24);
  const [current, setCurrent]       = useState(1.12);
  const [alertLog, setAlertLog]     = useState([]);
  const [stats, setStats]           = useState({ total: 0, normal: 0, faults: 0 });
  const [isAutoSim, setIsAutoSim]   = useState(false);
  const [dashFlash, setDashFlash]   = useState(false);
  const [slider, setSlider]         = useState(3.24);
  const [inputVal, setInputVal]     = useState("3.240");
  const [toast, setToast]           = useState(false);
  const [uptime, setUptime]         = useState(0);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [clock, setClock]           = useState("");
  const [lastSMS, setLastSMS]       = useState(null);
  const [alarmOn, setAlarmOn]       = useState(false);

  const autoRef  = useRef(null);
  const resetRef = useRef(null);
  const startT   = useRef(Date.now());
  const alertId  = useRef(0);
  const prevFault = useRef(false);

  // Clock
  useEffect(() => {
    const tick = () => setClock(
      new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST"
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Uptime
  useEffect(() => {
    const id = setInterval(() => setUptime(Math.floor((Date.now() - startT.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  // ── Core push ──
  const push = useCallback((rawV) => {
    const v   = +Math.max(0, Math.min(6, parseFloat(rawV))).toFixed(3);
    if (isNaN(v)) return;
    const i   = currentFromVoltage(v);
    const vBad = isVFault(v);
    const iBad = isIFault(i);
    const fault = vBad || iBad;
    const now  = ts();
    const nowDT = tsDate();

    setHistory(prev => {
      const next = [...prev, { voltage: v, current: i, timestamp: now, isFault: fault }];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
    setVoltage(v);
    setCurrent(i);
    setSlider(v);
    setInputVal(v.toFixed(3));

    if (fault) {
      const faults = [];
      if (vBad) faults.push(`${vFaultType(v)} (${v.toFixed(3)}V)`);
      if (iBad) faults.push(`${iFaultType(i)} (${i.toFixed(3)}A)`);

      if (!prevFault.current) {
        setDashFlash(true);
        setTimeout(() => setDashFlash(false), 700);
        playAlarm();
        setAlarmOn(true);
      }
      prevFault.current = true;

      const entry = {
        id: ++alertId.current, ts: now, dateTime: nowDT,
        voltage: v, current: i,
        faultType: vBad ? vFaultType(v) : iFaultType(i),
        faults,
      };
      setAlertLog(prev => [entry, ...prev]);
      setLastSMS(entry);
    } else {
      prevFault.current = false;
      setAlarmOn(false);
    }

    setStats(p => ({ total: p.total+1, normal: p.normal+(fault?0:1), faults: p.faults+(fault?1:0) }));
  }, []);

  // Auto sim
  useEffect(() => {
    if (isAutoSim) {
      autoRef.current = setInterval(() => push(Math.random() < 0.85 ? randomNormal() : randomFault()), 3000);
    } else {
      clearInterval(autoRef.current);
    }
    return () => clearInterval(autoRef.current);
  }, [isAutoSim, push]);

  const handlePush = () => {
    const v = parseFloat(inputVal);
    if (isNaN(v)) return;
    push(v);
    setToast(true);
    setTimeout(() => setToast(false), 1500);
  };

  const handleSlider = (e) => {
    const v = parseFloat(e.target.value);
    setSlider(v);
    setInputVal(v.toFixed(3));
    push(v);
  };

  const handleReset = () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      resetRef.current = setTimeout(() => setResetConfirm(false), 3000);
      return;
    }
    clearTimeout(resetRef.current);
    setResetConfirm(false);
    setHistory([]); setVoltage(3.24); setCurrent(1.12);
    setAlertLog([]); setStats({ total:0, normal:0, faults:0 });
    setSlider(3.24); setInputVal("3.240");
    setAlarmOn(false); setLastSMS(null);
    prevFault.current = false;
    startT.current = Date.now();
  };

  const vFault  = isVFault(voltage);
  const iFault  = isIFault(current);
  const anyFault = vFault || iFault;
  const sliderSafe = !isVFault(slider);
  const activeFaults = [
    ...(vFault ? [`${vFaultType(voltage)} — ${voltage.toFixed(3)}V`] : []),
    ...(iFault ? [`${iFaultType(current)} — ${current.toFixed(3)}A`] : []),
  ];

  return (
    <div className={`min-h-screen bg-[#0d1117] text-[#c9d1d9] flex flex-col transition-all duration-300 ${
      dashFlash ? "ring-4 ring-inset ring-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)]" : ""
    }`}>

      {/* ══ NAVBAR ══ */}
      <nav className="bg-[#161b22] border-b border-[#30363d] px-5 py-3 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚆</span>
          <div>
            <div className="font-bold text-white text-sm tracking-wide leading-tight">Track Circuit Remote Monitoring System</div>
            <div className="text-[#8b949e] text-[10px]">Indian Railways · DC Track Circuit · Voltage & Current · Remote Diagnostics</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LED on={!anyFault} fault={anyFault} size="md" />
          <LiveDot />
          <InfoTooltip position="bottom" title="System Status Indicator" rows={[
            { icon: "🟢", label: "Green LED", text: "Both voltage (2.4–4.0V) and current (0.5–1.5A) are within safe operating range. Track section is clear and all systems normal." },
            { icon: "🔴", label: "Red LED flashing", text: "One or both parameters are outside safe range. Alarm has been triggered and SMS dispatched to Maintenance Officer." },
            { icon: "📡", label: "LIVE indicator", text: "Dashboard is connected and receiving data. In production this reflects the 4G link to the STM32 field unit." },
          ]} />
        </div>
        <div className="font-mono text-[#8b949e] text-sm tabular-nums">{clock}</div>
      </nav>

      {/* ══ BODY ══ */}
      <div className="flex flex-1 min-h-0">

        {/* ████████  LEFT — MONITORING DASHBOARD (70%)  ████████ */}
        <div className={`w-[70%] flex flex-col gap-3 p-4 overflow-y-auto border-r transition-all duration-300 ${
          anyFault ? "border-red-500/30" : "border-[#30363d]"
        }`}>

          {/* ALARM BANNER */}
          <AlarmBanner active={anyFault} faults={activeFaults} />

          {/* ── STAT CARDS: row 1 — Voltage + Current ── */}
          <div className="grid grid-cols-2 gap-3">

            {/* Voltage card */}
            <div className={`bg-[#161b22] border rounded-xl p-4 transition-all duration-300 ${
              vFault ? "border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "border-[#00bfff]/30 shadow-[0_0_12px_rgba(0,191,255,0.06)]"
            }`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  <CardHead label="Live Voltage Monitoring" position="bottom" tooltip={{
                    title: "Voltage Monitoring — Use Case",
                    rows: [
                      { icon: "⚡", label: "What it measures", text: "Continuous DC voltage across the track circuit rails, sampled by the STM32 ADC at 10 Hz through an optocoupler-isolated voltage divider." },
                      { icon: "✅", label: "Safe range: 2.4V – 4.0V", text: "Within this band the relay is energised, the signal aspect is GREEN and trains may proceed. Nominal operating point is ~3.0V." },
                      { icon: "🔽", label: "Under-voltage (< 2.4V)", text: "Train shunt detected (axles short the rails), broken rail bond, or feed loss. Relay drops — signal RED." },
                      { icon: "🔼", label: "Over-voltage (> 4.0V)", text: "Transformer tap fault, surge on line, or wrong resistance settings in the feed circuit." },
                      { icon: "🟢", label: "Green light", text: "ON when voltage is within the safe range — visual status at a glance." },
                      { icon: "🔴", label: "Red light + alarm", text: "Triggers when voltage leaves safe range. Alarm beeps and SMS is sent automatically." },
                    ],
                  }} />
                </div>
                <LED on={!vFault} fault={vFault} size="lg" />
              </div>

              <div className={`font-mono text-5xl font-bold tabular-nums transition-all duration-300 mb-2 ${vFault ? "text-red-400" : "text-[#00bfff]"}`}>
                {voltage.toFixed(3)}<span className="text-2xl font-normal ml-1 opacity-70">V</span>
              </div>

              {/* Range bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[9px] font-mono text-[#484f58] mb-1">
                  <span>0V</span><span>2.4V</span><span>4.0V</span><span>6V</span>
                </div>
                <div className="relative h-3 bg-[#21262d] rounded-full overflow-hidden">
                  <div className="absolute left-[40%] right-[33.3%] h-full bg-green-500/20 border-l border-r border-green-500/40" />
                  <div
                    className={`absolute top-0.5 bottom-0.5 w-2 -ml-1 rounded-full transition-all duration-300 ${vFault ? "bg-red-500 shadow-[0_0_6px_#ef4444]" : "bg-[#00bfff] shadow-[0_0_6px_#00bfff]"}`}
                    style={{ left: `${(voltage / 6) * 100}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all duration-300 ${
                  vFault
                    ? "bg-red-500/10 text-red-400 border-red-500/30 fault-blink"
                    : "bg-green-500/10 text-green-400 border-green-500/30"
                }`}>
                  {vFault ? `🔴 ${vFaultType(voltage)}` : "🟢 Voltage in Range"}
                </span>
                <span className="text-[#484f58] text-[10px] font-mono">Safe: 2.4 – 4.0 V</span>
              </div>
            </div>

            {/* Current card */}
            <div className={`bg-[#161b22] border rounded-xl p-4 transition-all duration-300 ${
              iFault ? "border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "border-emerald-500/30 shadow-[0_0_12px_rgba(34,197,94,0.06)]"
            }`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">〰️</span>
                  <CardHead label="Live Current Monitoring" position="bottom" tooltip={{
                    title: "Current Monitoring — Use Case",
                    rows: [
                      { icon: "〰️", label: "What it measures", text: "DC current flowing through the track circuit, derived from voltage ÷ track impedance (~2.9Ω typical for Indian Railways DC circuits)." },
                      { icon: "✅", label: "Safe range: 0.50 – 1.50 A", text: "At nominal 3V / 2.9Ω ≈ 1.03A. Current confirms the voltage reading — both should be in range for normal operation." },
                      { icon: "🔽", label: "Under-current (< 0.50A)", text: "Open circuit condition — broken rail, disconnected bond wire, or very high impedance joint. Current cannot flow." },
                      { icon: "🔼", label: "Over-current (> 1.50A)", text: "Low-resistance fault — wiring short, damaged insulation, or track flooding creating a leakage path." },
                      { icon: "🔗", label: "Correlation with voltage", text: "In a healthy circuit, V and I change proportionally. A voltage drop with current spike indicates a short (train shunt). Both dropping together indicates an open circuit." },
                    ],
                  }} />
                </div>
                <LED on={!iFault} fault={iFault} size="lg" />
              </div>

              <div className={`font-mono text-5xl font-bold tabular-nums transition-all duration-300 mb-2 ${iFault ? "text-red-400" : "text-emerald-400"}`}>
                {current.toFixed(3)}<span className="text-2xl font-normal ml-1 opacity-70">A</span>
              </div>

              {/* Range bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[9px] font-mono text-[#484f58] mb-1">
                  <span>0A</span><span>0.5A</span><span>1.5A</span><span>2A+</span>
                </div>
                <div className="relative h-3 bg-[#21262d] rounded-full overflow-hidden">
                  <div className="absolute left-[25%] right-[25%] h-full bg-green-500/20 border-l border-r border-green-500/40" />
                  <div
                    className={`absolute top-0.5 bottom-0.5 w-2 -ml-1 rounded-full transition-all duration-300 ${iFault ? "bg-red-500 shadow-[0_0_6px_#ef4444]" : "bg-emerald-400 shadow-[0_0_6px_#34d399]"}`}
                    style={{ left: `${Math.min((current / 2) * 100, 98)}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all duration-300 ${
                  iFault
                    ? "bg-red-500/10 text-red-400 border-red-500/30 fault-blink"
                    : "bg-green-500/10 text-green-400 border-green-500/30"
                }`}>
                  {iFault ? `🔴 ${iFaultType(current)}` : "🟢 Current in Range"}
                </span>
                <span className="text-[#484f58] text-[10px] font-mono">Safe: 0.50 – 1.50 A</span>
              </div>
            </div>
          </div>

          {/* ── STAT CARDS: row 2 — Relay + System + Location ── */}
          <div className="grid grid-cols-3 gap-3">

            {/* Relay */}
            <div className={`bg-[#161b22] border rounded-xl p-4 flex flex-col gap-2 transition-all duration-300 ${
              anyFault ? "border-red-500/60 shadow-[0_0_14px_rgba(239,68,68,0.2)]" : "border-[#30363d]"
            }`}>
              <CardHead label="Relay Status" tooltip={{
                title: "QTA2 Track Relay — Use Case",
                rows: [
                  { icon: "🔌", label: "ENERGISED", text: "Relay coil powered (V & I in range). Signal GREEN. Train may proceed through this section." },
                  { icon: "❌", label: "DE-ENERGISED", text: "Relay has dropped. Signal RED. Train MUST NOT proceed. This is the fail-safe state for any fault." },
                  { icon: "🛡️", label: "Fail-safe design", text: "Indian Railways' interlocking principle: the relay must be actively powered to permit movement. Any fault causes de-energisation — never a false clear." },
                ],
              }} />
              <div className="flex items-center gap-2">
                <LED on={!anyFault} fault={anyFault} size="md" />
                {anyFault
                  ? <div className="text-red-400 font-bold text-sm fault-blink">❌ DE-ENERGISED</div>
                  : <div className="text-green-400 font-bold text-sm">⚡ ENERGISED</div>
                }
              </div>
              <div className={`text-[10px] w-fit px-2 py-0.5 rounded-full border ${anyFault ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-green-500/10 text-green-400 border-green-500/30"}`}>
                {anyFault ? "Signal: RED 🔴" : "Signal: GREEN 🟢"}
              </div>
              <div className="text-[#484f58] text-[10px]">QTA2 Track Relay</div>
            </div>

            {/* System condition */}
            <div className={`bg-[#161b22] border rounded-xl p-4 flex flex-col gap-2 transition-all duration-300 ${
              anyFault ? "border-red-500/60 shadow-[0_0_14px_rgba(239,68,68,0.2)]" : "border-[#30363d]"
            }`}>
              <CardHead label="System Condition" tooltip={{
                title: "System Condition — Use Case",
                rows: [
                  { icon: "✅", label: "NORMAL", text: "Both voltage and current are within safe bands. Track is clear, relay energised, signal GREEN." },
                  { icon: "🚨", label: "FAULT DETECTED", text: "One or both parameters out of range. Root cause could be: train presence, broken rail, feed failure, or wiring fault." },
                  { icon: "⏱️", label: "Response time", text: "STM32 samples at 10Hz. Fault declared after ≥300ms persistence — filters momentary transient spikes." },
                ],
              }} />
              <div className="flex items-center gap-2">
                <LED on={!anyFault} fault={anyFault} size="md" />
                {anyFault
                  ? <div className="text-red-400 font-bold text-sm fault-blink">🚨 FAULT DETECTED</div>
                  : <div className="text-green-400 font-bold text-sm">✅ NORMAL</div>
                }
              </div>
              {anyFault && activeFaults.map((f, i) => (
                <div key={i} className="text-orange-400 text-[10px] font-mono font-semibold bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{f}</div>
              ))}
              {!anyFault && <div className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded">Track clear — proceed</div>}
            </div>

            {/* Location */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 flex flex-col gap-2">
              <CardHead label="Device Location" position="left" tooltip={{
                title: "GNSS Location — Use Case",
                rows: [
                  { icon: "📍", label: "Purpose", text: "GPS coordinates let the Control Room identify the exact faulting location on the track map — no manual cross-referencing needed." },
                  { icon: "🛰️", label: "Module", text: "u-blox NEO-M8N. ±2.5m CEP accuracy. NMEA GGA sentences parsed by STM32 UART." },
                  { icon: "📱", label: "In SMS alert", text: "Coordinates, location name, and track section are included in every SMS so the Maintenance Officer can navigate directly to the site." },
                ],
              }} />
              <div className="font-mono text-xs text-[#c9d1d9] font-semibold">
                📍 {GPS.lat}° N<br />&nbsp;&nbsp;&nbsp;&nbsp;{GPS.lon}° E
              </div>
              <div className="text-[#484f58] text-[10px]">{GPS.place} · {GPS.section}</div>
              <div className="flex items-center gap-1.5 mt-auto">
                <SigBars />
                <span className="text-green-400 text-[10px] font-bold">4G ●●●● Connected</span>
              </div>
            </div>
          </div>

          {/* ── LINE CHART ── */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-sm">📈 Voltage & Current — Real-Time Feed</span>
                <InfoTooltip position="right" title="Dual-Line Chart — Use Case" rows={[
                  { icon: "🔵", label: "Blue line (Voltage)", text: "DC track circuit voltage in Volts. Watch for it breaching the orange (min) or red (max) dashed reference lines." },
                  { icon: "🟢", label: "Green line (Current)", text: "Derived DC current in Amps. Correlates with voltage — both should track proportionally in a healthy circuit." },
                  { icon: "🟩", label: "Shaded band", text: "The voltage safe zone (2.4–4.0V). Current safe zone (0.5–1.5A) is shown separately on the right Y-axis in the second chart." },
                  { icon: "🔴", label: "Red dots", text: "Data points where a fault condition existed at that reading." },
                ]} />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-[#8b949e]">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#00bfff] inline-block rounded" /> Voltage (V)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" /> Current (A)</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Fault</span>
                <span className="font-mono">{Math.min(history.length, MAX_HISTORY)} / {MAX_HISTORY}</span>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="h-[240px] flex flex-col items-center justify-center gap-2 text-[#484f58]">
                <span className="text-2xl">📡</span>
                <span className="text-sm">Push a reading to populate the chart</span>
                <span className="text-[10px]">Use the Operator Panel on the right →</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={history} margin={{ top: 10, right: 40, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <XAxis dataKey="timestamp" tick={{ fill: "#8b949e", fontSize: 9, fontFamily: "monospace" }} axisLine={{ stroke: "#30363d" }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="v" domain={[0, 6]} ticks={[0,1,2,3,4,5,6]} tick={{ fill: "#8b949e", fontSize: 9 }} axisLine={{ stroke: "#30363d" }} tickLine={false} tickFormatter={v => `${v}V`} width={30} />
                  <YAxis yAxisId="i" orientation="right" domain={[0, 2]} ticks={[0,0.5,1.0,1.5,2.0]} tick={{ fill: "#8b949e", fontSize: 9 }} axisLine={{ stroke: "#30363d" }} tickLine={false} tickFormatter={v => `${v}A`} width={30} />
                  <Tooltip content={<ChartTip />} />

                  {/* Voltage safe zone */}
                  <ReferenceArea yAxisId="v" y1={V_MIN} y2={V_MAX} fill="#22c55e" fillOpacity={0.06} ifOverflow="hidden" />
                  <ReferenceLine yAxisId="v" y={V_MIN} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5}
                    label={{ value: "V-Min (2.4V)", position: "insideTopLeft", fill: "#f59e0b", fontSize: 9, dx: 6, dy: -4 }} />
                  <ReferenceLine yAxisId="v" y={V_MAX} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5}
                    label={{ value: "V-Max (4.0V)", position: "insideTopLeft", fill: "#ef4444", fontSize: 9, dx: 6, dy: -4 }} />

                  {/* Current safe zone */}
                  <ReferenceArea yAxisId="i" y1={I_MIN} y2={I_MAX} fill="#34d399" fillOpacity={0.04} ifOverflow="hidden" />

                  <Line yAxisId="v" type="monotone" dataKey="voltage" stroke="#00bfff" strokeWidth={2}
                    dot={({ cx, cy, payload }) => payload?.isFault
                      ? <circle key={`v${cx}`} cx={cx} cy={cy} r={6} fill="#ef4444" stroke="#ff8888" strokeWidth={1.5} />
                      : <circle key={`v${cx}`} cx={cx} cy={cy} r={3} fill="#00bfff" />
                    }
                    activeDot={{ r: 5 }} isAnimationActive animationDuration={350} />

                  <Line yAxisId="i" type="monotone" dataKey="current" stroke="#34d399" strokeWidth={1.5}
                    dot={({ cx, cy, payload }) => payload?.isFault
                      ? <circle key={`i${cx}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#ff8888" strokeWidth={1} />
                      : <circle key={`i${cx}`} cx={cx} cy={cy} r={2.5} fill="#34d399" />
                    }
                    activeDot={{ r: 4 }} isAnimationActive animationDuration={350} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── ALERT LOG ── */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-white font-semibold text-sm">⚠️ Alert Log</span>
              <InfoTooltip position="right" title="Alert Log — Use Case" rows={[
                { icon: "📋", label: "Purpose", text: "Complete fault record for this session. Each row is a voltage/current breach that triggered an alarm and SMS dispatch." },
                { icon: "📱", label: "SMS content", text: "Every entry includes: location name, GPS coords, voltage, current, fault type, and IST timestamp — exactly what's sent to the Maintenance Officer." },
                { icon: "🔴", label: "UNDER-VOLTAGE", text: "Train shunt or broken bond wire. Field team checks track occupation and rail continuity." },
                { icon: "🔴", label: "OVER-VOLTAGE", text: "Feed transformer fault or surge. Field team inspects transformer taps and surge arrestors." },
              ]} />
              {alertLog.length > 0 && (
                <span className="ml-auto bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-red-500/40">
                  {alertLog.length} fault{alertLog.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {alertLog.length === 0 ? (
              <div className="text-[#484f58] text-sm text-center py-8 flex flex-col items-center gap-2">
                <LED on size="lg" />
                <span>No faults recorded in this session</span>
              </div>
            ) : (
              <div className="overflow-auto max-h-[200px] rounded-lg border border-[#21262d]">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-[#0d1117] text-[#8b949e] uppercase tracking-wider text-[10px]">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Time</th>
                      <th className="px-3 py-2 text-left">Voltage</th>
                      <th className="px-3 py-2 text-left">Current</th>
                      <th className="px-3 py-2 text-left">Fault Type</th>
                      <th className="px-3 py-2 text-left">SMS Dispatched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertLog.map((r, i) => (
                      <tr key={r.id} className="border-t border-[#21262d] hover:bg-red-950/20 transition-colors" style={{ background: "rgba(239,68,68,0.05)" }}>
                        <td className="px-3 py-2.5 font-mono text-[#8b949e]">{alertLog.length - i}</td>
                        <td className="px-3 py-2.5 font-mono text-[#c9d1d9]">{r.ts}</td>
                        <td className="px-3 py-2.5 font-mono font-bold text-red-400">{r.voltage.toFixed(3)} V</td>
                        <td className="px-3 py-2.5 font-mono font-bold text-orange-400">{r.current.toFixed(3)} A</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.faultType.includes("UNDER")
                              ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
                              : "bg-red-500/20 text-red-400 border border-red-500/40"
                          }`}>{r.faultType}</span>
                        </td>
                        <td className="px-3 py-2.5 text-green-400 text-[10px]">📱 ✓ Officer notified</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── LATEST SMS PREVIEW ── */}
          {lastSMS && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-white font-semibold text-sm">📱 Last SMS Dispatched</span>
                <InfoTooltip position="right" title="SMS Alert Content — Use Case" rows={[
                  { icon: "📱", label: "What is sent", text: "On every new fault, the STM32 sends an AT+CMGS command to the SIM800L module. This is the exact text the Maintenance Officer receives on their mobile." },
                  { icon: "📍", label: "Location in SMS", text: "GPS coordinates + yard name + track section are included so the officer can navigate directly to the fault location." },
                  { icon: "⚡", label: "Voltage & Current", text: "Both measured values are included for initial remote diagnosis — allowing the officer to determine likely cause before arriving on site." },
                  { icon: "🕐", label: "Timestamp", text: "IST date + time included for maintenance log compliance as required by Indian Railways safety procedures." },
                ]} />
              </div>
              <SMSCard log={lastSMS} />
            </div>
          )}

          {/* ── GPS MAP ── */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: `linear-gradient(rgba(0,191,255,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,191,255,0.06) 1px,transparent 1px)`,
              backgroundSize: "28px 28px",
            }} />
            <div className="absolute top-2 left-2 text-[9px] font-mono text-[#30363d]">18.9°N 72.7°E</div>
            <div className="absolute top-2 right-2 text-[9px] font-mono text-[#30363d]">19.2°N 73.0°E</div>
            <div className="absolute bottom-2 left-2 text-[9px] font-mono text-[#30363d]">18.8°N 72.7°E</div>
            <div className="absolute bottom-2 right-2 text-[9px] font-mono text-[#30363d]">18.8°N 73.0°E</div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">📍 GPS — Device Location</span>
                  <InfoTooltip position="right" title="GPS Panel — Use Case" rows={[
                    { icon: "🗺️", label: "CTC integration", text: "Coordinates are broadcast with every data packet so Central Traffic Control's track diagram auto-highlights the faulting section." },
                    { icon: "📱", label: "SMS use", text: "Lat/Lon included in the SMS alert — Maintenance Officer can tap the coordinates to open Google Maps navigation." },
                    { icon: "🛰️", label: "HDOP 0.9", text: "Horizontal Dilution of Precision < 1.0 = excellent satellite geometry. Position accuracy ±2.5m." },
                  ]} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5"><SigBars /><span className="text-green-400 text-xs font-semibold">4G LTE Active</span></div>
                  <span className="bg-[#00bfff]/10 text-[#00bfff] text-xs px-2.5 py-0.5 rounded-full border border-[#00bfff]/30 font-mono font-semibold">STM32 Online</span>
                </div>
              </div>
              <div className="flex flex-col items-center py-5">
                <div className="text-5xl mb-3 drop-shadow-[0_0_20px_rgba(0,191,255,0.5)]">📡</div>
                <div className="font-mono text-2xl font-bold text-[#00bfff] tracking-wider">{GPS.lat}° N &nbsp;|&nbsp; {GPS.lon}° E</div>
                <div className="text-[#8b949e] text-sm mt-2">{GPS.place} — Track Section {GPS.section}</div>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="bg-green-500/10 text-green-400 text-xs px-3 py-1 rounded-full border border-green-500/30">● GPS Fix Acquired</span>
                  <span className="bg-[#00bfff]/10 text-[#00bfff] text-xs px-3 py-1 rounded-full border border-[#00bfff]/30">● HDOP: 0.9 (Excellent)</span>
                  <span className="bg-purple-500/10 text-purple-400 text-xs px-3 py-1 rounded-full border border-purple-500/30">● Satellites: 8 / 12</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── FOOTER ── */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl px-4 py-3">
            <div className="flex flex-wrap gap-2 mb-1.5">
              {[
                ["🧠","STM32 Microcontroller"],["📶","4G Cellular Module"],
                ["🛰️","GNSS Module"],["⚡","Voltage Sensor"],
                ["〰️","Current Sensor"],["🛡️","Optocoupler Isolation"],
              ].map(([icon,label]) => (
                <span key={label} className="bg-[#21262d] text-[#8b949e] text-[10px] px-2.5 py-1 rounded-full border border-[#30363d] flex items-center gap-1">
                  {icon} {label}
                </span>
              ))}
            </div>
            <div className="text-[#484f58] text-[10px]">Hardware procurement pending · Software Prototype v1.0</div>
          </div>
        </div>

        {/* ████████  RIGHT — OPERATOR PANEL (30%)  ████████ */}
        <div className="w-[30%] flex flex-col gap-3 p-4 overflow-y-auto bg-[#0d1117]">

          <div className="flex items-center gap-2 pb-2 border-b border-[#30363d]">
            <span className="text-white font-bold text-sm">🎛️ Operator Control Panel</span>
            <InfoTooltip position="bottom" title="Operator Panel — Purpose" rows={[
              { icon: "🎛️", label: "Demo interface", text: "Simulates the voltage readings that the physical STM32 field unit would transmit over 4G every 3 seconds in production." },
              { icon: "📡", label: "In production", text: "Replaced by a REST API endpoint. STM32 POSTs JSON: { voltage, current, lat, lon, timestamp } — the dashboard updates automatically." },
              { icon: "🧪", label: "Use", text: "Manual entry for precise values, Slider for smooth sweeps, Quick Scenarios for instant fault demos, Auto Simulate for hands-free presentations." },
            ]} />
          </div>

          {/* §1 Manual entry */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <SecLabel text="§1 — Manual Voltage Entry" tooltip={{
              title: "Manual Entry — Use Case",
              rows: [
                { icon: "✏️", label: "Purpose", text: "Enter any specific voltage reading (e.g., a value from a field multimeter measurement) to see exactly how the system would respond." },
                { icon: "〰️", label: "Current auto-derived", text: "Current is automatically calculated as V ÷ 2.9Ω + small noise — mimicking the real sensor relationship." },
                { icon: "⌨️", label: "Tip", text: "Press Enter to push instantly. Range: 0.000 – 6.000V at 1mV precision." },
              ],
            }} />
            <label className="text-[#c9d1d9] text-xs mb-1.5 block">Enter Voltage Reading (V)</label>
            <input
              type="number" min={0} max={6} step={0.001} value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handlePush()}
              placeholder="e.g. 3.240"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 font-mono text-xl text-[#00bfff] placeholder-[#484f58] focus:outline-none focus:border-[#00bfff]/60 transition-all duration-200 mb-3"
            />
            {/* Current preview */}
            <div className="flex items-center justify-between mb-3 text-xs">
              <span className="text-[#8b949e]">Derived current ≈</span>
              <span className="font-mono text-emerald-400 font-bold">{(parseFloat(inputVal) / 2.9 || 0).toFixed(3)} A</span>
            </div>
            <button onClick={handlePush} className="w-full bg-[#00bfff]/10 hover:bg-[#00bfff]/20 active:scale-[0.98] text-[#00bfff] border border-[#00bfff]/40 rounded-lg px-4 py-2.5 text-sm font-bold transition-all duration-200">
              📡 PUSH READING TO DASHBOARD
            </button>
            <div className={`mt-2 bg-green-500/10 border border-green-500/30 text-green-400 text-xs text-center rounded-lg py-1.5 font-semibold transition-all duration-300 ${toast ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
              ✅ Reading Pushed Successfully
            </div>
          </div>

          {/* §2 Slider */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <SecLabel text="§2 — Drag to Set Voltage" tooltip={{
              title: "Voltage Slider — Use Case",
              rows: [
                { icon: "🎚️", label: "Live update", text: "Dragging updates the entire left panel in real time — ideal for live presentations sweeping from normal → fault → normal." },
                { icon: "🟢", label: "Green thumb", text: "Voltage within 2.4–4.0V safe band. Both LED indicators on the left will be green." },
                { icon: "🔴", label: "Red thumb + alarm", text: "Exits safe range — LEDs turn red, alarm sounds once, and an Alert Log entry is created." },
              ],
            }} />
            <div className="flex justify-between text-xs font-mono mb-1.5">
              <span className="text-[#8b949e]">0 V</span>
              <span className={`font-bold text-base transition-colors duration-300 ${sliderSafe ? "text-green-400" : "text-red-400"}`}>{slider.toFixed(3)} V</span>
              <span className="text-[#8b949e]">6 V</span>
            </div>
            <input type="range" min={0} max={6} step={0.01} value={slider} onChange={handleSlider}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                accentColor: sliderSafe ? "#22c55e" : "#ef4444",
                background: `linear-gradient(to right,${sliderSafe?"#22c55e":"#ef4444"} ${(slider/6)*100}%,#21262d ${(slider/6)*100}%)`,
              }}
            />
            <div className="mt-3 flex rounded-lg overflow-hidden text-[10px] font-bold h-7 border border-[#30363d]">
              <div className="bg-red-500/20 text-red-400 flex items-center justify-center border-r border-[#21262d]" style={{width:`${(V_MIN/6)*100}%`}}>UNDER-V</div>
              <div className="bg-green-500/20 text-green-400 flex items-center justify-center border-r border-[#21262d]" style={{width:`${((V_MAX-V_MIN)/6)*100}%`}}>✓ SAFE</div>
              <div className="bg-red-500/20 text-red-400 flex items-center justify-center" style={{width:`${((6-V_MAX)/6)*100}%`}}>OVER-V</div>
            </div>
            <div className="mt-1 flex text-[9px] text-[#484f58] font-mono">
              <div style={{width:`${(V_MIN/6)*100}%`}} className="text-center">0–2.4V</div>
              <div style={{width:`${((V_MAX-V_MIN)/6)*100}%`}} className="text-center">2.4–4.0V</div>
              <div style={{width:`${((6-V_MAX)/6)*100}%`}} className="text-center">4.0–6V</div>
            </div>
          </div>

          {/* §3 Quick scenarios */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <SecLabel text="§3 — Quick Demo Scenarios" tooltip={{
              title: "Quick Scenarios — Use Case",
              rows: [
                { icon: "✅", label: "Normal (3.2V / ~1.10A)", text: "Baseline healthy reading. Relay energised, signal green, both LEDs green." },
                { icon: "⚠️", label: "Under-Voltage (1.85V / ~0.64A)", text: "Simulates a train shunting the track. Relay drops, alarm beeps, SMS sent, LEDs red." },
                { icon: "🚨", label: "Over-Voltage (4.75V / ~1.64A)", text: "Simulates transformer fault. Alarm triggers, log entry created." },
                { icon: "🔄", label: "Auto Simulate", text: "85% normal / 15% fault every 3 seconds — hands-free continuous demonstration." },
              ],
            }} />
            <div className="flex flex-col gap-2">
              <button onClick={() => push(3.2)} className="w-full bg-green-500/10 hover:bg-green-500/20 active:scale-[0.98] text-green-400 border border-green-500/30 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-200 flex justify-between items-center">
                <span>✅ Normal Operation</span>
                <span className="font-mono bg-green-500/10 px-2 py-0.5 rounded text-green-300">3.200 V</span>
              </button>
              <button onClick={() => push(1.85)} className="w-full bg-orange-500/10 hover:bg-orange-500/20 active:scale-[0.98] text-orange-400 border border-orange-500/30 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-200 flex justify-between items-center">
                <span>⚠️ Under-Voltage Fault</span>
                <span className="font-mono bg-orange-500/10 px-2 py-0.5 rounded text-orange-300">1.850 V</span>
              </button>
              <button onClick={() => push(4.75)} className="w-full bg-red-500/10 hover:bg-red-500/20 active:scale-[0.98] text-red-400 border border-red-500/30 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-200 flex justify-between items-center">
                <span>🚨 Over-Voltage Fault</span>
                <span className="font-mono bg-red-500/10 px-2 py-0.5 rounded text-red-300">4.750 V</span>
              </button>
              <button
                onClick={() => setIsAutoSim(p => !p)}
                className={`w-full rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-200 border flex items-center gap-2 ${
                  isAutoSim ? "bg-[#00bfff]/15 hover:bg-[#00bfff]/25 text-[#00bfff] border-[#00bfff]/40" : "bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border-[#30363d]"
                }`}
              >
                {isAutoSim ? (
                  <>
                    <span className="relative flex h-2 w-2 flex-shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00bfff] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00bfff]" />
                    </span>
                    ⏹ Stop Simulation
                    <span className="ml-auto text-[10px] text-[#00bfff]/60 font-mono">every 3s</span>
                  </>
                ) : (
                  <>🔄 Auto Simulate <span className="ml-auto text-[10px] text-[#484f58] font-mono">85% / 15%</span></>
                )}
              </button>
            </div>
          </div>

          {/* §4 Session stats */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <SecLabel text="§4 — Session Statistics" tooltip={{
              title: "Session Statistics — Use Case",
              rows: [
                { icon: "📊", label: "Total / Normal / Faults", text: "Running count of all readings pushed this session. A healthy installation should show < 5% fault rate." },
                { icon: "⏱️", label: "Uptime", text: "MM:SS since page load. In production: STM32 power-on time. Resets or reboots visible here." },
                { icon: "📉", label: "Fault rate bar", text: "Visual bar. Orange < 20% fault rate; Red ≥ 20% triggers maintenance escalation in the production system." },
              ],
            }} />
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Total Readings", value: stats.total,  color: "text-[#c9d1d9]" },
                { label: "Normal",         value: stats.normal, color: "text-green-400" },
                { label: "Faults",         value: stats.faults, color: "text-red-400" },
                { label: "Uptime",         value: fmt(uptime),  color: "text-[#00bfff]" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-[#0d1117] rounded-lg p-3 border border-[#30363d]">
                  <div className="text-[#8b949e] text-[10px] mb-1">{label}</div>
                  <div className={`font-mono font-bold text-2xl ${color} tabular-nums`}>{value}</div>
                </div>
              ))}
            </div>
            {stats.total > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-[#8b949e] mb-1">
                  <span>Fault Rate</span>
                  <span className={`font-mono font-semibold ${stats.faults/stats.total > 0.2 ? "text-red-400" : "text-[#8b949e]"}`}>
                    {((stats.faults/stats.total)*100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(stats.faults/stats.total)*100}%`,
                      background: stats.faults/stats.total > 0.2 ? "#ef4444" : "#f59e0b",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* §5 Reset */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <SecLabel text="§5 — Session Control" tooltip={{
              title: "Reset — Use Case",
              rows: [
                { icon: "🗑️", label: "What it clears", text: "Clears chart, alert log, SMS preview, session stats and resets uptime. Does not reload the page." },
                { icon: "⚠️", label: "Two-click safety", text: "Requires two clicks to prevent accidental data loss mid-presentation." },
              ],
            }} />
            <button onClick={handleReset} className={`w-full rounded-lg px-4 py-2.5 text-xs font-bold transition-all duration-200 border ${
              resetConfirm ? "bg-red-500/15 border-red-500/50 text-red-400 hover:bg-red-500/25" : "bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] border-[#30363d]"
            }`}>
              {resetConfirm ? "⚠️ Sure? Click again to clear all data" : "🗑️ Clear Session Data"}
            </button>
            {resetConfirm && <div className="mt-2 text-[10px] text-[#8b949e] text-center">Clears chart, alert log, SMS and stats.</div>}
          </div>

          {/* Live state display */}
          <div className={`rounded-xl p-4 border transition-all duration-300 ${
            anyFault ? "bg-red-950/20 border-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "bg-[#161b22] border-[#30363d]"
          }`}>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-[#8b949e] text-[10px] font-semibold uppercase tracking-widest">Current Dashboard State</span>
              <InfoTooltip position="top" title="Live State — Use Case" rows={[
                { icon: "🖥️", text: "Compact mirror of the left panel — confirms what reading is currently active without scrolling." },
                { icon: "🔴", text: "Red border + glow = fault active. Green = within safe range." },
              ]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <div className="text-[#8b949e] text-[9px] uppercase mb-1">Voltage</div>
                <div className={`font-mono text-2xl font-bold tabular-nums ${vFault ? "text-red-400" : "text-[#00bfff]"}`}>{voltage.toFixed(3)}<span className="text-sm"> V</span></div>
                <div className="flex justify-center mt-1"><LED on={!vFault} fault={vFault} size="md" /></div>
              </div>
              <div className="text-center">
                <div className="text-[#8b949e] text-[9px] uppercase mb-1">Current</div>
                <div className={`font-mono text-2xl font-bold tabular-nums ${iFault ? "text-red-400" : "text-emerald-400"}`}>{current.toFixed(3)}<span className="text-sm"> A</span></div>
                <div className="flex justify-center mt-1"><LED on={!iFault} fault={iFault} size="md" /></div>
              </div>
            </div>
            <div className={`text-center text-xs font-bold mt-3 ${anyFault ? "text-red-400 fault-blink" : "text-green-400"}`}>
              {anyFault ? `⚠ FAULT — ${activeFaults[0]}` : "✓ All Parameters in Safe Range"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
