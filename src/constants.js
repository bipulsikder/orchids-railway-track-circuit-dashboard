export const V_MIN = 2.4;
export const V_MAX = 4.0;
export const I_MIN = 0.50;
export const I_MAX = 1.50;
export const MAX_HISTORY = 20;

export const TRACK_CIRCUITS = [
  { id: 1, name: "track circuit 1", section: "T-14", lat: "19.0760", lon: "72.8777", place: "Mumbai Central Railway Yard" },
  { id: 2, name: "track circuit 2", section: "T-15", lat: "19.0800", lon: "72.8800", place: "Dadar Junction Yard" },
  { id: 3, name: "track circuit 3", section: "T-16", lat: "19.0850", lon: "72.8820", place: "Andheri Station Limit" }
];

export function isVFault(v)  { return v < V_MIN || v > V_MAX; }
export function isIFault(i)  { return i < I_MIN || i > I_MAX; }
export function vFaultType(v){ return v < V_MIN ? "UNDER-VOLTAGE" : "OVER-VOLTAGE"; }
export function iFaultType(i){ return i < I_MIN ? "UNDER-CURRENT" : "OVER-CURRENT"; }

export function ts() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function tsDate() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function currentFromVoltage(v) {
  const base = v / 2.9;
  return +Math.max(0, base + (Math.random() - 0.5) * 0.08).toFixed(3);
}

export function randomNormal() { return +(2.5 + Math.random() * 1.3).toFixed(3); }
export function randomFault()  {
  return Math.random() < 0.5
    ? +(1.2 + Math.random() * 1.1).toFixed(3)
    : +(4.1 + Math.random() * 1.4).toFixed(3);
}

export function playAlarm() {
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
