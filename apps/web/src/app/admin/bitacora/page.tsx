"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";

interface Log {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  user: { name: string };
}

interface Employee { id: string; name: string }

const ACTION_COLORS: Record<string, string> = {
  CREAR: "text-emerald-400",
  EDITAR: "text-blue-400",
  ELIMINAR: "text-red-400",
  CANCELAR: "text-orange-400",
  CAMBIAR: "text-amber-400",
  ARQUEO: "text-purple-400",
  UNIR: "text-cyan-400",
  TRANSFERIR: "text-indigo-400",
  DIVIDIR: "text-pink-400",
};

function getActionColor(action: string): string {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.startsWith(key)) return color;
  }
  return "text-white/40";
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString("es-CR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function BitacoraPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 30;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (filterUser) params.set("userId", filterUser);
      if (filterAction) params.set("action", filterAction);
      if (filterEntity) params.set("entity", filterEntity);

      const [logRes, empRes] = await Promise.all([
        authFetch(`/api/admin/bitacora?${params}`),
        employees.length === 0 ? authFetch("/api/admin/empleados") : Promise.resolve(null),
      ]);

      const logData = await logRes.json();
      setLogs(logData.data || []);
      setTotal(logData.total || 0);

      if (empRes) {
        const empData = await empRes.json();
        setEmployees(Array.isArray(empData) ? empData.map((e: Employee) => ({ id: e.id, name: e.name })) : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filterUser, filterAction, filterEntity, employees.length]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Bitácora de Acciones</h2>
        <p className="text-white/30 text-sm mt-1">{total} registros en la bitácora</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={filterUser} onChange={(e) => { setFilterUser(e.target.value); setPage(0); }} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none appearance-none">
          <option value="" className="bg-[#1A1A1A]">Todos los usuarios</option>
          {employees.map((e) => <option key={e.id} value={e.id} className="bg-[#1A1A1A]">{e.name}</option>)}
        </select>
        <input value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }} placeholder="Filtrar por acción..." className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 w-48" />
        <input value={filterEntity} onChange={(e) => { setFilterEntity(e.target.value); setPage(0); }} placeholder="Filtrar por entidad..." className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 w-48" />
        {(filterUser || filterAction || filterEntity) && (
          <button onClick={() => { setFilterUser(""); setFilterAction(""); setFilterEntity(""); setPage(0); }} className="px-4 py-2.5 rounded-xl bg-white/5 text-white/40 text-sm hover:bg-white/10">Limpiar</button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-white/30">Cargando...</div>
      ) : (
        <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Fecha/Hora</th>
                <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Usuario</th>
                <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Acción</th>
                <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Entidad</th>
                <th className="text-left text-xs text-white/30 font-medium px-5 py-3">IP</th>
                <th className="text-center text-xs text-white/30 font-medium px-5 py-3">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <>
                  <tr key={log.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                    <td className="px-5 py-3 text-xs text-white/40 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                    <td className="px-5 py-3 text-sm text-white/60">{log.user.name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium ${getActionColor(log.action)}`}>{log.action}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-white/40">{log.entity}</td>
                    <td className="px-5 py-3 text-xs text-white/20 font-mono">{log.ip || "—"}</td>
                    <td className="px-5 py-3 text-center">
                      {log.details && (
                        <button className="text-xs text-[var(--gold)]/50 hover:text-[var(--gold)]">
                          {expandedId === log.id ? "▲" : "▼"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === log.id && log.details && (
                    <tr key={`${log.id}-detail`} className="border-b border-white/5">
                      <td colSpan={6} className="px-5 py-3">
                        <pre className="text-xs text-white/30 bg-white/[0.02] rounded-lg p-3 overflow-x-auto">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-white/20 text-sm">No hay registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/30">Mostrando {page * limit + 1}-{Math.min((page + 1) * limit, total)} de {total}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 text-xs disabled:opacity-30 hover:bg-white/10">Anterior</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 text-xs disabled:opacity-30 hover:bg-white/10">Siguiente</button>
          </div>
        </div>
      )}
    </div>
  );
}
