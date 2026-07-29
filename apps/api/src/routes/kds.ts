import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { requireAuth } from "../middleware/auth.js";

export async function kdsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.get<{ Params: { destination: string } }>(
    "/api/kds/:destination",
    async (request, reply) => {
      const destination = request.params.destination.toUpperCase();
      if (destination !== "COCINA" && destination !== "BARRA") {
        return reply.status(400).send({ error: "Destino debe ser COCINA o BARRA" });
      }

      const orders = await prisma.order.findMany({
        where: {
          status: "ABIERTA",
          items: {
            some: {
              status: { in: ["PENDIENTE", "PREPARANDO", "LISTO"] },
              OR: [
                { product: { category: { destination } } },
                { isOpenItem: true, destination },
              ],
            },
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          table: { select: { number: true } },
          waiter: { select: { name: true } },
          items: {
            where: {
              OR: [
                { product: { category: { destination } } },
                { isOpenItem: true, destination },
              ],
            },
            orderBy: { id: "asc" },
            select: {
              id: true,
              quantity: true,
              notes: true,
              status: true,
              isOpenItem: true,
              customName: true,
              product: { select: { name: true } },
              modifiers: {
                orderBy: { id: "asc" },
                select: { id: true, name: true, priceDelta: true },
              },
            },
          },
        },
      });

      return orders;
    }
  );
}
