"use client";

import { useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";
import { formatCRC } from "@/lib/constants";

type PeriodType = "dia" | "semana" | "mes" | "personalizado";

interface ReportData {
  period: { from: string; to: string };
  summary: {
    totalSales: number;
    totalOrders: number;
    avgTicket: number;
    totalItems: number;
    totalCovers: number;
    revenuePerCover: number;
    cancelledItems: number;
  };
  salesByDay: { date: string; orders: number; total: number; covers: number }[];
  salesByCategory: { category: string; itemCount: number; total: number }[];
  topProducts: { name: string; totalQty: number; totalRevenue: number }[];
  paymentMethods: { method: string; count: number; total: number }[];
  employeePerformance: { name: string; orderCount: number; totalSales: number; avgTicket: number }[];
  peakHours: { hour: number; count: number }[];
  cashSessions: {
    user: string;
    openedAt: string;
    closedAt: string | null;
    openingAmount: number;
    closingAmount: number | null;
    difference: number | null;
  }[];
}

function formatCRCpdf(n: number): string {
  return `CRC ${n.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDatePdf(d: string): string {
  const dt = new Date(d + "T12:00:00");
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString("es-CR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDateTimePdf(d: string): string {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()} ${hh}:${mi}`;
}

function getDateRange(type: PeriodType): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (type === "dia") return { from: to, to };
  if (type === "semana") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { from: d.toISOString().slice(0, 10), to };
  }
  if (type === "mes") {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: d.toISOString().slice(0, 10), to };
  }
  return { from: to, to };
}

const PERIOD_LABELS: Record<PeriodType, string> = {
  dia: "Hoy",
  semana: "Última Semana",
  mes: "Este Mes",
  personalizado: "Personalizado",
};

const PAYMENT_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  SINPE: "SINPE Móvil",
  TRANSFERENCIA: "Transferencia",
};

