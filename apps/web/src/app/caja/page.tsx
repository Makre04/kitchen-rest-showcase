"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-client";
import { useRoleGuard } from "@/lib/use-role-guard";
import { formatCRC } from "@/lib/constants";

interface CashSession {
  id: string;
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  user: { id: string; name: string };
  movements: CashMovement[];
}

interface CashMovement {
  id: string;
  type: string;
  amount: string;
  paymentMethod: string | null;
  description: string | null;
  createdAt: string;
  user: { name: string };
}

interface PendingTable {
  id: string;
  number: number;
  capacity: number;
  subtotal: string;
  tax: string;
  total: string;
  itemCount: number;
  orders: {
    id: string;
    waiter: { name: string };
    items: {
      id: string;
      quantity: number;
      unitPrice: string;
      status: string;
      product: { name: string };
    }[];
  }[];
}

interface DaySummary {
  totalOrders: number;
  totalSales: string;
  totalTax: string;
  totalSubtotal: string;
  byMethod: { method: string; count: number; total: string }[];
}

interface Cashier {
  id: string;
  name: string;
  role: { name: string };
}

type Tab = "pending" | "movements" | "summary";
type PaymentMethod = "EFECTIVO" | "TARJETA" | "SINPE";
type InvoiceOption = "NINGUNO" | "TIQUETE" | "FACTURA";

const PAYMENT_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  SINPE: "SINPE Móvil",
  MIXTO: "Mixto",
};

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  APERTURA: { label: "Apertura", color: "text-blue-400" },
  CIERRE: { label: "Cierre", color: "text-purple-400" },
  VENTA: { label: "Venta", color: "text-emerald-400" },
  ENTRADA: { label: "Entrada", color: "text-green-400" },
  SALIDA: { label: "Salida", color: "text-red-400" },
  CANCELACION: { label: "Cancelación", color: "text-red-500" },
};

