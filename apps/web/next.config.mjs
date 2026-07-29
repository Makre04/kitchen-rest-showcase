/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["http://192.168.100.25:3000", "http://192.168.100.25"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
  // TEMPORAL — PILOTO CONTROLADO (2026-06-15)
  // `ignoreDuringBuilds: true` activado solo para piloto, para no bloquear el build
  // con deuda de estilo preexistente (no-explicit-any / no-unused-vars).
  // TypeScript si corre en el build. Lint aparte: pnpm --filter @kitchen-rest/web lint
  //
  // REACTIVAR ANTES DE PRODUCCION:
  //   1) Limpiar deuda ESLint.
  //   2) Poner `ignoreDuringBuilds: false`.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
