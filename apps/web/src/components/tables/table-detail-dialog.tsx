"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { authFetch, getSession } from "@/lib/auth-client";
import { formatCRC, IVA_RATE } from "@/lib/constants";

type TableStatus =
  | "LIBRE"
  | "OCUPADA"
  | "ESPERANDO_PEDIDO"
  | "EN_PREPARACION"
  | "PENDIENTE_PAGO"
  | "PAGO_PARCIAL";

interface ItemModifier {
  id: string;
  name: string;
  priceDelta: number | string;
}

interface OrderItem {
  id: string;
  quantity: number;
  status: string;
  unitPrice?: string;
  finalPrice?: string;
  isOpenItem?: boolean;
  customName?: string | null;
  notes?: string | null;
  product: { id: string; name: string; price?: string } | null;
  modifiers?: ItemModifier[];
}

interface PaymentRecord {
  id: string;
  paidAmount: string;
  status: string;
  createdAt: string;
}

interface Order {
  id: string;
  covers?: number;
  waiter: { id: string; name: string };
  items: OrderItem[];
  payments?: PaymentRecord[];
}

interface TableData {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  orders?: Order[];
}

interface TableDetailDialogProps {
  table: TableData | null;
  tables: TableData[];
  open: boolean;
  onClose: () => void;
  onChangeStatus: (id: string, status: TableStatus) => void;
  onRefresh: () => void;
  detailLoading?: boolean;
}

type View = "main" | "merge" | "transfer" | "split" | "deleteItem" | "payment";
type PaymentMethod = "EFECTIVO" | "TARJETA" | "SINPE";
type InvoiceOption = "NINGUNO" | "TIQUETE" | "FACTURA";
interface PayLine { method: PaymentMethod; amount: string; reference: string }

const PAYMENT_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  SINPE: "SINPE Móvil",
};

const STATUS_LABELS: Record<TableStatus, { text: string; color: string }> = {
  LIBRE: { text: "Libre", color: "text-emerald-400" },
  OCUPADA: { text: "Ocupada", color: "text-amber-400" },
  ESPERANDO_PEDIDO: { text: "Esperando pedido", color: "text-blue-400" },
  EN_PREPARACION: { text: "En preparación", color: "text-orange-400" },
  PENDIENTE_PAGO: { text: "Pendiente de pago", color: "text-red-400" },
  PAGO_PARCIAL: { text: "Pago parcial", color: "text-purple-400" },
};

