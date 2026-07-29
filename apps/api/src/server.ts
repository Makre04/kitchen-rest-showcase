import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth.js";
import { tableRoutes } from "./routes/tables.js";
import { productRoutes } from "./routes/products.js";
import { orderRoutes } from "./routes/orders.js";
import { kdsRoutes } from "./routes/kds.js";
import { cajaRoutes } from "./routes/caja.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { ticketRoutes } from "./routes/tickets.js";
import { adminRoutes } from "./routes/admin.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { reportRoutes } from "./routes/reports.js";
import { modifierRoutes } from "./routes/modifiers.js";
import { adminMenuRoutes } from "./routes/admin-menu.js";

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

const server = Fastify({
  logger: true,
  disableRequestLogging: false,
  requestTimeout: 30_000,
  keepAliveTimeout: 72_000,
  connectionTimeout: 10_000,
});

server.setErrorHandler((error: import("fastify").FastifyError, request, reply) => {
  server.log.error({ err: error, url: request.url }, "Request error");
  reply.status(error.statusCode ?? 500).send({
    error: error.message || "Error interno del servidor",
  });
});

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

server.register(cors, {
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

server.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

server.register(authRoutes);
server.register(tableRoutes);
server.register(productRoutes);
server.register(orderRoutes);
server.register(kdsRoutes);
server.register(cajaRoutes);
server.register(invoiceRoutes);
server.register(ticketRoutes);
server.register(adminRoutes);
server.register(dashboardRoutes);
server.register(reportRoutes);
server.register(modifierRoutes);
server.register(adminMenuRoutes);

const start = async () => {
  const port = Number(process.env.API_PORT) || 3001;
  const host = process.env.API_HOST || "0.0.0.0";

  try {
    await server.listen({ port, host });
    server.log.info(`API running on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

async function shutdown(signal: string) {
  server.log.info(`${signal} received, shutting down gracefully`);
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
