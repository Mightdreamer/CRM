# Plan de Implementación — Migración a Railway + Reestructura Monorepo

> **Documento vivo.** Este archivo se actualiza progresivamente a medida que se completa el trabajo.

---

## Cómo usar este documento (instrucciones para IA y humanos)

- Cada tarea es un checkbox `- [ ]`. Marcar como `- [x]` SOLO cuando esté verificada (no solo escrita).
- El campo `Status` de cada fase tiene tres estados: `⏳ Pendiente`, `🔄 En progreso`, `✅ Completada`.
- Al iniciar una fase: cambiar status a `🔄 En progreso` y poner fecha en `Iniciada`.
- Al completar una fase: cambiar status a `✅ Completada`, poner fecha en `Completada`, y agregar una entrada breve en `Notas de ejecución` sobre decisiones tomadas o desviaciones del plan.
- Si surge un blocker o se decide cambiar el plan: documentar en `Notas de ejecución` de la fase respectiva, no borrar el item original.
- Las estimaciones de tiempo son orientativas, no compromisos.

---

## Contexto

Producto: ERP B2B multi-tenant para PyMEs en República Dominicana, con facturación, cotizaciones, cuentas por cobrar, gestión de productos/gastos, asistente AI, y (futuro) integración con plataforma fiscal externa.

**Estado actual:**
- Next.js 16.2.6 monolítico, desplegado en Vercel (`prj_dza2rFixCFJR5n5pxEe7NvhTXUSS`).
- Supabase como base de datos. Schema ya es multi-tenant (`businesses`, `business_members`, RLS por `business_id`).
- Solo un usuario por business (limitación de aplicación; el schema soporta multi-business).
- Sin lógica DGII/e-CF implementada. La integración fiscal vivirá en un servicio externo aparte y se conectará vía HTTP en una fase posterior.

**Objetivo de esta migración:**
1. Cortar Vercel y desplegar en Railway con Docker + auto-deploy desde GitHub.
2. Reestructurar a monorepo con frontend y backend separados (`apps/web` Next.js + `apps/api` Hono), preparando la base para una posible consola interna de admin y otros consumidores que aparezcan más adelante.
3. Preservar 100% del código de dominio existente. Cero reescritura.

---

## Decisiones de arquitectura

| Decisión | Elección | Razón |
| --- | --- | --- |
| Monorepo tooling | pnpm workspaces + Turborepo | Estándar TS, builds en paralelo, optimizado para Docker con `turbo prune`. |
| Backend framework | Hono + Zod + `@hono/zod-openapi` | Liviano, streaming nativo (asistente AI), OpenAPI auto-generado. |
| API style | REST versionado (`/v1`) | Compatible con cualquier consumidor web o backend que aparezca después. |
| ORM | Drizzle sobre supabase-js | Queries type-safe, mejor DX que raw SQL. supabase-js se mantiene para auth/storage. |
| Auth usuarios | Supabase Auth + JWT forward al API | API verifica JWT y usa cliente Supabase con ese token → RLS sigue aplicando. |
| Comunicación web↔api | BFF sobre Railway Private Network | Next.js es lo único expuesto. Llama API por `http://api.railway.internal:8080`. |
| Build | Dockerfile multi-stage + `output: 'standalone'` + `turbo prune` | Portabilidad (no lock-in Railway), fuentes para PDFs, reproducibilidad para auditoría. |
| Background jobs | pg-boss (diferido a Fase 8) | Justificado por facturación recurrente y recordatorios automáticos. Sin Redis inicialmente. |
| Email | Resend + React Email | Cuando se agregue notificaciones (Fase 3). |
| Observability | Sentry (errores) + Axiom (logs) + OpenTelemetry (traces) | Se agrega en Fase 1 al levantar Railway. |
| Cutover Vercel | Hard cutover (sin paralelo) | Confirmado por el usuario. Backup: mantener proyecto Vercel 48h por si rollback. |

---

## Estructura final del repo

```
/Users/ernestomendez/Software/CRM/
├── apps/
│   ├── web/                          # Next.js 16 — solo UI
│   │   ├── src/{app,components,lib,i18n,messages,proxy.ts}
│   │   ├── public/
│   │   ├── next.config.ts            # con output: 'standalone'
│   │   ├── Dockerfile
│   │   └── package.json
│   └── api/                          # Hono — backend REST
│       ├── src/
│       │   ├── index.ts              # bootstrap + serve
│       │   ├── middleware/auth.ts    # verifica JWT Supabase
│       │   ├── routes/{customers,products,invoices,quotations,expenses,settings,assistant,pdf}.ts
│       │   └── lib/{pdf,openai}.ts
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── contracts/                    # Zod schemas compartidos
│   ├── db/                           # Drizzle + supabase clients + tipos generados
│   ├── core/                         # Lógica de dominio pura
│   └── tsconfig/                     # Configs base
├── supabase/                         # Migraciones + RLS + seeds
├── tests/
├── docs/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json                      # root
```

---

## FASE 1 — Bones del monorepo + Railway

**Status:** ✅ Completada
**Iniciada:** 2026-06-24
**Completada:** 2026-06-24
**Estimación:** 1-2 semanas
**Real:** ~1 día (sesión enfocada)

**Objetivo:** Producto funciona igual que hoy, pero corriendo en Railway desde una estructura monorepo con `apps/web` + `apps/api` scaffolded. Vercel apagado.

### Setup monorepo

- [x] Instalar pnpm global (corepack: pnpm 11.9 en host, pnpm@9.15.0 pinned en `packageManager`)
- [x] Crear `pnpm-workspace.yaml` con `packages: ['apps/*', 'packages/*']`
- [x] Crear `turbo.json` con pipelines: `build`, `dev`, `lint`, `typecheck`, `test`
- [x] Strip root `package.json` a monorepo-only (solo `turbo` en devDeps)
- [x] `pnpm install` resuelve sin errores

### Mover frontend a apps/web

- [x] `git mv src apps/web/src`
- [x] `git mv public apps/web/public`
- [x] Mover `next.config.ts`, `tsconfig.json`, `postcss.config.*`, `vitest.config.*`, `components.json`, `tests/` → `apps/web/` (eslint config se quedó en root como monorepo-wide)
- [x] Crear `apps/web/package.json` con deps de UI/Next + scripts
- [x] Agregar `output: 'standalone'` + `outputFileTracingRoot` en `apps/web/next.config.ts`
- [x] `pnpm --filter @crm/web dev/build/test` todos verdes
- [x] Actualizar `.gitignore` para ser monorepo-aware (paths sin `/` anclado)

### Extraer packages compartidos

- [x] `packages/tsconfig/`: `base.json`, `nextjs.json`, `node.json`
- [x] `packages/contracts/`: 7 Zod schemas (customer, invoice, product, quotation, expense, payment, settings). Export `@crm/contracts/*`
- [x] `packages/db/`: 4 archivos (types, browser, server, admin). Subpath exports `@crm/db/{browser,server,admin}` para evitar bundling server-only en browser. `next` como peerDep opcional (proxy.ts usa `next/headers`)
- [x] `packages/core/`: solo money helpers (calc + format) + tests (26 tests)
- [x] Actualizar imports en `apps/web` (48 imports validation, 30+ supabase, 4 money)
- [x] Test suite sigue verde (44 tests: 26 core + 18 web)
- [~] **Diferido a Phase 2**: Drizzle (sin endpoints API que se beneficien todavía); domain/, assistant/, ai/, openai/, pdf/, auth/ se quedaron en `apps/web/src/lib/` porque importan Supabase o Next.js directamente