export default function CajaPage() {
  const authState = useRoleGuard(["CAJERO", "ADMINISTRADOR"]);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [selectedCashier, setSelectedCashier] = useState<string | null>(null);
  const [session, setSession] = useState<CashSession | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [pendingTables, setPendingTables] = useState<PendingTable[]>([]);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [clock, setClock] = useState("");

  const [openingAmount, setOpeningAmount] = useState("");

  const [selectedTable, setSelectedTable] = useState<PendingTable | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("EFECTIVO");
  const [invoiceOption, setInvoiceOption] = useState<InvoiceOption>("NINGUNO");
  const [customerName, setCustomerName] = useState("");
  const [customerIdType, setCustomerIdType] = useState<"01" | "02" | "03">("01");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const [showMovementForm, setShowMovementForm] = useState(false);
  const [movType, setMovType] = useState<"ENTRADA" | "SALIDA">("ENTRADA");
  const [movAmount, setMovAmount] = useState("");
  const [movDesc, setMovDesc] = useState("");

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closingAmount, setClosingAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");

  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    authFetch(`/api/users`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((users) => {
        if (!Array.isArray(users)) return;
        setCashiers(
          users.filter(
            (u: Cashier) => u.role.name === "CAJERO" || u.role.name === "ADMINISTRADOR"
          )
        );
      })
      .catch(() => setLoadError(true));
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const res = await authFetch(`/api/caja/session`);
      if (res.status === 404) {
        setSession(null);
        setNoSession(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.movements)) {
        setSession(data);
        setNoSession(false);
      } else {
        setNoSession(true);
      }
    } catch {
      setNoSession(true);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const res = await authFetch(`/api/caja/pending`);
      if (!res.ok) return;
      const data = await res.json();
      setPendingTables(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await authFetch(`/api/caja/summary`);
      if (!res.ok) return;
      setSummary(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (selectedCashier) fetchSession();
  }, [selectedCashier, fetchSession]);

  useEffect(() => {
    if (session && !noSession) {
      fetchPending();
      fetchSummary();
      const interval = setInterval(() => {
        fetchPending();
        fetchSummary();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [session, noSession, fetchPending, fetchSummary]);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenSession = async () => {
    const amount = parseFloat(openingAmount);
    if (isNaN(amount) || amount < 0) return;
    await authFetch(`/api/caja/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedCashier, openingAmount: amount }),
    });
    setOpeningAmount("");
    await fetchSession();
  };

  const handleCloseTable = async (table: PendingTable) => {
    if (processing) return;
    if (invoiceOption === "FACTURA" && (!customerName.trim() || !customerIdNumber.trim())) {
      setResult({ success: false, message: "Nombre y cédula son requeridos para factura" });
      return;
    }
    setProcessing(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        paymentMethod,
        cashierId: selectedCashier,
      };
      if (invoiceOption !== "NINGUNO") {
        body.invoiceType = invoiceOption;
        if (invoiceOption === "FACTURA") {
          body.customerName = customerName.trim();
          body.customerIdType = customerIdType;
          body.customerIdNumber = customerIdNumber.trim();
          if (customerEmail.trim()) body.customerEmail = customerEmail.trim();
        }
      }
      const res = await authFetch(`/api/caja/tables/${table.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        const invoiceMsg = data.invoice
          ? ` · ${data.invoice.type === "FACTURA" ? "Factura" : "Tiquete"} #${data.invoice.sequence} emitido`
          : "";
        setResult({
          success: true,
          message: `Mesa ${table.number} cobrada: ${formatCRC(data.total)}${invoiceMsg}`,
        });
        setSelectedTable(null);
        resetForm();
        await fetchPending();
        await fetchSummary();
        await fetchSession();
      } else {
        const msg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        setResult({ success: false, message: msg || "Error al cobrar" });
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Error de conexión" });
    } finally {
      setProcessing(false);
    }
  };

  const resetForm = () => {
    setPaymentMethod("EFECTIVO");
    setInvoiceOption("NINGUNO");
    setCustomerName("");
    setCustomerIdType("01");
    setCustomerIdNumber("");
    setCustomerEmail("");
  };

  const handleAddMovement = async () => {
    const amount = parseFloat(movAmount);
    if (isNaN(amount) || amount <= 0 || !movDesc.trim()) return;
    await authFetch(`/api/caja/movement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: movType, amount, description: movDesc.trim(), userId: selectedCashier }),
    });
    setMovAmount("");
    setMovDesc("");
    setShowMovementForm(false);
    await fetchSession();
  };

  const handleCloseSession = async () => {
    if (!session) return;
    const amount = parseFloat(closingAmount);
    if (isNaN(amount) || amount < 0) return;
    await authFetch(`/api/caja/session/${session.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closingAmount: amount, notes: closingNotes.trim() || undefined }),
    });
    setShowCloseForm(false);
    setClosingAmount("");
    setClosingNotes("");
    await fetchSession();
  };

  if (authState === "loading") return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-[var(--gold)] animate-spin" />
    </div>
  );
  if (authState === "unauthorized") return null;

  if (!selectedCashier) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">Caja</h1>
            <p className="text-white/40 mt-2">Seleccione cajero</p>
          </div>
          <div className="space-y-3">
            {loadError ? (
              <div className="text-center text-red-400/70 text-sm py-4">
                Error al cargar cajeros.{" "}
                <button onClick={() => window.location.reload()} className="underline hover:text-red-400">Reintentar</button>
              </div>
            ) : cashiers.length === 0 ? (
              <div className="text-center text-white/20 text-sm py-4">Cargando...</div>
            ) : (
              cashiers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCashier(c.id)}
                  className="w-full rounded-xl bg-white/5 border border-white/10 p-5 text-left hover:bg-white/10 hover:border-[var(--gold)]/30 transition-all"
                >
                  <span className="text-lg font-medium text-white">{c.name}</span>
                  <span className="text-xs text-white/30 ml-3">{c.role.name}</span>
                </button>
              ))
            )}
          </div>
          <a href="/" className="block text-center text-white/30 hover:text-white/60 text-sm py-2 transition-colors">
            Volver a mesas
          </a>
        </div>
      </div>
    );
  }

  const cashierName = cashiers.find((c) => c.id === selectedCashier)?.name || "";

  if (noSession) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">Apertura de caja</h1>
            <p className="text-white/40 mt-2">
              Cajero: <span className="text-[var(--gold)]">{cashierName}</span>
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-white/50 block mb-2">Monto inicial (₡)</label>
              <input
                type="number"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-2xl text-white text-center focus:outline-none focus:border-[var(--gold)]/50"
              />
            </div>
            <button
              onClick={handleOpenSession}
              disabled={!openingAmount || parseFloat(openingAmount) < 0}
              className="w-full rounded-xl bg-emerald-500 text-white py-4 text-lg font-bold hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              Abrir caja
            </button>
          </div>
          <button
            onClick={() => setSelectedCashier(null)}
            className="w-full text-center text-white/30 hover:text-white/60 text-sm py-2 transition-colors"
          >
            Cambiar cajero
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-white/30 text-lg">Cargando...</div>
      </div>
    );
  }

  if (session.closedAt) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <h1 className="text-2xl font-bold text-white">Caja cerrada</h1>
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 space-y-3 text-left">
            <Row label="Monto esperado" value={formatCRC(session.expectedAmount || "0")} />
            <Row label="Monto contado" value={formatCRC(session.closingAmount || "0")} />
            <div className="h-px bg-white/10" />
            <Row
              label="Diferencia"
              value={formatCRC(session.difference || "0")}
              color={parseFloat(session.difference || "0") === 0 ? "text-emerald-400" : "text-red-400"}
            />
            {session.notes && <p className="text-sm text-white/40 pt-2">{session.notes}</p>}
          </div>
          <button
            onClick={() => { setNoSession(true); setSession(null); }}
            className="w-full rounded-xl bg-[var(--gold)] text-black py-4 text-lg font-bold hover:brightness-110 transition-all"
          >
            Abrir nueva caja
          </button>
          <a href="/" className="block text-white/30 hover:text-white/60 text-sm transition-colors">
            Volver a mesas
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-3 md:p-4">
      <header className="flex items-center justify-between mb-4 md:mb-6 gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <button onClick={() => setSelectedCashier(null)} className="flex-shrink-0 text-white/40 hover:text-white transition-colors p-1 touch-manipulation">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h1 className="text-lg md:text-2xl font-bold tracking-tight min-w-0 truncate">
            <span className="text-[var(--gold)]">Caja</span>{" "}
            <span className="text-white/40 font-light">{cashierName}</span>
          </h1>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          {clock && <span className="hidden md:inline text-white/30 text-sm">{clock}</span>}
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <button
            onClick={() => setShowCloseForm(true)}
            className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 px-3 md:px-4 py-2 text-xs md:text-sm font-bold hover:bg-red-500/20 transition-all touch-manipulation whitespace-nowrap"
          >
            Cerrar caja
          </button>
          <a href="/" className="text-white/30 hover:text-white/60 text-sm transition-colors hidden sm:inline">Mesas</a>
        </div>
      </header>

      {result && (
        <div className={cn(
          "mb-4 rounded-xl p-4 text-sm font-medium flex items-center justify-between",
          result.success ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20" : "bg-red-400/10 text-red-400 border border-red-400/20"
        )}>
          <span>{result.message}</span>
          <button onClick={() => setResult(null)} className="text-current opacity-50 hover:opacity-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Ventas hoy" value={formatCRC(summary?.totalSales || "0")} color="text-emerald-400" />
        <SummaryCard label="IVA 13%" value={formatCRC(summary?.totalTax || "0")} color="text-yellow-400" />
        <SummaryCard label="Ordenes cerradas" value={String(summary?.totalOrders || 0)} color="text-blue-400" />
        <SummaryCard label="Mesas por cobrar" value={String(pendingTables.length)} color={pendingTables.length > 0 ? "text-orange-400" : "text-white/30"} />
      </div>

      <div className="flex items-center gap-2 mb-6">
        {([["pending", "Por cobrar", pendingTables.length], ["movements", "Movimientos", session.movements.length], ["summary", "Resumen", null]] as [Tab, string, number | null][]).map(
          ([tab, label, count]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
                activeTab === tab ? "bg-[var(--gold)] text-black" : "bg-white/5 text-white/50 hover:bg-white/10"
              )}
            >
              {label}
              {count !== null && count > 0 && (
                <span className={cn("ml-2 inline-flex items-center justify-center rounded-full text-[10px] font-bold w-5 h-5", activeTab === tab ? "bg-black/20 text-black" : "bg-white/10 text-white/50")}>
                  {count}
                </span>
              )}
            </button>
          )
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowMovementForm(true)}
          className="rounded-xl bg-white/5 text-white/50 px-4 py-2.5 text-sm hover:bg-white/10 transition-all"
        >
          + Movimiento
        </button>
      </div>

      {activeTab === "pending" && (
        <div>
          {pendingTables.length === 0 ? (
            <EmptyState text="No hay mesas pendientes de cobro" />
          ) : selectedTable ? (
            <div className="max-w-lg mx-auto">
              <button
                onClick={() => { setSelectedTable(null); resetForm(); setResult(null); }}
                className="text-white/40 hover:text-white text-sm mb-4 flex items-center gap-1 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                Volver
              </button>

              <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Mesa {selectedTable.number}</h2>
                  <span className="text-sm text-white/40">{selectedTable.orders[0]?.waiter.name}</span>
                </div>

                <div className="space-y-1.5">
                  {selectedTable.orders.flatMap((o) =>
                    o.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-lg bg-white/5 p-3 text-sm">
                        <span className="text-white/80">{item.quantity}x {item.product.name}</span>
                        <span className="text-white/50">{formatCRC(parseFloat(item.unitPrice) * item.quantity)}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2 pt-2 border-t border-white/10">
                  <Row label="Subtotal" value={formatCRC(selectedTable.subtotal)} />
                  <Row label="IVA 13%" value={formatCRC(selectedTable.tax)} />
                  <div className="h-px bg-white/10" />
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-white">Total</span>
                    <span className="text-[var(--gold)]">{formatCRC(selectedTable.total)}</span>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-white/50 block mb-2">Método de pago</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["EFECTIVO", "TARJETA", "SINPE"] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPaymentMethod(m)}
                        className={cn(
                          "rounded-xl py-3 text-sm font-medium transition-all",
                          paymentMethod === m ? "bg-[var(--gold)] text-black" : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        {PAYMENT_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-white/50 block mb-2">Comprobante</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([["NINGUNO", "Sin comprobante"], ["TIQUETE", "Tiquete"], ["FACTURA", "Factura"]] as [InvoiceOption, string][]).map(
                      ([opt, label]) => (
                        <button
                          key={opt}
                          onClick={() => setInvoiceOption(opt)}
                          className={cn(
                            "rounded-xl py-3 text-sm font-medium transition-all",
                            invoiceOption === opt
                              ? opt === "FACTURA" ? "bg-purple-500 text-white" : opt === "TIQUETE" ? "bg-blue-500 text-white" : "bg-white/20 text-white"
                              : "bg-white/5 text-white/50 hover:bg-white/10"
                          )}
                        >
                          {label}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {invoiceOption === "FACTURA" && (
                  <div className="space-y-3 pt-2 border-t border-white/10">
                    <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Datos del cliente</h3>
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Nombre</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Nombre completo o razón social"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Tipo ID</label>
                        <select
                          value={customerIdType}
                          onChange={(e) => setCustomerIdType(e.target.value as "01" | "02" | "03")}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 appearance-none"
                        >
                          <option value="01">Física</option>
                          <option value="02">Jurídica</option>
                          <option value="03">DIMEX</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-white/40 block mb-1">Cédula / ID</label>
                        <input
                          type="text"
                          value={customerIdNumber}
                          onChange={(e) => setCustomerIdNumber(e.target.value)}
                          placeholder={customerIdType === "01" ? "0-0000-0000" : customerIdType === "02" ? "3-101-000000" : "000000000000"}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Correo (opcional)</label>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="cliente@ejemplo.com"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={() => handleCloseTable(selectedTable)}
                  disabled={processing || (invoiceOption === "FACTURA" && (!customerName.trim() || !customerIdNumber.trim()))}
                  className="w-full rounded-xl bg-emerald-500 text-white py-4 text-lg font-bold hover:bg-emerald-600 disabled:opacity-50 transition-all active:scale-[0.98]"
                >
                  {processing
                    ? "Procesando..."
                    : `Cobrar ${formatCRC(selectedTable.total)}${invoiceOption !== "NINGUNO" ? ` + ${invoiceOption === "FACTURA" ? "Factura" : "Tiquete"}` : ""}`}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {pendingTables.map((table) => (
                <button
                  key={table.id}
                  onClick={() => { setSelectedTable(table); resetForm(); setResult(null); }}
                  className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-5 text-left hover:border-[var(--gold)]/30 hover:bg-white/5 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-2xl font-black text-white">{table.number}</span>
                    <span className="text-xs text-white/30">{table.itemCount} items</span>
                  </div>
                  <div className="text-sm text-white/40 mb-1">Mesero: {table.orders[0]?.waiter.name}</div>
                  <div className="text-lg font-bold text-[var(--gold)]">{formatCRC(table.total)}</div>
                  <div className="text-xs text-white/30 mt-1">IVA: {formatCRC(table.tax)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "movements" && (
        <div className="max-w-2xl">
          {session.movements.length === 0 ? (
            <EmptyState text="Sin movimientos registrados" />
          ) : (
            <div className="space-y-1.5">
              {session.movements.map((m) => {
                const cfg = MOVEMENT_LABELS[m.type] || { label: m.type, color: "text-white/50" };
                return (
                  <div key={m.id} className="flex items-center justify-between rounded-xl bg-[#1A1A1A] border border-white/10 p-4">
                    <div className="flex items-center gap-3">
                      <span className={cn("text-sm font-bold", cfg.color)}>{cfg.label}</span>
                      <span className="text-sm text-white/50">{m.description}</span>
                      {m.paymentMethod && (
                        <span className="text-xs bg-white/5 text-white/30 rounded-full px-2 py-0.5">
                          {PAYMENT_LABELS[m.paymentMethod] || m.paymentMethod}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className={cn("text-sm font-bold", m.type === "SALIDA" ? "text-red-400" : "text-white")}>
                        {m.type === "SALIDA" ? "-" : "+"}{formatCRC(m.amount)}
                      </div>
                      <div className="text-[10px] text-white/20">
                        {new Date(m.createdAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}{m.user.name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "summary" && summary && (
        <div className="max-w-md space-y-4">
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 space-y-3">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Resumen del día</h3>
            <Row label="Subtotal ventas" value={formatCRC(summary.totalSubtotal)} />
            <Row label="IVA 13% recaudado" value={formatCRC(summary.totalTax)} />
            <div className="h-px bg-white/10" />
            <div className="flex justify-between text-lg font-bold">
              <span className="text-white">Total ventas</span>
              <span className="text-emerald-400">{formatCRC(summary.totalSales)}</span>
            </div>
            <div className="text-sm text-white/30">{summary.totalOrders} orden{summary.totalOrders !== 1 ? "es" : ""} cerrada{summary.totalOrders !== 1 ? "s" : ""}</div>
          </div>
          {summary.byMethod.length > 0 && (
            <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 space-y-3">
              <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Por método de pago</h3>
              {summary.byMethod.map((m) => (
                <div key={m.method} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white/80">{PAYMENT_LABELS[m.method] || m.method}</span>
                    <span className="text-xs text-white/30 ml-2">({m.count} orden{m.count > 1 ? "es" : ""})</span>
                  </div>
                  <span className="text-sm font-bold text-white">{formatCRC(m.total)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 space-y-2">
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Caja</h3>
            <Row label="Apertura" value={formatCRC(session.openingAmount)} />
            <Row label="Abierta desde" value={new Date(session.openedAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })} />
            <Row label="Cajero" value={session.user.name} />
          </div>
        </div>
      )}

      {showMovementForm && (
        <Modal onClose={() => setShowMovementForm(false)}>
          <h2 className="text-lg font-bold text-white mb-4">Nuevo movimiento</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMovType("ENTRADA")} className={cn("rounded-xl py-3 text-sm font-medium transition-all", movType === "ENTRADA" ? "bg-emerald-500 text-white" : "bg-white/5 text-white/50")}>Entrada</button>
              <button onClick={() => setMovType("SALIDA")} className={cn("rounded-xl py-3 text-sm font-medium transition-all", movType === "SALIDA" ? "bg-red-500 text-white" : "bg-white/5 text-white/50")}>Salida</button>
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">Monto (₡)</label>
              <input type="number" value={movAmount} onChange={(e) => setMovAmount(e.target.value)} placeholder="0" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xl text-white text-center focus:outline-none focus:border-[var(--gold)]/50" />
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">Descripción</label>
              <input type="text" value={movDesc} onChange={(e) => setMovDesc(e.target.value)} placeholder="Ej: Compra de hielo" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--gold)]/50" />
            </div>
            <button onClick={handleAddMovement} disabled={!movAmount || !movDesc.trim()} className="w-full rounded-xl bg-[var(--gold)] text-black py-3 font-bold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all">Registrar</button>
          </div>
        </Modal>
      )}

      {showCloseForm && (
        <Modal onClose={() => setShowCloseForm(false)}>
          <h2 className="text-lg font-bold text-white mb-4">Cierre de caja</h2>
          <div className="space-y-4">
            <div className="rounded-xl bg-white/5 p-4 space-y-2">
              <Row label="Apertura" value={formatCRC(session.openingAmount)} />
              <Row label="Ventas efectivo" value={formatCRC(summary?.totalSales || "0")} />
              <Row label="Ordenes cerradas" value={String(summary?.totalOrders || 0)} />
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">Monto contado en caja (₡)</label>
              <input type="number" value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} placeholder="0" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-2xl text-white text-center focus:outline-none focus:border-[var(--gold)]/50" />
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">Observaciones (opcional)</label>
              <input type="text" value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} placeholder="Ej: Sin novedades" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--gold)]/50" />
            </div>
            <button onClick={handleCloseSession} disabled={!closingAmount} className="w-full rounded-xl bg-red-500 text-white py-4 text-lg font-bold hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all">Cerrar caja</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-white/50">{label}</span>
      <span className={color || "text-white"}>{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl bg-[#1A1A1A] border border-white/10 p-4">
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <div className={cn("text-xl font-bold", color)}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-48">
      <span className="text-white/20 text-lg">{text}</span>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#1A1A1A] border border-white/10 p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/30 hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
        {children}
      </div>
    </div>
  );
}
