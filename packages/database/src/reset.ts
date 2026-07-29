/**
 * Reset de datos TRANSACCIONALES para dejar la base lista para piloto/demo.
 *
 * Borra SOLO los efectos de operación/pruebas:
 *   - pagos y detalles de pago
 *   - comprobantes (facturas/tiquetes)
 *   - modificadores de detalle de orden
 *   - detalle de orden (items)
 *   - órdenes
 *   - movimientos y sesiones de caja
 *   - clientes
 * y deja todas las mesas en estado LIBRE.
 *
 * NO toca el catálogo (usuarios, roles, mesas, categorías, productos,
 * modificadores de producto ni configuración): eso lo administra el seed.
 *
 * Uso:
 *   pnpm db:reset      # limpia datos transaccionales + re-corre seed
 */
import { prisma } from "./index.js";

async function main() {
  console.log("Reset de datos transaccionales (piloto)...");

  // Orden de borrado respetando llaves foráneas.
  await prisma.paymentMethodDetail.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.orderItemModifier.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.cashMovement.deleteMany({});
  await prisma.cashSession.deleteMany({});
  await prisma.customer.deleteMany({});

  // Todas las mesas quedan libres.
  const tables = await prisma.table.updateMany({ data: { status: "LIBRE" } });

  // Reiniciar consecutivo de comprobantes para el piloto.
  await prisma.config.deleteMany({ where: { key: "INVOICE_CONSECUTIVE" } });

  console.log(`OK datos transaccionales eliminados. Mesas reseteadas: ${tables.count}`);
  console.log("Reset completado.");
}

main()
  .catch((e) => {
    console.error("Error en reset:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