### Scaffold apps/api

- [x] Crear `apps/api/package.json` con Hono 4.10 + `@hono/zod-openapi` 1.4 + tsup + tsx + vitest
- [x] `apps/api/src/index.ts`: bootstrap Hono + healthcheck `GET /healthz`
- [x] `pnpm --filter @crm/api dev` levanta en localhost:8080
- [x] `curl http://localhost:8080/healthz` retorna 200
- [x] `pnpm --filter @crm/api build` produce `dist/index.js` (~450 B)
- [~] **Diferido**: middleware/auth.ts, middleware/error.ts (vienen con las rutas de negocio en Phase 2)

### Dockerfiles

- [x] `.dockerignore` raíz
- [x] `apps/web/Dockerfile`: multi-stage (pruner → installer → runner), `turbo prune @crm/web --docker`, Next.js standalone runtime. Imagen final 230 MB
- [x] `apps/api/Dockerfile`: multi-stage similar + `pnpm deploy --prod` + fuentes `font-noto font-noto-emoji` para @react-pdf/renderer (Phase 2). Imagen 657 MB (optimizable con tsup bundling cuando llegue Phase 2)
- [x] Build local de ambas imágenes OK, containers responden healthcheck
- **Lección**: separar `deps` y `builder` en stages distintos rompe los symlinks de pnpm workspace → tsup no se encuentra. Hay que install+build en el mismo stage.

### docker-compose para dev local

- [x] `docker-compose.yml` raíz con servicios `web` + `api`, ambos leen `env_file: .env.local`, `API_URL=http://api:8080`

### Setup Railway

- [x] Proyecto: `keen-blessing` (`4bf78170-671c-4204-8559-8faeb376c0da`) — workspace "Ernesto Mendez's Projects"
- [x] Repo conectado: `ernestomendez1/CRM`
- [x] Servicio `web`: ID `6987d418-337f-4e8d-84c9-802727e481cd`, dominio público `https://web-production-9995f.up.railway.app`
- [x] Servicio `api`: ID `103701db-29e7-4638-87b1-376e9b421ec0`, solo private network (`http://api.railway.internal:8080`)
- [x] Dockerfile path configurado por servicio vía GraphQL `serviceInstanceUpdate` (CLI no tiene flag directo)
- [x] Watch patterns configurados por servicio para builds incrementales
- [x] Env vars seteadas en ambos servicios (`railway variables --skip-deploys --set`)
- [x] Auto-deploy desde push a main funcionando
- [x] Healthchecks pasan; ambos deploys SUCCESS

### Observability básica (Sentry)

- [-] **Diferido**: No bloqueante para Phase 1. Agregar cuando aparezca el primer issue de producción.

### Cutover Vercel

- [x] Dominio: usa generado por Railway (`*.up.railway.app`), sin dominio custom por ahora
- [x] Supabase → Auth → URL Configuration: site_url + uri_allow_list actualizados vía Management API (PAT). Incluye Railway URL + localhost para dev local
- [x] Smoke test producción OK: login, CRUD customer/product/invoice/quotation/expense, descarga PDFs, asistente AI (después de agregar OPENAI_API_KEY al web), extracción gasto, settings
- [x] Borrar `.vercel/` del repo
- [x] Vercel deployment ya borrado por el usuario antes de empezar

### Notas de ejecución

**Refinamientos vs plan original:**
- `packages/core` solo recibió `money/` (helpers puros). `domain/*`, `assistant/*`, `ai/*`, `openai/*`, `pdf/*`, `auth/*` se quedaron en `apps/web/src/lib/` porque importan Supabase o Next.js (no son lógica pura). Migran en Phase 2 junto con la separación de rutas API.
- Drizzle diferido a Phase 2 (sin endpoints que se beneficien todavía).
- `packages/auth` eliminado del scope (session.ts usa `next/navigation.redirect()` — acoplado a Next.js, vive en apps/web).

**Sorpresas en ejecución:**
1. **Railway IaC (`railway/iac`) tiene un bug con pnpm**: la importación se rompe con `?namespace=` query string ("Cannot find module ...?namespace=..."). Workaround: usar CLI directo + GraphQL para configurar Dockerfile path. Probado con `node-linker=hoisted` también — mismo bug. Reportable a railwayapp/cli.
2. **Railway no tiene "DOCKERFILE" en su Builder enum** — solo `HEROKU`, `NIXPACKS`, `PAKETO`, `RAILPACK`. La forma correcta es setear `dockerfilePath` y Railpack lo respeta automáticamente. No hace falta cambiar el builder.
3. **PORT inyectado por Railway no respeta el del Dockerfile**: hay que setear `PORT=3000` (web) y `PORT=8080` (api) explícitamente en env vars, sino el contenedor escucha en otro puerto que el dominio.
4. **Env vars duplicadas web↔api**: `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_POOLER_URL`, `OPENAI_EXPENSE_MODEL` están en AMBOS servicios durante Phase 1 porque las rutas en `apps/web/src/app/api/*` y los Server Actions todavía las usan. Quitar del web cuando Phase 2 migre esas rutas al api.
5. **Hono + Zod 4**: `@hono/zod-openapi` 0.16.x requiere zod 3.x. Hay que usar 1.x line (>= 1.0). Hono también >= 4.10.0.
6. **Servicios sin instancia**: cuando creas un servicio en el dashboard sin deployar, queda como "shell" a nivel proyecto pero sin `ServiceInstance` en el environment — el CLI no puede operarlo. Hay que crear vía dashboard+deployar, o usar `railway add --repo` que lo hace todo.
7. **`railway add` ignora el proyecto linkeado**: cae en el último proyecto linkeado a CUALQUIER subdirectorio. Hay que `railway link` desde el directorio exacto donde corres `railway add`.

**Pendientes para próxima sesión / TODO:**
- Revocar el PAT de Supabase Management (`sbp_d8d6dd97...`) en https://supabase.com/dashboard/account/tokens y borrar `SUPABASE_ACCESS_TOKEN` de `.env.local`.
- Setear región explícita en ambos servicios Railway (actualmente default — verificar latencia y mover a `us-east-4` si hace falta).
- Sentry + Axiom (observability) cuando llegue el primer issue de producción.

---

## FASE 2 — Migración de dominios a API REST

**Status:** ✅ Completada
**Iniciada:** 2026-06-25
**Completada:** 2026-06-25
**Estimación:** 3-6 semanas
**Real:** ~1 día (sesión enfocada, sin features paralelas)

**Objetivo:** Cada dominio del producto (settings, products, customers, quotations, invoices, expenses) consumido por el web vía HTTP al `apps/api`. Server Actions reducidos a wrappers que forwardean al api y invalidan cache.

### Infraestructura compartida

