import { useState } from "react";
import { currentFromVoltage, randomNormal, TRACK_CIRCUITS, isVFault, isIFault } from "../constants";
import { supabase } from "../supabaseClient";

export default function UploadPanel() {
  const [rows, setRows] = useState([
    { id: Date.now(), voltage: 3.24, current: 1.12 }
  ]);
  const [toast, setToast] = useState(false);
  const [selectedCircuitId, setSelectedCircuitId] = useState(TRACK_CIRCUITS[0].id);

  const handleAddMore = () => {
    const v = randomNormal();
    const i = currentFromVoltage(v);
    setRows([{ id: Date.now(), voltage: v, current: i }, ...rows]);
  };

  const updateRow = (id, field, value) => {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleRun = async (row) => {
    const v = parseFloat(row.voltage);
    const i = parseFloat(row.current);
    if (!isNaN(v) && !isNaN(i)) {
      const is_fault = isVFault(v) || isIFault(i);
      
      const { error } = await supabase.from('telemetry').insert([{
        circuit_id: selectedCircuitId,
        voltage: v,
        current: i,
        is_fault
      }]);
      
      if (error) {
        console.error("Insert error:", error);
      } else {
        // Show toast
        setToast(true);
        setTimeout(() => setToast(false), 1500);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] p-8 flex justify-center">
      <div className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#30363d]">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🎛️</span> Operator Upload Panel
            </h1>
            <p className="text-[#8b949e] text-xs mt-1">
              Inject fault telemetry into the PostgreSQL database.
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <select
              value={selectedCircuitId}
              onChange={(e) => setSelectedCircuitId(Number(e.target.value))}
              className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#c9d1d9] focus:outline-none focus:border-[#58a6ff] transition-colors"
            >
              {TRACK_CIRCUITS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            
            <button 
              onClick={handleAddMore}
              className="bg-[#00bfff]/10 hover:bg-[#00bfff]/20 text-[#00bfff] border border-[#00bfff]/40 rounded-lg px-4 py-2 text-sm font-bold transition-all duration-200"
            >
              + Add More
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.id} className="flex items-end gap-3 bg-[#0d1117] p-4 rounded-lg border border-[#21262d]">
              <div className="flex-1">
                <label className="text-[#8b949e] text-[10px] font-semibold uppercase tracking-widest mb-1 block">Voltage (V)</label>
                <input
                  type="number" 
                  step={0.001}
                  value={row.voltage}
                  onChange={(e) => updateRow(row.id, 'voltage', e.target.value)}
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 font-mono text-sm text-[#00bfff] focus:outline-none focus:border-[#00bfff]/60 transition-all"
                />
              </div>
              <div className="flex-1">
                <label className="text-[#8b949e] text-[10px] font-semibold uppercase tracking-widest mb-1 block">Current (A)</label>
                <input
                  type="number"
                  step={0.001} 
                  value={row.current}
                  onChange={(e) => updateRow(row.id, 'current', e.target.value)}
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 font-mono text-sm text-emerald-400 focus:outline-none focus:border-emerald-400/60 transition-all"
                />
              </div>
              <button 
                onClick={() => handleRun(row)}
                className="bg-green-500/10 hover:bg-green-500/20 active:scale-[0.98] text-green-400 border border-green-500/30 rounded-lg px-6 py-2 text-sm font-bold transition-all duration-200 h-[38px] flex items-center justify-center gap-2"
              >
                <span>📡</span> RUN
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="text-center py-8 text-[#484f58] text-sm">
              No entries. Click "Add More" to generate inputs.
            </div>
          )}
        </div>

        <div className={`mt-4 bg-green-500/10 border border-green-500/30 text-green-400 text-sm text-center rounded-lg py-2 font-semibold transition-all duration-300 ${toast ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          ✅ Reading Pushed to Dashboard!
        </div>
      </div>
    </div>
  );
}
