"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";
import { formatCRC } from "@/lib/constants";

interface Movement {
  type: string;
  amount: string;
  paymentMethod: string | null;
  description: string | null;
  createdAt: string;
}

interface Session {
  id: string;
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  user: { id: string; name: string };
  movements: Movement[];
}

interface Employee { id: string; name: string }

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  APERTURA: { label: "Apertura", color: "text-blue-400" },
  CIERRE: { label: "Cierre", color: "text-white/60" },
  VENTA: { label: "Venta", color: "text-emerald-400" },
  ENTRADA: { label: "Entrada", color: "text-green-400" },
  SALIDA: { label: "Salida", color: "text-red-400" },
  CANCELACION: { label: "Cancelación", color: "text-orange-400" },
};

export default function TurnosPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 20;

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (filterUser) params.set("userId", filterUser);

      const [sessRes, empRes] = await Promise.all([
        authFetch(`/api/admin/turnos?${params}`),
        employees.length === 0 ? authFetch("/api/admin/empleados") : Promise.resolve(null),
      ]);

      const sessData = await sessRes.json();
      setSessions(sessData.data || []);
      setTotal(sessData.total || 0);

      if (empRes) {
        const empData = await empRes.json();
        setEmployees(Array.isArray(empData) ? empData.map((e: Employee & { id: string; name: string }) => ({ id: e.id, name: e.name })) : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filterUser, employees.length]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Turnos y Sesiones de Caja</h2>
        <p className="text-white/30 text-sm mt-1">{total} sesiones registradas</p>
      </div>

      <div className="flex gap-3">
        <select value={filterUser} onChange={(e) => { setFilterUser(e.target.value); setPage(0); }} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none appearance-none min-w-[200px]">
          <option value="" className="bg-[#1A1A1A]">Todos los empleados</option>
          {employees.map((e) => <option key={e.id} value={e.id} className="bg-[#1A1A1A]">{e.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-white/30">Cargando...</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const isOpen = !s.closedAt;
            const expanded = expandedId === s.id;
            const movements = Array.isArray(s.movements) ? s.movements : [];
            const salesTotal = movements.filter((m) => m.type === "VENTA").reduce((sum, m) => sum + Number(m.amount), 0);

            return (
              <div key={s.id} className="rounded-2xl bg-[#1A1A1A] border border-white/5 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : s.id)}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">{s.user.name}</p>
                      <p className="text-xs text-white/30 mt-0.5">{formatDate(s.openedAt)}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${isOpen ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
                      {isOpen ? "Abierta" : "Cerrada"}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <p className="text-xs text-white/30">Apertura</p>
                      <p className="text-sm text-white/60">{formatCRC(s.openingAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-white/30">Ventas</p>
                      <p className="text-sm text-emerald-400">{formatCRC(salesTotal)}</p>
                    </div>
                    {s.closingAmount && (
                      <div>
                        <p className="text-xs text-white/30">Cierre</p>
                        <p className="text-sm text-white/60">{formatCRC(s.closingAmount)}</p>
                      </div>
                    )}
                    {s.difference !== null && (
                      <div>
                        <p className="text-xs text-white/30">Diferencia</p>
                        <p className={`text-sm font-medium ${Number(s.difference) === 0 ? "text-emerald-400" : Number(s.difference) > 0 ? "text-blue-400" : "text-red-400"}`}>
                          {Number(s.difference) > 0 ? "+" : ""}{formatCRC(s.difference)}
                        </p>
                      </div>
                    )}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-white/20 transition-transform ${expanded ? "rotate-180" : ""}`}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-white/5 px-5 py-4 space-y-2">
                    <p className="text-xs text-white/30 uppercase tracking-wider mb-3">Movimientos ({movements.length})</p>
                    {movements.length === 0 ? (
                      <p className="text-sm text-white/20 text-center py-4">Sin movimientos</p>
                    ) : (
                      <div className="space-y-1">
                        {movements.map((m, i) => {
                          const info = MOVEMENT_LABELS[m.type] || { label: m.type, color: "text-white/40" };
                          return (
                            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02]">
                              <div className="flex items-center gap-3">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${info.color} bg-current/10`} style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                                  {info.label}
                                </span>
                                {m.description && <span className="text-xs text-white/30">{m.description}</span>}
                                {m.paymentMethod && <span className="text-[10px] text-white/20">{m.paymentMethod}</span>}
                              </div>
                              <div className="text-right">
                                <p className={`text-sm font-medium ${m.type === "SALIDA" || m.type === "CANCELACION" ? "text-red-400" : "text-white/60"}`}>
                                  {m.type === "SALIDA" || m.type === "CANCELACION" ? "-" : ""}{formatCRC(m.amount)}
                                </p>
                                <p className="text-[10px] text-white/20">{new Date(m.createdAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {s.notes && <p className="text-xs text-white/30 mt-3 italic">Nota: {s.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}

          {sessions.length === 0 && <div className="text-center py-12 text-white/20">No hay sesiones registradas</div>}

          {total > limit && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-white/30">Mostrando {page * limit + 1}-{Math.min((page + 1) * limit, total)} de {total}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 text-xs disabled:opacity-30 hover:bg-white/10">Anterior</button>
                <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 text-xs disabled:opacity-30 hover:bg-white/10">Siguiente</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