- [x] `apps/web/src/lib/api-client.ts`: server-only fetch wrapper con JWT forwarding (`apiGet/Post/Patch/Put/Delete/PostForm`)
- [x] `apps/api/src/lib/responses.ts`: helpers `ok`, `created`, `noContent`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `serverError`
- [x] `apps/api/src/lib/errors.ts`: `AppError` + `zodToFieldErrors`
- [x] `apps/api/src/middleware/auth.ts`: extract Bearer JWT, verify con `supabase.auth.getUser`, load business_id vía Drizzle, inyectar `ctx`
- [x] `apps/api/src/lib/db.ts` + `packages/db/src/drizzle.ts`: Drizzle client cacheado por proceso, conexión vía `SUPABASE_DB_POOLER_URL`
- [~] **Diferido**: OpenAPI spec auto-generado (`@hono/zod-openapi/createRoute` por endpoint). Se difiere a Fase 5 cuando llegue el SDK público para partners.

### Migración por dominio

#### Settings
- [x] Endpoints GET / + PATCH /profile, /tax, /numbering, /pdf + POST/DELETE /logo
- [x] Numbering guard (no permite retroceder counter) → 409
- [x] Logo multipart upload con Supabase Storage admin client (cleanup del logo previo)

#### Products
- [x] CRUD + PATCH /:id/(de)activate + GET /search (para assistant)
- [x] Paginación con count, búsqueda ilike por name + sku

#### Customers
- [x] CRUD + GET /:id/overview (customer + quotations + invoices + payments en un solo request — usado por la página de detalle)
- [x] CRUD + GET /search

#### Quotations
- [x] CRUD multi-tabla con `db.transaction` (header + items)
- [x] PATCH /:id/status, DELETE /:id (guard `converted_invoice_id`)
- [x] POST /:id/convert: transacción que crea invoice + items + link source quotation
- [x] RPC `next_quotation_number` / `next_invoice_number` vía `db.execute(sql\`...\`)`

#### Invoices
- [x] CRUD multi-tabla con transacciones (header + items)
- [x] Guard `status === 'draft'` para update/delete (409 si no)
- [x] PATCH /:id/status + POST /:id/payments + DELETE /:id/payments/:pid, todos llaman `recomputeInvoiceStatus` usando `applyPayments` de `@crm/core/money`

#### Expenses
- [x] CRUD multipart (form fields + opcional `receipt` file)
- [x] DELETE /:id/receipt, POST /:id/receipt-url (signed URL de 5 min, ahora con el expense id en lugar del storage path)
- [x] Cleanup atómico del archivo si la inserción falla

### Migrar rutas AI

- [x] `POST /v1/assistant/chat` con tool calling (prepare/search para products, customers, expenses)
- [x] `POST /v1/assistant/execute` que crea el record vía `createXRecord` y retorna path para revalidatePath en web
- [x] `POST /v1/expenses/extract` con upload a OpenAI Files API (PDF) o base64 inline (imágenes), structured JSON output, cleanup en finally
- [~] **Decisión**: No streaming. Mantenemos el shape JSON existente (chat + execute responden discriminated union). Streaming se evaluará cuando UX lo pida.
- [~] **Decisión**: Web mantiene rutas `/api/assistant/{chat,execute}` y `/api/expenses/extract` como thin proxies a la api — el widget en `assistant-widget.tsx` y `expense-form.tsx` siguen llamando esos paths, sin tocar código de browser.

### Migrar generación de PDFs

- [x] Las rutas `/api/pdf/invoice/[id]` y `/api/pdf/quotation/[id]` ahora cargan datos via `api-client` (no Supabase directo)
- [~] **Decisión**: `@react-pdf/renderer` se queda en `apps/web`. Razón: las labels vienen de `next-intl` (web-only). Mover el rendering al api requeriría forwardear todas las labels en el body o duplicar i18n en api. Sin un beneficio claro (las dependencias del api ya están limpias), se difiere a futuro si la latencia de PDFs se vuelve problema medible.

### Limpieza

- [x] Borrar `apps/web/src/lib/domain/`, `apps/web/src/lib/openai/`, `apps/web/src/lib/assistant/{copy,openai,schemas,service}.ts` (mantenido solo `types.ts` con search result types inlined)
- [x] Borrar tests viejos: `tests/unit/{api,assistant,domain}/*.test.ts` y `tests/unit/expense-extraction.test.ts`
- [x] `apps/web/.env.example`: quitadas `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_POOLER_URL`, `OPENAI_API_KEY`, `OPENAI_EXPENSE_MODEL`
- [x] Railway web service: borradas esas mismas 4 env vars
- [x] OpenAPI spec → diferido a Fase 5
- [-] **No aplicable**: `src/lib/fiscal/` y `src/app/api/fiscal/` ya estaban borrados desde Fase 1

### Notas de ejecución

**Decisiones de runtime:**
- **Drizzle desde día 1** (no supabase-js para queries del api) — porque vas a mover la DB de Supabase a Railway próximamente, y con Drizzle el swap es solo cambiar `DATABASE_URL`. Auth y Storage siguen con supabase-js.
- **Service-role connection** al pooler URL en lugar de RLS-applied JWT. Razón: simpler, faster, application-level enforcement de `business_id` en cada query. RLS sigue como defense-in-depth pero no se depende de él.
- **`db.execute(sql\`...\`)` para las RPCs** existentes (`next_quotation_number`, `next_invoice_number`) en lugar de reimplementar el counter en TS. Mantiene atomicidad y portabilidad cuando migres DB.
- **Forms preservan `useActionState`**: los Server Actions ahora son wrappers thin (parsean FormData → llaman api → revalidatePath → retornan SettingsResult/etc.). UI no cambió, progressive enhancement intacto.

**Sorpresas en ejecución:**
1. **noUncheckedIndexedAccess** en `packages/tsconfig/base.json` rompe destructurings como `const [{ count }] = await db.select(...)`. Workaround: `countRows[0]?.count ?? 0`.
2. **tsup bundles workspace deps pero deja node_modules externos** — `pg` (transitive de `@crm/db`) no se podía resolver hasta agregarlo como dep directa en `apps/api/package.json`. Mismo patrón para `@crm/core` que el api importa para `calculateTotals`/`applyPayments`.
3. **`turbo prune` + tsup**: separar `deps` y `builder` stages rompía symlinks de pnpm workspace. Solución: install + build en el mismo stage.
4. **Hono multipart** en el endpoint `/extract` no funciona bien con el `api-client.apiPostForm` wrapper porque la api retorna shape custom (`{ ok, extracted, warnings }`) en lugar de `ApiResult<T>`. Solución: la ruta web hace fetch crudo y forwardea el JSON tal cual al widget.
5. **Customer overview endpoint**: la página de detalle del customer carga 4 recursos (customer + quotations + invoices + payments). En lugar de 4 round-trips al api, se agregó `GET /v1/customers/:id/overview` que retorna todo en un single query con joins. Pattern repetible si otras páginas tienen patrones similares.
6. **i18n labels en PDFs**: dado que `next-intl` no existe en api, mover PDFs al api requería forwardear ~20 labels por request o reimplementar i18n. Decisión: mantener rendering en web pero data via api.

**Smoke tests automáticos:** Generación de JWT vía Supabase Admin (`auth.admin.generateLink` → `verifyOtp`), exposición temporal del api con dominio público, runner Node con `fetch` directo. Cobertura: foundation (healthz, /v1/me, auth negative), settings (GET + PATCH), products (CRUD + deactivate), customers (CRUD + overview + cross-tenant), quotations (CRUD + status + convert + guard "can't delete converted"), invoices (CRUD + status transitions + payment add + balance recompute + paid status), expenses (CRUD), assistant chat. Total: 37 tests across two runs, todos verdes. Script no committed (one-off).

