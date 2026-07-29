import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen/database";
import { requireAuth } from "../middleware/auth.js";

export async function productRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/categories", async () => {
    return prisma.category.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        products: {
          where: { active: true },
          orderBy: { name: "asc" },
        },
      },
    });
  });

  app.get("/api/products", async () => {
    return prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: { category: true },
    });
  });

  // Single call that returns categories with products and their modifier groups.
  // POS uses this to avoid two sequential round-trips.
  app.get("/api/catalog", async () => {
    const [categories, modifierGroups] = await Promise.all([
      prisma.category.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          products: {
            where: { active: true },
            orderBy: { name: "asc" },
          },
        },
      }),
      prisma.modifierGroup.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          options: { where: { active: true }, orderBy: { name: "asc" } },
        },
      }),
    ]);
    return { categories, modifierGroups };
  });
}
