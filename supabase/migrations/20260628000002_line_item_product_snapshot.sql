-- =====================================================================
-- Line items: snapshot product_name + description nullable
--
-- Each quotation/invoice line now carries a frozen `product_name` that
-- reflects the catalog name at the time the line was created. The free
-- `description` becomes an optional detail rendered beneath the name.
-- =====================================================================

-- ---------------------------------------------------------------------
-- quotation_items
-- ---------------------------------------------------------------------
alter table public.quotation_items
  add column product_name text;

update public.quotation_items qi
   set product_name = coalesce(p.name, qi.description)
  from public.products p
 where qi.product_id = p.id;

update public.quotation_items
   set product_name = description
 where product_name is null;

alter table public.quotation_items
  alter column product_name set not null,
  alter column description drop not null;

-- ---------------------------------------------------------------------
-- invoice_items
-- ---------------------------------------------------------------------
alter table public.invoice_items
  add column product_name text;

update public.invoice_items ii
   set product_name = coalesce(p.name, ii.description)
  from public.products p
 where ii.product_id = p.id;

update public.invoice_items
   set product_name = description
 where product_name is null;

alter table public.invoice_items
  alter column product_name set not null,
  alter column description drop not null;
