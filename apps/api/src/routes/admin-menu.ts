import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen/database";
import { z } from "zod";
import { requireRoles } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";

const productTypeEnum = z.enum([
  "FOOD",
  "COCKTAIL",
  "LIQUOR",
  "BEER",
  "SIMPLE_DRINK",
  "OPEN_PRESET",
]);

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().min(0),
  categoryId: z.string().min(1),
  productType: productTypeEnum.default("FOOD"),
  active: z.boolean().default(true),
  imageUrl: z.string().optional(),
  allowModifiers: z.boolean().default(true),
  allowNotes: z.boolean().default(true),
  requiresCustomization: z.boolean().default(false),
});

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  categoryId: z.string().min(1).optional(),
  productType: productTypeEnum.optional(),
  active: z.boolean().optional(),
  imageUrl: z.string().nullable().optional(),
  allowModifiers: z.boolean().optional(),
  allowNotes: z.boolean().optional(),
  requiresCustomization: z.boolean().optional(),
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  destination: z.enum(["COCINA", "BARRA"]),
  active: z.boolean().default(true),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  destination: z.enum(["COCINA", "BARRA"]).optional(),
  active: z.boolean().optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().default(false),
  minSelect: z.number().int().min(0).default(0),
  maxSelect: z.number().int().min(1).default(1),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  options: z
    .array(
      z.object({
        name: z.string().min(1),
        priceDelta: z.number().default(0),
        active: z.boolean().default(true),
        sortOrder: z.number().int().default(0),
      })
    )
    .optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  required: z.boolean().optional(),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(1).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const createOptionSchema = z.object({
  name: z.string().min(1),
  priceDelta: z.number().default(0),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const updateOptionSchema = z.object({
  name: z.string().min(1).optional(),
  priceDelta: z.number().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function adminMenuRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRoles("ADMINISTRADOR"));

  // ── Products ───────────────────────────────────────────────

  app.get("/api/admin/products", async (request) => {
    const query = request.query as {
      categoryId?: string;
      active?: string;
      search?: string;
      productType?: string;
    };

    const where: any = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.active !== undefined) where.active = query.active === "true";
    if (query.productType) where.productType = query.productType;
    if (query.search) {
      where.name = { contains: query.search, mode: "insensitive" };
    }

    return prisma.product.findMany({
      where,
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      include: {
        category: { select: { id: true, name: true, destination: true } },
        _count: { select: { modifierGroups: true } },
      },
    });
  });

  app.post("/api/admin/products", async (request, reply) => {
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ error: parsed.error.flatten() });

    const product = await prisma.product.create({
      data: parsed.data,
      include: {
        category: { select: { id: true, name: true, destination: true } },
      },
    });

    await auditLog(request, "PRODUCTO_CREADO", "productos", product.id, {
      name: product.name,
      price: Number(product.price),
    });

    return reply.status(201).send(product);
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/products/:id",
    async (request, reply) => {
      const parsed = updateProductSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten() });

      const before = await prisma.product.findUnique({
        where: { id: request.params.id },
      });
      if (!before) return reply.status(404).send({ error: "Producto no encontrado" });

      const product = await prisma.product.update({
        where: { id: request.params.id },
        data: parsed.data,
        include: {
          category: { select: { id: true, name: true, destination: true } },
        },
      });

      const changes: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(parsed.data)) {
        const oldVal = (before as any)[key];
        const newVal = val;
        if (String(oldVal) !== String(newVal)) {
          changes[key] = { from: oldVal, to: newVal };
        }
      }

      await auditLog(request, "PRODUCTO_EDITADO", "productos", product.id, changes);

      return product;
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/admin/products/:id/toggle",
    async (request, reply) => {
      const product = await prisma.product.findUnique({
        where: { id: request.params.id },
      });
      if (!product) return reply.status(404).send({ error: "Producto no encontrado" });

      const updated = await prisma.product.update({
        where: { id: request.params.id },
        data: { active: !product.active },
        include: {
          category: { select: { id: true, name: true, destination: true } },
        },
      });

      await auditLog(
        request,
        updated.active ? "PRODUCTO_ACTIVADO" : "PRODUCTO_DESACTIVADO",
        "productos",
        updated.id,
        { name: updated.name }
      );

      return updated;
    }
  );

  // ── Categories ─────────────────────────────────────────────

  app.get("/api/admin/categories", async () => {
    return prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
  });

  app.post("/api/admin/categories", async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ error: parsed.error.flatten() });

    const existing = await prisma.category.findFirst({
      where: { name: { equals: parsed.data.name, mode: "insensitive" } },
    });
    if (existing)
      return reply.status(409).send({ error: "Ya existe una categoria con ese nombre" });

    const category = await prisma.category.create({ data: parsed.data });

    await auditLog(request, "CATEGORIA_CREADA", "categorias", category.id, {
      name: category.name,
      destination: category.destination,
    });

    return reply.status(201).send(category);
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/categories/:id",
    async (request, reply) => {
      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten() });

      const category = await prisma.category.update({
        where: { id: request.params.id },
        data: parsed.data,
        include: { _count: { select: { products: true } } },
      });

      await auditLog(request, "CATEGORIA_EDITADA", "categorias", category.id, {
        name: category.name,
      });

      return category;
    }
  );

  // ── Modifier Groups ────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/admin/products/:id/modifiers",
    async (request) => {
      return prisma.modifierGroup.findMany({
        where: { productId: request.params.id },
        orderBy: { sortOrder: "asc" },
        include: {
          options: { orderBy: { sortOrder: "asc" } },
        },
      });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/products/:id/modifier-groups",
    async (request, reply) => {
      const parsed = createGroupSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten() });

      const product = await prisma.product.findUnique({
        where: { id: request.params.id },
      });
      if (!product) return reply.status(404).send({ error: "Producto no encontrado" });

      const { options, ...groupData } = parsed.data;

      const group = await prisma.modifierGroup.create({
        data: {
          ...groupData,
          productId: request.params.id,
          options: options?.length
            ? { create: options }
            : undefined,
        },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });

      await auditLog(request, "MODIFICADOR_GRUPO_CREADO", "grupos_modificador", group.id, {
        productId: request.params.id,
        productName: product.name,
        groupName: group.name,
      });

      return reply.status(201).send(group);
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/admin/modifier-groups/:id",
    async (request, reply) => {
      const parsed = updateGroupSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten() });

      const group = await prisma.modifierGroup.update({
        where: { id: request.params.id },
        data: parsed.data,
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });

      await auditLog(request, "MODIFICADOR_GRUPO_EDITADO", "grupos_modificador", group.id, {
        name: group.name,
      });

      return group;
    }
  );

  // ── Modifier Options ───────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    "/api/admin/modifier-groups/:id/options",
    async (request, reply) => {
      const parsed = createOptionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten() });

      const group = await prisma.modifierGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!group) return reply.status(404).send({ error: "Grupo no encontrado" });

      const option = await prisma.modifierOption.create({
        data: { ...parsed.data, groupId: request.params.id },
      });

      await auditLog(request, "MODIFICADOR_OPCION_CREADA", "opciones_modificador", option.id, {
        groupId: request.params.id,
        groupName: group.name,
        optionName: option.name,
      });

      return reply.status(201).send(option);
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/admin/modifier-options/:id",
    async (request, reply) => {
      const parsed = updateOptionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten() });

      const option = await prisma.modifierOption.update({
        where: { id: request.params.id },
        data: parsed.data,
      });

      await auditLog(request, "MODIFICADOR_OPCION_EDITADA", "opciones_modificador", option.id, {
        name: option.name,
      });

      return option;
    }
  );
}