**Pendientes para Fase 3+:**
- OpenAPI spec auto-generado vía `@hono/zod-openapi` (Fase 5 cuando llegue SDK público)
- Integration test infrastructure formal en `apps/api/tests/integration/` (los smoke tests externos cubren end-to-end pero no hay tests reproducibles en CI)
- Revisar si `OPENAI_API_KEY` rotation es manual o automatizable
- Si la DB se mueve a Railway, swap `SUPABASE_DB_POOLER_URL` → `DATABASE_URL` en api

---

## FASE 3 — Multi-tenancy UX completo

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 3-4 semanas

**Objetivo:** Un usuario puede pertenecer a múltiples businesses y cambiar entre ellas. Nuevos usuarios pueden registrarse y crear su primera business. Owners pueden invitar miembros.

### Business switcher

- [ ] Reemplazar `requireBusiness()` en `apps/api/src/middleware/auth.ts` para leer `business_id` desde cookie `selected_business_id` en vez de tomar el primero
- [ ] Si la cookie no existe o el business no pertenece al usuario: rechazar con 403 (el web lo redirige)
- [ ] Componente switcher en `apps/web/src/components/business-switcher.tsx` (dropdown en header)
- [ ] Endpoint `POST /v1/session/business` que valida ownership y setea cookie
- [ ] Eliminar el `// For multi-business support later` comment de `src/lib/auth/session.ts:71`

### Signup + onboarding

- [ ] Página `/signup` con Supabase Auth (email + password, magic link opcional)
- [ ] Wizard de onboarding post-signup: crear primera business (name, legal_name, tax_id, currency, country=DO default)
- [ ] Endpoint `POST /v1/businesses` que crea business + business_member (role=owner) en transacción
- [ ] Email de bienvenida via Resend (requiere setup Resend, ver más abajo)
- [ ] Reemplazar página `/no-business` con redirect a `/onboarding`

### Invitación de usuarios

- [ ] Endpoint `POST /v1/businesses/:id/invitations` (genera token, guarda en tabla `invitations`, envía email)
- [ ] Endpoint `POST /v1/invitations/:token/accept` (valida token, crea business_member)
- [ ] UI en settings: lista de miembros + formulario para invitar (email + role)
- [ ] Migración: tabla `invitations` con `business_id`, `email`, `role`, `token`, `expires_at`, `accepted_at`
- [ ] RLS en `invitations`: solo owners/admins del business pueden listar/crear

### Setup Resend (primer caso real de email)

- [ ] Crear cuenta Resend, agregar dominio, configurar DNS (SPF, DKIM)
- [ ] `packages/emails/`: scaffold con React Email
- [ ] Templates: `welcome.tsx`, `invitation.tsx`
- [ ] Cliente Resend en `apps/api/src/lib/email.ts`
- [ ] Env var `RESEND_API_KEY` en api
- [ ] Test de envío en sandbox

### Audit RLS (defensa en profundidad)

- [ ] Test suite en `apps/api/tests/rls/` que crea dos usuarios en dos businesses distintos
- [ ] Cada test intenta: leer/escribir/borrar recursos del otro tenant → debe fallar
- [ ] Cobertura: customers, products, invoices, quotations, expenses, settings, invitations
- [ ] CI ejecuta estos tests contra schema de Supabase de staging

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## FASE 4 — Dashboard real con métricas

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 3-5 días

**Objetivo:** Reemplazar el dashboard skeleton con métricas reales agregadas desde la base de datos. Es lo primero que un cliente ve al loguearse — sin números, el producto se siente vacío.

### Endpoints de agregación

- [ ] `GET /v1/dashboard/summary`: ingresos del mes (sum de invoices issued/paid en current month), gastos del mes, cuentas por cobrar (sum de `balance_due` de invoices issued/partially_paid/overdue), beneficio neto (ingresos − gastos)
- [ ] `GET /v1/dashboard/top-debtors`: top 5 clientes con mayor `balance_due` agregado
- [ ] `GET /v1/dashboard/upcoming-invoices`: facturas con due_date dentro de los próximos 7 días + facturas overdue
- [ ] `GET /v1/dashboard/recent-activity`: últimas 10 transacciones (facturas emitidas, pagos recibidos, gastos registrados)
- [ ] Queries respetan RLS (filtran por business_id automáticamente)

### UI

- [ ] Reemplazar widgets placeholder en `apps/web/src/app/(app)/dashboard/page.tsx` con datos reales
- [ ] Comparativa mes actual vs mes anterior (delta + flecha arriba/abajo)
- [ ] Selector de período (mes actual, mes anterior, últimos 30/90 días, año actual)
- [ ] Widget de cuentas por cobrar con drill-down a `/invoices?status=overdue`
- [ ] Widget de top deudores con drill-down a cada cliente
- [ ] Estados vacíos amigables (empty states) para clientes nuevos sin datos

### Performance

- [ ] Cachear agregaciones por business + período usando Runtime Cache o tabla materializada si crece
- [ ] Invalidar cache al crear/editar invoice, expense, payment
- [ ] Smoke test: dashboard carga en <500ms con dataset de 1000 facturas

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## FASE 5 — Reportes, envío de facturas y roles

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 3-4 semanas

**Objetivo:** Cerrar los gaps que más impactan la venta diaria: reportes que el contador del cliente necesita, envío de facturas sin tener que descargar el PDF a mano, y permisos granulares para que el dueño confíe en dar acceso a su equipo.

### Reportes y exports

- [ ] Estado de cuenta por cliente: endpoint `GET /v1/customers/:id/statement?from=&to=` (facturas + pagos + saldo)
- [ ] Reporte de ventas por período: endpoint `GET /v1/reports/sales?from=&to=&groupBy=customer|product|month`
- [ ] Reporte de gastos por categoría: endpoint `GET /v1/reports/expenses?from=&to=&groupBy=category|vendor`
- [ ] P&L básico: endpoint `GET /v1/reports/pnl?from=&to=` (ingresos − gastos por categoría)
- [ ] Export CSV de listas: `?format=csv` en endpoints de customers, invoices, expenses, products
- [ ] Export Excel (xlsx) de los reportes anteriores
- [ ] UI: nueva sección `/reports` con tabs por reporte + selector de período + botón export
- [ ] PDF de estado de cuenta por cliente (reusa infra de PDF existente)

### Envío de facturas por email y WhatsApp

- [ ] Setup Resend si no se completó en Fase 3 (dominio, DNS, API key)
- [ ] Template React Email `invoice.tsx`: cuerpo con resumen + link de descarga (o PDF adjunto)
- [ ] Endpoint `POST /v1/invoices/:id/send` con body `{ to: string[], cc?: string[], message?: string }`
- [ ] Tabla `invoice_deliveries`: `id`, `invoice_id`, `channel` (email|whatsapp), `recipient`, `sent_at`, `status`, `error_message`
- [ ] UI: botón "Enviar" en detalle de factura abre modal (destinatario pre-llenado con email del customer, mensaje editable)
- [ ] Generador de link `wa.me/<phone>?text=...` con texto pre-armado (incluye número de factura, total, link al PDF si el storage lo soporta público o signed URL)
- [ ] Historial de envíos visible en el detalle de la factura ("Enviada a juan@ejemplo.com el 2026-06-25")
- [ ] Misma funcionalidad para quotations (`POST /v1/quotations/:id/send`)

