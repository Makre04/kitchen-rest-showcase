# KITCHEN POS - TESTING GUIDE

## FLUJO COMPLETO - MESA → POS → KDS → COBRO → FACTURA → CIERRE

Este documento guía el testing de un ciclo completo de POS.

---

## OK RESULTADOS FINALES VALIDADOS (Piloto controlado — 2026-06-16)

Flujo completo ejercitado end-to-end contra la BD (Supabase). Todos los pasos en verde:

| # | Prueba | Resultado |
|---|--------|-----------|
| 1 | Login PIN admin / mesero / cocina / barra | OK Validado |
| 2 | KDS Cocina con modificadores y notas | OK Validado |
| 3 | KDS Barra con modificadores, notas y producto abierto | OK Validado |
| 4 | Producto abierto (creación por admin/barra) | OK Validado |
| 5 | Mesero **bloqueado** para producto abierto (403) | OK Validado |
| 6 | Estados PREPARANDO → LISTO → ENTREGADO | OK Validado |
| 7 | Transición inválida (ENTREGADO → PREPARANDO) rechazada (400) | OK Validado |
| 8 | Dividir cuenta (Cuenta A / Cuenta B) | OK Validado |
| 9 | Pago parcial (abono) | OK Validado |
| 10 | Mesa pasa a estado PAGO_PARCIAL | OK Validado |
| 11 | Re-dividir / mover ítems con abono **bloqueado** (409) | OK Validado |
| 12 | Pago mixto Efectivo + SINPE | OK Validado |
| 13 | Factura después de abono parcial | OK Validado |
| 14 | Tiquete electrónico | OK Validado |
| 15 | Sobre-cobro rechazado (monto > saldo, 400) | OK Validado |
| 16 | Mesa liberada (LIBRE) al saldar todo | OK Validado |
| 17 | Bitácora (LOGIN, CREAR_ORDEN, CREAR_PRODUCTO_ABIERTO, CAMBIAR_ESTADO_ITEM, DIVIDIR_CUENTA, ABONO_PARCIAL, COBRAR_ORDEN) | OK Validado |

> Nota: los comprobantes quedan en `haciendaStatus = PENDIENTE` porque Hacienda/proveedor
> de facturación no está configurado (modo local). La emisión y el historial sí funcionan.

###  Observación operativa (decisión de negocio pendiente — NO es bug)

Actualmente el sistema **permite cobrar una orden aunque existan ítems pendientes**
en cocina/barra. Al cerrarse la orden, esos ítems salen del KDS. **No se considera
bug para el piloto**, queda como decisión de negocio a definir:

- **Opción A**: permitir cobrar siempre (comportamiento actual).
- **Opción B**: bloquear el cobro si hay ítems pendientes.
- **Opción C**: mostrar una advertencia antes de cobrar.

Para esta versión piloto se deja **documentado, sin cambiar código**.

---

## 1️⃣ SETUP INICIAL

### 1.1 Levantar servidor

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

Espera a que tanto web (3000) como API (3001) estén corriendo.

### 1.2 Credenciales por defecto

- **Admin**: PIN `1234` → Rol ADMINISTRADOR
- **Mesero**: PIN `1111` → Rol MESERO
- **Cocina**: PIN `2222` → Rol COCINA
- **Barra**: PIN `3333` → Rol BARRA
- **Caja**: PIN `4444` → Rol CAJERO

---

## 2️⃣ ESCENARIOS DE PRUEBA

### A. PRODUCTO DIRECTO (Sin modales)

**Criterio**: Agua Cristal tiene `allowModifiers=false, allowNotes=false`

1. Abrir POS en una mesa
2. Navegar a **Bebidas**
3. Clickear **Agua Cristal**
   - OK NO debe abrir modal
   - OK Debe agregarse directo al pedido
4. Verificar en OrderPanel: "1x Agua Cristal ₡1.000"

---

### B. PRODUCTO CON MODIFICADORES

**Criterio**: Cerveza Imperial tiene Michelada

1. Clickear **Cerveza Imperial** en Bebidas
   - OK Abre ProductCustomizeModal
   - OK Muestra grupo "Michelada" (opcional)
2. Seleccionar **Michelada**
   - OK Precio cambia: ₡2.000 → ₡2.500
