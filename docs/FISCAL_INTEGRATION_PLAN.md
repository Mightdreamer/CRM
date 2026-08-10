# Plan de Integración CRM ↔ fiscal-platform Cloud API

> **Documento vivo.** Marcar checkboxes solo cuando la tarea esté verificada.
> Este plan reemplaza y expande la Fase 7 de `IMPLEMENTATION_PLAN.md` — cuando se
> arranque la integración, actualizar allí el status con un link a este doc.

---

## Contexto

**El objetivo:** que este CRM emita comprobantes fiscales electrónicos (e-CF) a la
DGII llamando al servicio `fiscal-platform` (`~/Software/fiscal-platform`), sin
implementar aquí ninguna lógica DGII (XML, firma, XSD, protocolo).

**División de responsabilidades:**

| Responsabilidad | Vive en |
| --- | --- |
| Datos de negocio (customers, products, invoices, payments) | CRM (Supabase) |
| Construcción de XML e-CF | fiscal-platform |
| Firma digital con certificado del emisor | fiscal-platform |
| Validación XSD | fiscal-platform |
| Comunicación con DGII (semilla, token, submit, consulta) | fiscal-platform |
| Gestión de rangos NCF (`ecf_sequences`) | fiscal-platform |
| Contingencia (retries, deadlines, 15d block) | fiscal-platform |
| Recepción de e-CFs entrantes (proveedores → nosotros) | fiscal-platform |
| Estado de la factura fiscal (badge, "Emitir e-CF", etc.) | CRM (UI + snapshot) |

**Estado hoy (2026-08-08):**

- fiscal-platform: fases 1–13.7 completas (ver `~/Software/fiscal-platform/CLAUDE.md`).
  Todos los endpoints que necesita el CRM están online. Cero pendientes de lado servidor.
- CRM: la integración **no ha empezado**. El único vestigio es
  `invoices.fiscal_metadata` (jsonb `{}`) en `packages/db/src/schema.ts:281`.
  Los folders `apps/web/src/lib/fiscal/` y `apps/web/src/app/api/fiscal/` fueron
  borrados en Fase 2 (limpieza pre-Hono).

---

## Decisiones ya tomadas

Estas decisiones vienen de conversaciones previas y **anulan lo que dice la Fase 7
de `IMPLEMENTATION_PLAN.md`** (ese texto está desactualizado en varios puntos):

| # | Decisión | Razón |
| --- | --- | --- |
| D1 | **eNCF sequences viven en fiscal-platform, NO en el CRM.** No crear tabla local `ncf_sequences`. | Feature `ecf-sequences` shipped en fiscal-platform Phase 13.6. Un tenant = un RNC, y los rangos son propiedad del RNC. El CRM solo los consulta (read-only) para mostrar estado de agotamiento. |
| D2 | **Un business del CRM = un tenant del fiscal-platform.** `tenant_id` + API key (cifrada AES-256-GCM) viven por-business en la DB del CRM; base URL en env var (una instancia de fiscal-platform sirve a todos los businesses). | Habilita multi-business y rotación de credenciales sin redeploy desde el arranque. La antigua Fase G (multi-business) se absorbió en la Fase A por esto. |
| D2b | **Certificado .p12 y rangos NCF NO se administran desde el CRM.** El CRM solo los muestra en modo lectura (estado del cert, `used/remaining/percentConsumed/daysToExpiry`) y linkea al admin-portal del fiscal-platform para gestionarlos. | El password del cert nunca debe tocar el CRM. La carga de rangos es rara (1–2× al año) y ya vive en el admin-portal. Reduce superficie de ataque y código a mantener. |
| D3 | **Polling desde el CRM, no webhooks.** UI del CRM llama `GET /api/v1/documents/:id` cada N segundos hasta estado terminal. | El fiscal-platform no expone webhooks. Alternativa: SSE (`GET /api/v1/documents/:id/events`) — mejor UX si el infra lo soporta. |
| D4 | **JSON mode primero (MVP), XML mode diferido.** | JSON pone toda la lógica de construcción en fiscal-platform. XML requiere portar `xml-builder` al CRM y usar `POST /allocate`. |
| D5 | **E34 (Notas de Crédito) diferido post-MVP.** | Cancelar una invoice localmente marca `cancelled` sin notificar a DGII. Se implementa cuando aparezca la primera cancelación real. |
| D6 | **Recepción de e-CFs entrantes: fuera del MVP.** | Los endpoints `/fe/*` de fiscal-platform reciben e-CFs de proveedores. Integrarlos con `expenses` del CRM es Fase F. |
| D7 | **Trigger de emisión: cuando `changeInvoiceStatus(id, 'issued')` corre.** Si falla el envío, el status local **no se revierte** — el operador reintenta manualmente. | Cloud API es idempotente por `externalReference = invoice.id`, así que reintentos son seguros. |
| D8 | **La activación de fiscal es admin-only (staff del CRM), no self-serve.** Los inputs de `tenant_id`, API key, y el toggle `fiscal_enabled` viven en `/admin/businesses/:id/fiscal` (staff auth middleware). El business owner nunca los ve. | Es una feature paga con costo adicional. Requiere que el staff cree el tenant en el fiscal-platform, suba el cert, genere la API key. Prevenir self-serve evita cobros no facturados y setups a medias. |
| D9 | **Opt-out per invoice:** con fiscal activo, el form de invoice tiene un checkbox "No emitir e-CF para esta factura" (unchecked por default). | Casos raros (pruebas internas, cortesías). Simpler que forzar todo-o-nada; el operador decide caso por caso. |
| D10 | **Invoices creadas ANTES de la activación quedan grandfathered.** El botón "Emitir e-CF" solo aparece en invoices creadas cuando `fiscal_enabled=true`. | Evita emisiones retroactivas con fechas raras que confunden a DGII y al operador. Casos de excepción se manejan por soporte manual. |
| D11 | **`products.type` (bien/servicio) se difiere post-Fase A.** El mapper hard-codea `indicadorBienoServicio=2` (Servicio) por default. | El CRM hoy es mayormente servicios. Cuando aparezca un cliente que venda bienes físicos, se agrega columna + migra. |