export default function ReportesPage() {
  const [period, setPeriod] = useState<PeriodType>("dia");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = period === "personalizado"
        ? { from: customFrom, to: customTo }
        : getDateRange(period);

      if (!range.from || !range.to) {
        setError("Seleccione fechas válidas");
        setLoading(false);
        return;
      }

      const res = await authFetch(`/api/admin/reportes?from=${range.from}&to=${range.to}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Error al generar reporte");
        setLoading(false);
        return;
      }
      setData(await res.json());
    } catch {
      setError("Error de conexión");
    }
    setLoading(false);
  }, [period, customFrom, customTo]);

  const generatePDF = async () => {
    if (!data) return;
    setGenerating(true);
    try {
      const jsPDFModule = await import("jspdf");
      const jsPDF = jsPDFModule.default;
      const atModule = await import("jspdf-autotable");
      if (typeof atModule.applyPlugin === "function") {
        atModule.applyPlugin(jsPDF);
      }

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 15;

      const periodLabel = period === "personalizado"
        ? `${formatDatePdf(data.period.from)} - ${formatDatePdf(data.period.to)}`
        : PERIOD_LABELS[period];

      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("KITCHEN REST POS", 14, y);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120);
      doc.text(`Reporte: ${periodLabel}`, 14, y + 7);
      const now = new Date();
      doc.text(`Generado: ${formatDateTimePdf(now.toISOString())}`, 14, y + 12);
      doc.setTextColor(0);

      // Line
      y += 18;
      doc.setDrawColor(200);
      doc.line(14, y, pageWidth - 14, y);
      y += 8;

      // Summary box
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Resumen General", 14, y);
      y += 8;

      const summaryData = [
        ["Ventas Totales", formatCRCpdf(data.summary.totalSales)],
        ["Total Ordenes", String(data.summary.totalOrders)],
        ["Ticket Promedio", formatCRCpdf(data.summary.avgTicket)],
        ["Productos Vendidos", String(data.summary.totalItems)],
        ["Comensales", String(data.summary.totalCovers)],
        ["Ingreso por Persona", formatCRCpdf(data.summary.revenuePerCover)],
        ["Promedio Personas/Orden", data.summary.totalOrders > 0 ? (data.summary.totalCovers / data.summary.totalOrders).toFixed(1) : "0"],
        ["Items Eliminados", String(data.summary.cancelledItems)],
      ];

      const goldHeader = { fillColor: [212, 175, 55] as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: "bold" as const };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addTable = (opts: Record<string, any>) => {
        (doc as any).autoTable({ ...opts, margin: { left: 14, right: 14 } });
        return ((doc as any).lastAutoTable?.finalY ?? y) + 10;
      };

      const sectionTitle = (title: string) => {
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(title, 14, y);
        y += 8;
      };

      y = addTable({
        startY: y,
        head: [["Metrica", "Valor"]],
        body: summaryData,
        theme: "grid",
        headStyles: goldHeader,
        styles: { fontSize: 10, cellPadding: 4 },
        columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
      });

      if (data.salesByDay.length > 0) {
        if (y > 230) { doc.addPage(); y = 15; }
        sectionTitle("Ventas por Dia");
        y = addTable({
          startY: y,
          head: [["Fecha", "Ordenes", "Comensales", "Total", "Ingreso/Persona"]],
          body: data.salesByDay.map((d) => [
            formatDatePdf(d.date),
            String(d.orders),
            String(d.covers),
            formatCRCpdf(d.total),
            d.covers > 0 ? formatCRCpdf(d.total / d.covers) : "-",
          ]),
          theme: "striped",
          headStyles: goldHeader,
          styles: { fontSize: 9, cellPadding: 3 },
          columnStyles: { 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "right" }, 4: { halign: "right" } },
        });
      }

      if (data.topProducts.length > 0) {
        if (y > 200) { doc.addPage(); y = 15; }
        sectionTitle("Productos Mas Vendidos");
        y = addTable({
          startY: y,
          head: [["#", "Producto", "Cantidad", "Ingreso"]],
          body: data.topProducts.map((p, i) => [String(i + 1), p.name, String(p.totalQty), formatCRCpdf(p.totalRevenue)]),
          theme: "striped",
          headStyles: goldHeader,
          styles: { fontSize: 9, cellPadding: 3 },
          columnStyles: { 0: { halign: "center", cellWidth: 10 }, 2: { halign: "center" }, 3: { halign: "right" } },
        });
      }

      if (data.salesByCategory.length > 0) {
        if (y > 220) { doc.addPage(); y = 15; }
        sectionTitle("Ventas por Categoria");
        y = addTable({
          startY: y,
          head: [["Categoria", "Items Vendidos", "Total"]],
          body: data.salesByCategory.map((c) => [c.category, String(c.itemCount), formatCRCpdf(c.total)]),
          theme: "striped",
          headStyles: goldHeader,
          styles: { fontSize: 9, cellPadding: 3 },
          columnStyles: { 1: { halign: "center" }, 2: { halign: "right" } },
        });
      }

      if (data.paymentMethods.length > 0) {
        if (y > 230) { doc.addPage(); y = 15; }
        sectionTitle("Metodos de Pago");
        y = addTable({
          startY: y,
          head: [["Metodo", "Transacciones", "Total"]],
          body: data.paymentMethods.map((m) => [PAYMENT_LABELS[m.method] || m.method, String(m.count), formatCRCpdf(m.total)]),
          theme: "striped",
          headStyles: goldHeader,
          styles: { fontSize: 9, cellPadding: 3 },
          columnStyles: { 1: { halign: "center" }, 2: { halign: "right" } },
        });
      }

      if (data.employeePerformance.length > 0) {
        if (y > 200) { doc.addPage(); y = 15; }
        sectionTitle("Rendimiento de Empleados");
        y = addTable({
          startY: y,
          head: [["Empleado", "Ordenes", "Ventas Total", "Ticket Prom."]],
          body: data.employeePerformance.map((e) => [e.name, String(e.orderCount), formatCRCpdf(e.totalSales), formatCRCpdf(e.avgTicket)]),
          theme: "striped",
          headStyles: goldHeader,
          styles: { fontSize: 9, cellPadding: 3 },
          columnStyles: { 1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" } },
        });
      }

      if (data.peakHours.length > 0) {
        if (y > 230) { doc.addPage(); y = 15; }
        sectionTitle("Horas Pico");
        y = addTable({
          startY: y,
          head: [["Hora", "Ordenes"]],
          body: data.peakHours.map((h) => [`${String(h.hour).padStart(2, "0")}:00 - ${String(h.hour).padStart(2, "0")}:59`, String(h.count)]),
          theme: "striped",
          headStyles: goldHeader,
          styles: { fontSize: 9, cellPadding: 3 },
          columnStyles: { 1: { halign: "center" } },
        });
      }

      if (data.cashSessions.length > 0) {
        if (y > 200) { doc.addPage(); y = 15; }
        sectionTitle("Sesiones de Caja");
        addTable({
          startY: y,
          head: [["Cajero", "Apertura", "Cierre", "Monto Apertura", "Monto Cierre", "Diferencia"]],
          body: data.cashSessions.map((cs) => [
            cs.user,
            formatDateTimePdf(cs.openedAt),
            cs.closedAt ? formatDateTimePdf(cs.closedAt) : "Abierta",
            formatCRCpdf(cs.openingAmount),
            cs.closingAmount !== null ? formatCRCpdf(cs.closingAmount) : "-",
            cs.difference !== null ? formatCRCpdf(cs.difference) : "-",
          ]),
          theme: "striped",
          headStyles: { ...goldHeader, fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2.5 },
          columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
        });
      }

      // Footer on all pages
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`KITCHEN REST POS - Reporte ${periodLabel}`, 14, doc.internal.pageSize.getHeight() - 10);
        doc.text(`Pagina ${i} de ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 10, { align: "right" });
      }

      const fileName = `KITCHEN_REST_Reporte_${period === "personalizado" ? `${customFrom}_${customTo}` : period}_${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error("Error generating PDF:", err);
      setError("Error al generar PDF");
    }
    setGenerating(false);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Reportes</h2>
        <p className="text-white/30 text-sm mt-1">Genera reportes por día, semana o mes y descárgalos en PDF</p>
      </div>

      {/* Period selector */}
      <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 space-y-4">
        <p className="text-sm font-medium text-white/60">Período del reporte</p>
        <div className="flex flex-wrap gap-2">
          {(["dia", "semana", "mes", "personalizado"] as PeriodType[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                period === p
                  ? "bg-[var(--gold)] text-black"
                  : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {period === "personalizado" && (
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-xs text-white/40 block mb-1">Desde</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
              />
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Hasta</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
              />
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-[var(--gold)] text-black font-semibold text-sm hover:bg-[var(--gold)]/80 disabled:opacity-40 transition-colors"
          >
            {loading ? "Generando..." : "Generar Reporte"}
          </button>
          {data && (
            <button
              onClick={generatePDF}
              disabled={generating}
              className="px-6 py-2.5 rounded-xl bg-red-500/20 text-red-400 font-semibold text-sm hover:bg-red-500/30 disabled:opacity-40 transition-colors flex items-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 18 15 15" />
              </svg>
              {generating ? "Descargando..." : "Descargar PDF"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-sm bg-red-400/10 text-red-400 border border-red-400/20">
          {error}
        </div>
      )}

      {/* Report preview */}
      {data && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Ventas Totales", value: formatCRC(data.summary.totalSales), color: "text-emerald-400" },
              { label: "Órdenes", value: String(data.summary.totalOrders), color: "text-blue-400" },
              { label: "Ticket Promedio", value: formatCRC(data.summary.avgTicket), color: "text-[var(--gold)]" },
              { label: "Items Vendidos", value: String(data.summary.totalItems), color: "text-purple-400" },
              { label: "Comensales", value: String(data.summary.totalCovers), color: "text-cyan-400" },
              { label: "Ingreso/Persona", value: formatCRC(data.summary.revenuePerCover), color: "text-teal-400" },
              { label: "Items Eliminados", value: String(data.summary.cancelledItems), color: "text-red-400" },
              { label: "Promedio Personas/Orden", value: data.summary.totalOrders > 0 ? (data.summary.totalCovers / data.summary.totalOrders).toFixed(1) : "0", color: "text-orange-400" },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-4 text-center">
                <p className="text-xs text-white/30">{card.label}</p>
                <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Sales by day */}
          {data.salesByDay.length > 0 && (
            <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
              <h3 className="text-sm font-bold text-white/60 mb-4">Ventas por Día</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left text-xs text-white/30 font-medium px-4 py-2">Fecha</th>
                      <th className="text-center text-xs text-white/30 font-medium px-4 py-2">Órdenes</th>
                      <th className="text-center text-xs text-white/30 font-medium px-4 py-2">Comensales</th>
                      <th className="text-right text-xs text-white/30 font-medium px-4 py-2">Total</th>
                      <th className="text-right text-xs text-white/30 font-medium px-4 py-2">$/Persona</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.salesByDay.map((d) => (
                      <tr key={d.date} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-2.5 text-sm text-white/60">{formatDate(d.date)}</td>
                        <td className="px-4 py-2.5 text-sm text-white/40 text-center">{d.orders}</td>
                        <td className="px-4 py-2.5 text-sm text-cyan-400 text-center">{d.covers}</td>
                        <td className="px-4 py-2.5 text-sm text-emerald-400 text-right font-medium">{formatCRC(d.total)}</td>
                        <td className="px-4 py-2.5 text-sm text-teal-400 text-right">{d.covers > 0 ? formatCRC(d.total / d.covers) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top products */}
          {data.topProducts.length > 0 && (
            <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
              <h3 className="text-sm font-bold text-white/60 mb-4">Productos Más Vendidos</h3>
              <div className="space-y-2">
                {data.topProducts.map((p, i) => {
                  const maxQty = data.topProducts[0].totalQty;
                  return (
                    <div key={p.name} className="flex items-center gap-3">
                      <span className="text-xs text-white/20 w-5 text-right">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-white/70">{p.name}</span>
                          <span className="text-xs text-white/30">{p.totalQty} uds · {formatCRC(p.totalRevenue)}</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--gold)]/60 rounded-full"
                            style={{ width: `${(p.totalQty / maxQty) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Categories + Payment methods */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.salesByCategory.length > 0 && (
              <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
                <h3 className="text-sm font-bold text-white/60 mb-4">Ventas por Categoría</h3>
                <div className="space-y-3">
                  {data.salesByCategory.map((c) => (
                    <div key={c.category} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/70">{c.category}</p>
                        <p className="text-xs text-white/30">{c.itemCount} items</p>
                      </div>
                      <span className="text-sm font-medium text-emerald-400">{formatCRC(c.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.paymentMethods.length > 0 && (
              <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
                <h3 className="text-sm font-bold text-white/60 mb-4">Métodos de Pago</h3>
                <div className="space-y-3">
                  {data.paymentMethods.map((m) => (
                    <div key={m.method} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/70">{PAYMENT_LABELS[m.method] || m.method}</p>
                        <p className="text-xs text-white/30">{m.count} transacciones</p>
                      </div>
                      <span className="text-sm font-medium text-blue-400">{formatCRC(m.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Employee performance */}
          {data.employeePerformance.length > 0 && (
            <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
              <h3 className="text-sm font-bold text-white/60 mb-4">Rendimiento de Empleados</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left text-xs text-white/30 font-medium px-4 py-2">Empleado</th>
                      <th className="text-center text-xs text-white/30 font-medium px-4 py-2">Órdenes</th>
                      <th className="text-right text-xs text-white/30 font-medium px-4 py-2">Ventas</th>
                      <th className="text-right text-xs text-white/30 font-medium px-4 py-2">Ticket Prom.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employeePerformance.map((e) => (
                      <tr key={e.name} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-2.5 text-sm text-white/60">{e.name}</td>
                        <td className="px-4 py-2.5 text-sm text-white/40 text-center">{e.orderCount}</td>
                        <td className="px-4 py-2.5 text-sm text-emerald-400 text-right">{formatCRC(e.totalSales)}</td>
                        <td className="px-4 py-2.5 text-sm text-[var(--gold)] text-right">{formatCRC(e.avgTicket)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Peak hours + Cash sessions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.peakHours.length > 0 && (
              <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
                <h3 className="text-sm font-bold text-white/60 mb-4">Horas Pico</h3>
                <div className="space-y-2">
                  {data.peakHours.map((h) => (
                    <div key={h.hour} className="flex items-center gap-3">
                      <span className="text-xs text-white/40 w-16">{String(h.hour).padStart(2, "0")}:00</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-400/60 rounded-full"
                          style={{ width: `${(h.count / data.peakHours[0].count) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-white/30 w-8 text-right">{h.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.cashSessions.length > 0 && (
              <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-5">
                <h3 className="text-sm font-bold text-white/60 mb-4">Sesiones de Caja</h3>
                <div className="space-y-3">
                  {data.cashSessions.map((cs, i) => (
                    <div key={i} className="rounded-xl bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white/60">{cs.user}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${cs.closedAt ? "bg-white/5 text-white/30" : "bg-emerald-400/10 text-emerald-400"}`}>
                          {cs.closedAt ? "Cerrada" : "Abierta"}
                        </span>
                      </div>
                      <div className="flex gap-4 text-xs text-white/30">
                        <span>Apertura: {formatCRC(cs.openingAmount)}</span>
                        {cs.closingAmount !== null && <span>Cierre: {formatCRC(cs.closingAmount)}</span>}
                        {cs.difference !== null && (
                          <span className={cs.difference === 0 ? "text-emerald-400" : cs.difference > 0 ? "text-blue-400" : "text-red-400"}>
                            Dif: {cs.difference > 0 ? "+" : ""}{formatCRC(cs.difference)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* No data message */}
          {data.summary.totalOrders === 0 && (
            <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-12 text-center">
              <p className="text-white/20 text-lg">No hay ventas cerradas en este período</p>
              <p className="text-white/10 text-sm mt-2">Solo se incluyen órdenes con estado CERRADA</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
