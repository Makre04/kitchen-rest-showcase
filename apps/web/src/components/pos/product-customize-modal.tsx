"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth-client";
import { formatCRC } from "./product-grid";
import { cn } from "@/lib/utils";

interface ModifierOption {
  id: string;
  name: string;
  priceDelta: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  allowModifiers?: boolean;
  allowNotes?: boolean;
  requiresCustomization?: boolean;
}

export interface SelectedModifier {
  modifierOptionId: string;
  name: string;
  priceDelta: number;
}

interface ProductCustomizeModalProps {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onAdd: (product: Product, modifiers: SelectedModifier[], notes: string, quantity: number) => void;
}

export function ProductCustomizeModal({ product, open, onClose, onAdd }: ProductCustomizeModalProps) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!product || !open) return;
    setSelected({});
    setNotes("");
    setQuantity(1);
    setLoading(true);

    authFetch(`/api/products/${product.id}/modifiers`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          const arr: ModifierGroup[] = Array.isArray(data) ? data : [];
          setGroups(arr.map((g) => ({
            ...g,
            options: (Array.isArray(g.options) ? g.options : []).map((o) => ({
              ...o,
              priceDelta: Number(o.priceDelta),
            })),
          })));
          const defaultSelections: Record<string, string[]> = {};
          for (const g of arr) {
            if (g.required && g.options?.length > 0) {
              defaultSelections[g.id] = [g.options[0].id];
            }
          }
          setSelected(defaultSelections);
        } else {
          setGroups([]);
        }
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [product, open]);

  if (!product) return null;

  const basePrice = Number(product.price);

  const allSelectedMods: SelectedModifier[] = [];
  for (const [groupId, optionIds] of Object.entries(selected)) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) continue;
    for (const optId of optionIds) {
      const opt = group.options.find((o) => o.id === optId);
      if (opt) {
        allSelectedMods.push({
          modifierOptionId: opt.id,
          name: opt.name,
          priceDelta: opt.priceDelta,
        });
      }
    }
  }

  const modifiersTotal = allSelectedMods.reduce((s, m) => s + m.priceDelta, 0);
  const finalPrice = basePrice + modifiersTotal;

  const toggleOption = (groupId: string, optionId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    setSelected((prev) => {
      const current = prev[groupId] || [];
      if (group.maxSelect === 1) {
        if (current.includes(optionId) && !group.required) {
          return { ...prev, [groupId]: [] };
        }
        return { ...prev, [groupId]: [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [groupId]: [...current, optionId] };
    });
  };

  const showNotes = product.allowNotes !== false;

  const requiredGroupsMissing = groups
    .filter((g) => g.required)
    .some((g) => !(selected[g.id]?.length));

  const isDisabled = requiredGroupsMissing;

  const handleAdd = () => {
    if (isDisabled) return;
    onAdd(product, allSelectedMods, notes, quantity);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#1A1A1A] border-white/10 text-white w-[95vw] max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-lg">
            Personalizar {product.name}
          </DialogTitle>
          <p className="text-sm text-[var(--gold)]">{formatCRC(basePrice)}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-white/30">Cargando modificadores...</div>
        ) : (
          <div className="space-y-5 mt-2">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-white/80">{group.name}</span>
                  {group.required && (
                    <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">Requerido</span>
                  )}
                  {group.maxSelect > 1 && (
                    <span className="text-[10px] text-white/30">Máx {group.maxSelect}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((opt) => {
                    const isSelected = (selected[group.id] || []).includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(group.id, opt.id)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl text-sm transition-all border touch-manipulation min-h-[44px]",
                          isSelected
                            ? "bg-[var(--gold)]/20 border-[var(--gold)]/50 text-[var(--gold)]"
                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {opt.name}
                        {opt.priceDelta > 0 && (
                          <span className="ml-1 text-xs opacity-70">+{formatCRC(opt.priceDelta)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Notes */}
            {showNotes && (
              <div>
                <span className="text-sm font-semibold text-white/80 mb-2 block">Notas</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Sin sal, poco picante, servir aparte..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 resize-none h-20"
                />
              </div>
            )}

            {/* Quantity */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white/80">Cantidad</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-lg bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center text-lg"
                >−</button>
                <span className="w-8 text-center text-lg font-bold text-white">{quantity}</span>
                <button
                  onClick={() => setQuantity((q) => q + 1)}
                  className="w-9 h-9 rounded-lg bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center text-lg"
                >+</button>
              </div>
            </div>

            {/* Modifiers summary */}
            {allSelectedMods.length > 0 && (
              <div className="rounded-xl bg-white/5 p-3 space-y-1">
                {allSelectedMods.map((m, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-white/50">{m.name}</span>
                    {m.priceDelta > 0 && <span className="text-[var(--gold)]">+{formatCRC(m.priceDelta)}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Total + Add button */}
            <div className="sticky bottom-0 bg-[#1A1A1A] pt-3 pb-1 -mx-1 px-1">
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div>
                  <span className="text-xs text-white/40">Total por unidad</span>
                  <div className="text-xl font-bold text-[var(--gold)]">{formatCRC(finalPrice)}</div>
                </div>
                <Button
                  onClick={handleAdd}
                  disabled={isDisabled}
                  className="px-6 md:px-8 py-5 md:py-6 text-base font-bold bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
                >
                  Agregar {quantity > 1 ? `(${quantity})` : ""}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
