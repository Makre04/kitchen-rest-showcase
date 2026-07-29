import { PrismaClient, RoleName, CategoryDestination, ProductType } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

// PINs demo configurables por variables de entorno (en .env, NO versionado).
// Si no se definen, se usan los defaults históricos de demo.
const PINS = {
  ADMIN: process.env.SEED_ADMIN_PIN || "1234",
  MESERO: process.env.SEED_MESERO_PIN || "1111",
  COCINA: process.env.SEED_COCINA_PIN || "2222",
  BARRA: process.env.SEED_BARRA_PIN || "3333",
  CAJA: process.env.SEED_CAJA_PIN || "4444",
};

async function main() {
  // Sucursal
  const branch = await prisma.branch.upsert({
    where: { id: "branch-kitchen-main" },
    update: {},
    create: {
      id: "branch-kitchen-main",
      name: "Kitchen Restaurante",
      address: "San José, Costa Rica",
      phone: "+506 2222-3333",
      legalId: "3-101-000000",
    },
  });

  console.log(`OK Sucursal: ${branch.name}`);

  // Roles
  const roleNames: RoleName[] = [
    "ADMINISTRADOR",
    "CAJERO",
    "MESERO",
    "COCINA",
    "BARRA",
  ];

  const roles: Record<string, string> = {};
  for (const roleName of roleNames) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    roles[roleName] = role.id;
  }

  console.log(`OK Roles: ${roleNames.join(", ")}`);

  // Usuario admin
  const admin = await prisma.user.upsert({
    where: { email: "admin@kitchen.cr" },
    update: { pin: hashSync(PINS.ADMIN, 10), pinPlain: PINS.ADMIN },
    create: {
      name: "Administrador",
      pin: hashSync(PINS.ADMIN, 10),
      pinPlain: PINS.ADMIN,
      email: "admin@kitchen.cr",
      passwordHash: hashSync("admin123", 10),
      roleId: roles.ADMINISTRADOR,
      branchId: branch.id,
    },
  });

  console.log(`OK Admin: ${admin.name}`);

  // Mesero de ejemplo
  await prisma.user.upsert({
    where: { email: "mesero1@kitchen.cr" },
    update: { pin: hashSync(PINS.MESERO, 10), pinPlain: PINS.MESERO },
    create: {
      name: "Carlos Mesero",
      pin: hashSync(PINS.MESERO, 10),
      pinPlain: PINS.MESERO,
      email: "mesero1@kitchen.cr",
      roleId: roles.MESERO,
      branchId: branch.id,
    },
  });

  // Cocina
  await prisma.user.upsert({
    where: { email: "cocina@kitchen.cr" },
    update: { pin: hashSync(PINS.COCINA, 10), pinPlain: PINS.COCINA },
    create: {
      name: "María Cocina",
      pin: hashSync(PINS.COCINA, 10),
      pinPlain: PINS.COCINA,
      email: "cocina@kitchen.cr",
      roleId: roles.COCINA,
      branchId: branch.id,
    },
  });

  // Barra
  await prisma.user.upsert({
    where: { email: "barra@kitchen.cr" },
    update: { pin: hashSync(PINS.BARRA, 10), pinPlain: PINS.BARRA },
    create: {
      name: "Luis Barra",
      pin: hashSync(PINS.BARRA, 10),
      pinPlain: PINS.BARRA,
      email: "barra@kitchen.cr",
      roleId: roles.BARRA,
      branchId: branch.id,
    },
  });

  // Cajero
  await prisma.user.upsert({
    where: { email: "cajero@kitchen.cr" },
    update: { pin: hashSync(PINS.CAJA, 10), pinPlain: PINS.CAJA },
    create: {
      name: "Ana Cajera",
      pin: hashSync(PINS.CAJA, 10),
      pinPlain: PINS.CAJA,
      email: "cajero@kitchen.cr",
      roleId: roles.CAJERO,
      branchId: branch.id,
    },
  });

  console.log("OK Usuarios de ejemplo creados");

  // Mesas (5)
  for (let i = 1; i <= 5; i++) {
    await prisma.table.upsert({
      where: { branchId_number: { branchId: branch.id, number: i } },
      update: {},
      create: {
        number: i,
        capacity: i <= 3 ? 4 : 6,
        branchId: branch.id,
      },
    });
  }

  console.log("OK 5 mesas creadas");

  // Categorías y productos
  const categories = [
    {
      name: "Entradas",
      destination: CategoryDestination.COCINA,
      products: [
        { name: "Patacones con Frijol", price: 3500, description: "Patacones crujientes con frijol molido y pico de gallo", productType: "FOOD" as const, allowModifiers: false, allowNotes: true, requiresCustomization: false },
        { name: "Ceviche de Pescado", price: 5500, description: "Ceviche fresco del dia con limon y cilantro", productType: "FOOD" as const, allowModifiers: false, allowNotes: true, requiresCustomization: false },
        { name: "Empanadas de Queso", price: 2800, description: "3 empanadas de queso fritas", productType: "FOOD" as const, allowModifiers: false, allowNotes: true, requiresCustomization: false },
      ],
    },
    {
      name: "Platos Fuertes",
      destination: CategoryDestination.COCINA,
      products: [
        { name: "Casado con Pollo", price: 5500, description: "Arroz, frijoles, ensalada, platano maduro y pollo", productType: "FOOD" as const, allowModifiers: true, allowNotes: true, requiresCustomization: false },
        { name: "Casado con Carne", price: 6500, description: "Arroz, frijoles, ensalada, platano maduro y carne", productType: "FOOD" as const, allowModifiers: true, allowNotes: true, requiresCustomization: false },
        { name: "Arroz con Mariscos", price: 8500, description: "Arroz con camarones, pulpo y mejillones", productType: "FOOD" as const, allowModifiers: false, allowNotes: true, requiresCustomization: false },
      ],
    },
    {
      name: "Bebidas",
      destination: CategoryDestination.BARRA,
      products: [
        { name: "Agua Cristal", price: 1000, description: "Botella 600ml", productType: "SIMPLE_DRINK" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Fresco Natural", price: 1500, description: "Fresco del dia", productType: "SIMPLE_DRINK" as const, allowModifiers: true, allowNotes: false, requiresCustomization: true },
        { name: "Gaseosa", price: 1200, description: "Coca-Cola, Fanta o Sprite", productType: "SIMPLE_DRINK" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
      ],
    },
    {
      name: "Cocteles",
      destination: CategoryDestination.BARRA,
      products: [
        { name: "Mojito Clasico", price: 4500, description: "Ron, limon, menta, azucar y soda", productType: "COCKTAIL" as const, allowModifiers: true, allowNotes: true, requiresCustomization: false },
        { name: "Pina Colada", price: 4000, description: "Ron, crema de coco y pina", productType: "COCKTAIL" as const, allowModifiers: true, allowNotes: true, requiresCustomization: false },
        { name: "Margarita", price: 4500, description: "Tequila, triple sec y limon", productType: "COCKTAIL" as const, allowModifiers: true, allowNotes: true, requiresCustomization: false },
      ],
    },
    {
      name: "Licores",
      destination: CategoryDestination.BARRA,
      products: [
        { name: "Whisky", price: 4000, description: "Whisky nacional o importado", productType: "LIQUOR" as const, allowModifiers: true, allowNotes: false, requiresCustomization: true },
        { name: "Ron Centenario", price: 3500, description: "Ron Centenario 7 anos", productType: "LIQUOR" as const, allowModifiers: true, allowNotes: false, requiresCustomization: true },
        { name: "Vodka", price: 3000, description: "Vodka con mixer a eleccion", productType: "LIQUOR" as const, allowModifiers: true, allowNotes: false, requiresCustomization: true },
      ],
    },
    {
      name: "Cervezas",
      destination: CategoryDestination.BARRA,
      products: [
        { name: "Imperial Silver", price: 1800, description: "Cerveza Imperial Silver 350ml", productType: "BEER" as const, allowModifiers: true, allowNotes: false, requiresCustomization: false },
        { name: "Imperial", price: 1500, description: "Cerveza Imperial 350ml", productType: "BEER" as const, allowModifiers: true, allowNotes: false, requiresCustomization: false },
        { name: "Pilsen", price: 1500, description: "Cerveza Pilsen 350ml", productType: "BEER" as const, allowModifiers: true, allowNotes: false, requiresCustomization: false },
      ],
    },
    {
      name: "Adicionales",
      destination: CategoryDestination.COCINA,
      products: [
        { name: "Adicional Yuca",                        price: 800,  description: "Guarnición de yuca. Cód: 376",             productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Vegetales",                   price: 1300, description: "Porción de vegetales. Cód: 375",            productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Puré",                        price: 1300, description: "Porción de puré de papa. Cód: 374",         productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Plátano Tostado",             price: 800,  description: "Porción de plátano tostado. Cód: 373",      productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Patacones",                   price: 1300, description: "Porción de patacones. Cód: 372",            productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Orden Extra de Papas Fritas", price: 1500, description: "Orden extra de papas fritas. Cód: 371",     productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Frijoles Molidos",            price: 800,  description: "Porción de frijoles molidos. Cód: 370",     productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Ensalada",                    price: 1300, description: "Porción de ensalada. Cód: 369",             productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Chimichurri Argentino",       price: 800,  description: "Chimichurri argentino. Cód: 368",           productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Camarones",                   price: 2500, description: "Porción de camarones adicional. Cód: 367",  productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
        { name: "Adicional Arroz Blanco",                price: 800,  description: "Porción de arroz blanco. Cód: 366",         productType: "FOOD" as const, allowModifiers: false, allowNotes: false, requiresCustomization: false },
      ],
    },
  ];

  for (const cat of categories) {
    const category = await prisma.category.upsert({
      where: { id: `cat-${cat.name.toLowerCase().replace(/\s/g, "-")}` },
      update: {},
      create: {
        id: `cat-${cat.name.toLowerCase().replace(/\s/g, "-")}`,
        name: cat.name,
        destination: cat.destination,
      },
    });

    for (const prod of cat.products) {
      const productId = `prod-${prod.name.toLowerCase().replace(/\s/g, "-")}`;
      const flags = {
        allowModifiers: (prod as any).allowModifiers ?? true,
        allowNotes: (prod as any).allowNotes ?? true,
        requiresCustomization: (prod as any).requiresCustomization ?? false,
        productType: (prod as any).productType ?? "FOOD",
      };
      await prisma.product.upsert({
        where: { id: productId },
        update: flags,
        create: {
          id: productId,
          name: prod.name,
          description: prod.description,
          price: prod.price,
          categoryId: category.id,
          ...flags,
        },
      });
    }

    console.log(`OK Categoría "${cat.name}" con ${cat.products.length} productos`);
  }

  // Modificadores de productos
  const extrasGroup = {
    name: "Adicionales / Extras",
    required: false,
    maxSelect: 11,
    options: [
      { name: "Yuca",                        priceDelta: 800  },
      { name: "Vegetales",                   priceDelta: 1300 },
      { name: "Puré",                        priceDelta: 1300 },
      { name: "Plátano tostado",             priceDelta: 800  },
      { name: "Patacones",                   priceDelta: 1300 },
      { name: "Orden extra de papas fritas", priceDelta: 1500 },
      { name: "Frijoles molidos",            priceDelta: 800  },
      { name: "Ensalada",                    priceDelta: 1300 },
      { name: "Chimichurri argentino",       priceDelta: 800  },
      { name: "Camarones",                   priceDelta: 2500 },
      { name: "Arroz blanco",               priceDelta: 800  },
    ],
  };

  const modifiers = [
    {
      productId: "prod-mojito-clasico",
      groups: [
        {
          name: "Shot",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Doble shot", priceDelta: 2000 },
          ],
        },
        {
          name: "Alcohol",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Ron estándar", priceDelta: 0 },
            { name: "Ron premium", priceDelta: 1500 },
          ],
        },
        {
          name: "Azúcar",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Sin azúcar", priceDelta: 0 },
            { name: "Extra dulce", priceDelta: 0 },
          ],
        },
        {
          name: "Hielo",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Sin hielo", priceDelta: 0 },
            { name: "Poco hielo", priceDelta: 0 },
          ],
        },
      ],
    },
    {
      productId: "prod-casado-con-carne",
      groups: [
        {
          name: "Acompañamiento",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Arroz", priceDelta: 0 },
            { name: "Puré", priceDelta: 0 },
            { name: "Papas fritas", priceDelta: 500 },
          ],
        },
        {
          name: "Término",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Medio", priceDelta: 0 },
            { name: "Tres cuartos", priceDelta: 0 },
            { name: "Bien cocido", priceDelta: 0 },
          ],
        },
        {
          name: "Extras",
          required: false,
          maxSelect: 3,
          options: [
            { name: "Extra carne", priceDelta: 2000 },
            { name: "Extra aguacate", priceDelta: 800 },
            { name: "Queso", priceDelta: 500 },
          ],
        },
        extrasGroup,
      ],
    },
    {
      productId: "prod-casado-con-pollo",
      groups: [
        {
          name: "Acompañamiento",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Arroz", priceDelta: 0 },
            { name: "Puré", priceDelta: 0 },
            { name: "Papas fritas", priceDelta: 500 },
          ],
        },
        {
          name: "Extras",
          required: false,
          maxSelect: 3,
          options: [
            { name: "Extra pollo", priceDelta: 1500 },
            { name: "Extra aguacate", priceDelta: 800 },
            { name: "Queso", priceDelta: 500 },
          ],
        },
        extrasGroup,
      ],
    },
    {
      productId: "prod-margarita",
      groups: [
        {
          name: "Tamaño",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Grande", priceDelta: 1000 },
          ],
        },
        {
          name: "Extras",
          required: false,
          maxSelect: 2,
          options: [
            { name: "Sal en el borde", priceDelta: 0 },
            { name: "Doble tequila", priceDelta: 2000 },
          ],
        },
      ],
    },
    {
      productId: "prod-whisky",
      groups: [
        {
          name: "Presentación",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Solo", priceDelta: 0 },
            { name: "En las rocas", priceDelta: 0 },
            { name: "Con soda", priceDelta: 0 },
            { name: "Con agua", priceDelta: 0 },
          ],
        },
        {
          name: "Cantidad",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Sencillo", priceDelta: 0 },
            { name: "Doble", priceDelta: 3000 },
          ],
        },
        {
          name: "Tipo",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Nacional", priceDelta: 0 },
            { name: "Johnnie Walker Red", priceDelta: 2000 },
            { name: "Johnnie Walker Black", priceDelta: 4000 },
            { name: "Jack Daniel's", priceDelta: 3500 },
          ],
        },
      ],
    },
    {
      productId: "prod-ron-centenario",
      groups: [
        {
          name: "Presentación",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Solo", priceDelta: 0 },
            { name: "En las rocas", priceDelta: 0 },
            { name: "Con Coca-Cola", priceDelta: 500 },
          ],
        },
        {
          name: "Cantidad",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Sencillo", priceDelta: 0 },
            { name: "Doble", priceDelta: 2500 },
          ],
        },
      ],
    },
    {
      productId: "prod-vodka",
      groups: [
        {
          name: "Mixer",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Solo", priceDelta: 0 },
            { name: "Con jugo de naranja", priceDelta: 500 },
            { name: "Con Red Bull", priceDelta: 1500 },
            { name: "Con soda", priceDelta: 0 },
          ],
        },
        {
          name: "Cantidad",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Sencillo", priceDelta: 0 },
            { name: "Doble", priceDelta: 2000 },
          ],
        },
      ],
    },
    {
      productId: "prod-imperial-silver",
      groups: [
        {
          name: "Preparación",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Michelada", priceDelta: 800 },
          ],
        },
      ],
    },
    {
      productId: "prod-imperial",
      groups: [
        {
          name: "Preparación",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Michelada", priceDelta: 800 },
          ],
        },
      ],
    },
    {
      productId: "prod-pilsen",
      groups: [
        {
          name: "Preparación",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Normal", priceDelta: 0 },
            { name: "Michelada", priceDelta: 800 },
          ],
        },
      ],
    },
    {
      productId: "prod-fresco-natural",
      groups: [
        {
          name: "Fruta",
          required: true,
          maxSelect: 1,
          options: [
            { name: "Cas", priceDelta: 0 },
            { name: "Mora", priceDelta: 0 },
            { name: "Guanabana", priceDelta: 0 },
            { name: "Banano", priceDelta: 0 },
            { name: "Fresa", priceDelta: 0 },
          ],
        },
        {
          name: "Extra",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Con leche", priceDelta: 300 },
          ],
        },
      ],
    },
    {
      productId: "prod-pina-colada",
      groups: [
        {
          name: "Ron",
          required: false,
          maxSelect: 1,
          options: [
            { name: "Ron estandar", priceDelta: 0 },
            { name: "Ron premium", priceDelta: 1500 },
          ],
        },
      ],
    },
    { productId: "prod-arroz-con-mariscos",   groups: [extrasGroup] },
    { productId: "prod-patacones-con-frijol", groups: [extrasGroup] },
    { productId: "prod-ceviche-de-pescado",   groups: [extrasGroup] },
    { productId: "prod-empanadas-de-queso",   groups: [extrasGroup] },
  ];

  for (const mod of modifiers) {
    const product = await prisma.product.findUnique({ where: { id: mod.productId } });
    if (!product) continue;

    // Delete existing options then groups for this product to avoid duplicates on re-seed
    const existingGroups = await prisma.modifierGroup.findMany({ where: { productId: mod.productId }, select: { id: true } });
    if (existingGroups.length > 0) {
      await prisma.modifierOption.deleteMany({ where: { groupId: { in: existingGroups.map(g => g.id) } } });
      await prisma.modifierGroup.deleteMany({ where: { productId: mod.productId } });
    }

    for (let gi = 0; gi < mod.groups.length; gi++) {
      const g = mod.groups[gi];
      await prisma.modifierGroup.create({
        data: {
          productId: mod.productId,
          name: g.name,
          required: g.required,
          minSelect: 0,
          maxSelect: g.maxSelect,
          sortOrder: gi,
          options: {
            create: g.options.map((o, oi) => ({
              name: o.name,
              priceDelta: o.priceDelta,
              sortOrder: oi,
            })),
          },
        },
      });
    }

    console.log(`OK Modificadores para "${product.name}"`);
  }

  // Configuración base
  const configs = [
    { key: "IVA_RATE", value: "13", description: "Porcentaje de IVA (Costa Rica)" },
    { key: "CURRENCY", value: "CRC", description: "Moneda por defecto" },
    { key: "RESTAURANT_NAME", value: "Kitchen Restaurante", description: "Nombre del restaurante" },
    { key: "INVOICE_CONSECUTIVE", value: "0", description: "Último consecutivo de factura emitida" },
  ];

  for (const config of configs) {
    await prisma.config.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }

  console.log("OK Configuración base creada");
  console.log("\nSeed completado exitosamente");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
