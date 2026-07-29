import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";

const createGroupSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  required: z.boolean().default(false),
  minSelect: z.number().int().min(0).default(0),
  maxSelect: z.number().int().min(1).default(1),
  sortOrder: z.number().int().default(0),
  options: z.array(z.object({
    name: z.string().min(1),
    priceDelta: z.number().default(0),
    sortOrder: z.number().int().default(0),
  })).optional(),
});

const createOptionSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1),
  priceDelta: z.number().default(0),
  sortOrder: z.number().int().default(0),
});

export async function modifierRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { productId: string } }>(
    "/api/products/:productId/modifiers",
    async (request) => {
      const groups = await prisma.modifierGroup.findMany({
        where: { productId: request.params.productId, active: true },
        orderBy: { sortOrder: "asc" },
        include: {
          options: {
            where: { active: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      return groups;
    }
  );

  app.get("/api/modifiers", async () => {
    return prisma.modifierGroup.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        product: { select: { name: true } },
        options: { orderBy: { sortOrder: "asc" } },
      },
    });
  });

  app.post<{ Body: z.infer<typeof createGroupSchema> }>(
    "/api/modifiers/groups",
    async (request, reply) => {
      const parsed = createGroupSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const group = await prisma.modifierGroup.create({
        data: {
          productId: parsed.data.productId,
          name: parsed.data.name,
          required: parsed.data.required,
          minSelect: parsed.data.minSelect,
          maxSelect: parsed.data.maxSelect,
          sortOrder: parsed.data.sortOrder,
          options: parsed.data.options ? {
            create: parsed.data.options.map((o, i) => ({
              name: o.name,
              priceDelta: o.priceDelta,
              sortOrder: o.sortOrder || i,
            })),
          } : undefined,
        },
        include: { options: true },
      });

      return reply.status(201).send(group);
    }
  );

  app.post<{ Body: z.infer<typeof createOptionSchema> }>(
    "/api/modifiers/options",
    async (request, reply) => {
      const parsed = createOptionSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const option = await prisma.modifierOption.create({
        data: parsed.data,
      });

      return reply.status(201).send(option);
    }
  );
}
