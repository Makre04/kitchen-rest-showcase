"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { formatCRC } from "@/lib/constants";

interface DailySale { date: string; label: string; sales: number; orders: number }
interface MonthlySale { month: string; label: string; sales: number; orders: number; avgTicket: number }
interface HourData { hour: number; label: string; orders: number; sales: number }
interface Product { id: string; name: string; category: string; qty: number; revenue: number }
interface PaymentMethod { method: string; count: number; total: number; percentage: number }
interface Comparison {
  thisMonth: { sales: number; orders: number; avgTicket: number; tax: number };
  lastMonth: { sales: number; orders: number; avgTicket: number; tax: number };
  changes: { sales: number; orders: number; avgTicket: number };
}
interface EmployeePerf {
  id: string; name: string; role: string; orders: number;
  totalSales: number; avgTicket: number; totalItems: number;
  avgServiceMinutes: number; cancellations: number;
}
interface CategoryData { id: string; name: string; qty: number; revenue: number }

type Tab = "ventas" | "productos" | "empleados" | "comparacion";

function BarChart({ data, maxVal, color }: { data: { label: string; value: number }[]; maxVal: number; color: string }) {
  if (maxVal === 0) return <div className="text-center py-8 text-white/20 text-sm">Sin datos</div>;
  return (
    <div className="flex items-end gap-1 h-48">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
          <div className={`w-full rounded-t ${color} transition-all min-h-[2px]`} style={{ height: `${Math.max((d.value / maxVal) * 100, 1)}%` }} title={`${d.label}: ${formatCRC(d.value)}`} />
          <span className="text-[8px] text-white/20 mt-1 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function HourHeatmap({ data }: { data: HourData[] }) {
  const hours = Array.isArray(data) ? data : [];
  const maxOrders = Math.max(...hours.map((d) => d.orders), 1);
  const activeHours = hours.filter((d) => d.hour >= 6 && d.hour <= 23);
  return (
    <div className="flex gap-1 items-end h-40">
      {activeHours.map((d) => {
        const intensity = d.orders / maxOrders;
        const bg = intensity === 0 ? "bg-white/5" : intensity < 0.3 ? "bg-emerald-400/20" : intensity < 0.6 ? "bg-emerald-400/40" : intensity < 0.8 ? "bg-orange-400/60" : "bg-red-400/70";
        return (
          <div key={d.hour} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className={`w-full rounded-t ${bg} transition-all min-h-[4px]`} style={{ height: `${Math.max(intensity * 100, 3)}%` }} title={`${d.label}: ${d.orders} órdenes`} />
            <span className="text-[8px] text-white/20 mt-1">{d.hour}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardGerencial() {
  const [tab, setTab] = useState<Tab>("ventas");
  const [loading, setLoading] = useState(true);
  const [dailySales, setDailySales] = useState<DailySale[]>([]);
  const [monthlySales, setMonthlySales] = useState<MonthlySale[]>([]);
  const [hours, setHours] = useState<HourData[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [employees, setEmployees] = useState<EmployeePerf[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      authFetch("/api/admin/dashboard/ventas-diarias").then((r) => r.json()).then(setDailySales),
      authFetch("/api/admin/dashboard/ventas-mensuales").then((r) => r.json()).then(setMonthlySales),
      authFetch("/api/admin/dashboard/horas-pico").then((r) => r.json()).then(setHours),
      authFetch("/api/admin/dashboard/productos-estrella").then((r) => r.json()).then(setProducts),
      authFetch("/api/admin/dashboard/metodos-pago").then((r) => r.json()).then(setPayments),
      authFetch("/api/admin/dashboard/comparacion-mensual").then((r) => r.json()).then(setComparison),
      authFetch("/api/admin/dashboard/rendimiento-empleados").then((r) => r.json()).then(setEmployees),
      authFetch("/api/admin/dashboard/categorias").then((r) => r.json()).then(setCategories),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-white/30">Cargando dashboard...</div>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "ventas", label: "Ventas" },
    { id: "productos", label: "Productos" },
    { id: "empleados", label: "Empleados" },
    { id: "comparacion", label: "Comparación" },
  ];

  const PAYMENT_COLORS: Record<string, string> = {
    EFECTIVO: "bg-emerald-400", TARJETA: "bg-blue-400", SINPE: "bg-purple-400", MIXTO: "bg-orange-400", SIN_METODO: "bg-white/20",
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard Gerencial</h2>
        <p className="text-white/30 text-sm mt-1">Análisis completo de rendimiento</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-[var(--gold)]/10 text-[var(--gold)]" : "text-white/40 hover:text-white/60"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* VENTAS TAB */}
      {tab === "ventas" && (
        <div className="space-y-6">
          {/* Daily sales chart */}
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Ventas Diarias — Últimos 30 días</h3>
            <BarChart
              data={dailySales.map((d) => ({ label: d.label, value: d.sales }))}
              maxVal={Math.max(...dailySales.map((d) => d.sales), 1)}
              color="bg-emerald-400"
            />
            <div className="flex justify-between mt-3">
              <span className="text-xs text-white/20">Total: {formatCRC(dailySales.reduce((s, d) => s + d.sales, 0))}</span>
              <span className="text-xs text-white/20">{dailySales.reduce((s, d) => s + d.orders, 0)} órdenes</span>
            </div>
          </div>

          {/* Monthly sales chart */}
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Ventas Mensuales — Últimos 12 meses</h3>
            <BarChart
              data={monthlySales.map((d) => ({ label: d.label, value: d.sales }))}
              maxVal={Math.max(...monthlySales.map((d) => d.sales), 1)}
              color="bg-blue-400"
            />
          </div>

          {/* Peak hours heatmap */}
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Horas Pico</h3>
            <HourHeatmap data={hours} />
            <div className="flex gap-2 mt-3 text-[10px] text-white/30">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white/5" /> Bajo</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-400/30" /> Medio</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400/60" /> Alto</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400/70" /> Pico</span>
            </div>
          </div>

          {/* Payment methods */}
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Métodos de Pago</h3>
            {payments.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-4">Sin datos</p>
            ) : (
              <>
                <div className="flex rounded-full overflow-hidden h-4 mb-4">
                  {payments.map((p) => (
                    <div key={p.method} className={`${PAYMENT_COLORS[p.method] || "bg-white/20"} transition-all`} style={{ width: `${p.percentage}%` }} title={`${p.method}: ${p.percentage}%`} />
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {payments.map((p) => (
                    <div key={p.method} className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${PAYMENT_COLORS[p.method] || "bg-white/20"}`} />
                      <div>
                        <p className="text-xs text-white/60">{p.method} ({p.percentage}%)</p>
                        <p className="text-xs text-white/30">{formatCRC(p.total)} · {p.count} órdenes</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* PRODUCTOS TAB */}
      {tab === "productos" && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Productos Estrella — Top 15</h3>
            {products.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-4">Sin datos de ventas</p>
            ) : (
              <div className="space-y-2">
                {products.map((p, i) => {
                  const maxQty = products[0]?.qty || 1;
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className={`w-6 text-right text-sm font-bold ${i < 3 ? "text-[var(--gold)]" : "text-white/20"}`}>{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-white/70">{p.name}</span>
                          <span className="text-xs text-white/30">{p.qty} uds · {formatCRC(p.revenue)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${i < 3 ? "bg-[var(--gold)]" : "bg-white/20"}`} style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Ventas por Categoría</h3>
            {categories.length === 0 ? (
              <p className="text-white/20 text-sm text-center py-4">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {categories.map((c) => {
                  const maxRev = categories[0]?.revenue || 1;
                  return (
                    <div key={c.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white/60">{c.name}</span>
                        <span className="text-xs text-white/30">{c.qty} uds · {formatCRC(c.revenue)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-purple-400/60 transition-all" style={{ width: `${(c.revenue / maxRev) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EMPLEADOS TAB */}
      {tab === "empleados" && (
        <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 overflow-hidden">
          <div className="p-5 border-b border-white/5">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Rendimiento de Empleados — Últimos 30 días</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Empleado</th>
                <th className="text-center text-xs text-white/30 font-medium px-3 py-3">Rol</th>
                <th className="text-right text-xs text-white/30 font-medium px-3 py-3">Órdenes</th>
                <th className="text-right text-xs text-white/30 font-medium px-3 py-3">Ventas</th>
                <th className="text-right text-xs text-white/30 font-medium px-3 py-3">Ticket Prom.</th>
                <th className="text-right text-xs text-white/30 font-medium px-3 py-3">Items</th>
                <th className="text-right text-xs text-white/30 font-medium px-3 py-3">Tiempo Prom.</th>
                <th className="text-right text-xs text-white/30 font-medium px-3 py-3">Cancelaciones</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, i) => (
                <tr key={emp.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {i < 3 && <span className="text-[var(--gold)] text-xs font-bold">#{i + 1}</span>}
                      <span className="text-sm text-white/70">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-xs text-white/40">{emp.role}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-white/60">{emp.orders}</td>
                  <td className="px-3 py-3 text-right text-sm font-medium text-emerald-400">{formatCRC(emp.totalSales)}</td>
                  <td className="px-3 py-3 text-right text-sm text-white/50">{formatCRC(emp.avgTicket)}</td>
                  <td className="px-3 py-3 text-right text-sm text-white/40">{emp.totalItems}</td>
                  <td className="px-3 py-3 text-right text-sm text-white/40">
                    {emp.avgServiceMinutes > 0 ? `${emp.avgServiceMinutes} min` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm ${emp.cancellations > 0 ? "text-red-400" : "text-white/20"}`}>
                      {emp.cancellations}
                    </span>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-white/20 text-sm">Sin datos de rendimiento</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* COMPARACIÓN TAB */}
      {tab === "comparacion" && comparison && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "Ventas", this: comparison.thisMonth.sales, last: comparison.lastMonth.sales, change: comparison.changes.sales, fmt: formatCRC },
              { label: "Órdenes", this: comparison.thisMonth.orders, last: comparison.lastMonth.orders, change: comparison.changes.orders, fmt: (n: number) => String(n) },
              { label: "Ticket Promedio", this: comparison.thisMonth.avgTicket, last: comparison.lastMonth.avgTicket, change: comparison.changes.avgTicket, fmt: formatCRC },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
                <p className="text-xs text-white/30 uppercase tracking-wider">{item.label}</p>
                <p className="text-2xl font-bold text-white mt-2">{item.fmt(item.this)}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-sm font-medium ${item.change > 0 ? "text-emerald-400" : item.change < 0 ? "text-red-400" : "text-white/30"}`}>
                    {item.change > 0 ? "↑" : item.change < 0 ? "↓" : "="} {Math.abs(item.change)}%
                  </span>
                  <span className="text-xs text-white/20">vs mes anterior</span>
                </div>
                <p className="text-xs text-white/20 mt-1">Anterior: {item.fmt(item.last)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Detalle Comparativo</h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs text-white/30 font-medium py-2">Métrica</th>
                  <th className="text-right text-xs text-white/30 font-medium py-2">Este Mes</th>
                  <th className="text-right text-xs text-white/30 font-medium py-2">Mes Anterior</th>
                  <th className="text-right text-xs text-white/30 font-medium py-2">Cambio</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="py-3 text-sm text-white/60">Ventas totales</td>
                  <td className="py-3 text-sm text-right text-white">{formatCRC(comparison.thisMonth.sales)}</td>
                  <td className="py-3 text-sm text-right text-white/40">{formatCRC(comparison.lastMonth.sales)}</td>
                  <td className={`py-3 text-sm text-right font-medium ${comparison.changes.sales >= 0 ? "text-emerald-400" : "text-red-400"}`}>{comparison.changes.sales > 0 ? "+" : ""}{comparison.changes.sales}%</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-3 text-sm text-white/60">Órdenes</td>
                  <td className="py-3 text-sm text-right text-white">{comparison.thisMonth.orders}</td>
                  <td className="py-3 text-sm text-right text-white/40">{comparison.lastMonth.orders}</td>
                  <td className={`py-3 text-sm text-right font-medium ${comparison.changes.orders >= 0 ? "text-emerald-400" : "text-red-400"}`}>{comparison.changes.orders > 0 ? "+" : ""}{comparison.changes.orders}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-3 text-sm text-white/60">Ticket promedio</td>
                  <td className="py-3 text-sm text-right text-white">{formatCRC(comparison.thisMonth.avgTicket)}</td>
                  <td className="py-3 text-sm text-right text-white/40">{formatCRC(comparison.lastMonth.avgTicket)}</td>
                  <td className={`py-3 text-sm text-right font-medium ${comparison.changes.avgTicket >= 0 ? "text-emerald-400" : "text-red-400"}`}>{comparison.changes.avgTicket > 0 ? "+" : ""}{comparison.changes.avgTicket}%</td>
                </tr>
                <tr>
                  <td className="py-3 text-sm text-white/60">IVA recaudado</td>
                  <td className="py-3 text-sm text-right text-white">{formatCRC(comparison.thisMonth.tax)}</td>
                  <td className="py-3 text-sm text-right text-white/40">{formatCRC(comparison.lastMonth.tax)}</td>
                  <td className="py-3 text-sm text-right text-white/30">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Monthly trend */}
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider mb-4">Ticket Promedio Mensual</h3>
            <BarChart
              data={monthlySales.map((d) => ({ label: d.label, value: d.avgTicket }))}
              maxVal={Math.max(...monthlySales.map((d) => d.avgTicket), 1)}
              color="bg-orange-400"
            />
          </div>
        </div>
      )}
    </div>
  );
}
