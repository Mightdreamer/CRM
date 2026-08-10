-- =====================================================================
-- Fiscal integration — Phase A: businesses + invoices
--
-- Adds the columns needed for the fiscal-platform integration:
--
--   businesses (staff-only, editable via /v1/admin/businesses/:id/fiscal-provisioning):
--     * fiscal_enabled                    — master toggle
--     * fiscal_platform_tenant_id         — tenant UUID at fiscal-platform
--     * fiscal_platform_api_key_encrypted — API key ciphered with AES-256-GCM
--     * fiscal_platform_api_key_hint      — last 4 chars for UI display
--     * fiscal_provisioned_at             — first activation timestamp
--                                            (used for grandfathering — invoices
--                                             created before this date do NOT
--                                             emit e-CF; see D10)
--     * fiscal_integration_mode           — JSON | XML (only JSON supported for now)
--
--   businesses (owner-editable via /v1/settings/fiscal):
--     * fiscal_default_document_type      — E31 | E32
--     * fiscal_default_tipo_ingresos      — 01..06
--     * fiscal_trade_name                 — Emisor.nombreComercial
--     * fiscal_branch                     — Emisor.sucursal
--     * fiscal_economic_activity          — Emisor.actividadEconomica
--     * fiscal_municipality               — Emisor.municipio
--     * fiscal_province                   — Emisor.provincia
--
--   invoices:
--     * fiscal_opt_out — per-invoice override; when true this specific
--                        invoice does NOT emit e-CF even if business is
--                        fiscal-enabled (see D9)
--
-- Rationale: docs/FISCAL_INTEGRATION_PLAN.md (Fase A + D2/D8/D9/D10).
-- =====================================================================

-- ---------------------------------------------------------------------
-- businesses: staff-only provisioning columns
-- ---------------------------------------------------------------------
alter table public.businesses
  add column fiscal_enabled                    boolean     not null default false,
  add column fiscal_platform_tenant_id         text,
  add column fiscal_platform_api_key_encrypted bytea,
  add column fiscal_platform_api_key_hint      text,
  add column fiscal_provisioned_at             timestamptz,
  add column fiscal_integration_mode           text        not null default 'JSON';

-- ---------------------------------------------------------------------
-- businesses: owner-editable Emisor metadata
-- ---------------------------------------------------------------------
alter table public.businesses
  add column fiscal_default_document_type text not null default 'E31',
  add column fiscal_default_tipo_ingresos text not null default '01',
  add column fiscal_trade_name            text,
  add column fiscal_branch                text,
  add column fiscal_economic_activity     text,
  add column fiscal_municipality          text,
  add column fiscal_province              text;

-- ---------------------------------------------------------------------
-- Value constraints (defensive — app also validates via Zod)
-- ---------------------------------------------------------------------
alter table public.businesses
  add constraint businesses_fiscal_integration_mode_ck
    check (fiscal_integration_mode in ('JSON', 'XML')),
  add constraint businesses_fiscal_default_document_type_ck
    check (fiscal_default_document_type in ('E31', 'E32')),
  add constraint businesses_fiscal_default_tipo_ingresos_ck
    check (fiscal_default_tipo_ingresos in ('01','02','03','04','05','06'));

-- ---------------------------------------------------------------------
-- Coherence: cannot activate fiscal without full provisioning
-- (fiscal_enabled=true requires tenant + api key; the endpoint also
--  validates the RNC and provisioned_at timestamp).
-- ---------------------------------------------------------------------
alter table public.businesses
  add constraint businesses_fiscal_enabled_requires_provisioning_ck
    check (
      not fiscal_enabled
      or (
        fiscal_platform_tenant_id is not null
        and fiscal_platform_api_key_encrypted is not null
      )
    );

-- ---------------------------------------------------------------------
-- invoices: per-invoice fiscal opt-out
-- ---------------------------------------------------------------------
alter table public.invoices
  add column fiscal_opt_out boolean not null default false;