### Roles aplicados (no solo en schema)

- [ ] Middleware de autorización en API: `requireRole(['owner','admin','accountant'])` por endpoint
- [ ] Mapa de permisos por recurso: documentar qué rol puede crear/editar/borrar customers, products, invoices, expenses, settings
- [ ] `accountant`: crea y edita gastos, ve facturas y reportes, NO edita productos ni configuración
- [ ] `viewer`: solo lectura en todo
- [ ] UI esconde botones de acciones no permitidas según rol (cliente lee `role` del contexto de sesión)
- [ ] Tests de autorización por rol en `apps/api/tests/auth/`

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## FASE 6 — Pagos como entidad de primera clase

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 2 semanas

**Objetivo:** Refactorizar `payments` para que sea un documento independiente de la factura, capaz de aplicarse a varias facturas o quedar como anticipo. Habilita "Recibo de Ingreso" como PDF, vista de cobros agregada, y reportes de cobranza que el contador del cliente espera. Alcance v1 acotado: sin `cash_accounts` ni conciliación bancaria todavía (esos vendrían después si crece la demanda).

### Schema y migración

- [ ] Migración: agregar a `payments` las columnas `payment_number` (auto-generado, ej. `REC-00001`), `customer_id` (FK), `unallocated_amount` (decimal). Mantener temporalmente `invoice_id` como nullable para backfill
- [ ] Migración: tabla `payment_applications` con `id`, `business_id`, `payment_id` (FK cascade), `invoice_id` (FK restrict), `amount_applied` (decimal), `applied_at`, `created_by`
- [ ] Migración data: para cada `payment` existente, crear una `payment_application` con `amount_applied = payment.amount` y `invoice_id = payment.invoice_id`. Setear `customer_id` desde la factura. Setear `unallocated_amount = 0`
- [ ] Migración: eliminar columna `payments.invoice_id` después de validar backfill
- [ ] RPC `next_payment_number(business_id)` siguiendo patrón de invoices/quotations (ACID, sin duplicados)
- [ ] Setting de numeración en `businesses.numbering_settings`: `payment_prefix` (default `REC-`), `payment_next_number`
- [ ] Función SQL `recalculate_invoice_balance(invoice_id)`: ahora suma desde `payment_applications` en vez de `payments`. Actualiza `amount_paid`, `balance_due`, `status`
- [ ] RLS en `payment_applications` por `business_id`

### Lógica de negocio en API

- [ ] Endpoint `POST /v1/payments`: body `{ customer_id, payment_date, amount, method, reference, notes, applications: [{ invoice_id, amount_applied }] }`. Suma de applications ≤ amount. Diferencia → `unallocated_amount`. Transacción atómica
- [ ] Endpoint `POST /v1/payments/:id/apply`: aplicar `unallocated_amount` (o parte de él) a una factura existente. Útil para anticipos que después se reconcilian
- [ ] Endpoint `GET /v1/payments`: lista con filtros por fecha, customer, método, estado (con/sin saldo a aplicar)
- [ ] Endpoint `GET /v1/payments/:id`: detalle con applications expandidas (info de cada factura aplicada)
- [ ] Endpoint `DELETE /v1/payments/:id`: soft delete; cascada en applications; recalcula balance de las facturas afectadas
- [ ] Validación: no permitir `amount_applied > invoice.balance_due` en el momento de aplicar
- [ ] Mantener compatibilidad del flujo "registrar pago de esta factura": un endpoint conveniencia `POST /v1/invoices/:id/payments` que crea payment + una sola application en una transacción (lo que el UX actual ya hace)

### UI

- [ ] Nueva sección `/payments`: lista de cobros con columnas (fecha, número, cliente, monto, sin aplicar, método). Filtros por período, cliente, método
- [ ] Detalle de pago: muestra applications (lista de facturas a las que se aplicó + montos), saldo sin aplicar destacado, botón "Aplicar saldo a factura"
- [ ] Formulario de nuevo pago (entry directo desde `/payments/new`): selecciona cliente, monto total, luego picker de facturas pendientes de ese cliente con asignación de montos (auto-completar al saldo de cada una hasta agotar el pago)
- [ ] Flujo rápido desde factura sigue funcionando: botón "Registrar pago" en detalle de invoice prellena cliente y aplica todo el monto a esa factura
- [ ] Indicador en detalle de cliente: "Tiene RD$X de anticipo sin aplicar" con CTA para aplicar a una factura

### PDF Recibo de Ingreso

- [ ] Template `apps/api/src/lib/pdf/payment-receipt.tsx`: recibo formal con número, cliente, monto en letras, método, fecha, lista de facturas aplicadas, firma
- [ ] Endpoint `GET /v1/payments/:id/pdf` (reusa infra de PDFs existentes)
- [ ] Botón "Descargar Recibo" en detalle de pago
- [ ] Botón "Enviar Recibo por email/WhatsApp" (reusa infra de Fase 5)

### Reportes

- [ ] Endpoint `GET /v1/reports/collections?from=&to=&groupBy=customer|method|day`: cobros recibidos en período
- [ ] Endpoint `GET /v1/reports/customer-balances`: por cliente — facturado, cobrado, balance pendiente, anticipos sin aplicar
- [ ] Export CSV/Excel (reusa infra de Fase 5)
- [ ] Estado de cuenta por cliente (Fase 5) ahora muestra applications con detalle de qué pago se aplicó a qué factura

### Integración con dashboard y recordatorios

- [ ] Widget "Cobros del mes" en `/dashboard` (suma de pagos en mes actual)
- [ ] Cuentas por cobrar del dashboard sigue siendo correcto (se calcula igual: suma de `balance_due` de facturas)
- [ ] Recordatorios de Fase 8 (worker) siguen funcionando — solo usan `invoice.balance_due` que ahora se calcula desde applications

### Integración con asistente AI

- [ ] Tool `register_payment`: recibe cliente, monto, método, opcional lista de facturas a aplicar. Si no se especifican, las aplica automáticamente a las facturas pendientes más antiguas
- [ ] Tool `check_customer_balance`: consulta balance pendiente y anticipos sin aplicar de un cliente

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## FASE 7 — Integración con facturación electrónica (e-CF DGII)

**Status:** 🔄 En progreso
**Iniciada:** 2026-08-10
**Completada:** —
**Estimación:** 3-4 semanas

**Objetivo:** Conectar el ERP con `fiscal-platform` (monorepo externo en `/Users/ernestomendez/Software/fiscal-platform`) para emitir comprobantes fiscales electrónicos (e-CF) a la DGII. Este ERP **no implementa** generación de XML, firma con certificado, validación XSD ni protocolo DGII — toda esa lógica vive en la Cloud API de fiscal-platform. El ERP es el **cliente** que envía facturas en JSON, recibe estados (vía webhook), y muestra el ciclo de vida fiscal al usuario.

**Tipos de documento soportados (e-CF):** B01 (crédito fiscal), B02 (consumo), B03 (nota de débito), B04 (nota de crédito), B14 (gubernamental), B15 (regímenes especiales), B16 (exportaciones).

### Pre-requisitos (verificar antes de empezar)