---

## Mapeo de operaciones

| Acción en CRM | Endpoint fiscal-platform | Notas |
| --- | --- | --- |
| Emitir factura (issued) con `fiscal_enabled=true` | `POST /api/v1/invoices` (JSON) | Body = payload mapeado; header `Authorization: Bearer fpk_...`; idempotente por `externalReference = invoice.id`. |
| Consultar estado de e-CF | `GET /api/v1/documents/:id` | Polling desde UI (o SSE `documents/:id/events`). |
| Reintentar tras fallo transitorio | `POST /api/v1/documents/:id/retry` | Solo si el doc está en `FAILED` por causa transitoria. |
| Mostrar rangos NCF en settings | `GET /api/v1/ecf-sequences` | Read-only. Incluye stats `used/remaining/percentConsumed/daysToExpiry`. |
| Listar historial fiscal | `GET /api/v1/documents?status=&type=&from=&to=` | Paginado con cursor. |
| Cancelar e-CF emitido *(post-MVP)* | `POST /api/v1/invoices` con `documentType: E34` | Emite Nota de Crédito referenciando el eNCF original. |
| Recibir e-CFs de proveedores *(post-MVP)* | `GET /api/v1/received-documents` | Un cron del CRM podría poll-ear y crear `expenses` a partir de ellos. |

Endpoints de administración (**se ejecutan una sola vez por operador**, no por el CRM):

- `POST /admin/tenants` — crear el tenant del CRM
- `POST /admin/tenants/:id/api-keys` (scope `WEB`) — generar la API key que el CRM usará
- `POST /admin/tenants/:id/certificate` — subir el .p12 del emisor + password
- `POST /admin/tenants/:id/ecf-sequences` — cargar rangos NCF autorizados por DGII

---

## Pre-requisitos operacionales

Antes de que el CRM pueda emitir su primer e-CF (en TestECF o producción):

- [ ] **Certificado digital del emisor** (.p12) obtenido de un CA autorizado por DGII (Camara TIC, Avansi, Viafirma).
- [ ] **RNC del business** cargado en `businesses.tax_id` y verificado.
- [ ] **Tenant creado en fiscal-platform** — anotar `tenantId`.
- [ ] **Cert subido** vía `POST /admin/tenants/:id/certificate` (encripta con AES-256-GCM, requiere `CERT_ENCRYPTION_KEY` ya seteado allá).
- [ ] **Rangos NCF cargados** vía `POST /admin/tenants/:id/ecf-sequences` para cada `documentType` que se vaya a emitir (mínimo E31 y E32). En TestECF usar los rangos oficiales pre-cert (ver `dgii-documentacion/Preguntas_Tecnicas_e_CF_Pre_Certificacion.md`) con vencimiento `31-12-2028` (no `31-12-2025` como dice el PDF).
- [ ] **API key WEB generada** vía `POST /admin/tenants/:id/api-keys` — el plaintext (`fpk_...`) se muestra **una sola vez**. Se pega en la UI de Settings del CRM (Fase F), NO en env vars.
- [ ] Env vars seteados en Railway (`api` service): `FISCAL_PLATFORM_BASE_URL`, `FISCAL_ENCRYPTION_KEY` (base64, 32 bytes — usada para cifrar la API key at-rest).

---

## Fases

### Fase A — Configuración fiscal por business

**Objetivo:** que el business tenga los metadatos fiscales necesarios para armar el
payload `Emisor` del e-CF, credenciales cifradas para llamar al fiscal-platform, y
un flag para activar/desactivar la integración.

- [x] Migración: agregar a `businesses` las columnas. **⚠️ El scope de cada columna determina qué endpoint la puede modificar:**

  - **Provisioning (STAFF-ONLY — solo editable vía `/admin/businesses/:id/fiscal`):**
    - `fiscal_enabled boolean not null default false` — toggle maestro; activarlo requiere que las 3 columnas siguientes estén completas
    - `fiscal_platform_tenant_id text` — UUID del tenant en el fiscal-platform (pegado por staff)
    - `fiscal_platform_api_key_encrypted bytea` — API key `fpk_...` cifrada con AES-256-GCM (formato `iv(12) || authTag(16) || ciphertext`)
    - `fiscal_platform_api_key_hint text` — últimos 4 chars del `fpk_...` para mostrar en UI (ej. `fpk_...ab12`); nunca la key completa
    - `fiscal_provisioned_at timestamptz` — cuándo el staff activó por primera vez (para grandfathering — invoices creadas antes no muestran botón "Emitir e-CF"; ver D10)
    - `fiscal_integration_mode text not null default 'JSON'` (`JSON` | `XML`) — hoy staff-only porque solo JSON está soportado

  - **Metadatos del Emisor (OWNER-editable en Settings, una vez que el business tiene `fiscal_enabled=true`):**
    - `fiscal_default_document_type text not null default 'E31'` (`E31` | `E32`)
    - `fiscal_default_tipo_ingresos text not null default '01'` (ver enum `TipoIngresos` del fiscal-platform)
    - `fiscal_trade_name text` — `nombreComercial` del e-CF (fallback a `businesses.name` si null)
    - `fiscal_branch text` — `sucursal`
    - `fiscal_economic_activity text` — `actividadEconomica`
    - `fiscal_municipality text`, `fiscal_province text` — para `Emisor.municipio/provincia`