export function TableDetailDialog({
  table,
  tables,
  open,
  onClose,
  onChangeStatus,
  onRefresh,
  detailLoading = false,
}: TableDetailDialogProps) {
  const router = useRouter();
  const session = getSession();
  const role = session?.user.role;
  const canCharge = role === "CAJERO" || role === "ADMINISTRADOR";
  const [view, setView] = useState<View>("main");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Merge
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  // Transfer
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Delete
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  // Split
  const [splitGroups, setSplitGroups] = useState<string[][]>([]);
  const [currentGroup, setCurrentGroup] = useState(0);

  // Payment
  const [invoiceOption, setInvoiceOption] = useState<InvoiceOption>("NINGUNO");
  const [customerName, setCustomerName] = useState("");
  const [customerIdType, setCustomerIdType] = useState<"01" | "02" | "03">("01");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  // Líneas de pago (mixto/parcial)
  const [payLines, setPayLines] = useState<PayLine[]>([{ method: "EFECTIVO", amount: "", reference: "" }]);

  // Optimistic UI: overrides item status locally while API confirms in background
  const [localItemStatuses, setLocalItemStatuses] = useState<Record<string, string>>({});
  // Per-item busy: only that button spins, rest of comanda stays usable
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced refresh: batches rapid actions into 1 refetch after 800ms idle
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      setLocalItemStatuses({});
      onRefresh();
    }, 800);
  }, [onRefresh]);

  if (!table) return null;

  const statusInfo = STATUS_LABELS[table.status];
  const activeOrder = table.orders?.[0];
  const allItems = table.orders?.flatMap((o) => o.items.map((i) => ({ ...i, orderId: o.id }))) || [];
  // Returns the locally-overridden status (optimistic) or the server status
  const getEffectiveStatus = (item: { id: string; status: string }) =>
    localItemStatuses[item.id] ?? item.status;
  // Count of LISTO items using effective (optimistic) status
  const listoCount = allItems.filter((i) => getEffectiveStatus(i) === "LISTO").length;
  const otherTables = tables.filter((t) => t.id !== table.id);
  const hasOrders = allItems.length > 0;
  // ¿Alguna orden de la mesa ya tiene abonos? Si es así, se bloquea mover/dividir/eliminar
  const anyOrderHasPayments = (table.orders || []).some((o) => (o.payments?.length ?? 0) > 0);
  const totalAbonado = (table.orders || []).reduce(
    (s, o) => s + (o.payments || []).reduce((a, p) => a + parseFloat(p.paidAmount), 0),
    0
  );

  const resetState = () => {
    setView("main");
    setError("");
    setSuccess("");
    setMergeTarget(null);
    setTransferTarget(null);
    setSelectedItems(new Set());
    setDeleteItemId(null);
    setDeleteOrderId(null);
    setAdminPin("");
    setDeleteReason("");
    setSplitGroups([]);
    setCurrentGroup(0);
    setInvoiceOption("NINGUNO");
    setCustomerName("");
    setCustomerIdType("01");
    setCustomerIdNumber("");
    setCustomerEmail("");
    setPayingOrderId(null);
    setPayLines([{ method: "EFECTIVO", amount: "", reference: "" }]);
    setLocalItemStatuses({});
    setBusyItems(new Set());
    if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleTakeOrder = () => {
    handleClose();
    router.push(`/pos/${table.id}`);
  };

  const handleMerge = async () => {
    if (!mergeTarget || processing) return;
    setProcessing(true);
    setError("");
    try {
      const res = await authFetch("/api/tables/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTableId: table.id, targetTableId: mergeTarget }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Error al unir mesas");
        return;
      }
      setSuccess("Mesas unidas correctamente");
      onRefresh();
      setTimeout(handleClose, 1000);
    } catch {
      setError("Error de conexión");
    } finally {
      setProcessing(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferTarget || selectedItems.size === 0 || processing) return;
    setProcessing(true);
    setError("");
    try {
      const res = await authFetch("/api/tables/transfer-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTableId: table.id,
          targetTableId: transferTarget,
          itemIds: Array.from(selectedItems),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Error al transferir");
        return;
      }
      setSuccess("Productos transferidos");
      onRefresh();
      setTimeout(handleClose, 1000);
    } catch {
      setError("Error de conexión");
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteItemId || !deleteOrderId || !adminPin || processing) return;
    setProcessing(true);
    setError("");
    try {
      const res = await authFetch(`/api/orders/${deleteOrderId}/items/${deleteItemId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPin, reason: deleteReason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Error al eliminar");
        return;
      }
      setSuccess("Producto eliminado");
      onRefresh();
      setTimeout(() => {
        setSuccess("");
        setView("main");
        setDeleteItemId(null);
        setAdminPin("");
        setDeleteReason("");
      }, 1000);
    } catch {
      setError("Error de conexión");
    } finally {
      setProcessing(false);
    }
  };

  const handleSplit = async () => {
    if (!activeOrder || splitGroups.length < 2 || processing) return;
    setProcessing(true);
    setError("");
    try {
      const res = await authFetch("/api/tables/split-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: activeOrder.id, groups: splitGroups }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Error al dividir");
        return;
      }
      setSuccess("Cuenta dividida");
      onRefresh();
      setTimeout(handleClose, 1000);
    } catch {
      setError("Error de conexión");
    } finally {
      setProcessing(false);
    }
  };

  const handleDeliverItem = async (orderId: string, itemId: string) => {
    if (busyItems.has(itemId)) return;
    setError("");
    // Optimistic: flip to ENTREGADO immediately, no waiting
    setLocalItemStatuses((prev) => ({ ...prev, [itemId]: "ENTREGADO" }));
    setBusyItems((prev) => new Set(prev).add(itemId));
    try {
      const res = await authFetch(`/api/orders/${orderId}/items/${itemId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ENTREGADO" }),
      });
      if (!res.ok) {
        // Revert optimistic change on error
        setLocalItemStatuses((prev) => { const n = { ...prev }; delete n[itemId]; return n; });
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "No se pudo marcar entregado");
        return;
      }
      scheduleRefresh();
    } catch {
      setLocalItemStatuses((prev) => { const n = { ...prev }; delete n[itemId]; return n; });
      setError("Error de conexión");
    } finally {
      setBusyItems((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  };

  // Batch deliver: optimistically marks all LISTO items delivered, then confirms with 1 request
  const handleDeliverAll = async (orderId: string) => {
    const listoIds = allItems
      .filter((i) => i.orderId === orderId && getEffectiveStatus(i) === "LISTO")
      .map((i) => i.id);
    if (listoIds.length === 0) return;
    setError("");
    // Optimistic: flip all LISTO → ENTREGADO immediately
    setLocalItemStatuses((prev) => {
      const n = { ...prev };
      listoIds.forEach((id) => { n[id] = "ENTREGADO"; });
      return n;
    });
    try {
      const res = await authFetch(`/api/orders/${orderId}/items/deliver-all`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Revert all on error
        setLocalItemStatuses((prev) => {
          const n = { ...prev };
          listoIds.forEach((id) => { delete n[id]; });
          return n;
        });
        setError(typeof data.error === "string" ? data.error : "No se pudo entregar todo");
        return;
      }
      if (data.deliveredCount > 0) {
        setSuccess(data.message);
        setTimeout(() => setSuccess(""), 2000);
      }
      scheduleRefresh();
    } catch {
      setLocalItemStatuses((prev) => {
        const n = { ...prev };
        listoIds.forEach((id) => { delete n[id]; });
        return n;
      });
      setError("Error de conexión");
    }
  };

  const getItemPrice = (item: OrderItem) => {
    if (item.finalPrice) return parseFloat(item.finalPrice);
    if (item.unitPrice) return parseFloat(item.unitPrice);
    if (item.product?.price) return parseFloat(item.product.price);
    return 0;
  };

  const getOrderTotal = (order: Order) => {
    const subtotal = order.items.reduce((sum, item) => {
      return sum + getItemPrice(item) * item.quantity;
    }, 0);
    const tax = subtotal * IVA_RATE;
    return { subtotal, tax, total: subtotal + tax };
  };

  const getOrderPaid = (order: Order) =>
    (order.payments || []).reduce((s, p) => s + parseFloat(p.paidAmount), 0);

  const getOrderBalance = (order: Order) =>
    Math.max(0, getOrderTotal(order).total - getOrderPaid(order));

  // Pago mixto / parcial usando /api/caja/orders/:id/pay
  const handleMixedPay = async (orderId: string, balance: number) => {
    if (processing) return;
    const details = payLines
      .map((l) => ({ method: l.method, amount: parseFloat(l.amount), reference: l.reference.trim() || undefined }))
      .filter((l) => !isNaN(l.amount) && l.amount > 0);

    if (details.length === 0) {
      setError("Ingrese al menos un monto");
      return;
    }
    const sum = details.reduce((s, d) => s + d.amount, 0);
    if (sum - balance > 0.01) {
      setError(`El monto excede el saldo pendiente (${formatCRC(balance)})`);
      return;
    }
    const fullyPaying = balance - sum <= 0.01;
    if (fullyPaying && invoiceOption === "FACTURA" && (!customerName.trim() || !customerIdNumber.trim())) {
      setError("Nombre y cédula son requeridos para factura");
      return;
    }

    setProcessing(true);
    setError("");
    try {
      const cashierId = getSession()?.user.id;
      if (!cashierId) { setError("Sesión no válida"); return; }

      const body: Record<string, unknown> = { cashierId, details };
      if (fullyPaying && invoiceOption !== "NINGUNO") {
        body.invoiceType = invoiceOption;
        if (invoiceOption === "FACTURA") {
          body.customerName = customerName.trim();
          body.customerIdType = customerIdType;
          body.customerIdNumber = customerIdNumber.trim();
          if (customerEmail.trim()) body.customerEmail = customerEmail.trim();
        }
      }

      const res = await authFetch(`/api/caja/orders/${orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Error al cobrar");
        return;
      }

      if (data.status === "PARCIAL") {
        setSuccess(`Abono ${formatCRC(data.paidNow)} · Saldo ${formatCRC(data.balance)}`);
        onRefresh();
        setPayLines([{ method: "EFECTIVO", amount: "", reference: "" }]);
        setTimeout(() => setSuccess(""), 2500);
      } else {
        const invoiceMsg = data.invoice
          ? ` · ${data.invoice.type === "FACTURA" ? "Factura" : "Tiquete"} #${data.invoice.sequence}`
          : "";
        setSuccess(`Cobrado: ${formatCRC(data.total)}${invoiceMsg}`);
        onRefresh();
        if (data.tableFreed) {
          setTimeout(handleClose, 1200);
        } else {
          setPayingOrderId(null);
          setPayLines([{ method: "EFECTIVO", amount: "", reference: "" }]);
          setInvoiceOption("NINGUNO");
          setTimeout(() => setSuccess(""), 2000);
        }
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setProcessing(false);
    }
  };

  const toggleItemSelection = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const initSplit = () => {
    if (!allItems.length) return;
    setSplitGroups([allItems.map((i) => i.id), []]);
    setCurrentGroup(1);
    setView("split");
  };

  const toggleSplitItem = (itemId: string) => {
    setSplitGroups((prev) => {
      const next = prev.map((g) => g.filter((id) => id !== itemId));
      next[currentGroup] = [...next[currentGroup], itemId];
      return next;
    });
  };

  const getSplitGroupForItem = (itemId: string): number => {
    return splitGroups.findIndex((g) => g.includes(itemId));
  };

  const SPLIT_COLORS = ["text-blue-400", "text-emerald-400", "text-purple-400", "text-orange-400"];
  const SPLIT_BG = ["bg-blue-400/10", "bg-emerald-400/10", "bg-purple-400/10", "bg-orange-400/10"];
  const SPLIT_LABELS = ["Cuenta A", "Cuenta B", "Cuenta C", "Cuenta D"];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#1A1A1A] border-white/10 text-white w-[95vw] max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Mesa {table.number}
            <span className={cn("ml-3 text-base font-normal", statusInfo.color)}>
              {statusInfo.text}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Skeleton while loading full detail */}
        {detailLoading && (
          <div className="space-y-3 pt-2 animate-pulse">
            <div className="h-4 w-1/3 rounded bg-white/10" />
            <div className="rounded-xl bg-white/5 p-4 space-y-2">
              <div className="h-3 w-1/2 rounded bg-white/10" />
              <div className="h-3 w-3/4 rounded bg-white/10" />
              <div className="h-3 w-2/3 rounded bg-white/10" />
            </div>
            <div className="h-10 rounded-xl bg-white/5" />
          </div>
        )}

        {!detailLoading && error && (
          <div className="rounded-lg bg-red-400/10 border border-red-400/20 p-3 text-sm text-red-400">{error}</div>
        )}
        {!detailLoading && success && (
          <div className="rounded-lg bg-emerald-400/10 border border-emerald-400/20 p-3 text-sm text-emerald-400">{success}</div>
        )}

        {/* MAIN VIEW */}
        {!detailLoading && view === "main" && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-4 text-sm text-white/50">
              <span>Capacidad: {table.capacity}</span>
              {activeOrder?.covers && activeOrder.covers > 0 && (
                <span className="text-white/70">Comensales: <span className="text-[var(--gold)] font-semibold">{activeOrder.covers}</span></span>
              )}
            </div>

            {anyOrderHasPayments && (
              <div className="rounded-xl bg-purple-400/10 border border-purple-400/20 p-3 text-sm flex items-center justify-between">
                <span className="text-purple-300 font-medium">Abono registrado</span>
                <span className="text-purple-200 font-bold">{formatCRC(totalAbonado)}</span>
              </div>
            )}

            {hasOrders && (
              <div className="rounded-xl bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--gold)]">Orden activa</span>
                  <div className="flex items-center gap-2">
                    {activeOrder && listoCount > 0 && (
                      <button
                        type="button"
                        onClick={() => handleDeliverAll(activeOrder.id)}
                        className="text-xs rounded-full px-3 py-1 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors font-semibold"
                      >
                        Entregar todo ({listoCount})
                      </button>
                    )}
                    <span className="text-xs text-white/40">{activeOrder?.waiter.name}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {allItems.map((item) => {
                    const itemName = item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "—");
                    const mods = Array.isArray(item.modifiers) ? item.modifiers : [];
                    const effectiveStatus = getEffectiveStatus(item);
                    const itemBusy = busyItems.has(item.id);
                    return (
                      <div key={item.id}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-white/70">
                            {item.quantity}x {itemName}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-white/30 text-xs">{formatCRC(getItemPrice(item) * item.quantity)}</span>
                            <span className={cn(
                              "text-xs rounded-full px-2 py-0.5 transition-colors",
                              effectiveStatus === "ENTREGADO" ? "bg-emerald-400/20 text-emerald-300"
                                : effectiveStatus === "LISTO" ? "bg-emerald-400/10 text-emerald-400"
                                : effectiveStatus === "PREPARANDO" ? "bg-orange-400/10 text-orange-400"
                                : "bg-white/5 text-white/40"
                            )}>{effectiveStatus}</span>
                            {effectiveStatus === "LISTO" && (
                              <button
                                type="button"
                                disabled={itemBusy}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeliverItem(item.orderId, item.id);
                                }}
                                className="text-xs rounded-full px-2 py-0.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                                title="Marcar como entregado"
                              >
                                {itemBusy ? "..." : "Entregar"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeleteItemId(item.id);
                                setDeleteOrderId(item.orderId);
                                setView("deleteItem");
                                setError("");
                              }}
                              className="p-1 rounded text-red-400/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                              title="Eliminar producto"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                        </div>
                        {mods.length > 0 && (
                          <div className="ml-6 mt-0.5 space-y-0.5">
                            {mods.map((m) => (
                              <div key={m.id} className="text-xs text-[var(--gold)]/60">
                                {m.name}{Number(m.priceDelta) > 0 ? ` +${formatCRC(Number(m.priceDelta))}` : ""}
                              </div>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <div className="ml-6 mt-0.5 text-xs text-white/30 italic">{item.notes}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {table.status === "LIBRE" && (
                <>
                  <Button onClick={() => onChangeStatus(table.id, "OCUPADA")} className="w-full text-white font-semibold py-6 text-base bg-amber-500 hover:bg-amber-600">
                    Ocupar mesa
                  </Button>
                  <Button onClick={handleTakeOrder} className="w-full text-black font-semibold py-6 text-base bg-[var(--gold)] hover:bg-[var(--gold)]/80">
                    Tomar pedido directo
                  </Button>
                </>
              )}

              {table.status === "OCUPADA" && (
                <>
                  <Button onClick={handleTakeOrder} className="w-full text-black font-semibold py-6 text-base bg-[var(--gold)] hover:bg-[var(--gold)]/80">
                    Tomar pedido
                  </Button>
                  <Button onClick={() => onChangeStatus(table.id, "LIBRE")} className="w-full text-white font-semibold py-6 text-base bg-emerald-500 hover:bg-emerald-600">
                    Liberar mesa
                  </Button>
                </>
              )}

              {(table.status === "EN_PREPARACION" || table.status === "PENDIENTE_PAGO" || table.status === "PAGO_PARCIAL") && (
                <>
                  <Button onClick={handleTakeOrder} className="w-full text-black font-semibold py-6 text-base bg-[var(--gold)] hover:bg-[var(--gold)]/80">
                    {table.status === "EN_PREPARACION" ? "Agregar al pedido" : "Ver pedido"}
                  </Button>
                  {table.status === "EN_PREPARACION" && (
                    <Button onClick={() => onChangeStatus(table.id, "PENDIENTE_PAGO")} className="w-full text-white font-semibold py-6 text-base bg-red-500 hover:bg-red-600">
                      {canCharge ? "Listo para cobrar" : "Solicitar cobro"}
                    </Button>
                  )}
                  {canCharge ? (
                    <Button
                      onClick={() => { setView("payment"); setError(""); setSuccess(""); }}
                      className="w-full text-white font-semibold py-6 text-base bg-emerald-500 hover:bg-emerald-600"
                    >
                      {table.status === "PAGO_PARCIAL" ? "Cobrar saldo" : "Cobrar mesa"}
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-white/30 pt-1">
                      El cobro lo realiza caja o administración
                    </p>
                  )}
                </>
              )}

              {table.status === "ESPERANDO_PEDIDO" && (
                <Button onClick={() => onChangeStatus(table.id, "EN_PREPARACION")} className="w-full text-white font-semibold py-6 text-base bg-orange-500 hover:bg-orange-600">
                  Enviar a cocina
                </Button>
              )}

              {hasOrders && (
                <>
                  <div className="h-px bg-white/10 my-1" />
                  {anyOrderHasPayments && (
                    <p className="text-center text-[11px] text-white/30">
                      Mesa con abono: no se puede unir, mover ni dividir hasta saldar
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      disabled={anyOrderHasPayments}
                      onClick={() => { setView("merge"); setError(""); }}
                      className="rounded-xl bg-white/5 border border-white/10 py-3 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Unir mesas
                    </button>
                    <button
                      disabled={anyOrderHasPayments}
                      onClick={() => { setView("transfer"); setError(""); setSelectedItems(new Set()); }}
                      className="rounded-xl bg-white/5 border border-white/10 py-3 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Mover items
                    </button>
                    <button
                      disabled={anyOrderHasPayments}
                      onClick={() => { initSplit(); setError(""); }}
                      className="rounded-xl bg-white/5 border border-white/10 py-3 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Dividir cuenta
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* MERGE VIEW */}
        {!detailLoading && view === "merge" && (
          <div className="space-y-4 pt-2">
            <button onClick={() => { setView("main"); setError(""); }} className="text-white/40 hover:text-white text-sm flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              Volver
            </button>
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">
              Unir Mesa {table.number} con...
            </h3>
            <p className="text-xs text-white/30">Todos los productos de Mesa {table.number} se moverán a la mesa seleccionada.</p>
            <div className="grid grid-cols-3 gap-2">
              {otherTables.filter((t) => t.status !== "LIBRE" || t.orders?.some((o) => o.items.length > 0)).length === 0 && otherTables.length > 0 ? (
                otherTables.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setMergeTarget(t.id)}
                    className={cn(
                      "rounded-xl border py-4 text-center transition-all",
                      mergeTarget === t.id ? "border-[var(--gold)] bg-[var(--gold)]/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    )}
                  >
                    <span className="text-lg font-bold">{t.number}</span>
                    <span className={cn("block text-[10px] mt-1", STATUS_LABELS[t.status].color)}>{STATUS_LABELS[t.status].text}</span>
                  </button>
                ))
              ) : (
                otherTables.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setMergeTarget(t.id)}
                    className={cn(
                      "rounded-xl border py-4 text-center transition-all",
                      mergeTarget === t.id ? "border-[var(--gold)] bg-[var(--gold)]/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    )}
                  >
                    <span className="text-lg font-bold">{t.number}</span>
                    <span className={cn("block text-[10px] mt-1", STATUS_LABELS[t.status].color)}>{STATUS_LABELS[t.status].text}</span>
                  </button>
                ))
              )}
            </div>
            <Button
              onClick={handleMerge}
              disabled={!mergeTarget || processing}
              className="w-full text-white font-semibold py-5 bg-blue-500 hover:bg-blue-600 disabled:opacity-30"
            >
              {processing ? "Uniendo..." : "Unir mesas"}
            </Button>
          </div>
        )}

        {/* TRANSFER VIEW */}
        {!detailLoading && view === "transfer" && (
          <div className="space-y-4 pt-2">
            <button onClick={() => { setView("main"); setError(""); }} className="text-white/40 hover:text-white text-sm flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              Volver
            </button>
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">
              Mover productos a otra mesa
            </h3>
            <div className="space-y-1">
              {allItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleItemSelection(item.id)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-lg p-3 text-sm transition-all text-left",
                    selectedItems.has(item.id) ? "bg-[var(--gold)]/10 border border-[var(--gold)]/30" : "bg-white/5 border border-transparent hover:bg-white/10"
                  )}
                >
                  <span className="text-white/80">{item.quantity}x {(item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "—"))}</span>
                  {selectedItems.has(item.id) && (
                    <span className="text-[var(--gold)] text-xs font-bold">Seleccionado</span>
                  )}
                </button>
              ))}
            </div>
            {selectedItems.size > 0 && (
              <>
                <h4 className="text-xs text-white/40 mt-2">Mover a mesa:</h4>
                <div className="grid grid-cols-4 gap-2">
                  {otherTables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTransferTarget(t.id)}
                      className={cn(
                        "rounded-xl border py-3 text-center transition-all",
                        transferTarget === t.id ? "border-[var(--gold)] bg-[var(--gold)]/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                      )}
                    >
                      <span className="text-sm font-bold">{t.number}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <Button
              onClick={handleTransfer}
              disabled={selectedItems.size === 0 || !transferTarget || processing}
              className="w-full text-white font-semibold py-5 bg-purple-500 hover:bg-purple-600 disabled:opacity-30"
            >
              {processing ? "Moviendo..." : `Mover ${selectedItems.size} item${selectedItems.size > 1 ? "s" : ""}`}
            </Button>
          </div>
        )}

        {/* DELETE ITEM VIEW */}
        {!detailLoading && view === "deleteItem" && (
          <div className="space-y-4 pt-2">
            <button onClick={() => { setView("main"); setError(""); setAdminPin(""); }} className="text-white/40 hover:text-white text-sm flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              Volver
            </button>
            <div className="rounded-xl bg-red-400/5 border border-red-400/20 p-4 space-y-2">
              <h3 className="text-sm font-bold text-red-400">Eliminar producto</h3>
              <p className="text-xs text-white/40">
                Eliminando: <span className="text-white/70">{(() => {
                  const it = allItems.find((i) => i.id === deleteItemId);
                  if (!it) return "";
                  return it.isOpenItem ? (it.customName || "Producto abierto") : (it.product?.name || "—");
                })()}</span>
              </p>
              <p className="text-xs text-white/30">Se requiere PIN de administrador para eliminar productos.</p>
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">PIN Administrador</label>
              <input
                type="password"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="****"
                maxLength={6}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-center text-xl tracking-[0.5em] focus:outline-none focus:border-red-400/50"
              />
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Motivo (opcional)</label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Ej: Cliente canceló"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30"
              />
            </div>
            <Button
              onClick={handleDeleteItem}
              disabled={adminPin.length < 4 || processing}
              className="w-full text-white font-semibold py-5 bg-red-500 hover:bg-red-600 disabled:opacity-30"
            >
              {processing ? "Verificando..." : "Eliminar con PIN"}
            </Button>
          </div>
        )}

        {/* PAYMENT VIEW */}
        {!detailLoading && view === "payment" && (
          <div className="space-y-4 pt-2">
            <button onClick={() => { setView("main"); setError(""); setPayingOrderId(null); }} className="text-white/40 hover:text-white text-sm flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              Volver
            </button>

            {(() => {
              const orders = table.orders?.filter((o) => o.items.length > 0) || [];
              const hasMultiple = orders.length > 1;

              if (hasMultiple && !payingOrderId) {
                return (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Cuentas divididas</h3>
                    <p className="text-xs text-white/30">Seleccione la cuenta a cobrar</p>
                    {orders.map((order, i) => {
                      const totals = getOrderTotal(order);
                      return (
                        <button
                          key={order.id}
                          onClick={() => { setPayingOrderId(order.id); setError(""); }}
                          className="w-full rounded-xl bg-white/5 border border-white/10 p-4 text-left hover:border-[var(--gold)]/30 transition-all"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-white">Cuenta {String.fromCharCode(65 + i)}</span>
                            <span className="text-lg font-bold text-[var(--gold)]">{formatCRC(totals.total)}</span>
                          </div>
                          <div className="space-y-0.5">
                            {order.items.map((item) => (
                              <div key={item.id} className="text-xs text-white/40">
                                {item.quantity}x {(item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "—"))}
                              </div>
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              }

              const targetOrder = payingOrderId
                ? orders.find((o) => o.id === payingOrderId)
                : orders[0];

              if (!targetOrder) return null;

              const totals = getOrderTotal(targetOrder);
              const paid = getOrderPaid(targetOrder);
              const balance = getOrderBalance(targetOrder);
              const enteredSum = payLines.reduce((s, l) => {
                const n = parseFloat(l.amount);
                return s + (isNaN(n) ? 0 : n);
              }, 0);
              const fullyPaying = balance - enteredSum <= 0.01 && enteredSum > 0;
              const overpaying = enteredSum - balance > 0.01;
              const orderLabel = hasMultiple
                ? `Cuenta ${String.fromCharCode(65 + orders.findIndex((o) => o.id === targetOrder.id))}`
                : "Cuenta";

              return (
                <div className="space-y-4">
                  {hasMultiple && (
                    <button onClick={() => setPayingOrderId(null)} className="text-white/40 hover:text-white text-xs flex items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                      Ver todas las cuentas
                    </button>
                  )}

                  <div className="rounded-xl bg-white/5 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[var(--gold)]">{orderLabel}</span>
                      <span className="text-xs text-white/40">{targetOrder.waiter.name}</span>
                    </div>
                    {targetOrder.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="text-white/60">{item.quantity}x {(item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "—"))}</span>
                        <span className="text-white/30 text-xs">
                          {formatCRC(getItemPrice(item) * item.quantity)}
                        </span>
                      </div>
                    ))}
                    <div className="h-px bg-white/10 my-1" />
                    <div className="flex justify-between text-xs">
                      <span className="text-white/40">Subtotal</span>
                      <span className="text-white/60">{formatCRC(totals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-white/40">IVA 13%</span>
                      <span className="text-white/60">{formatCRC(totals.tax)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold pt-1">
                      <span className="text-white">Total</span>
                      <span className="text-[var(--gold)]">{formatCRC(totals.total)}</span>
                    </div>
                    {paid > 0 && (
                      <>
                        <div className="flex justify-between text-xs">
                          <span className="text-white/40">Pagado</span>
                          <span className="text-emerald-400">{formatCRC(paid)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold">
                          <span className="text-white/70">Saldo pendiente</span>
                          <span className="text-purple-400">{formatCRC(balance)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/40">Pago {payLines.length > 1 ? "(mixto)" : ""}</label>
                      {payLines.length < 3 && (
                        <button
                          type="button"
                          onClick={() => setPayLines((p) => [...p, { method: "SINPE", amount: "", reference: "" }])}
                          className="text-xs text-[var(--gold)]/70 hover:text-[var(--gold)]"
                        >
                          + Agregar método
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {payLines.map((line, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <select
                            value={line.method}
                            onChange={(e) => setPayLines((p) => p.map((l, i) => i === idx ? { ...l, method: e.target.value as PaymentMethod } : l))}
                            className="bg-white/5 border border-white/10 rounded-xl px-2 py-2.5 text-white text-xs focus:outline-none focus:border-[var(--gold)]/50 appearance-none w-24"
                          >
                            {(["EFECTIVO", "TARJETA", "SINPE"] as PaymentMethod[]).map((m) => (
                              <option key={m} value={m} className="bg-[#1A1A1A]">{PAYMENT_LABELS[m]}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={line.amount}
                            onChange={(e) => setPayLines((p) => p.map((l, i) => i === idx ? { ...l, amount: e.target.value } : l))}
                            placeholder="Monto"
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                          />
                          {payLines.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => setPayLines((p) => p.filter((_, i) => i !== idx))}
                              className="p-2 rounded-lg text-red-400/40 hover:text-red-400 hover:bg-red-400/10"
                              title="Quitar"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPayLines((p) => p.map((l, i) => i === idx ? { ...l, amount: String(balance) } : l))}
                              className="text-[10px] text-white/40 hover:text-white px-2 py-1 rounded-lg bg-white/5"
                              title="Pagar saldo completo"
                            >
                              Saldo
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs mt-2">
                      <span className="text-white/40">Ingresado</span>
                      <span className={cn(overpaying ? "text-red-400" : fullyPaying ? "text-emerald-400" : "text-white/60")}>
                        {formatCRC(enteredSum)} / {formatCRC(balance)}
                      </span>
                    </div>
                    {(payLines.some((l) => l.method === "TARJETA" || l.method === "SINPE")) && (
                      <input
                        type="text"
                        value={payLines.find((l) => l.method !== "EFECTIVO")?.reference || ""}
                        onChange={(e) => setPayLines((p) => {
                          const i = p.findIndex((l) => l.method !== "EFECTIVO");
                          if (i < 0) return p;
                          return p.map((l, idx) => idx === i ? { ...l, reference: e.target.value } : l);
                        })}
                        placeholder="Referencia SINPE / voucher (opcional)"
                        className="w-full mt-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[var(--gold)]/50"
                      />
                    )}
                  </div>

                  {fullyPaying && (
                  <>
                  <div>
                    <label className="text-xs text-white/40 block mb-2">Comprobante</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([["NINGUNO", "Ninguno"], ["TIQUETE", "Tiquete"], ["FACTURA", "Factura"]] as [InvoiceOption, string][]).map(
                        ([opt, label]) => (
                          <button
                            key={opt}
                            onClick={() => setInvoiceOption(opt)}
                            className={cn(
                              "rounded-xl py-2.5 text-xs font-medium transition-all",
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
                    <div className="space-y-2 pt-1 border-t border-white/10">
                      <h4 className="text-xs font-bold text-white/40 uppercase tracking-wider">Datos del cliente</h4>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Nombre completo o razón social"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={customerIdType}
                          onChange={(e) => setCustomerIdType(e.target.value as "01" | "02" | "03")}
                          className="bg-white/5 border border-white/10 rounded-xl px-2 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 appearance-none"
                        >
                          <option value="01">Física</option>
                          <option value="02">Jurídica</option>
                          <option value="03">DIMEX</option>
                        </select>
                        <input
                          type="text"
                          value={customerIdNumber}
                          onChange={(e) => setCustomerIdNumber(e.target.value)}
                          placeholder="Cédula / ID"
                          className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                        />
                      </div>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="Correo (opcional)"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
                      />
                    </div>
                  )}
                  </>
                  )}

                  <Button
                    onClick={() => handleMixedPay(targetOrder.id, balance)}
                    disabled={processing || enteredSum <= 0 || overpaying || (fullyPaying && invoiceOption === "FACTURA" && (!customerName.trim() || !customerIdNumber.trim()))}
                    className={cn(
                      "w-full text-white font-semibold py-5 disabled:opacity-30",
                      fullyPaying ? "bg-emerald-500 hover:bg-emerald-600" : "bg-purple-500 hover:bg-purple-600"
                    )}
                  >
                    {processing
                      ? "Procesando..."
                      : overpaying
                        ? "Monto excede el saldo"
                        : fullyPaying
                          ? `Cobrar ${formatCRC(enteredSum)}${invoiceOption !== "NINGUNO" ? ` + ${invoiceOption === "FACTURA" ? "Factura" : "Tiquete"}` : ""}`
                          : `Registrar abono ${formatCRC(enteredSum)}`}
                  </Button>
                </div>
              );
            })()}
          </div>
        )}

        {/* SPLIT VIEW */}
        {!detailLoading && view === "split" && (
          <div className="space-y-4 pt-2">
            <button onClick={() => { setView("main"); setError(""); }} className="text-white/40 hover:text-white text-sm flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              Volver
            </button>
            <h3 className="text-sm font-bold text-white/50 uppercase tracking-wider">Dividir cuenta</h3>
            <p className="text-xs text-white/30">Toque un producto para moverlo a la cuenta seleccionada.</p>

            <div className="flex gap-2">
              {splitGroups.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentGroup(i)}
                  className={cn(
                    "flex-1 rounded-xl py-2 text-xs font-bold transition-all",
                    currentGroup === i ? cn(SPLIT_BG[i], SPLIT_COLORS[i], "border border-current") : "bg-white/5 text-white/40"
                  )}
                >
                  {SPLIT_LABELS[i]} ({splitGroups[i].length})
                </button>
              ))}
              {splitGroups.length < 4 && (
                <button
                  onClick={() => setSplitGroups((p) => [...p, []])}
                  className="rounded-xl bg-white/5 text-white/30 px-3 py-2 text-xs hover:bg-white/10"
                >
                  +
                </button>
              )}
            </div>

            <div className="space-y-1">
              {allItems.map((item) => {
                const group = getSplitGroupForItem(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleSplitItem(item.id)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-lg p-3 text-sm transition-all text-left border",
                      group >= 0 ? cn(SPLIT_BG[group], "border-transparent") : "bg-white/5 border-transparent"
                    )}
                  >
                    <span className="text-white/80">{item.quantity}x {(item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "—"))}</span>
                    {group >= 0 && (
                      <span className={cn("text-xs font-bold", SPLIT_COLORS[group])}>{SPLIT_LABELS[group]}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <Button
              onClick={handleSplit}
              disabled={splitGroups.some((g) => g.length === 0) || processing}
              className="w-full text-white font-semibold py-5 bg-purple-500 hover:bg-purple-600 disabled:opacity-30"
            >
              {processing ? "Dividiendo..." : `Dividir en ${splitGroups.length} cuentas`}
            </Button>
            {splitGroups.some((g) => g.length === 0) && (
              <p className="text-xs text-yellow-400/60 text-center">Cada cuenta debe tener al menos un producto</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
