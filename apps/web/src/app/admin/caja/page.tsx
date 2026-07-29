"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";
import { formatCRC } from "@/lib/constants";

interface CashUser {
  id: string;
  name: string;
  role: string;
  lastSession: { id: string; openingAmount: string; closingAmount: string | null; difference: string | null; openedAt: string; closedAt: string | null } | null;
  totalSessions: number;
  totalDifference: string;
  sessionsWithDifference: number;
}

interface ArqueoResult {
  id: string;
  openingAmount: string;
  closingAmount: number;
  expectedAmount: number;
  difference: number;
  breakdown: { sales: number; entries: number; exits: number; cancellations: number };
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("es-CR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function CajaControlPage() {
  const [users, setUsers] = useState<CashUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [arqueoSession, setArqueoSession] = useState<string | null>(null);
  const [countedAmount, setCountedAmount] = useState("");
  const [arqueoNotes, setArqueoNotes] = useState("");
  const [arqueoResult, setArqueoResult] = useState<ArqueoResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin/caja-usuarios");
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleArqueo = async () => {
    if (!arqueoSession || !countedAmount) return;
    setProcessing(true); setMsg(null);
    try {
      const res = await authFetch("/api/admin/arqueo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: arqueoSession,
          countedAmount: parseFloat(countedAmount),
          notes: arqueoNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: typeof data.error === "string" ? data.error : "Error en arqueo" });
        return;
      }
      setArqueoResult(data);
      setMsg({ type: "ok", text: "Arqueo completado" });
      fetchData();
    } catch {
      setMsg({ type: "err", text: "Error de conexión" });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full text-white/30">Cargando...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Control de Caja por Usuario</h2>
        <p className="text-white/30 text-sm mt-1">Seguimiento de diferencias y arqueos</p>
      </div>

      {msg && (
        <div className={`rounded-xl p-3 text-sm ${msg.type === "ok" ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20" : "bg-red-400/10 text-red-400 border border-red-400/20"}`}>
          {msg.text}
        </div>
      )}

      {/* User cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {users.map((u) => {
          const diff = Number(u.totalDifference);
          const hasOpenSession = u.lastSession && !u.lastSession.closedAt;
          return (
            <div key={u.id} className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{u.name}</p>
                  <p className="text-xs text-white/30">{u.role} · {u.totalSessions} turnos</p>
                </div>
                {hasOpenSession && (
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-400/10 text-emerald-400 animate-pulse">
                    En turno
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-white/[0.03] p-3 text-center">
                  <p className="text-xs text-white/30">Diferencia Total</p>
                  <p className={`text-lg font-bold ${diff === 0 ? "text-emerald-400" : diff > 0 ? "text-blue-400" : "text-red-400"}`}>
                    {diff > 0 ? "+" : ""}{formatCRC(diff)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3 text-center">
                  <p className="text-xs text-white/30">Con Diferencia</p>
                  <p className={`text-lg font-bold ${u.sessionsWithDifference > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                    {u.sessionsWithDifference}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-3 text-center">
                  <p className="text-xs text-white/30">Último Turno</p>
                  <p className="text-xs text-white/50 mt-1">
                    {u.lastSession ? formatDate(u.lastSession.openedAt) : "—"}
                  </p>
                </div>
              </div>

              {hasOpenSession && u.lastSession && (
                <button
                  onClick={() => { setArqueoSession(u.lastSession!.id); setCountedAmount(""); setArqueoNotes(""); setArqueoResult(null); setMsg(null); }}
                  className="w-full py-2.5 rounded-xl bg-[var(--gold)]/10 text-[var(--gold)] text-sm font-medium hover:bg-[var(--gold)]/20 transition-colors"
                >
                  Realizar Arqueo
                </button>
              )}
            </div>
          );
        })}
      </div>

      {users.length === 0 && <div className="text-center py-12 text-white/20">No hay cajeros registrados</div>}

      {/* Arqueo Modal */}
      {arqueoSession && !arqueoResult && (
        <div className="rounded-2xl bg-[#1A1A1A] border border-[var(--gold)]/20 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Arqueo de Caja</h3>
            <button onClick={() => setArqueoSession(null)} className="text-white/30 hover:text-white text-sm">Cerrar</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/40 block mb-1">Monto contado en caja *</label>
              <input type="number" value={countedAmount} onChange={(e) => setCountedAmount(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-[var(--gold)]/50" placeholder="0" min="0" step="100" />
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Observaciones (opcional)</label>
              <input type="text" value={arqueoNotes} onChange={(e) => setArqueoNotes(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30" placeholder="Notas del arqueo" />
            </div>
          </div>
          <button onClick={handleArqueo} disabled={!countedAmount || processing} className="px-6 py-2.5 rounded-xl bg-[var(--gold)] text-black font-semibold text-sm hover:bg-[var(--gold)]/80 disabled:opacity-40 transition-colors">
            {processing ? "Procesando..." : "Confirmar Arqueo"}
          </button>
        </div>
      )}

      {/* Arqueo Result */}
      {arqueoResult && (
        <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Resultado del Arqueo</h3>
            <button onClick={() => { setArqueoResult(null); setArqueoSession(null); }} className="text-white/30 hover:text-white text-sm">Cerrar</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl bg-white/[0.03] p-4 text-center">
              <p className="text-xs text-white/30">Apertura</p>
              <p className="text-lg font-bold text-white/60">{formatCRC(arqueoResult.openingAmount)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4 text-center">
              <p className="text-xs text-white/30">Ventas</p>
              <p className="text-lg font-bold text-emerald-400">{formatCRC(arqueoResult.breakdown.sales)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4 text-center">
              <p className="text-xs text-white/30">Esperado</p>
              <p className="text-lg font-bold text-blue-400">{formatCRC(arqueoResult.expectedAmount)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4 text-center">
              <p className="text-xs text-white/30">Contado</p>
              <p className="text-lg font-bold text-white">{formatCRC(arqueoResult.closingAmount)}</p>
            </div>
          </div>
          <div className={`rounded-xl p-4 text-center ${arqueoResult.difference === 0 ? "bg-emerald-400/10" : Math.abs(arqueoResult.difference) < 500 ? "bg-amber-400/10" : "bg-red-400/10"}`}>
            <p className="text-xs text-white/40">Diferencia</p>
            <p className={`text-3xl font-bold ${arqueoResult.difference === 0 ? "text-emerald-400" : arqueoResult.difference > 0 ? "text-blue-400" : "text-red-400"}`}>
              {arqueoResult.difference > 0 ? "+" : ""}{formatCRC(arqueoResult.difference)}
            </p>
            <p className="text-xs text-white/30 mt-1">
              {arqueoResult.difference === 0 ? "Caja cuadrada" : Math.abs(arqueoResult.difference) < 500 ? "Diferencia menor" : "Diferencia significativa — revisar"}
            </p>
          </div>
          {arqueoResult.breakdown.entries > 0 && <p className="text-xs text-white/30">Entradas: {formatCRC(arqueoResult.breakdown.entries)}</p>}
          {arqueoResult.breakdown.exits > 0 && <p className="text-xs text-white/30">Salidas: {formatCRC(arqueoResult.breakdown.exits)}</p>}
          {arqueoResult.breakdown.cancellations > 0 && <p className="text-xs text-white/30">Cancelaciones: {formatCRC(arqueoResult.breakdown.cancellations)}</p>}
        </div>
      )}
    </div>
  );
}