- [x] Helper `apps/api/src/lib/fiscal-platform/crypto.ts` con `encryptApiKey(plaintext)` y `decryptApiKey(bytea)` usando `FISCAL_ENCRYPTION_KEY` (base64, 32 bytes) y `crypto` nativo de Node.

- [x] **Endpoint admin (staff-auth):** `PATCH /v1/admin/businesses/:id/fiscal-provisioning` (+ GET del mismo path) acepta body `{ tenant_id?, api_key?, fiscal_enabled?, fiscal_integration_mode? }`. Al recibir `api_key`: cifra, guarda, regenera `hint`, devuelve solo el hint. Al setear `fiscal_enabled=true`: valida que `tenant_id` + `api_key_encrypted` + `tax_id` del business estén presentes y que el RNC tenga dígito verificador correcto (algoritmo DGII); si no, 422 con detalle.

- [x] **Endpoint owner:** `PATCH /v1/settings/fiscal` para los campos OWNER-editable (siguiendo la convención existente de `settings.ts` que usa `ctx.businessId`, no `:id` en URL). Retorna 403 si `fiscal_enabled=false`.

- [x] Contracts Zod en `packages/contracts/src/fiscal.ts` (archivo nuevo — settings.ts se dejó intacto):
  - `businessFiscalProvisioningSchema` (staff-only, incluye `api_key` opcional plaintext)
  - `businessFiscalSettingsSchema` (owner-facing, solo metadatos del Emisor)
  - Ningún schema devuelve `api_key_encrypted` al cliente — solo el `hint` cuando corresponda.

- [x] Validador de RNC/Cédula DGII en `packages/core/src/dgii/rnc.ts` con tests (`isValidRNC`, `isValidCedula`, `isValidTaxId`, `detectTaxIdKind`).

- [x] **Registrar en `fiscal_provisioned_at`** el timestamp al primer `fiscalEnabled=true` (para grandfathering; si se desactiva y reactiva, mantener el timestamp original — es la fecha desde la que aplican emisiones).

**Notas de ejecución (Fase A):**
- Migración: `supabase/migrations/20260810000001_fiscal_integration_phase_a.sql`. Correr con `supabase db push` (o el runner que se use) antes de arrancar la Fase B.
- Env var nueva: `FISCAL_ENCRYPTION_KEY` (base64, 32 bytes). Agregada a `apps/api/.env.example` con instrucción de generación. **Aún no está en fail-fast del boot** — la validación es lazy dentro de `crypto.ts` (Fase B agrega el fail-fast al arrancar el HTTP client).
- Fiscal_opt_out en `invoices` también se agregó en esta migración (Fase D lo consume, pero la columna vive desde ya).
- Constraint DB: `businesses_fiscal_enabled_requires_provisioning_ck` bloquea a nivel Postgres cualquier fila donde `fiscal_enabled=true` pero falte tenant o api_key — defensa adicional al validation del endpoint.

### Fase B — Cliente HTTP tipado a fiscal-platform

**Objetivo:** una capa de acceso al Cloud API que centralice auth, error handling y
mapeo de errores DGII a mensajes accionables en el CRM.

- [ ] Instalar `@fiscal-platform/shared-contracts` en `apps/api/package.json` (link workspace vía `pnpm add`; si no es viable por rutas cross-repo, copiar los tipos a `packages/contracts/src/fiscal.ts` con un comentario apuntando al origen).
- [ ] `apps/api/src/lib/fiscal-platform/client.ts` — factory `createFiscalClient(business)` que descifra la API key on-demand y retorna un cliente scoped al business:
  ```ts
  createFiscalClient(business): FiscalClient  // resuelve tenant + api key desde columnas de business
  // FiscalClient:
  submitInvoice(payload: InvoiceRequest): Promise<DocumentResponse>
  getDocument(id: string, includeXml?: boolean): Promise<DocumentResponse>
  retryDocument(id: string): Promise<DocumentResponse>
  listDocuments(params: {...}): Promise<{items, nextCursor}>
  listSequences(): Promise<Sequence[]>
  ```
- [ ] Env vars: `FISCAL_PLATFORM_BASE_URL`, `FISCAL_ENCRYPTION_KEY` (base64, 32 bytes). Fail-fast en `apps/api/src/index.ts` si faltan.
- [ ] Header en cada request: `Authorization: Bearer ${decryptedApiKey}`, `Content-Type: application/json`. La API key descifrada vive solo en memoria durante el request; no cachearla entre requests.
- [ ] Timeouts: 30s. Retries: **solo** para 5xx/network (no para 4xx). Backoff exponencial 1s/2s/4s.
- [ ] Error mapper: convertir `StandardApiError` del fiscal-platform en errores accionables del CRM (ver tabla "Errores esperados" abajo).

### Fase C — Mapper CRM invoice → InvoiceRequest

**Objetivo:** transformar el modelo interno del CRM al DTO exacto que consume el
Cloud API. Es el pedazo más frágil de la integración — cambios en el schema del
CRM o en los contratos del fiscal-platform rompen esto.

