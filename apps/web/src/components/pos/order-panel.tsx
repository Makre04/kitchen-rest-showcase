"use client";

import { Button } from "@/components/ui/button";
import { formatCRC } from "./product-grid";
import { IVA_RATE } from "@/lib/constants";

export interface OrderModifier {
  modifierOptionId?: string;
  name: string;
  priceDelta: number;
}

export interface OrderLineItem {
  id: string;
  productId: string | null;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  modifiers?: OrderModifier[];
  isOpenItem?: boolean;
  destination?: "COCINA" | "BARRA";
}

interface OrderPanelProps {
  items: OrderLineItem[];
  tableNumber: number;
  onUpdateQuantity: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  sending: boolean;
}

function getItemTotal(item: OrderLineItem): number {
  const modTotal = (item.modifiers || []).reduce((s, m) => s + m.priceDelta, 0);
  return item.price + modTotal;
}

export function OrderPanel({
  items,
  tableNumber,
  onUpdateQuantity,
  onRemove,
  onSend,
  sending,
}: OrderPanelProps) {
  const subtotal = items.reduce((sum, item) => sum + getItemTotal(item) * item.quantity, 0);
  const iva = subtotal * IVA_RATE;
  const total = subtotal + iva;

  return (
    <div className="flex flex-col h-full bg-[#111] border-l border-white/10">
      <div className="p-4 border-b border-white/10">
        <h2 className="text-lg font-bold text-white">Mesa {tableNumber}</h2>
        <p className="text-xs text-white/40 mt-1">
          {items.length === 0
            ? "Agregue productos al pedido"
            : `${items.reduce((s, i) => s + i.quantity, 0)} items`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 && (
          <div className="flex items-center justify-center h-32 text-white/15 text-sm">
            Pedido vacío
          </div>
        )}
        {items.map((item) => {
          const itemTotal = getItemTotal(item);
          const hasMods = item.modifiers && item.modifiers.length > 0;

          return (
            <div key={item.id} className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {item.name}
                  </div>
                  <div className="text-xs text-[var(--gold)]">
                    {formatCRC(item.price)}
                    {hasMods && itemTotal !== item.price && (
                      <span className="text-white/30 ml-1">→ {formatCRC(itemTotal)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      item.quantity === 1 ? onRemove(item.id) : onUpdateQuantity(item.id, -1)
                    }
                    className="w-8 h-8 rounded-lg bg-white/10 text-white/60 hover:bg-red-500/20 hover:text-red-400 transition-colors flex items-center justify-center text-lg"
                  >
                    {item.quantity === 1 ? "×" : "−"}
                  </button>
                  <span className="w-8 text-center text-sm font-bold text-white">{item.quantity}</span>
                  <button
                    onClick={() => onUpdateQuantity(item.id, 1)}
                    className="w-8 h-8 rounded-lg bg-white/10 text-white/60 hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors flex items-center justify-center text-lg"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Modifiers */}
              {hasMods && (
                <div className="mt-2 pl-2 border-l-2 border-[var(--gold)]/20 space-y-0.5">
                  {item.modifiers!.map((m, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-white/40">{m.name}</span>
                      {m.priceDelta > 0 && (
                        <span className="text-[var(--gold)]/60">+{formatCRC(m.priceDelta)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {item.notes && (
                <div className="mt-1.5 text-xs text-white/30 italic pl-2">
                  {item.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-white/50">
            <span>Subtotal</span>
            <span>{formatCRC(subtotal)}</span>
          </div>
          <div className="flex justify-between text-white/50">
            <span>IVA (13%)</span>
            <span>{formatCRC(iva)}</span>
          </div>
          <div className="flex justify-between text-white font-bold text-base pt-1 border-t border-white/10">
            <span>Total</span>
            <span className="text-[var(--gold)]">{formatCRC(total)}</span>
          </div>
        </div>

        <Button
          onClick={onSend}
          disabled={items.length === 0 || sending}
          className="w-full py-6 text-base font-bold bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 disabled:opacity-30"
        >
          {sending ? "Enviando..." : "Enviar a cocina / barra"}
        </Button>
      </div>
    </div>
  );
}
