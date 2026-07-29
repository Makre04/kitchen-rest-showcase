# Kitchen POS — Restaurant Point-of-Sale Platform

> Full-stack POS system built for a real restaurant operation in Costa Rica: waiter ordering, kitchen display, cashier sessions, and electronic invoicing — running on commodity tablets over local Wi-Fi.

A complete restaurant workflow in one system: the waiter takes the order at the table, the kitchen and bar see it instantly on their own displays, the cashier closes the check with split payments, and the invoice is ready for Costa Rica's tax authority (Hacienda) e-invoicing pipeline.

*Client-specific branding and data have been replaced for this portfolio release.*

---

## Core Features

- **Waiter module (mobile-first)** — table map, order taking with product modifiers, per-seat items, cart drafts that survive connection drops, and a connection-status banner for spotty restaurant Wi-Fi.
- **Kitchen Display System (KDS)** — real-time order queue per destination (kitchen / bar) over WebSockets; bump-to-complete flow replaces paper tickets.
- **Cashier & cash sessions** — open/close cash drawer sessions with movement tracking, split and mixed payment methods, and end-of-day reconciliation.
- **Electronic invoicing (CR)** — invoice generation designed for Costa Rica's Hacienda requirements, with a provider-integration layer and sandbox mode.
- **Admin back-office** — menu and modifier management, table layout, user roles, dashboards, and sales reports.
- **Audit trail** — every sensitive action is written to an append-only audit log.

## Architecture

```
apps/
├── web        Next.js 14 (App Router) — waiter POS, KDS, cashier,
│              invoicing, admin back-office
└── api        Fastify 5 — REST API + Socket.IO for real-time
               order flow, JWT auth (httpOnly cookies), Zod validation

packages/
└── database   Prisma 6 schema, migrations, and seed
               (PostgreSQL / Supabase)
```

**Real-time order flow:** waiter submits an order → API persists it and emits over Socket.IO → KDS screens for the right destination (kitchen or bar) update instantly → bumps propagate back to the waiter's view.

**Domain model:** 19 Prisma models covering branches, roles, users, tables, categories, products, modifier groups/options, orders, order items, payments (with per-method detail), customers, invoices, cash sessions, cash movements, audit logs, and configuration.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript |
| API | Fastify 5, Socket.IO, Zod |
| Auth | JWT (httpOnly cookies) + bcrypt-hashed role PINs |
| Database | PostgreSQL (Supabase) via Prisma 6 |
| Monorepo | pnpm workspaces |
| Infra | Docker Compose for local development |

## Security

- **No secrets in the repository** — all credentials live in environment variables; `.env.example` documents every variable with safe placeholders.
- **JWT hardening for production** — secret rotation enforced outside development; tokens delivered via httpOnly cookies, not localStorage.
- **Role-based access** — admin, waiter, kitchen, bar, and cashier roles with per-route authorization.
- **Input validation** — every API route validates payloads with Zod schemas.
- **Auditability** — sensitive operations (voids, cash movements, price changes) recorded in an audit log.

## Running Locally

```bash
pnpm install
cp .env.example .env       # fill in your database credentials

pnpm db:generate
pnpm db:push
pnpm db:seed               # demo catalog + demo users

pnpm dev                   # web on :3000, api on :3001
```

Demo PINs for the seeded roles are configurable via `SEED_*_PIN` variables.

## Project Status

Feature-complete for demo and controlled pilot use. Production e-invoicing (signed XML submission to Hacienda) is designed as a provider-backed integration and gated behind configuration.

## Author

**Pablo** — digital solutions for businesses: web development, automation systems, and client-acquisition strategy.

📧 pablojosueum@gmail.com