- [ ] `apps/api/src/lib/fiscal-platform/mapper.ts` con función `buildInvoiceRequest(inputs) → InvoiceRequest`.
- [ ] Inputs: `{ business, customer, invoice, items }` cargados en una sola consulta (`getInvoiceDetail` en `apps/api/src/domain/invoices.ts:410` casi ya lo hace — agregar `business` al join).
- [ ] Mapeo campo por campo (referencia: `~/Software/fiscal-platform/packages/shared-contracts/typescript/src/dtos/`):

  **Discriminadores:**
  ```
  documentType     = business.fiscal_default_document_type  // E31 si customer tiene tax_id válido, sino E32
  operationMode    = "CLOUD"
  integrationMode  = "JSON"
  externalReference = invoice.id                            // idempotencia
  ```

  **idDoc:** (NO enviar `eNCF` ni `fechaVencimientoSecuencia` — el fiscal-platform los aloca)
  ```
  version                       = "1.0"
  tipoeCF                       = documentType (E31/E32)
  tipoIngresos                  = business.fiscal_default_tipo_ingresos  // solo E31/E32
  tipoPago                      = 1 (Contado) por default. Si invoice.due_date && invoice.due_date > issue_date → 2 (Credito)
  fechaLimitePago               = invoice.due_date en dd-MM-yyyy si tipoPago=Credito
  indicadorMontoGravado         = 1 si items tienen ITBIS incluido en unit_price, sino omitir
  ```

  **emisor:**
  ```
  rncEmisor           = business.tax_id
  razonSocialEmisor   = business.legal_name ?? business.name
  nombreComercial     = business.fiscal_trade_name ?? business.name
  sucursal            = business.fiscal_branch
  direccionEmisor     = business.address
  municipio           = business.fiscal_municipality
  provincia           = business.fiscal_province
  telefonosEmisor     = business.phone ? [business.phone] : undefined
  correoEmisor        = business.email
  actividadEconomica  = business.fiscal_economic_activity
  fechaEmision        = invoice.issue_date en dd-MM-yyyy
  ```

  **comprador:** (obligatorio en E31, opcional-pero-obligatorio-bloque-vacío en E32)
  ```
  rncComprador        = customer.tax_id       // REQUERIDO en E31
  razonSocialComprador= customer.company_name ?? customer.name
  correoComprador     = customer.email
  direccionComprador  = customer.address
  municipioComprador  = customer.city
  ```

  **items[]:** una entrada por cada `invoice_items` row (ordenado por `sort_order`):
  ```
  numeroLinea            = sort_order + 1
  indicadorFacturacion   = mapTaxRateToIndicator(item.tax_rate)
                            // 0.18 → 1 (Itbis18)
                            // 0.16 → 2 (Itbis16)
                            // 0    → 3 (Itbis0)
                            // exempt/null → 4 (Exento)
  nombreItem             = item.product_name
  descripcionItem        = item.description
  indicadorBienoServicio = 2 (Servicio) por default; TODO: agregar `products.type` a este mapeo (bien=1)
  cantidadItem           = item.quantity.toFixed(2)
  precioUnitarioItem     = item.unit_price.toFixed(4)
  descuentoMonto         = (item.unit_price * item.quantity * item.discount_pct).toFixed(2) si > 0
  montoItem              = item.line_total.toFixed(2)
  ```

  **totales:**
  ```
  montoGravadoTotal      = sum(items donde indicadorFacturacion in [1,2,3]).line_subtotal
  montoGravadoI1         = sum(items donde indicadorFacturacion==1).line_subtotal   // ITBIS 18%
  montoGravadoI2         = sum(items donde indicadorFacturacion==2).line_subtotal   // ITBIS 16%
  montoGravadoI3         = sum(items donde indicadorFacturacion==3).line_subtotal   // ITBIS 0%
  montoExento            = sum(items donde indicadorFacturacion==4).line_subtotal
  itbis1                 = 18 si hay algún item con indicador=1
  totalITBIS             = invoice.tax_total.toFixed(2)
  totalITBIS1            = sum(items donde indicador==1).line_tax
  montoTotal             = invoice.total.toFixed(2)
  valorPagar             = invoice.balance_due.toFixed(2) si difiere de montoTotal
  ```

- [ ] Helpers puros: `formatDateForDgii(iso: string): string` (`YYYY-MM-DD` → `dd-MM-yyyy`), `mapTaxRateToIndicator(rate: string): IndicadorFacturacion`.
- [ ] Tests unitarios del mapper con casos: E31 con RNC, E32 sin RNC, con múltiples tasas de ITBIS, con descuento por línea, sin descuento.

### Fase D — Endpoint de emisión

**Objetivo:** que el CRM dispare el envío al fiscal-platform de forma controlada y
audite el resultado.

- [ ] Migración: extender `invoices.fiscal_metadata` con campos estructurados
  (siguen viviendo en el JSONB, no columnas nuevas):
  ```
  {
    "documentId": "uuid del fiscal-platform",
    "eNcf": "E310000000001",
    "status": "RECEIVED_BY_CLOUD" | "ACCEPTED" | ...,
    "trackId": "...",
    "submittedAt": "ISO",
    "lastCheckedAt": "ISO",
    "lastError": { "code": "...", "message": "..." } | null
  }
  ```
- [ ] Endpoint `POST /v1/invoices/:id/emit-ecf` en `apps/api/src/routes/invoices.ts`:
  - Valida `business.fiscal_enabled = true`
  - Valida invoice en `issued` (o permite forzar desde `draft` opcionalmente)
  - Valida datos requeridos: business.tax_id, customer.tax_id si E31
  - Corre `buildInvoiceRequest` → `client.submitInvoice(payload)`
  - Persiste `fiscal_metadata` con `documentId`, `eNcf`, `status`, `submittedAt`
  - En error: guarda `lastError` en fiscal_metadata, retorna 502 con detalle