3. Clickear **Agregar**
   - OK OrderPanel muestra:
     ```
     1x Cerveza Imperial ₡2.000 → ₡2.500
       Michelada
     ```

---

### C. PRODUCTO CON MODIFICADORES REQUERIDOS

**Criterio**: Whisky tiene presentación requerida (Vaso, Botella)

1. Clickear **Whisky** en Licores
   - OK Abre ProductCustomizeModal
   - OK Muestra "Presentación" con badge **Requerido**
2. Sin seleccionar nada:
   - OK Botón Agregar está **disabled** (gris)
3. Seleccionar **Vaso**
   - OK Botón Agregar se habilita
4. Clickear **Agregar**
   - OK Añade al pedido con modificador

---

### D. PRODUCTO ABIERTO

1. Clickear **(A) Producto abierto** en header de POS
   - OK Abre OpenItemModal
2. Llenar:
   - Nombre: "Vodka con Arándano"
   - Destino: **Barra**
   - Precio: 4500
   - Notas: "Poco hielo"
3. Clickear **Agregar**
   - OK Aparece en OrderPanel con badge (A)
   - OK Muestra precio final y notas

---

### E. AGREGAR NOTAS

**Criterio**: Cócteles tienen `allowNotes=true`

1. Clickear **Mojito Clasico**
   - OK Abre ProductCustomizeModal
   - OK Muestra campo **Notas**
2. Escribir: "Sin sal, poco hielo"
3. Clickear **Agregar**
   - OK OrderPanel muestra:
     ```
     1x Mojito Clasico ₡4.500
       Sin sal, poco hielo
     ```

---

## 3️⃣ ENVÍO A COCINA/BARRA

1. Agregar:
   - Casado con Carne (COCINA, tipo FOOD)
   - Mojito Clasico (BARRA, tipo COCKTAIL)
   - Cerveza Imperial (BARRA, tipo BEER)
   - Vodka Abierto (BARRA)

2. Clickear **Enviar a cocina / barra**
   - OK Spinner aparece
   - OK Vuelve a Mesas automaticamente

---

## 4️⃣ VERIFICAR EN KDS

### 4.1 KDS Cocina

1. Login con PIN `2222` (Cocina)
2. Navegar a **KDS Cocina**
   - OK Aparece Mesa 3
   - OK Muestra:
     ```
     1x Casado con Carne
       Sin ensalada (modificador)
       Extra aguacate (modificador)
     ```
3. Clickear **Preparar** en el item
   - Status cambia a **Preparando**
4. Clickear **Listo!**
   - Status cambia a **Listo**
5. Ticket pasa a sección "Listos"

### 4.2 KDS Barra

1. Login con PIN `3333` (Barra)
2. Navegar a **KDS Barra**
   - OK Muestra:
     ```
     1x Mojito Clasico
       Sin sal, poco hielo
     
     1x Cerveza Imperial
       Michelada
     
     1x Vodka con Arándano (A)
       Poco hielo
     ```
3. Marcar items como listos

---

## 5️⃣ FLUJO DE COBRO

1. Volver a **Mesas**
2. Clickear **Mesa 3**
   - OK Muestra orden con todos los items
   - OK Mostra total: subtotal + IVA
3. Opción **Cobrar** (en TableDetailDialog)
   - Seleccionar método: **EFECTIVO**
   - Seleccionar: **TIQUETE**
   - Clickear **Procesar pago**
   - OK Éxito, mesa se marca como PENDIENTE_PAGO

---

## 6️⃣ DIVIDIR CUENTA

1. Clickear Mesa con 2+ órdenes
2. Opción **Dividir cuenta**
   - Seleccionar items para Cuenta A
   - Seleccionar items para Cuenta B
   - Clickear **Dividir**
   - OK Crea dos órdenes separadas
3. Cobrar cada una por separado

---

## 7️⃣ FACTURACIÓN

1. Navegar a **Facturación**
   - OK Lista todas las facturas/tiquetes emitidos
   - OK Muestra estado Hacienda (PENDIENTE/ACEPTADO/RECHAZADO)
2. Filtrar por cliente, fecha, método
3. Click en tiquete:
   - OK Muestra detalle, items, modificadores, notas
   - OK Botón para reenviar si rechazado