- [ ] `fiscal-platform/apps/cloud-api` tiene endpoints reales (no `501 Not Implemented`) para: `POST /documents/submit`, `GET /documents/:id/status`, `POST /documents/:id/cancel`
- [ ] `fiscal-platform/packages/fiscal-core` orquesta el flujo build → validate → sign → submit → status
- [ ] `fiscal-platform` soporta multi-tenant (cada business del ERP mapea a un tenant en fiscal-platform con su propio certificado digital, RNC, y modo test/prod)
- [ ] Esquema de webhook desde fiscal-platform → ERP definido (payload, headers de firma HMAC)
- [ ] Contratos (`@fiscal-platform/shared-contracts`) finalizados para `BasicInvoiceRequest`, `DocumentStatus`, etc.

### Configuración fiscal por business

- [ ] Migración: agregar a `businesses` las columnas `fiscal_enabled` (bool), `fiscal_platform_tenant_id` (string, mapping al tenant en fiscal-platform), `dgii_rnc` (validado), `dgii_operation_mode` (`test` | `production`), `fiscal_config` (JSONB para datos del emisor: razón social, dirección fiscal, teléfono)
- [ ] Migración: tabla `ncf_sequences` con `business_id`, `document_type` (B01|B02|B03|B04|B14|B15|B16), `serie` (E31, E32, etc.), `next_number`, `range_start`, `range_end`, `is_active`, `valid_until` (fecha de vencimiento del rango DGII)
- [ ] Función SQL `next_ncf(business_id, document_type)` ACID que retorna NCF formateado (`E3100000001`) y avanza el counter
- [ ] UI en settings → nueva sección "Facturación electrónica": toggle activar, RNC, modo, gestión de rangos NCF (registrar nuevo rango, ver agotamiento), info del certificado (uploaded en fiscal-platform — solo lectura aquí con link al portal)
- [ ] Validación: RNC con dígito verificador correcto antes de activar

### Cliente HTTP a fiscal-platform

- [ ] `apps/api/src/lib/fiscal-platform/client.ts`: cliente tipado con métodos `submitInvoice(payload)`, `getStatus(documentId)`, `cancelDocument(documentId, reason)`, `submitCreditNote(payload)`
- [ ] Manejo de errores estructurado: errores de validación de fiscal-platform → mensajes accionables al usuario
- [ ] Timeouts y retries con backoff (la submission inicial puede ser sync, el resultado DGII es async)
- [ ] Env vars: `FISCAL_PLATFORM_BASE_URL`, `FISCAL_PLATFORM_API_KEY`, `FISCAL_PLATFORM_WEBHOOK_SECRET`
- [ ] Mapper invoice del ERP → payload `BasicInvoiceRequest` de fiscal-platform (incluye líneas, impuestos, customer, RNC, NCF asignado por el ERP)

### Flujo de emisión

- [ ] Migración: extender `invoice.fiscal_metadata` con campos estructurados — `ecf_number` (NCF asignado), `ecf_type` (B01..B16), `track_id` (devuelto por DGII), `submission_status` (`not_submitted` | `submitted` | `accepted` | `rejected` | `in_review` | `cancelled`), `submitted_at`, `dgii_responded_at`, `dgii_response_code`, `dgii_response_message`, `rejection_reasons` (array)
- [ ] En formulario de invoice: selector de tipo e-CF (default según customer — si tiene RNC válido sugiere B01, si no B02). Validación cruzada: B01 requiere customer con RNC válido
- [ ] Endpoint `POST /v1/invoices/:id/emit-ecf`: valida data requerida (RNC del business, NCF disponible, customer con datos completos según tipo), asigna NCF de la secuencia, hace POST a fiscal-platform, guarda `track_id` + `submission_status=submitted`
- [ ] No bloquear emisión normal: una invoice puede vivir en status `issued` sin e-CF. Emitir e-CF es acción aparte
- [ ] Botón "Emitir e-CF" en detalle de invoice (solo si business.fiscal_enabled = true)
- [ ] Alerta visible cuando NCF range tiene < 100 disponibles o vence en < 30 días

### Webhook de estado desde fiscal-platform

- [ ] Endpoint `POST /v1/webhooks/fiscal-platform`: recibe actualizaciones cuando DGII responde (segundos a minutos después del submit)
- [ ] Validación HMAC con `FISCAL_PLATFORM_WEBHOOK_SECRET` (header `X-Signature`)
- [ ] Tabla `webhook_events`: `id`, `source` (default `fiscal-platform`), `event_id` (UUID del evento de fiscal-platform), `payload` (JSONB), `received_at`, `processed_at`, `error_message`
- [ ] Idempotencia: mismo `event_id` no se procesa dos veces (UNIQUE constraint)
- [ ] Procesamiento: actualiza `invoice.fiscal_metadata` (status, dgii_response_code, dgii_responded_at, rejection_reasons)
- [ ] Si rechazado: log en `audit_log` + notificación al owner del business (in-app + email opcional)

### Notas de crédito y débito

- [ ] Migración: tabla `credit_notes` (o reusar `invoices` con `document_type=credit_note`) con `original_invoice_id` (FK), `reason_code` (códigos DGII: 01=devolución, 02=descuento, 03=ajuste, 04=cobro indebido), `reason_text`
- [ ] Misma estructura de líneas que invoice (qty puede ser negativa para devoluciones parciales)
- [ ] Endpoint `POST /v1/invoices/:id/credit-notes`: emite nota de crédito sobre factura existente (la nota emite e-CF B04 referenciando NCF original)
- [ ] Endpoint análogo para notas de débito (e-CF B03)
- [ ] Integración con Fase 6 (Pagos): NC reduce `invoice.balance_due` (es equivalente a un pago no-cobrado). NC se trata como `payment_application` virtual con `source=credit_note`
- [ ] UI: botón "Emitir nota de crédito" en detalle de invoice (solo si invoice tiene e-CF emitido y aceptado)

### Cancelación de e-CF

- [ ] Endpoint `POST /v1/invoices/:id/cancel-ecf`: válido solo si reglas DGII lo permiten (típicamente dentro de X horas o si DGII aún no aceptó)
- [ ] fiscal-platform maneja la cancelación con DGII; ERP solo refleja resultado
- [ ] Status `cancelled` no permite re-emitir e-CF sobre la misma invoice (hay que crear nueva)

### PDF enriquecido con datos fiscales

- [ ] Plantilla PDF de invoice incorpora: NCF, RNC del emisor, razón social oficial, fecha de emisión fiscal, código QR con link de verificación DGII, leyenda "Comprobante Fiscal Electrónico"
- [ ] Diferenciación visual entre "Factura pro-forma" (sin e-CF) y "e-CF emitido y aceptado"
- [ ] PDF de nota de crédito/débito con su propio formato y referencia al NCF original

### Reportes de compliance DGII

- [ ] **Reporte 606 (compras)**: agrupar `expenses` con `has_fiscal_receipt=true` por RNC del vendor + tipo de gasto, formato txt según especificación DGII. Endpoint `GET /v1/reports/dgii/606?period=YYYY-MM`
- [ ] **Reporte 607 (ventas)**: facturas emitidas en período, agrupadas por tipo e-CF y RNC del customer, formato txt DGII. Endpoint `GET /v1/reports/dgii/607?period=YYYY-MM`
- [ ] **Reporte 608 (anulados)**: e-CFs cancelados en período
- [ ] **Reporte 609 (pagos al exterior)**: si aplica
- [ ] UI en `/reports/dgii`: selector de período, descarga directa del txt formateado para upload en Oficina Virtual DGII

