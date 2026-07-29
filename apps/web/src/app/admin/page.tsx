"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { formatCRC } from "@/lib/constants";

interface Summary {
  daily: { sales: number; orders: number; avgTicket: number };
  monthly: { sales: number; orders: number; avgTicket: number };
  live: { activeOrders: number; activeTables: number; totalEmployees: number };
}

export default function AdminHome() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/admin/dashboard/resumen")
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-white/30">Cargando...</div>;
  if (!summary) return <div className="flex items-center justify-center h-full text-red-400">Error al cargar datos</div>;

  const cards = [
    { label: "Ventas Hoy", value: formatCRC(summary.daily.sales), sub: `${summary.daily.orders} órdenes`, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    { label: "Ticket Promedio Hoy", value: formatCRC(summary.daily.avgTicket), sub: "promedio por orden", color: "text-blue-400", bg: "bg-blue-400/10" },
    { label: "Ventas del Mes", value: formatCRC(summary.monthly.sales), sub: `${summary.monthly.orders} órdenes`, color: "text-purple-400", bg: "bg-purple-400/10" },
    { label: "Ticket Promedio Mes", value: formatCRC(summary.monthly.avgTicket), sub: "promedio mensual", color: "text-orange-400", bg: "bg-orange-400/10" },
  ];

  const live = [
    { label: "Mesas Activas", value: summary.live.activeTables, color: "text-amber-400" },
    { label: "Órdenes Abiertas", value: summary.live.activeOrders, color: "text-blue-400" },
    { label: "Empleados Activos", value: summary.live.totalEmployees, color: "text-emerald-400" },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">Panel Administrativo</h2>
        <p className="text-white/30 text-sm mt-1">Resumen general del negocio</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
            <p className="text-xs text-white/40 uppercase tracking-wider">{c.label}</p>
            <p className={`text-2xl font-bold mt-2 ${c.color}`}>{c.value}</p>
            <p className="text-xs text-white/30 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {live.map((l) => (
          <div key={l.label} className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5 text-center">
            <p className={`text-4xl font-bold ${l.color}`}>{l.value}</p>
            <p className="text-xs text-white/40 mt-2">{l.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <a href="/admin/empleados" className="group rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 hover:border-[var(--gold)]/30 transition-all">
          <h3 className="text-white/60 group-hover:text-[var(--gold)] font-medium transition-colors">Gestión de Empleados</h3>
          <p className="text-xs text-white/30 mt-1">Crear, editar y administrar personal</p>
        </a>
        <a href="/admin/turnos" className="group rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 hover:border-[var(--gold)]/30 transition-all">
          <h3 className="text-white/60 group-hover:text-[var(--gold)] font-medium transition-colors">Turnos y Sesiones</h3>
          <p className="text-xs text-white/30 mt-1">Historial de turnos y movimientos de caja</p>
        </a>
        <a href="/admin/caja" className="group rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 hover:border-[var(--gold)]/30 transition-all">
          <h3 className="text-white/60 group-hover:text-[var(--gold)] font-medium transition-colors">Control de Caja</h3>
          <p className="text-xs text-white/30 mt-1">Arqueo y control por usuario</p>
        </a>
        <a href="/admin/bitacora" className="group rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 hover:border-[var(--gold)]/30 transition-all">
          <h3 className="text-white/60 group-hover:text-[var(--gold)] font-medium transition-colors">Bitácora de Acciones</h3>
          <p className="text-xs text-white/30 mt-1">Registro completo de actividad del sistema</p>
        </a>
        <a href="/admin/dashboard" className="group rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 hover:border-[var(--gold)]/30 transition-all col-span-2 xl:col-span-1">
          <h3 className="text-white/60 group-hover:text-[var(--gold)] font-medium transition-colors">Dashboard Gerencial</h3>
          <p className="text-xs text-white/30 mt-1">Análisis detallado de ventas y rendimiento</p>
        </a>
      </div>
    </div>
  );
}