- [ ] **Migración adicional a `invoices`:** columna `fiscal_opt_out boolean not null default false` — cuando `true`, esta invoice específica NO genera e-CF aunque el business tenga fiscal activo (ver D9). El form UI la expone como checkbox "No emitir e-CF para esta factura".
- [ ] Hook en `changeInvoiceStatus(id, 'issued')` (`apps/api/src/domain/invoices.ts:270`):
  ```ts
  const shouldEmit =
    target === 'issued' &&
    business.fiscal_enabled &&
    !invoice.fiscal_opt_out &&
    invoice.created_at >= business.fiscal_provisioned_at &&  // grandfathering (D10)
    !invoice.fiscal_metadata.documentId;

  if (shouldEmit) {
    // dispatch async — no await; los errores no bloquean el issue
    submitInvoiceToFiscal(ctx, id).catch(logError);
  }
  ```
- [ ] Endpoint `POST /v1/invoices/:id/retry-ecf`: proxy al `POST /api/v1/documents/:documentId/retry`. Solo válido si `fiscal_metadata.status === 'FAILED'`.
- [ ] Guard: `PATCH /invoices/:id/status` a `draft` no permitido si `fiscal_metadata.status` en {`ACCEPTED`, `CONDITIONAL_ACCEPTED`, `IN_PROCESS`} (una e-CF aceptada no puede volver a draft).

### Fase E — Consulta de estado (polling)

**Objetivo:** que la UI vea el estado fiscal actualizado sin recargar la página.

**Opción A — Polling (default, más simple):**

- [ ] Endpoint `GET /v1/invoices/:id/fiscal-status` en el CRM:
  - Si `invoice.fiscal_metadata.documentId` está seteado y status no es terminal:
    → llama `client.getDocument(documentId)`
    → actualiza `fiscal_metadata` con snapshot fresco (`status`, `trackId`, `lastCheckedAt`)
    → retorna al UI el snapshot
  - Si status terminal: retorna el snapshot cacheado sin llamar al Cloud
- [ ] Componente `<FiscalStatusCard>` (client component) en `apps/web/src/app/(app)/invoices/[id]/`:
  - Polling con `setInterval` cada 10s mientras `status` no sea terminal
  - Estados terminales: `ACCEPTED`, `CONDITIONAL_ACCEPTED`, `REJECTED`, `FAILED`
  - Muestra badge de color + código + mensaje de error si aplica

**Opción B — SSE (mejor UX, más infra):**

- [ ] Proxy en el CRM: `GET /v1/invoices/:id/fiscal-events` → forwardea a `GET /api/v1/documents/:documentId/events` del fiscal-platform (que es un stream SSE).
- [ ] Componente `<FiscalStatusCard>` usa `EventSource` en lugar de setInterval.
- [ ] Requiere que Railway (o el proxy que use el `api` service) soporte streaming HTTP.

**Recomendación:** empezar con polling (Opción A) — 5 minutos de trabajo, cero infra. Migrar a SSE cuando esté el primer usuario real quejándose de la latencia.

### Fase F — UI de emisión y estado

**Objetivo:** que un operador entienda de un vistazo si una factura tiene e-CF o
no, y pueda emitir/reintentar con un click.

**La UI de fiscal se divide en dos superficies distintas según quién opera:**

- [ ] **`/admin/businesses/:id/fiscal` (STAFF-ONLY, tras el middleware de `/admin`):**
  - **Conexión con fiscal-platform:**
    - Input `fiscal_platform_tenant_id` (UUID, con validación de formato).
    - Input `fiscal_platform_api_key` (type=password, placeholder muestra `fpk_...ab12` si ya hay una guardada). Al submit: server cifra + guarda + regenera `hint`.
    - Botón "Probar conexión" — llama `GET /api/v1/documents?limit=1` con las credenciales guardadas para verificar auth.
  - **Activación:**
    - Toggle `fiscal_enabled` — deshabilitado hasta que `tenant_id` + API key + `tax_id` del business estén presentes y el RNC valide.
    - Al activar por primera vez: setea `fiscal_provisioned_at = now()`.
    - Warning al desactivar: "Invoices ya emitidas mantienen su e-CF. Nuevas facturas no se emitirán hasta reactivar."
  - **Estado read-only (para debug):**
    - Último `fiscal_provisioned_at`, últimos errores del cliente HTTP (útil cuando el owner llama a soporte).

- [ ] **`/settings/fiscal` (OWNER-facing, solo visible si `business.fiscal_enabled=true`):**
  - Si `fiscal_enabled=false`: la sección entera no aparece en el menú de Settings. Aparece un placeholder "¿Necesitás facturación electrónica? Contactá a soporte." con link/email.
  - Si `fiscal_enabled=true`:
    - **Certificado del emisor** (read-only): RNC + fecha de vencimiento + días restantes + mensaje "Para renovar el certificado, contactá a soporte" (NO exponer link al admin-portal del fiscal-platform — el owner no tiene acceso ahí).
    - **Rangos NCF** (read-only + alertas):
      - Tabla por `documentType` (E31, E32) con columnas: `nextNumber`, `used`, `remaining`, `percentConsumed`, `daysToExpiry`.
      - Alerta amarilla ≥90% consumido o ≤30 días para vencer.
      - Alerta roja ≥95% o ≤7 días.
      - CTA "Contactá a soporte para cargar un nuevo rango" (NO link externo).
    - **Metadatos del Emisor** (editables):
      - Inputs para `fiscal_trade_name`, `fiscal_branch`, `fiscal_economic_activity`, `fiscal_municipality`, `fiscal_province`.
      - Selectores: `fiscal_default_document_type`, `fiscal_default_tipo_ingresos`.

