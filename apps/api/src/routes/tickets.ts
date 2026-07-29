import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen/database";
import { requireAuth } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";

function money(value: unknown) {
  return `₡${Number(value || 0).toLocaleString("es-CR", { maximumFractionDigits: 0 })}`;
}

function line(text = "", width = 42) {
  return text.padEnd(width).slice(0, width);
}

export async function ticketRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { orderId: string }; Querystring: { destination?: "COCINA" | "BARRA" | "CAJA" } }>(
    "/api/tickets/:orderId",
    async (request, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: request.params.orderId },
        include: {
          table: true,
          waiter: { select: { name: true } },
          items: { include: { product: { include: { category: true } } } },
        },
      });

      if (!order) return reply.status(404).send({ error: "Orden no encontrada" });

      const destination = request.query.destination;
      const items = destination && destination !== "CAJA"
        ? order.items.filter((i) =>
            i.isOpenItem
              ? i.destination === destination
              : i.product?.category.destination === destination
          )
        : order.items;

      const title = destination === "COCINA" ? "TICKET COCINA" : destination === "BARRA" ? "TICKET BARRA" : "COMPROBANTE CAJA";
      const total = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);

      const body = [
        "==========================================",
        line(title),
        "==========================================",
        line(`Mesa: ${order.table.number}`),
        line(`Mesero: ${order.waiter.name}`),
        line(`Hora: ${new Date(order.createdAt).toLocaleString("es-CR")}`),
        "------------------------------------------",
        ...items.flatMap((item) => [
          line(`${item.quantity}x ${item.product?.name || item.customName || "Producto"}`),
          ...(item.notes ? [line(`Obs: ${item.notes}`)] : []),
        ]),
        "------------------------------------------",
        destination === "CAJA" ? line(`Subtotal: ${money(total)}`) : line("Preparar y marcar listo"),
        "==========================================",
      ].join("\n");

      await auditLog(request, "GENERAR_TICKET", "orden", order.id, { destination: destination || "CAJA" });

      reply.header("Content-Type", "text/plain; charset=utf-8");
      return body;
    }
  );
}
