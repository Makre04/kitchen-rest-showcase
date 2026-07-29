import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { requireRoles } from "../middleware/auth.js";

export async function waiterRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRoles("MESERO", "ADMINISTRADOR", "CAJERO"));
  app.get("/api/waiter/orders", async (request) => {
    const { waiterId } = request.query as { waiterId?: string };

    const orders = await prisma.order.findMany({
      where: {
        status: "ABIERTA",
        ...(waiterId && { waiterId }),
      },
      orderBy: { createdAt: "asc" },
      include: {
        table: true,
        waiter: { select: { id: true, name: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            product: {
              include: { category: true },
            },
          },
        },
      },
    });

    return orders;
  });
}
