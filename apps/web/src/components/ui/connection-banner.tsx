"use client";

interface ConnectionBannerProps {
  visible: boolean;
  lastUpdated: number | null;
}

// Discreet fixed banner shown while polling fails; disappears when connection recovers
export function ConnectionBanner({ visible, lastUpdated }: ConnectionBannerProps) {
  if (!visible) return null;

  const time = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-amber-500/15 border border-amber-400/30 px-4 py-2 text-xs text-amber-300 shadow-lg backdrop-blur-sm">
      <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      Conexión inestable. Reintentando…
      {time && <span className="text-amber-300/60">· Última actualización {time}</span>}
    </div>
  );
}