- [ ] **Modo XML:** toggle deshabilitado con badge "Próximamente" (staff-only, en `/admin`).
- [ ] **Form de invoice** (solo si `business.fiscal_enabled=true`):
  - **Selector de tipo e-CF:**
    - Default sugerido según customer: si `customer.tax_id` valida como RNC → E31, sino E32.
    - Override manual con dropdown en el form.
    - Validación cruzada: E31 requiere customer con RNC válido.
  - **Checkbox "No emitir e-CF para esta factura"** (`invoice.fiscal_opt_out`, unchecked por default):
    - Colapsable/secundario para no invitar al mis-uso.
    - Tooltip: "Usar solo para casos internos o cortesías. Facturas comerciales reales deben emitir e-CF."
    - Si está checkeado: el selector de tipo se oculta y no se dispara el envío al fiscal-platform.
- [ ] **Detalle de invoice**:
  - Botón "Emitir e-CF" (solo si `fiscal_enabled` y `!fiscal_metadata.documentId`)
  - `<FiscalStatusCard>` con estado + trackId + botón "Reintentar" si FAILED
  - Link al XML firmado (`GET /v1/invoices/:id/fiscal-xml` → proxy a `GET /api/v1/documents/:id?include=xml`)
- [ ] **Lista de invoices**:
  - Columna nueva: badge de estado fiscal
    - `—` gris: sin e-CF
    - `Enviado` azul: `RECEIVED_BY_CLOUD` / `SENT_TO_DGII` / `IN_PROCESS` / `TRACK_ID_RECEIVED`
    - `Aceptado` verde: `ACCEPTED` / `CONDITIONAL_ACCEPTED`
    - `Rechazado` rojo: `REJECTED`
    - `Fallido` naranja: `FAILED` / `CONTINGENCY_PENDING`
  - Filtro por estado fiscal
- [ ] **PDF de invoice**: enriquecer con `eNcf`, código QR de verificación DGII (URL del QR viene con el response del fiscal-platform o se construye según especificación DGII), leyenda "Comprobante Fiscal Electrónico".

### Fase G — Multi-business ✅ absorbido en Fase A

Este bloque desapareció como fase separada: `fiscal_platform_tenant_id` y
`fiscal_platform_api_key_encrypted` se agregaron directamente en la Fase A, y el
cliente HTTP de la Fase B ya es per-business desde el inicio. No hay migración
pendiente aquí.

### Fase H — Recepción de e-CFs entrantes (post-MVP)

**Objetivo:** cuando un proveedor emite un e-CF donde el business del CRM es el
receptor, esa recepción queda registrada en el fiscal-platform. Ideal que aparezca
en el módulo de `expenses` del CRM.

- [ ] Cron job (Fase 8 del `IMPLEMENTATION_PLAN.md` — worker) que cada N minutos
  llama `GET /api/v1/received-documents?since=<lastSync>` y crea un `expenses` draft
  por cada e-CF nuevo con `has_fiscal_receipt=true` + `fiscal_receipt_number=eNcf`.
- [ ] UI en `/expenses`: filtro "Con e-CF recibido" + drill-down al XML original.
- [ ] Endpoint `POST /v1/expenses/:id/approve-ecf` que llama
  `POST /api/v1/received-documents/:receivedId/approve` del fiscal-platform
  (aprobación comercial saliente, Fase 13.5).

### Fase I — Modo XML (post-MVP)

**Objetivo:** para clientes con sistemas legacy que ya generan XML e-CF, permitir
que el CRM lo envíe tal cual.

- [ ] Toggle `fiscal_integration_mode = 'XML'` en settings.
- [ ] Endpoint `POST /v1/invoices/:id/emit-ecf-xml` que acepta el XML como body.
- [ ] Antes del envío: llamar `POST /api/v1/ecf-sequences/allocate` para obtener el eNCF que debe embeber el XML (o el flujo caller-supplied si el XML ya lo trae).
- [ ] Cliente llama `POST /api/v1/xml-documents` en lugar de `/invoices`.

### Fase J — Notas de crédito E34 (post-MVP)

**Objetivo:** cancelar formalmente una factura ante DGII.

- [ ] Endpoint `POST /v1/invoices/:id/emit-credit-note` con body `{ codigoModificacion, razonModificacion }`.
- [ ] Mapper `buildCreditNoteRequest` que arma `documentType: E34` con `informacionReferencia` apuntando al eNCF original.
- [ ] UI: botón "Emitir nota de crédito" en detalle de invoice con e-CF aceptado.
- [ ] Integración con `payments`: la NC reduce `balance_due` de la invoice original (ver Fase 6 de `IMPLEMENTATION_PLAN.md`).

---

## Errores esperados y cómo mostrarlos

Errores comunes que el fiscal-platform devuelve y cómo el CRM debe reaccionar:

| HTTP | code | Cuándo | UX en CRM |
| --- | --- | --- | --- |
| 401 | `AUTH_FAIL` | API key inválida o revocada | Toast "Configuración inválida — contactar soporte". Log a Sentry con severity high. |
| 412 | `NO_ACTIVE_CERTIFICATE` | Tenant sin cert activo | Toast "El certificado del emisor no está configurado. Contactar administrador." |
| 412 | `ECF_SEQUENCE_UNAVAILABLE` | No hay rango NCF activo para ese tipo | Toast "No hay rangos NCF disponibles para {E31/E32}. Cargar nuevo rango en configuración." |
| 400 | `VALIDATION_FAILED` | Payload incompleto/mal formado | Bug del mapper — log full payload a Sentry, mostrar toast genérico "Error interno al emitir e-CF". |
| 422 | `XSD_INVALID` | XML generado no pasa XSD | Bug del mapper o del builder — log a Sentry con `details`. |
| 451 | `CONTINGENCY_15D_EXCEEDED` | Tenant en contingencia >15 días | Toast "Tenant en contingencia excedida. La factura queda emitida localmente sin e-CF. Contactar soporte." NO revertir status local. |
| 503 | (varios) | fiscal-platform down o DGII down | Toast "Servicio fiscal temporalmente no disponible. Se reintentará automáticamente." Marca `lastError` + agenda retry. |