### UI agregada

- [ ] Badge de estado fiscal en lista y detalle de invoices: `Sin e-CF` (gris), `Enviado` (azul), `Aceptado` (verde), `Rechazado` (rojo), `Cancelado` (tachado)
- [ ] Vista "Bandeja fiscal" en `/fiscal/inbox`: facturas con `submission_status=submitted` o `rejected` que requieren atención
- [ ] Drill-down en detalle de invoice: respuesta cruda de DGII (código, mensaje, XML response link a fiscal-platform), historial de eventos (submitted/responded/cancelled)
- [ ] Settings → "Facturación electrónica": gestión de rangos NCF, vencimientos, modo test/prod

### Integración con asistente AI

- [ ] Tool `emit_ecf`: emite e-CF de una factura existente (requiere confirmación si modo producción)
- [ ] Tool `check_ecf_status`: consulta estado de e-CF de una factura
- [ ] Tool `list_pending_ecf`: lista facturas con `submission_status=not_submitted` o `rejected`
- [ ] Queries soportadas: "¿qué facturas tengo pendientes de emitir e-CF?", "¿cuántas facturas fueron rechazadas este mes?", "¿cuánto queda de mi rango NCF B02?"

### Notas de ejecución

- El diseño detallado y vigente está en [`docs/FISCAL_INTEGRATION_PLAN.md`](./FISCAL_INTEGRATION_PLAN.md); reemplaza los endpoints, webhooks, secuencias locales y credenciales globales descritos originalmente en esta fase.
- Fases A y B del plan fiscal completadas. Contratos vendorizados desde `fiscal-platform` commit `5f4aa80633ad96f89791db61cb12a696fe2c6274` porque el paquete fuente es privado y está fuera del build context del CRM.
- 2026-08-11: Completada la Fase D del plan fiscal: emisión manual/automática idempotente, retry, snapshot fiscal, grandfathering y opt-out por factura.

---

## FASE 8 — Worker, facturación recurrente y recordatorios

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 2-3 semanas

**Objetivo:** Levantar el background job processor para soportar facturación recurrente (gimnasios, escuelas, mantenimiento, servicios profesionales) y recordatorios automáticos de cobro. Estos dos features son los que justifican el costo de operar un worker.

### Setup worker

- [ ] Scaffold `apps/worker/` con Node + pg-boss + script de entry
- [ ] `Dockerfile` para el worker
- [ ] Agregar servicio `worker` en Railway (mismo proyecto, mismo repo, Root Directory `apps/worker`, sin public domain)
- [ ] Env vars: `SUPABASE_DB_POOLER_URL` (pg-boss usa el mismo Postgres)
- [ ] pg-boss inicializa schema `pgboss` en migración

### Patrón de jobs compartido

- [ ] `packages/jobs/`: definiciones tipadas de jobs (name, payload schema Zod, handler signature)
- [ ] `apps/api/src/lib/queue.ts`: cliente que encola jobs (`enqueue('send-email', payload)`)
- [ ] `apps/worker/src/handlers/`: un archivo por tipo de job
- [ ] Worker registra handlers, hace polling de pg-boss
- [ ] Manejo de retries y dead-letter

### Facturación recurrente

- [ ] Migración: tabla `recurring_invoice_templates` con `business_id`, `customer_id`, `cadence` (monthly|weekly|quarterly|annual), `day_of_month` (o equivalente), `next_run_at`, `start_date`, `end_date` (opcional), `is_active`, `notes`, `terms`, `currency`, `default_payment_terms_days`
- [ ] Migración: tabla `recurring_invoice_template_items` (mismo shape que invoice_items, sin totales calculados — se recalculan al generar)
- [ ] Endpoints REST CRUD `/v1/recurring-invoices`
- [ ] UI en `/recurring-invoices`: lista, crear/editar template (reusa componentes de invoice form), activar/pausar
- [ ] Job `generate-recurring-invoices`: corre diariamente (cron de pg-boss), busca templates con `next_run_at <= today AND is_active`, genera invoice en estado `draft` (o `issued` si el business lo configura), actualiza `next_run_at`
- [ ] Setting por business: "auto-emitir facturas recurrentes" (draft vs issued), "auto-enviar por email al cliente"

### Recordatorios automáticos de cobro

- [ ] Migración: tabla `reminder_rules` con `business_id`, `trigger_days` (negativo = antes del vencimiento, positivo = después), `channel` (email|whatsapp), `template`, `is_active`
- [ ] Defaults sugeridos al crear business: recordatorio 3 días antes, día del vencimiento, 7 días después, 15 días después
- [ ] Job `send-payment-reminders`: corre diariamente, busca facturas con balance_due > 0 cuyo `due_date + trigger_days = today`, encola un `send-email` o registra link de WhatsApp pendiente
- [ ] Tabla `reminder_deliveries`: log de qué se mandó a quién y cuándo (evita duplicados)
- [ ] UI en settings: configurar reglas + previsualizar template
- [ ] Botón "Enviar recordatorio ahora" en detalle de factura overdue

### Otros jobs en este worker

- [ ] `send-email`: cualquier email transaccional pasa por aquí (incluye los emails de envío de factura de Fase 5 y de recibos de pago de Fase 6)
- [ ] `generate-pdf`: si la latencia de PDFs grandes se vuelve problema visible

### Observability

- [ ] Logs de worker llegan a Axiom
- [ ] Sentry captura errores no manejados en handlers
- [ ] Dashboard en pg-boss admin (o tabla custom) para ver jobs pendientes/fallidos

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## FASE 9 — Admin console (cuando exista equipo de soporte)

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 3-4 semanas

**Objetivo:** Consola interna para staff de soporte/operaciones. Separada del producto-cliente.

- [ ] `apps/admin/` con Next.js
- [ ] Auth con Supabase Auth + role `staff` (nueva tabla `staff_users`)
- [ ] Dominio separado: `admin.tudominio.com` (Railway service propio)
- [ ] Comparte `packages/ui` con `apps/web`
- [ ] Funcionalidad: ver todas las businesses, impersonar (con audit log), métricas globales, gestión de billing (cuando exista)

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## FASE 10 — Inventario

**Status:** ⏳ Pendiente
**Iniciada:** —
**Completada:** —
**Estimación:** 2-3 semanas

**Objetivo:** Habilitar control de stock para PyMEs que venden productos físicos (comercios, distribuidores, ferreterías). Productos de tipo `service` no son afectados. Alcance v1: un solo almacén por business, costo promedio simple, sin órdenes de compra (esas pueden venir después si se justifica).

### Schema y migraciones

- [ ] Migración: agregar a `products` las columnas `tracks_inventory` (bool, default false), `stock_quantity` (decimal), `reorder_point` (decimal), `unit_cost` (decimal, opcional)
- [ ] Migración: tabla `inventory_movements` con `id`, `business_id`, `product_id`, `occurred_at`, `type` (`in` | `out` | `adjustment` | `opening_stock`), `quantity` (signed decimal), `reference_type` (`invoice` | `expense` | `manual` | `opening_stock`), `reference_id` (nullable), `unit_cost` (snapshot al momento del movimiento), `notes`, `created_by`
- [ ] Índice en `inventory_movements (business_id, product_id, occurred_at)` para queries de historial
- [ ] RLS por `business_id` (replicar patrón existente)
- [ ] Función SQL `recalculate_product_stock(product_id)`: suma de movimientos → actualiza `products.stock_quantity` (counter cache)
- [ ] Trigger o job que mantiene el counter cache consistente

