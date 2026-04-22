import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer
} from "recharts";
import { Routes, Route } from "react-router-dom";
import UploadPanel from "./components/UploadPanel";
import { supabase } from "./supabaseClient";
import {
  V_MIN, V_MAX, I_MIN, I_MAX, MAX_HISTORY, TRACK_CIRCUITS,
  isVFault, isIFault, vFaultType, iFaultType, ts, tsDate,
  currentFromVoltage, playAlarm
} from "./constants";

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
        <span className="text-[#8b949e]">Location :</span> <span className="text-[#c9d1d9]">{log.gps?.place}</span>{"\n"}
        <span className="text-[#8b949e]">Section  :</span> <span className="text-[#c9d1d9]">Track {log.gps?.section}</span>{"\n"}
        <span className="text-[#8b949e]">GPS      :</span> <span className="text-[#c9d1d9]">{log.gps?.lat}°N, {log.gps?.lon}°E</span>{"\n"}
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
// DASHBOARD VIEW
// ══════════════════════════════════════════════════════════════════════════════
function Dashboard() {
  const [history, setHistory]       = useState([]);
  const [voltage, setVoltage]       = useState(null);
  const [current, setCurrent]       = useState(null);
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
  const [selectedCircuitId, setSelectedCircuitId] = useState(1);
  const currentCircuit = TRACK_CIRCUITS.find(c => c.id === selectedCircuitId) || TRACK_CIRCUITS[0];

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

  // ── Load historical telemetry ──
  const loadTelemetry = useCallback((rows) => {
    const chartRows = [...rows].reverse();
    
    let hist = [];
    let alerts = [];
    let t = 0, n = 0, f = 0;
    let lastAlert = null;
    let latestV = null, latestI = null;

    chartRows.forEach((r, idx) => {
      const v = parseFloat(r.voltage);
      const i = parseFloat(r.current);
      const fault = r.is_fault;
      const vBad = isVFault(v);
      const iBad = isIFault(i);
      
      const d = new Date(r.created_at);
      const timeStr = d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
      const dtStr = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      
      hist.push({ voltage: v, current: i, timestamp: timeStr, isFault: fault });
      t++;
      if (fault) { f++; } else { n++; }
      
      if (fault) {
        const faultsArr = [];
        if (vBad) faultsArr.push(`${vFaultType(v)} (${v.toFixed(3)}V)`);
        if (iBad) faultsArr.push(`${iFaultType(i)} (${i.toFixed(3)}A)`);
        
        const entry = {
          id: r.id,
          ts: timeStr, dateTime: dtStr,
          voltage: v, current: i,
          faultType: vBad ? vFaultType(v) : iFaultType(i),
          faults: faultsArr,
          gps: TRACK_CIRCUITS.find(c => c.id === r.circuit_id) || TRACK_CIRCUITS[0]
        };
        alerts.unshift(entry);
        lastAlert = entry;
      }
      
      if (idx === chartRows.length - 1) {
        latestV = v;
        latestI = i;
      }
    });

    setHistory(hist.slice(-MAX_HISTORY));
    setAlertLog(alerts);
    setStats({ total: t, normal: n, faults: f });
    setVoltage(latestV);
    setCurrent(latestI);
    setSlider(latestV);
    setInputVal(latestV.toFixed(3));
    setLastSMS(lastAlert);
  }, []);

  // ── Core push ──
  const push = useCallback((v, iOverride) => {
    if (isNaN(v)) return;
    const i   = iOverride ?? currentFromVoltage(v);
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
        gps: currentCircuit
      };
      setAlertLog(prev => [entry, ...prev]);
      setLastSMS(entry);
    } else {
      prevFault.current = false;
      setAlarmOn(false);
    }

    setStats(p => ({ total: p.total+1, normal: p.normal+(fault?0:1), faults: p.faults+(fault?1:0) }));
  }, [currentCircuit]);

  // Sync state with Supabase Realtime Postgres Changes
  useEffect(() => {
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('telemetry')
        .select('*')
        .eq('circuit_id', selectedCircuitId)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY);
        
      if (data && data.length > 0) {
        loadTelemetry(data);
      } else {
        // Reset if no data
        setHistory([]);
        setAlertLog([]);
        setStats({ total: 0, normal: 0, faults: 0 });
        setLastSMS(null);
        setVoltage(null);
        setCurrent(null);
        setSlider(3.24);
        setInputVal("3.240");
      }
    };
    
    prevFault.current = false;
    setAlarmOn(false);
    fetchHistory();

    const channel = supabase.channel(`telemetry-${selectedCircuitId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'telemetry', 
        filter: `circuit_id=eq.${selectedCircuitId}` 
      }, (payload) => {
        const row = payload.new;
        push(parseFloat(row.voltage), parseFloat(row.current));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCircuitId, loadTelemetry, push]);

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

  const handleHardReset = async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      resetRef.current = setTimeout(() => setResetConfirm(false), 3000);
      return;
    }
    clearTimeout(resetRef.current);
    setResetConfirm(false);

    // Delete from Supabase
    const { error } = await supabase
      .from('telemetry')
      .delete()
      .eq('circuit_id', selectedCircuitId);

    if (error) {
      console.error("Reset error:", error);
      return;
    }

    // Clear local state
    setHistory([]);
    setVoltage(null);
    setCurrent(null);
    setAlertLog([]);
    setStats({ total: 0, normal: 0, faults: 0 });
    setSlider(3.24);
    setInputVal("3.240");
    setAlarmOn(false);
    setLastSMS(null);
    prevFault.current = false;
    startT.current = Date.now();
  };

  const vFault  = voltage !== null && isVFault(voltage);
  const iFault  = current !== null && isIFault(current);
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

      <nav className="bg-[#161b22] border-b border-[#30363d] px-5 py-3 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚆</span>
          <div>
            <div className="font-bold text-white text-sm tracking-wide leading-tight">Track Circuit Remote Monitoring System</div>
            <div className="text-[#8b949e] text-[10px]">Indian Railways · DC Track Circuit · Voltage & Current · Remote Diagnostics</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          
          <div className="flex items-center gap-2">
            <select 
              value={selectedCircuitId}
              onChange={(e) => setSelectedCircuitId(parseInt(e.target.value))}
              className="bg-[#0d1117] text-[#00bfff] text-xs font-bold font-mono px-3 py-1.5 rounded-lg border border-[#30363d] focus:outline-none focus:border-[#00bfff]/60 transition-all cursor-pointer"
            >
              {TRACK_CIRCUITS.map(c => (
                <option key={c.id} value={c.id}>{c.name.toUpperCase()} • {c.section}</option>
              ))}
            </select>
            
            <button
              onClick={handleHardReset}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                resetConfirm 
                  ? "bg-red-500 text-white border-red-400" 
                  : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
              }`}
            >
              {resetConfirm ? "CONFIRM RESET?" : "HARD RESET"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <LED on={voltage !== null && !anyFault} fault={anyFault} size="md" />
          <LiveDot />
          <InfoTooltip position="bottom" title="System Status Indicator" rows={[
            { icon: "🟢", label: "Green LED", text: "Both voltage (2.4–4.0V) and current (0.5–1.5A) are within safe operating range. Track section is clear and all systems normal." },
            { icon: "🔴", label: "Red LED flashing", text: "One or both parameters are outside safe range. Alarm has been triggered and SMS dispatched to Maintenance Officer." },
            { icon: "📡", label: "LIVE indicator", text: "Dashboard is connected and receiving data. In production this reflects the 4G link to the STM32 field unit." },
          ]} />
          </div>
        </div>
        <div className="font-mono text-[#8b949e] text-sm tabular-nums">{clock}</div>
      </nav>

      {/* ══ BODY ══ */}
      <div className="flex flex-1 min-h-0 container mx-auto max-w-6xl">

        {/* ████████  MAIN DASHBOARD  ████████ */}
        <div className={`w-full flex flex-col gap-3 p-4 overflow-y-auto transition-all duration-300`}>

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
                <LED on={voltage !== null && !vFault} fault={vFault} size="lg" />
              </div>

              <div className={`font-mono text-5xl font-bold tabular-nums transition-all duration-300 mb-2 ${vFault ? "text-red-400" : "text-[#00bfff]"}`}>
                {voltage !== null ? voltage.toFixed(3) : "---"}<span className="text-2xl font-normal ml-1 opacity-70">V</span>
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
                    style={{ left: `${voltage !== null ? (voltage / 6) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all duration-300 ${
                  voltage === null ? "bg-[#21262d] text-[#8b949e] border-[#30363d]" :
                  vFault
                    ? "bg-red-500/10 text-red-400 border-red-500/30 fault-blink"
                    : "bg-green-500/10 text-green-400 border-green-500/30"
                }`}>
                  {voltage === null ? "⚪ Waiting for Data..." : vFault ? `🔴 ${vFaultType(voltage)}` : "🟢 Voltage in Range"}
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
                <LED on={current !== null && !iFault} fault={iFault} size="lg" />
              </div>

              <div className={`font-mono text-5xl font-bold tabular-nums transition-all duration-300 mb-2 ${iFault ? "text-red-400" : "text-emerald-400"}`}>
                {current !== null ? current.toFixed(3) : "---"}<span className="text-2xl font-normal ml-1 opacity-70">A</span>
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
                    style={{ left: `${current !== null ? Math.min((current / 2) * 100, 98) : 0}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all duration-300 ${
                  current === null ? "bg-[#21262d] text-[#8b949e] border-[#30363d]" :
                  iFault
                    ? "bg-red-500/10 text-red-400 border-red-500/30 fault-blink"
                    : "bg-green-500/10 text-green-400 border-green-500/30"
                }`}>
                  {current === null ? "⚪ Waiting for Data..." : iFault ? `🔴 ${iFaultType(current)}` : "🟢 Current in Range"}
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
                <LED on={voltage !== null && !anyFault} fault={anyFault} size="md" />
                {voltage === null 
                  ? <div className="text-[#484f58] font-bold text-sm">⚪ WAITING...</div>
                  : anyFault
                    ? <div className="text-red-400 font-bold text-sm fault-blink">❌ DE-ENERGISED</div>
                    : <div className="text-green-400 font-bold text-sm">⚡ ENERGISED</div>
                }
              </div>
              <div className={`text-[10px] w-fit px-2 py-0.5 rounded-full border ${voltage === null ? "bg-[#21262d] text-[#8b949e] border-[#30363d]" : anyFault ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-green-500/10 text-green-400 border-green-500/30"}`}>
                {voltage === null ? "Signal: N/A" : anyFault ? "Signal: RED 🔴" : "Signal: GREEN 🟢"}
              </div>
              <div className="text-[#484f58] text-[10px] uppercase font-bold">{currentCircuit.name}</div>
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
                <LED on={voltage !== null && !anyFault} fault={anyFault} size="md" />
                {voltage === null
                  ? <div className="text-[#484f58] font-bold text-sm">⚪ WAITING...</div>
                  : anyFault
                    ? <div className="text-red-400 font-bold text-sm fault-blink">🚨 FAULT DETECTED</div>
                    : <div className="text-green-400 font-bold text-sm">✅ NORMAL</div>
                }
              </div>
              {anyFault && activeFaults.map((f, i) => (
                <div key={i} className="text-orange-400 text-[10px] font-mono font-semibold bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{f}</div>
              ))}
              {!anyFault && voltage !== null && <div className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded">Track clear — proceed</div>}
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
                📍 {currentCircuit.lat}° N<br />&nbsp;&nbsp;&nbsp;&nbsp;{currentCircuit.lon}° E
              </div>
              <div className="text-[#484f58] text-[10px]">{currentCircuit.place} · {currentCircuit.section}</div>
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
                <span className="text-sm">Push a reading from /upload to populate the chart</span>
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
                <LED on={voltage !== null} size="lg" />
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
                <div className="font-mono text-2xl font-bold text-[#00bfff] tracking-wider">{currentCircuit.lat}° N &nbsp;|&nbsp; {currentCircuit.lon}° E</div>
                <div className="text-[#8b949e] text-sm mt-2">{currentCircuit.place} — Track Section {currentCircuit.section}</div>
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
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/upload" element={<UploadPanel />} />
    </Routes>
  );
}
