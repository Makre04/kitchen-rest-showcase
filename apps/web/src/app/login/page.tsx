"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, saveSession } from "@/lib/auth-client";

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const addDigit = (digit: string) => {
    if (pin.length >= 6) return;
    setPin((p) => p + digit);
    setError("");
  };

  const submit = async () => {
    if (pin.length < 4) {
      setError("Ingrese un PIN de 4 a 6 dígitos");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "PIN inválido");
        setPin("");
        return;
      }
      saveSession(data);
      router.replace("/");
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111] p-6 shadow-2xl">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-white">
            <span className="text-[var(--gold)]">KITCHEN</span> POS
          </h1>
          <p className="text-white/40 mt-2">Acceso rápido por código</p>
        </div>

        <div className="mb-5 rounded-2xl bg-black/40 border border-white/10 p-5 text-center">
          <div className="text-white/20 text-xs uppercase tracking-widest mb-2">PIN</div>
          <div className="text-4xl font-bold tracking-[.35em] text-white min-h-[48px]">
            {pin.replace(/./g, "•") || " "}
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-red-300 text-sm text-center">{error}</div>}

        <div className="grid grid-cols-3 gap-3">
          {digits.slice(0, 9).map((d) => (
            <button key={d} onClick={() => addDigit(d)} className="h-16 rounded-2xl bg-white/5 text-2xl font-bold text-white hover:bg-white/10 active:scale-95 transition-all">
              {d}
            </button>
          ))}
          <button onClick={() => setPin((p) => p.slice(0, -1))} className="h-16 rounded-2xl bg-white/5 text-white/70 hover:bg-white/10 active:scale-95 transition-all">
            Borrar
          </button>
          <button onClick={() => addDigit("0")} className="h-16 rounded-2xl bg-white/5 text-2xl font-bold text-white hover:bg-white/10 active:scale-95 transition-all">
            0
          </button>
          <button onClick={submit} disabled={loading} className="h-16 rounded-2xl bg-[var(--gold)] text-black font-black hover:opacity-80 active:scale-95 transition-all disabled:opacity-40">
            {loading ? "..." : "Entrar"}
          </button>
        </div>

        <div className="mt-6 text-center text-xs text-white/30">
          Demo: Admin 1234 · Mesero 1111 · Cocina 2222 · Barra 3333 · Caja 4444
        </div>
      </div>
    </div>
  );
}