**Regla general:** cualquier error del fiscal-platform va a `fiscal_metadata.lastError` como `{ code, message, at }`. La UI muestra el mensaje al operador. Fallos de emisión **nunca revierten** el status de la invoice — el operador reintenta cuando la causa está resuelta.

---

## Contratos clave (referencia inline)

Fuentes de verdad (releer si algo cambia): `~/Software/fiscal-platform/packages/shared-contracts/typescript/src/`.

### Request — POST /api/v1/invoices

```ts
// InvoiceRequest = E31InvoiceRequest | E32InvoiceRequest | E34CreditNoteRequest
{
  documentType: "E31" | "E32" | "E34",
  operationMode: "CLOUD",              // siempre CLOUD desde el CRM
  integrationMode: "JSON",             // siempre JSON en Fase C-F
  externalReference: "invoice-uuid",   // para idempotencia
  idDoc: {
    version: "1.0",
    tipoeCF: "E31",                    // == documentType
    // eNCF: OMITIR — el fiscal-platform lo aloca
    // fechaVencimientoSecuencia: OMITIR — el fiscal-platform lo inyecta
    tipoIngresos: "01",                // solo E31/E32
    tipoPago: 1,                       // Contado=1, Credito=2, Gratuito=3
    // fechaLimitePago: "dd-MM-yyyy"   // requerida si tipoPago=2
  },
  emisor: {
    rncEmisor: "131456789",            // 9 u 11 dígitos
    razonSocialEmisor: "Mi Empresa SRL",
    nombreComercial: "Mi Empresa",
    direccionEmisor: "Av. Ejemplo 123",
    municipio: "010100",               // código municipio DGII (opcional)
    provincia: "01",                   // código provincia DGII (opcional)
    telefonosEmisor: ["8091234567"],
    correoEmisor: "contacto@empresa.do",
    actividadEconomica: "Consultoría",
    fechaEmision: "08-08-2026"         // dd-MM-yyyy
  },
  comprador: {                          // obligatorio para E31
    rncComprador: "402123456",
    razonSocialComprador: "Cliente SRL",
    correoComprador: "cliente@correo.com",
    direccionComprador: "Calle X",
    municipioComprador: "010100"
  },
  items: [
    {
      numeroLinea: 1,
      indicadorFacturacion: 1,          // 0=NoFacturable, 1=ITBIS18, 2=ITBIS16, 3=ITBIS0, 4=Exento
      nombreItem: "Servicio X",
      descripcionItem: "Descripción larga",
      indicadorBienoServicio: 2,        // 1=Bien, 2=Servicio
      cantidadItem: "1.00",
      precioUnitarioItem: "1000.0000",
      montoItem: "1000.00"
    }
  ],
  totales: {
    montoGravadoTotal: "1000.00",
    montoGravadoI1: "1000.00",          // base ITBIS 18%
    itbis1: 18,
    totalITBIS: "180.00",
    totalITBIS1: "180.00",
    montoTotal: "1180.00"
  }
}
```

### Response — DocumentResponse

```ts
{
  id: "doc-uuid-fiscal-platform",
  eNCF: "E310000000001",
  status: "RECEIVED_BY_CLOUD",         // ver DocumentStatus enum abajo
  externalReference: "invoice-uuid-del-crm",
  createdAt: "2026-08-08T15:30:00Z",
  trackId: "..."                       // aparece cuando llega TRACK_ID_RECEIVED
}
```

### DocumentStatus (estados que verá el CRM)

Progresión típica del happy path:
`RECEIVED_BY_CLOUD` → `SIGNED` → `SENT_TO_DGII` → `TRACK_ID_RECEIVED` → `IN_PROCESS` → `ACCEPTED` (o `CONDITIONAL_ACCEPTED`)

Estados terminales (dejar de pollear):
`ACCEPTED`, `CONDITIONAL_ACCEPTED`, `REJECTED`, `FAILED`

Estado transitorio importante:
`CONTINGENCY_PENDING` — DGII rechazó con error transitorio; el fiscal-platform va a reintentar. Mostrar como "En reintento". Si llega a 72h sin éxito → `FAILED` con code `CONTINGENCY_DEADLINE_EXCEEDED`.

### Enums útiles (importar de shared-contracts)

- `DocumentType`: `E31`, `E32`, `E34`
- `OperationMode`: `LOCAL`, `CLOUD`
- `IntegrationMode`: `JSON`, `XML`
- `TipoPago`: `Contado=1`, `Credito=2`, `Gratuito=3`
- `TipoIngresos`: `"01"`..`"06"` (default `"01"` = ventas)
- `IndicadorFacturacion`: `NoFacturable=0`, `Itbis18=1`, `Itbis16=2`, `Itbis0=3`, `Exento=4`
- `IndicadorBienoServicio`: `Bien=1`, `Servicio=2`

---

## Variables de entorno

Agregar a `apps/api` (Railway service `api`):