---

## 8️⃣ ADMIN MENÚ

1. Login con PIN `1234` (Admin)
2. Clickear **Admin → Menú**

### 8.1 Crear Producto

1. Clickear **+ Nuevo producto**
   - Nombre: "Margarita Premium"
   - Descripción: "Tequila premium con triple sec"
   - Precio: 6500
   - Categoría: **Cocteles**
   - Tipo: **Cocktail**
   - OK allowModifiers: ON (verde)
   - OK allowNotes: ON (verde)
   - Clickear **Crear**
   - OK Aparece en tabla
   - OK Contador de Productos sube a 21

### 8.2 Crear Modificador

1. Clickear **Modificadores** tab
   - OK Muestra "Margarita Premium" 0 grupos
2. Clickear **Editar modificadores**
   - Clickear **+ Nuevo grupo de modificadores**
   - Nombre: "Presentación"
   - Obligatorio: ON
   - Opciones:
     - Rocks (+0)
     - Up (+500)
   - Clickear **Crear**
   - OK Grupo aparece con 2 opciones

### 8.3 Desactivar Producto

1. Tab **Productos**
2. Buscar viejo "Mojito Clásico"
3. Clickear **Desactivar**
   - OK Desaparece de Productos
   - OK Aparece en tab **Inactivos**
   - OK Contador actualiza

---

## 9️⃣ VALIDACIONES CRÍTICAS

- [ ] KDS muestra **modificadores** bajo cada item
- [ ] KDS muestra **notas** bajo cada item
- [ ] Productos abiertos aparecen con (A) en KDS y POS
- [ ] Precio final = basePrice + suma(priceDelta)
- [ ] No hay errores `.filter is not a function`
- [ ] Mesas se actualizan en tiempo real (3 seg)
- [ ] Órdenes se envían correcto a destino (COCINA/BARRA)
- [ ] Admin puede crear/editar/desactivar productos
- [ ] Modificadores requeridos bloquean agregar
- [ ] Facturas se crean con totales correctos

---

## 10. CHECKLIST FINAL

```
MESA → POS
  OK Carga datos correctamente
  OK Muestra categorías y productos
  OK Filtro de productos directo vs modal
  OK Agregación de cantidades duplicadas
  OK Precio final correcto con mods

POS → COCINA/BARRA
  OK Envío crea órdenes
  OK Items van al destino correcto
  OK Modificadores se persisten

KDS COCINA/BARRA
  OK Muestra órdenes por destino
  OK Muestra modificadores y notas
  OK Transiciones de estado (PENDIENTE → PREPARANDO → LISTO)
  OK Productos abiertos muestran con (A)

COBRO
  OK Cálculo correcto IVA (13%)
  OK División de cuenta funciona
  OK Método de pago se registra

FACTURACIÓN
  OK Se crean TIQUETE o FACTURA
  OK Se muestran en historial
  OK Totales coinciden con orden

ADMIN
  OK CRUD de productos completo
  OK CRUD de modificadores completo
  OK Deactivación funciona
  OK Seed data cargó correctamente
```

---

## [AVISO] PROBLEMAS CONOCIDOS

Si encuentras:

- **"filter is not a function"** → Verificar Array.isArray() antes de .filter()
- **Modificadores no aparecen en KDS** → Backend incluye, frontend tipos actualizados
- **Precio incorrecto** → Verificar que unitPrice y modifiersTotal se sumen correctamente
- **Producto abierto no llega a KDS** → Verificar destination está lleno en el item

---

##  RESUMEN CAMBIOS REALIZADOS

1. **KDS Cocina/Barra** - Agregados tipos para modifiers
2. **Dashboard** - Agregada validación de arrays
3. **Admin Turnos** - Agregada validación de movements array
4. **POS Page** - Verificada la página (ya estaba bien)
5. **ProductCustomizeModal** - Verificada (ya estaba bien)
6. **OrderPanel** - Verificada (ya estaba bien)
7. **Routes Backend** - Todas las rutas verificadas (completas)

---

**Última actualización**: 2026-06-15
**Stack**: Next.js 14 + Fastify 5 + Prisma + Supabase PostgreSQL
**Estado**: Ready for testing OK
