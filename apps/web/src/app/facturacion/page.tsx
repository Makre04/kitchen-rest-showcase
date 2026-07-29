"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-client";
import { useRoleGuard } from "@/lib/use-role-guard";
import { formatCRC } from "@/lib/constants";

interface Invoice {
  id: string;
  type: "TIQUETE" | "FACTURA";
  sequence: number;
  haciendaKey: string | null;
  haciendaStatus: "PENDIENTE" | "ACEPTADO" | "RECHAZADO";
  subtotal: string;
  tax: string;
  total: string;
  paymentMethod: string | null;
  haciendaError: string | null;
  sentAt: string | null;
  createdAt: string;
  order: {
    id: string;
    table: { number: number };
    waiter: { name: string };
    items?: {
      id: string;
      quantity: number;
      unitPrice: string;
      product: { name: string };
    }[];
  };
  customer: {
    id: string;
    name: string;
    idDoc: string | null;
    email: string | null;
  } | null;
}

interface HaciendaConfigStatus {
  configured: boolean;
  sandbox: boolean;
  cedula: string | null;
  nombre: string | null;
}

type Tab = "all" | "errors";

const PAYMENT_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  SINPE: "SINPE Móvil",
  MIXTO: "Mixto",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  PENDIENTE: { label: "Pendiente", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  ACEPTADO: { label: "Aceptado", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  RECHAZADO: { label: "Rechazado", color: "text-red-400", bg: "bg-red-400/10" },
};

export default function FacturacionPage() {
  const authState = useRoleGuard(["CAJERO", "ADMINISTRADOR"]);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [haciendaConfig, setHaciendaConfig] = useState<HaciendaConfigStatus | null>(null);
  const [clock, setClock] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await authFetch(`/api/invoices?limit=20`);
      if (!res.ok) return;
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await authFetch(`/api/invoices/config/status`);
      if (!res.ok) return;
      setHaciendaConfig(await res.json());
    } catch {
      setHaciendaConfig({ configured: false, sandbox: false, cedula: null, nombre: null });
    }
  }, []);

  useEffect(() => {
    // Parallel: invoices list and hacienda config are independent
    Promise.all([fetchInvoices(), fetchConfig()]);
  }, [fetchInvoices, fetchConfig]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })
      );
    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCheckStatus = async (invoiceId: string) => {
    try {
      await authFetch(`/api/invoices/${invoiceId}/check`, { method: "POST" });
      await fetchInvoices();
      if (selectedInvoice?.id === invoiceId) {
        const res = await authFetch(`/api/invoices/${invoiceId}`);
        if (res.ok) setSelectedInvoice(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleResend = async (invoiceId: string) => {
    try {
      await authFetch(`/api/invoices/${invoiceId}/resend`, { method: "POST" });
      await fetchInvoices();
      if (selectedInvoice?.id === invoiceId) {
        const res = await authFetch(`/api/invoices/${invoiceId}`);
        if (res.ok) setSelectedInvoice(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchInvoiceDetail = async (id: string) => {
    try {
      const res = await authFetch(`/api/invoices/${id}`);
      if (!res.ok) return;
      setSelectedInvoice(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const errorInvoices = invoices.filter(
    (i) => i.haciendaStatus === "RECHAZADO" || i.haciendaError
  );

  const filteredInvoices = (activeTab === "errors" ? errorInvoices : invoices).filter((inv) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const seq = `${inv.type === "FACTURA" ? "FAC" : "TIQ"}-${String(inv.sequence).padStart(6, "0")}`.toLowerCase();
    return (
      seq.includes(q) ||
      inv.customer?.name?.toLowerCase().includes(q) ||
      inv.customer?.idDoc?.toLowerCase().includes(q) ||
      String(inv.order.table.number).includes(q)
    );
  });

  if (authState === "loading") return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-[var(--gold)] animate-spin" />
    </div>
  );
  if (authState === "unauthorized") return null;

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-3 md:p-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-4 md:mb-6 gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <a href="/" className="flex-shrink-0 text-white/40 hover:text-white transition-colors p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </a>
          <h1 className="text-lg md:text-2xl font-bold tracking-tight whitespace-nowrap min-w-0">
            <span className="text-[var(--gold)]">Facturación</span>{" "}
            <span className="text-white/40 font-light hidden sm:inline">Electrónica</span>
          </h1>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          {clock && <span className="hidden md:inline text-white/30 text-sm">{clock}</span>}
        </div>

        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          {haciendaConfig && (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs",
                haciendaConfig.configured
                  ? haciendaConfig.sandbox
                    ? "bg-yellow-400/10 text-yellow-400"
                    : "bg-emerald-400/10 text-emerald-400"
                  : "bg-red-400/10 text-red-400"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  haciendaConfig.configured
                    ? haciendaConfig.sandbox
                      ? "bg-yellow-400"
                      : "bg-emerald-400"
                    : "bg-red-400"
                )}
              />
              <span className="hidden sm:inline">
                {haciendaConfig.configured
                  ? haciendaConfig.sandbox
                    ? "Sandbox"
                    : "Producción"
                  : "Sin configurar"}
              </span>
            </div>
          )}
          <a href="/" className="text-white/30 hover:text-white/60 text-sm transition-colors hidden sm:inline">
            Mesas
          </a>
        </div>
      </header>

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4 md:mb-6">
        <button
          onClick={() => { setActiveTab("all"); setSelectedInvoice(null); }}
          className={cn(
            "rounded-xl px-3 md:px-4 py-2 md:py-2.5 text-sm font-medium transition-all touch-manipulation",
            activeTab === "all"
              ? "bg-[var(--gold)] text-black"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          )}
        >
          Comprobantes
          {invoices.length > 0 && (
            <span className={cn(
              "ml-2 inline-flex items-center justify-center rounded-full text-[10px] font-bold w-5 h-5",
              activeTab === "all" ? "bg-black/20 text-black" : "bg-white/10 text-white/50"
            )}>
              {invoices.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab("errors"); setSelectedInvoice(null); }}
          className={cn(
            "rounded-xl px-3 md:px-4 py-2 md:py-2.5 text-sm font-medium transition-all touch-manipulation",
            activeTab === "errors"
              ? "bg-red-500 text-white"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          )}
        >
          Errores
          {errorInvoices.length > 0 && (
            <span className={cn(
              "ml-2 inline-flex items-center justify-center rounded-full text-[10px] font-bold w-5 h-5",
              activeTab === "errors" ? "bg-white/20 text-white" : "bg-red-400/10 text-red-400"
            )}>
              {errorInvoices.length}
            </span>
          )}
        </button>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar factura, cliente, mesa..."
          className="flex-1 min-w-[160px] bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 placeholder:text-white/20"
        />
      </div>

      {/* Invoice List */}
      {!selectedInvoice && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-48 text-white/30">Cargando...</div>
          ) : filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[40vh] text-center">
              <div className="text-xl text-white/20">
                {searchQuery ? "Sin resultados" : activeTab === "errors" ? "Sin errores" : "Sin comprobantes emitidos"}
              </div>
              {activeTab === "all" && !searchQuery && (
                <div className="text-sm text-white/10 mt-2">
                  Los comprobantes emitidos al cobrar aparecen aquí
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredInvoices.map((inv) => {
                const cfg = STATUS_CONFIG[inv.haciendaStatus];
                return (
                  <button
                    key={inv.id}
                    onClick={() => fetchInvoiceDetail(inv.id)}
                    className="w-full rounded-xl bg-[#1A1A1A] border border-white/10 p-4 flex items-center justify-between hover:border-white/20 transition-all text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-sm font-bold text-white">
                          {inv.type === "FACTURA" ? "FAC" : "TIQ"}-{String(inv.sequence).padStart(6, "0")}
                        </span>
                        <div className="text-xs text-white/30 mt-0.5">
                          Mesa {inv.order.table.number} · {inv.order.waiter.name}
                        </div>
                      </div>
                      {inv.customer && (
                        <div className="text-xs text-white/40">
                          {inv.customer.name}
                          {inv.customer.idDoc && (
                            <span className="text-white/20 ml-1">({inv.customer.idDoc})</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={cn("text-xs font-bold rounded-full px-3 py-1", cfg.bg, cfg.color)}>
                        {cfg.label}
                      </span>
                      <div className="text-right">
                        <div className="text-sm font-bold text-white">{formatCRC(inv.total)}</div>
                        <div className="text-[10px] text-white/20">
                          {new Date(inv.createdAt).toLocaleDateString("es-CR", {
                            day: "2-digit",
                            month: "short",
                          })}{" "}
                          {new Date(inv.createdAt).toLocaleTimeString("es-CR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Invoice Detail */}
      {selectedInvoice && (
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => setSelectedInvoice(null)}
            className="text-white/40 hover:text-white text-sm mb-4 flex items-center gap-1 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Volver
          </button>

          <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">
                {selectedInvoice.type === "FACTURA" ? "Factura" : "Tiquete"} #{String(selectedInvoice.sequence).padStart(6, "0")}
              </h2>
              {(() => {
                const cfg = STATUS_CONFIG[selectedInvoice.haciendaStatus];
                return (
                  <span className={cn("text-xs font-bold rounded-full px-3 py-1", cfg.bg, cfg.color)}>
                    {cfg.label}
                  </span>
                );
              })()}
            </div>

            <div className="space-y-2 text-sm">
              <Row label="Mesa" value={String(selectedInvoice.order.table.number)} />
              <Row label="Mesero" value={selectedInvoice.order.waiter.name} />
              {selectedInvoice.customer && (
                <>
                  <Row label="Cliente" value={selectedInvoice.customer.name} />
                  {selectedInvoice.customer.idDoc && (
                    <Row label="Cédula" value={selectedInvoice.customer.idDoc} />
                  )}
                  {selectedInvoice.customer.email && (
                    <Row label="Email" value={selectedInvoice.customer.email} />
                  )}
                </>
              )}
              <Row
                label="Método pago"
                value={PAYMENT_LABELS[selectedInvoice.paymentMethod || "EFECTIVO"]}
              />
            </div>

            {selectedInvoice.order.items && (
              <div className="space-y-1 pt-2 border-t border-white/10">
                {selectedInvoice.order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between text-sm py-1"
                  >
                    <span className="text-white/60">
                      {item.quantity}x {item.product.name}
                    </span>
                    <span className="text-white/40">
                      {formatCRC(parseFloat(item.unitPrice) * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-white/10">
              <Row label="Subtotal" value={formatCRC(selectedInvoice.subtotal)} />
              <Row label="IVA 13%" value={formatCRC(selectedInvoice.tax)} />
              <div className="h-px bg-white/10" />
              <div className="flex justify-between text-lg font-bold">
                <span className="text-white">Total</span>
                <span className="text-[var(--gold)]">
                  {formatCRC(selectedInvoice.total)}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-white/10">
              <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider">
                Hacienda
              </h3>
              {selectedInvoice.haciendaKey && (
                <div>
                  <span className="text-[10px] text-white/20 block">Clave numérica</span>
                  <span className="text-xs text-white/50 font-mono break-all">
                    {selectedInvoice.haciendaKey}
                  </span>
                </div>
              )}
              {selectedInvoice.sentAt && (
                <Row
                  label="Enviado"
                  value={new Date(selectedInvoice.sentAt).toLocaleString("es-CR")}
                />
              )}
              {selectedInvoice.haciendaError && (
                <div className="text-xs text-red-400/70 bg-red-400/5 rounded-lg p-2">
                  {selectedInvoice.haciendaError}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              {selectedInvoice.haciendaStatus === "PENDIENTE" && (
                <button
                  onClick={() => handleCheckStatus(selectedInvoice.id)}
                  className="flex-1 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 py-3 text-sm font-bold hover:bg-blue-500/20 transition-all"
                >
                  Consultar estado
                </button>
              )}
              {selectedInvoice.haciendaStatus === "RECHAZADO" && (
                <button
                  onClick={() => handleResend(selectedInvoice.id)}
                  className="flex-1 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 py-3 text-sm font-bold hover:bg-orange-500/20 transition-all"
                >
                  Reenviar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