| Variable | Valor típico | Notas |
| --- | --- | --- |
| `FISCAL_PLATFORM_BASE_URL` | `https://fiscal-platform.example.com` | Base URL del Cloud API. Una instancia sirve a todos los businesses. |
| `FISCAL_ENCRYPTION_KEY` | `base64(32 bytes aleatorios)` | Key para cifrar/descifrar las API keys de fiscal-platform que viven en `businesses.fiscal_platform_api_key_encrypted`. Generar con `openssl rand -base64 32`. **Rotarla obliga a re-cifrar todas las keys guardadas.** |
| `FISCAL_PLATFORM_TIMEOUT_MS` | `30000` | Opcional, default 30s |

Actualizar `apps/api/.env.example` con estas keys.

**No** agregar `FISCAL_PLATFORM_API_KEY` — esa credencial es per-business y vive
cifrada en la DB. **No** agregar nada al `apps/web` — solo el `api` service llama
al fiscal-platform.

---

## Anti-patterns a evitar

- ❌ **No** portar `xml-builder`, `xml-signer`, `xsd-validator`, `dgii-client` al CRM. Toda esa lógica vive en fiscal-platform.
- ❌ **No** crear tabla `ncf_sequences` local — usar `GET /api/v1/ecf-sequences` del fiscal-platform.
- ❌ **No** guardar el certificado .p12 en la DB del CRM ni en Railway env vars — vive cifrado en la DB del fiscal-platform.
- ❌ **No** construir UI en el CRM para subir el certificado ni para cargar rangos NCF. El CRM es read-only sobre ambos: muestra estado y linkea al admin-portal del fiscal-platform (ver D2b).
- ❌ **No** loguear la API key descifrada. Redact en logs; nunca devolver plaintext al cliente después de guardarla — solo el `hint` (últimos 4 chars).
- ❌ **No** implementar retries de envío en el CRM para 4xx del fiscal-platform — solo 5xx/network. Los 4xx indican bugs del mapper o config inválida; retryar los enmascara.
- ❌ **No** revertir `invoice.status` a `draft` cuando el envío falla — el operador maneja errores desde `<FiscalStatusCard>`. Revertir esconde el problema y crea confusión sobre qué se emitió.
- ❌ **No** implementar webhook receiver todavía — el fiscal-platform no los emite. Cuando los agregue, migrar de polling a webhook es trivial.
- ❌ **No** hard-codear el mapeo `documentType`, `tipoPago`, etc. — usar el enum importado de shared-contracts.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Mapper produce payload inválido → 400/422 en cada emisión | Tests unitarios del mapper con snapshots. Correr contra TestECF end-to-end antes de habilitar `fiscal_enabled` en producción. |
| Contratos de fiscal-platform cambian sin aviso | Versión de `@fiscal-platform/shared-contracts` pinned en el CRM. Antes de bumpearla, correr smoke test contra TestECF. |
| Rango NCF se agota sin aviso | UI de settings muestra `percentConsumed` y `daysToExpiry`. Alerta a partir de 90% consumido o < 30 días. |
| API key filtrada en logs | Nunca loguear headers de request completos. Redact `Authorization` en el cliente HTTP. Rotación via admin endpoint del fiscal-platform. |
| DGII down por horas → todas las emisiones en `CONTINGENCY_PENDING` | El fiscal-platform lo maneja (backoff hasta 72h). CRM solo muestra el estado. Después de 24h en pendiente, sugerir al operador entrar en contingencia manual (endpoint admin del fiscal-platform). |
| Latencia percibida al emitir factura (blocking hasta que responde el Cloud) | Envío async — el hook en `changeInvoiceStatus` dispatch-ea sin await. UI polla estado en `<FiscalStatusCard>`. |

---

## Verificación end-to-end (correr en TestECF antes de producción)

Con el tenant configurado en TestECF del fiscal-platform:

1. Crear customer con RNC válido (usar RNC de prueba DGII).
2. Crear producto taxable (ITBIS 18%).
3. Crear invoice con ese customer + producto, monto pequeño (RD$100).
4. Marcar como `issued`.
5. Verificar en `fiscal_metadata.documentId` que se pobló.
6. Poll `GET /v1/invoices/:id/fiscal-status` cada 10s.
7. Esperar hasta ver `status: ACCEPTED` (segundos a minutos según latencia DGII).
8. Verificar que el eNcf se generó y coincide con el patrón `E31000000000X`.
9. Crear una invoice sin RNC en el customer → verificar que sugiere E32 y también llega a `ACCEPTED`.
10. Emitir varias facturas seguidas → verificar en `GET /v1/fiscal/sequences` que `nextNumber` avanza correctamente.
11. Simular error: revocar temporalmente la API key → verificar que el CRM muestra el error accionable.
12. Simular re-emisión con mismo `externalReference` → verificar que fiscal-platform retorna 200 (no 201) y no crea doc duplicado.

---

## Referencias

- Cloud API (server side): `~/Software/fiscal-platform/apps/cloud-api/src/documents/documents.controller.ts`
- Contratos TS: `~/Software/fiscal-platform/packages/shared-contracts/typescript/src/dtos/`
- Fases del fiscal-platform: `~/Software/fiscal-platform/CLAUDE.md` (tabla de fases)
- Documentación DGII: `~/Software/fiscal-platform/dgii-documentacion/`
- Rangos NCF de pre-cert: `~/Software/fiscal-platform/dgii-documentacion/Preguntas_Tecnicas_e_CF_Pre_Certificacion.md` (⚠️ vencimiento real es `31-12-2028`, no `31-12-2025` como dice el PDF)
- Config empírica TestECF: `~/Software/fiscal-platform/dgii-documentacion/TestECF-Empirical-Config.md`
