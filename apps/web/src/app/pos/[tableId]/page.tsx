"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { CategoryTabs } from "@/components/pos/category-tabs";
import { ProductGrid } from "@/components/pos/product-grid";
import { OrderPanel, type OrderLineItem } from "@/components/pos/order-panel";
import { ProductCustomizeModal, type SelectedModifier } from "@/components/pos/product-customize-modal";
import { OpenItemModal } from "@/components/pos/open-item-modal";
import { authFetch, getSession, getTokenExpiry } from "@/lib/auth-client";
import { getCachedCatalog, setCachedCatalog } from "@/lib/catalog-cache";
import { IVA_RATE } from "@/lib/constants";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  productType?: string;
  allowModifiers?: boolean;
  allowNotes?: boolean;
  requiresCustomization?: boolean;
}

interface Category {
  id: string;
  name: string;
  destination: "COCINA" | "BARRA";
  products: Product[];
}

interface TableData {
  id: string;
  number: number;
}

let itemIdCounter = 0;
function nextItemId() {
  return `local-${++itemIdCounter}-${Date.now()}`;
}

export default function POSPage() {
  const params = useParams();
  const router = useRouter();
  const tableId = params.tableId as string;

  const [table, setTable] = useState<TableData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<OrderLineItem[]>([]);
  const [sending, setSending] = useState(false);
  const [waiterId, setWaiterId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("MESERO");
  const [covers, setCovers] = useState(1);

  const [customizeProduct, setCustomizeProduct] = useState<Product | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [openItemOpen, setOpenItemOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);

  // ── Borrador local del carrito ──────────────────────────────
  // Sobrevive a expiración de sesión, refresh accidental o cierre de pestaña.
  const draftKey = `kitchen_pos_draft_${tableId}`;
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (Array.isArray(draft.items) && draft.items.length > 0) {
          setOrderItems(draft.items);
          if (typeof draft.covers === "number") setCovers(draft.covers);
        }
      }
    } catch {
      // Borrador corrupto: se ignora
    }
    hydratedRef.current = true;
  }, [draftKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (orderItems.length > 0) {
        localStorage.setItem(draftKey, JSON.stringify({ items: orderItems, covers, savedAt: Date.now() }));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      // Storage lleno: se ignora, el carrito sigue en memoria
    }
  }, [orderItems, covers, draftKey]);

  // ── Aviso de sesión próxima a expirar ───────────────────────
  useEffect(() => {
    const check = () => {
      const exp = getTokenExpiry();
      if (!exp) return;
      const minsLeft = Math.round((exp - Date.now()) / 60000);
      if (minsLeft <= 0) {
        setSessionWarning("Su sesión expiró. El pedido queda guardado en este dispositivo; vuelva a iniciar sesión.");
      } else if (minsLeft <= 30) {
        setSessionWarning(`Su sesión expira en ${minsLeft} min. Envíe la comanda antes de que expire.`);
      } else {
        setSessionWarning(null);
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // Check catalog cache first (5-min TTL) to avoid re-fetching on every POS mount
      const cached = getCachedCatalog();

      const [catalogData, tableRes] = await Promise.all([
        cached
          ? Promise.resolve(cached)
          : authFetch(`/api/catalog`).then((r) => (r.ok ? r.json() : null)),
        authFetch(`/api/tables/${tableId}`),
      ]);

      if (catalogData && !cached) {
        setCachedCatalog(catalogData);
      }

      const cats = catalogData?.categories ?? [];
      if (Array.isArray(cats)) {
        setCategories(cats);
        if (cats.length > 0 && !selectedCategory) {
          setSelectedCategory(cats[0].id);
        }
      }

      if (tableRes.ok) {
        const tableData: TableData = await tableRes.json();
        setTable(tableData);
      }
    } catch (err) {
      console.error("Error loading POS data:", err);
    }
  }, [tableId, selectedCategory]);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setWaiterId(session.user.id);
    setUserRole(session.user.role || "MESERO");
    fetchData();
  }, [fetchData, router]);

  const [mobileView, setMobileView] = useState<"catalog" | "order">("catalog");

  const currentProducts =
    categories.find((c) => c.id === selectedCategory)?.products || [];

  const totalItems = orderItems.reduce((s, i) => s + i.quantity, 0);
  const mobileSubtotal = orderItems.reduce(
    (s, i) => s + (i.price + (i.modifiers || []).reduce((ms, m) => ms + m.priceDelta, 0)) * i.quantity,
    0
  );
  const mobileTotal = mobileSubtotal * (1 + IVA_RATE);
  const formatMobileTotal = (n: number) =>
    new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", minimumFractionDigits: 0 }).format(n);

  const handleProductClick = (product: Product) => {
    const canModify = product.allowModifiers !== false;
    const canNote = product.allowNotes !== false;

    if (!canModify && !canNote) {
      handleAddDirect(product);
      return;
    }

    setCustomizeProduct(product);
    setCustomizeOpen(true);
  };

  const handleAddDirect = (product: Product) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && !i.modifiers?.length && !i.notes);
      if (existing) {
        return prev.map((i) => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        id: nextItemId(),
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: 1,
      }];
    });
  };

  const handleAddWithModifiers = (product: Product, modifiers: SelectedModifier[], notes: string, quantity: number) => {
    const newItem: OrderLineItem = {
      id: nextItemId(),
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      quantity,
      notes: notes || undefined,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
    };
    setOrderItems((prev) => [...prev, newItem]);
  };

  const handleAddOpenItem = (item: { name: string; price: number; destination: "COCINA" | "BARRA"; notes: string; quantity: number }) => {
    const newItem: OrderLineItem = {
      id: nextItemId(),
      productId: null,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      notes: item.notes || undefined,
      isOpenItem: true,
      destination: item.destination,
    };
    setOrderItems((prev) => [...prev, newItem]);
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    setOrderItems((prev) =>
      prev.map((i) => i.id === id ? { ...i, quantity: i.quantity + delta } : i)
    );
  };

  const handleRemove = (id: string) => {
    setOrderItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleSendOrder = async () => {
    if (!waiterId || orderItems.length === 0) return;

    setSending(true);
    setSendError(null);
    try {
      const regularItems = orderItems.filter((i) => !i.isOpenItem);
      const openItems = orderItems.filter((i) => i.isOpenItem);

      let orderId: string | null = null;

      if (regularItems.length > 0) {
        const res = await authFetch(`/api/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId,
            waiterId,
            covers,
            items: regularItems.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              notes: i.notes,
              modifiers: i.modifiers?.map((m) => ({
                modifierOptionId: m.modifierOptionId,
                name: m.name,
                priceDelta: m.priceDelta,
              })),
            })),
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSendError(typeof data.error === "string" ? data.error : "No se pudo enviar el pedido. Intente de nuevo.");
          setSending(false);
          return;
        }

        const order = await res.json();
        orderId = order.id;
      } else if (openItems.length > 0) {
        const res = await authFetch(`/api/orders/open-only`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId, waiterId, covers }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSendError(typeof data.error === "string" ? data.error : "No se pudo enviar el pedido. Intente de nuevo.");
          setSending(false);
          return;
        }
        const order = await res.json();
        orderId = order.id;
      }

      if (orderId && openItems.length > 0) {
        for (const openItem of openItems) {
          await authFetch(`/api/orders/${orderId}/open-item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: openItem.name,
              price: openItem.price,
              destination: openItem.destination,
              quantity: openItem.quantity,
              notes: openItem.notes,
              createdBy: waiterId,
            }),
          });
        }
      }

      // Pedido enviado: el borrador local ya no es necesario
      try { localStorage.removeItem(draftKey); } catch { /* ignorar */ }
      router.push("/");
    } catch (err) {
      console.error("Error creating order:", err);
      setSendError("Error de conexión. El pedido queda guardado en este dispositivo.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#0A0A0A]">
      {/* Aviso discreto de sesión próxima a expirar */}
      {sessionWarning && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 rounded-full bg-amber-500/15 border border-amber-400/30 px-4 py-1.5 text-xs text-amber-300 shadow-lg backdrop-blur-sm whitespace-nowrap">
          {sessionWarning}
        </div>
      )}
      {/* Catalog panel — full width on mobile, flex-1 on tablet+ */}
      <div className={`flex-col overflow-hidden flex-1 ${mobileView === "order" ? "hidden md:flex" : "flex"}`}>
        <header className="flex items-center justify-between p-3 md:p-4 border-b border-white/10 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => router.push("/")}
              className="flex-shrink-0 text-white/40 hover:text-white transition-colors p-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-base md:text-lg font-bold text-white whitespace-nowrap">
              Mesa {table?.number}
            </h1>
            <span className="hidden sm:inline text-xs text-white/30 bg-white/5 rounded-full px-3 py-1 whitespace-nowrap">
              Nuevo pedido
            </span>
          </div>
          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <button
              onClick={() => setOpenItemOpen(true)}
              className="text-xs text-orange-400/70 hover:text-orange-400 bg-orange-400/10 hover:bg-orange-400/20 px-2 md:px-3 py-2 rounded-xl transition-colors border border-orange-400/20 whitespace-nowrap"
            >
              <span className="hidden sm:inline">Producto </span>abierto
            </button>
            <div className="flex items-center gap-1">
              <span className="hidden md:inline text-xs text-white/40">Personas:</span>
              <button
                onClick={() => setCovers((c) => Math.max(1, c - 1))}
                className="w-8 h-8 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white flex items-center justify-center text-sm font-bold transition-colors touch-manipulation"
              >-</button>
              <span className="w-7 text-center text-sm font-bold text-[var(--gold)]">{covers}</span>
              <button
                onClick={() => setCovers((c) => Math.min(20, c + 1))}
                className="w-8 h-8 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white flex items-center justify-center text-sm font-bold transition-colors touch-manipulation"
              >+</button>
            </div>
          </div>
        </header>

        <div className="px-3 md:px-4 pt-3 md:pt-4">
          <CategoryTabs
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </div>

        {/* Product grid — extra bottom padding on mobile for the sticky bar */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 pb-24 md:pb-4">
          <ProductGrid products={currentProducts} onAdd={handleProductClick} />
        </div>

        {/* Mobile sticky bottom bar */}
        <div className="md:hidden flex-shrink-0 p-3 border-t border-white/10 bg-[#0A0A0A]">
          <button
            onClick={() => setMobileView("order")}
            className="w-full py-4 rounded-2xl bg-[var(--gold)] text-black font-bold flex items-center justify-between px-5 touch-manipulation active:scale-[0.98] transition-transform"
          >
            <span className="text-base">Ver comanda</span>
            <span className="text-sm font-semibold">
              {totalItems > 0
                ? `${totalItems} item${totalItems > 1 ? "s" : ""} · ${formatMobileTotal(mobileTotal)}`
                : "Vacía"}
            </span>
          </button>
        </div>
      </div>

      {/* Order panel — hidden on mobile unless mobileView=order, always visible md+ */}
      <div className={`flex-col md:w-[360px] md:flex-shrink-0 ${mobileView === "catalog" ? "hidden md:flex" : "flex flex-1"}`}>
        {/* Mobile back button */}
        <div className="md:hidden flex items-center gap-3 p-3 border-b border-white/10 bg-[#111]">
          <button
            onClick={() => setMobileView("catalog")}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm touch-manipulation"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Volver al menú
          </button>
        </div>
        {sendError && (
          <div className="mx-3 mt-3 rounded-xl bg-red-400/10 border border-red-400/20 p-3 text-sm text-red-400">
            {sendError}
          </div>
        )}
        <OrderPanel
          items={orderItems}
          tableNumber={table?.number || 0}
          onUpdateQuantity={handleUpdateQuantity}
          onRemove={handleRemove}
          onSend={handleSendOrder}
          sending={sending}
        />
      </div>

      {/* Customize Modal */}
      <ProductCustomizeModal
        product={customizeProduct}
        open={customizeOpen}
        onClose={() => { setCustomizeOpen(false); setCustomizeProduct(null); }}
        onAdd={handleAddWithModifiers}
      />

      {/* Open Item Modal */}
      <OpenItemModal
        open={openItemOpen}
        onClose={() => setOpenItemOpen(false)}
        onAdd={handleAddOpenItem}
        userRole={userRole}
      />
    </div>
  );
}