### Lógica de negocio en API

- [ ] Al emitir invoice (status: draft → issued) con producto que `tracks_inventory`: crear movimiento `out` con qty negativa, `reference_type=invoice`
- [ ] Setting por business: `allow_backorder` (bool). Si false y stock insuficiente al emitir → rechazar con 400 y mensaje claro
- [ ] Al cancelar invoice: crear movimiento de reversa (`in` con qty positiva, mismo reference_id)
- [ ] Convertir quotation → invoice NO afecta stock (solo al emitir la invoice resultante)
- [ ] Endpoint `POST /v1/products/:id/stock-adjustments`: registrar ajuste manual con razón
- [ ] Endpoint `POST /v1/products/:id/opening-stock`: cargar stock inicial al activar tracking (solo permitido si no hay movimientos previos)
- [ ] Endpoint `GET /v1/products/:id/movements?from=&to=`: historial de movimientos
- [ ] Endpoint `GET /v1/inventory/summary`: lista de productos con stock actual, valoración (`qty × unit_cost`), flag de low stock

### UI

- [ ] Formulario de producto: toggle "Llevar inventario" — al activar, abre input de stock inicial + reorder_point
- [ ] Nueva sección `/inventory`: lista de productos con stock actual, valoración total, columna "low stock" destacada
- [ ] Filtros: bajo stock, sin stock, sin movimiento en N días
- [ ] Tab "Movimientos" en detalle de producto con timeline (tipo, qty, fecha, referencia clicable)
- [ ] Modal "Ajustar stock" en producto: input de cantidad nueva o delta, razón obligatoria, registra movimiento `adjustment`
- [ ] Validación en formulario de invoice: si producto tiene tracking y stock insuficiente, mostrar warning (bloquea emisión si `allow_backorder=false`)

### Reportes e integración con dashboard

- [ ] Widget en `/dashboard`: productos con stock bajo (count + drill-down)
- [ ] Reporte de valoración de inventario (snapshot a fecha): `GET /v1/reports/inventory-valuation?as_of=`
- [ ] Reporte de movimientos por producto/período: `GET /v1/reports/inventory-movements?from=&to=&product_id=`
- [ ] Reporte de productos sin movimiento (slow movers): `GET /v1/reports/slow-movers?days=`
- [ ] Export CSV/Excel en los tres reportes (reusa infra de Fase 5)

### Integración con asistente AI

- [ ] Tool `check_stock`: consultar stock actual de un producto por nombre/SKU
- [ ] Tool `adjust_stock`: ajustar stock con razón (requiere confirmación por riesgo)
- [ ] Soporte para queries tipo "¿qué productos están bajos en stock?" o "ajustar 10 unidades del producto X por daño"

### Notas de ejecución

_(Vacío hasta que se ejecute.)_

---

## Variables de entorno (referencia final)

| Variable | `web` | `api` | `worker` | Notas |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ❌ | Pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ❌ | Pública |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | ✅ | ✅ | Solo backend |
| `SUPABASE_DB_POOLER_URL` | ❌ | ✅ | ✅ | Drizzle directo + pg-boss |
| `OPENAI_API_KEY` | ❌ | ✅ | ❌ | Asistente + extracción |
| `RESEND_API_KEY` | ❌ | ✅ | ✅ | Emails (Fase 3+) |
| `SENTRY_DSN` | ✅ | ✅ | ✅ | Distinto por servicio |
| `AXIOM_TOKEN` | ✅ | ✅ | ✅ | Logs |
| `API_URL` | ✅ | ❌ | ❌ | `http://api.railway.internal:8080` en prod |
| `FISCAL_PLATFORM_BASE_URL` | ❌ | ✅ | ❌ | URL de Cloud API del fiscal-platform (Fase 7) |
| `FISCAL_PLATFORM_API_KEY` | ❌ | ✅ | ❌ | Auth al fiscal-platform (Fase 7) |
| `FISCAL_PLATFORM_WEBHOOK_SECRET` | ❌ | ✅ | ❌ | HMAC para validar webhooks entrantes (Fase 7) |
| `PORT` | auto | auto | auto | Railway inyecta |

---

## Anti-patrones a evitar

- ❌ Reescribir desde cero. Refactor preserva lógica probada.
- ❌ NestJS. Demasiado opinionado, ecosistema TS en RD/LATAM más pequeño.
- ❌ tRPC. Encierra en TS end-to-end, limita opciones de consumidores futuros.
- ❌ Prisma. No juega bien con Supabase RLS. Drizzle es superior.
- ❌ Microservicios desde día 1. Monolito modular en monorepo, extraer cuando un servicio tenga perfil de carga radicalmente distinto.
- ❌ Kubernetes. Railway/Fly cubren tus necesidades por años.
- ❌ Distroless images al inicio. `node:alpine` está bien, distroless complica debugging.
- ❌ SBOM, image signing, Trivy scans. Hasta que un cliente lo pida explícitamente.
- ❌ Pre-construir worker antes de tener un job real. Esperar el primer caso de uso.
- ❌ Tests de contrato cross-service antes de que existan partners externos.
- ❌ Realtime (Supabase realtime, websockets) antes de tener un caso de uso visible (notificaciones cross-tab, dashboards live).

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Refactor masivo rompe formularios sutilmente | Migración dominio por dominio, no big-bang. Tests existentes verdes en cada paso. |
| `output: 'standalone'` no copia archivos de `next-intl` o assets | Probar build Docker localmente antes de pushear. Si falta, `outputFileTracingIncludes` en `next.config.ts`. |
| RLS deja de aplicar si api usa service-role por accidente | Convención: `@crm/db/server` requiere JWT explícito, `@crm/db/admin` solo desde rutas marcadas `// admin-only`. Lint rule custom opcional. |
| Latencia web↔api en Railway private network | Ambos servicios en misma región. Medir en smoke tests. Railway private network es <1ms intra-región. |
| Cutover sin paralelo deja a usuarios sin servicio si algo falla | Cutover fuera de horario laboral. Mantener proyecto Vercel pausado (no borrado) 48h para rollback rápido. |
| pnpm + Turbo + Docker builds lentos en CI | Usar `turbo prune --docker` en multi-stage. Layer caching de pnpm con `pnpm fetch`. |

---

## Verificación end-to-end (smoke test estándar)

Ejecutar después de cada fase, antes de marcar como completada:

1. Login con usuario existente
2. Crear customer, product, quotation, invoice, expense
3. Editar y eliminar uno de cada
4. Descargar PDF de invoice y quotation
5. Asistente AI: enviar mensaje, recibir respuesta (streaming)
6. Extracción de gasto: subir foto de recibo, confirmar campos extraídos
7. Verificar `Authorization` header se propaga correctamente web→api
8. Intentar acceso cross-tenant (con sesión de business A, query de business B) → debe fallar
9. `pnpm -r test` verde
10. Logs en Sentry y Axiom muestran actividad sin errores no esperados
