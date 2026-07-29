"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OpenItemModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (item: { name: string; price: number; destination: "COCINA" | "BARRA"; notes: string; quantity: number }) => void;
  userRole: string;
}

export function OpenItemModal({ open, onClose, onAdd, userRole }: OpenItemModalProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [destination, setDestination] = useState<"COCINA" | "BARRA">("BARRA");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);

  const canCreate = userRole === "ADMINISTRADOR" || userRole === "CAJERO" || userRole === "BARRA";

  const handleSubmit = () => {
    if (!canCreate) return;
    if (!name.trim() || !price) return;
    onAdd({
      name: name.trim(),
      price: Number(price),
      destination,
      notes: notes.trim(),
      quantity,
    });
    setName("");
    setPrice("");
    setNotes("");
    setQuantity(1);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#1A1A1A] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg">Producto Abierto</DialogTitle>
          <p className="text-xs text-white/40">Producto fuera del menú</p>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs text-white/40 block mb-1">Nombre *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Vodka con arándano"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
            />
          </div>

          <div>
            <label className="text-xs text-white/40 block mb-1">Precio *</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="4500"
              min="0"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50"
            />
          </div>

          <div>
            <label className="text-xs text-white/40 block mb-1">Destino *</label>
            <div className="flex gap-2">
              {(["COCINA", "BARRA"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDestination(d)}
                  className={cn(
                    "flex-1 py-3 rounded-xl text-sm font-semibold transition-all border",
                    destination === d
                      ? "bg-[var(--gold)]/20 border-[var(--gold)]/50 text-[var(--gold)]"
                      : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
                  )}
                >
                  {d === "COCINA" ? "Cocina" : "Barra"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-white/40 block mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Vaso alto, poco hielo..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 resize-none h-16"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Cantidad</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-lg bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center text-lg">−</button>
              <span className="w-8 text-center text-lg font-bold text-white">{quantity}</span>
              <button onClick={() => setQuantity((q) => q + 1)} className="w-9 h-9 rounded-lg bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center text-lg">+</button>
            </div>
          </div>

          {!canCreate && (
            <div className="rounded-xl bg-orange-400/10 border border-orange-400/20 p-3 text-xs text-orange-400">
              Este rol no puede crear producto abierto sin aprobación
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!canCreate || !name.trim() || !price}
            className="w-full py-6 text-base font-bold bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Agregar producto abierto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
