CREATE TABLE database_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  data_origin text NOT NULL CHECK(data_origin IN ('synthetic','live')),
  seed_version text, seed_anchor date
);
CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL CHECK(kind IN ('buyer','supplier','admin')));
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, is_demo boolean NOT NULL DEFAULT false);
CREATE TABLE memberships (
  user_id uuid REFERENCES users, organization_id uuid REFERENCES organizations,
  role text NOT NULL CHECK(role IN ('buyer','supplier','admin')), PRIMARY KEY(user_id,organization_id)
);
CREATE TABLE locations (id text PRIMARY KEY, name text NOT NULL, city text NOT NULL DEFAULT 'Ташкент');
CREATE TABLE skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, category text NOT NULL,
  brand text NOT NULL, model text NOT NULL, variant text NOT NULL,
  condition text NOT NULL DEFAULT 'new', region text NOT NULL, warranty text NOT NULL,
  unit text NOT NULL DEFAULT 'шт.',
  UNIQUE(category,brand,model,variant,condition,region,warranty)
);
CREATE TABLE warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations, location_id text NOT NULL REFERENCES locations, name text NOT NULL);
CREATE TABLE inventory_balances (
  warehouse_id uuid REFERENCES warehouses, sku_id uuid REFERENCES skus,
  on_hand integer NOT NULL DEFAULT 0 CHECK(on_hand>=0), reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),
  quarantine integer NOT NULL DEFAULT 0 CHECK(quarantine>=0), verified_at timestamptz,
  version integer NOT NULL DEFAULT 1, PRIMARY KEY(warehouse_id,sku_id), CHECK(reserved<=on_hand)
);
CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL REFERENCES organizations,
  sku_id uuid NOT NULL REFERENCES skus, warehouse_id uuid NOT NULL REFERENCES warehouses,
  current_version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
  data_origin text NOT NULL CHECK(data_origin IN ('synthetic','live'))
);
CREATE TABLE offer_versions (
  offer_id uuid REFERENCES offers, version integer NOT NULL,
  unit_price numeric(20,2) NOT NULL CHECK(unit_price>0), delivery numeric(20,2) CHECK(delivery>=0),
  fees numeric(20,2) NOT NULL DEFAULT 0 CHECK(fees>=0), min_quantity integer NOT NULL DEFAULT 1 CHECK(min_quantity>0),
  currency text NOT NULL DEFAULT 'UZS' CHECK(currency='UZS'),
  payment_terms text NOT NULL DEFAULT 'bank_transfer' CHECK(payment_terms='bank_transfer'),
  price_basis text NOT NULL DEFAULT 'seller_final' CHECK(price_basis='seller_final'),
  delivery_days integer NOT NULL DEFAULT 1 CHECK(delivery_days>=0),
  last_verified_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
  PRIMARY KEY(offer_id,version), CHECK(valid_until>last_verified_at)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid NOT NULL REFERENCES organizations,
  supplier_id uuid NOT NULL REFERENCES organizations, sku_id uuid NOT NULL REFERENCES skus,
  warehouse_id uuid NOT NULL REFERENCES warehouses, offer_id uuid NOT NULL REFERENCES offers,
  status text NOT NULL CHECK(status IN ('REQUESTED','QUOTED','RESERVED','SHIPPED','COMPLETED','CANCELLED','EXPIRED','DISPUTED','REJECTED')),
  quantity integer NOT NULL CHECK(quantity>0), snapshot jsonb NOT NULL,
  baseline_snapshot jsonb, quote jsonb, quote_version integer NOT NULL DEFAULT 0,
  quote_expires_at timestamptz, accepted_quote_version integer, version integer NOT NULL DEFAULT 1,
  data_origin text NOT NULL CHECK(data_origin IN ('synthetic','live')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_parties ON orders(buyer_id,supplier_id);
CREATE TABLE reservations (
  order_id uuid PRIMARY KEY REFERENCES orders, warehouse_id uuid NOT NULL REFERENCES warehouses,
  sku_id uuid NOT NULL REFERENCES skus, quantity integer NOT NULL CHECK(quantity>0),
  status text NOT NULL CHECK(status IN ('active','consumed','released','expired')),
  expires_at timestamptz NOT NULL
);
CREATE TABLE shipments (order_id uuid PRIMARY KEY REFERENCES orders, quantity integer NOT NULL CHECK(quantity>0), actor_id uuid NOT NULL REFERENCES users, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE receipts (order_id uuid PRIMARY KEY REFERENCES orders, quantity integer NOT NULL CHECK(quantity>0), actor_id uuid NOT NULL REFERENCES users, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders,
  quantity integer NOT NULL CHECK(quantity>0), resalable boolean NOT NULL, reason text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','ACCEPTED')),
  requested_by uuid NOT NULL REFERENCES users, accepted_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz
);
CREATE TABLE business_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schema_version integer NOT NULL DEFAULT 1,
  type text NOT NULL, organization_id uuid NOT NULL REFERENCES organizations,
  aggregate_id uuid NOT NULL, aggregate_version integer NOT NULL,
  sku_id uuid REFERENCES skus, warehouse_id uuid REFERENCES warehouses,
  occurred_at timestamptz NOT NULL DEFAULT now(), recorded_at timestamptz NOT NULL DEFAULT now(),
  source_type text NOT NULL, source_id text NOT NULL DEFAULT 'narxpilot', external_id text,
  verification_level text NOT NULL DEFAULT 'platform_confirmed',
  data_origin text NOT NULL CHECK(data_origin IN ('synthetic','live')), payload jsonb NOT NULL,
  UNIQUE(source_type,source_id,external_id)
);
CREATE INDEX events_sku_time ON business_events(sku_id,occurred_at,recorded_at);
CREATE INDEX events_aggregate ON business_events(aggregate_id,recorded_at);
CREATE TABLE outbox (
  event_id uuid PRIMARY KEY REFERENCES business_events, attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, last_error text
);
CREATE INDEX outbox_pending ON outbox(available_at) WHERE processed_at IS NULL;
CREATE TABLE idempotency (
  organization_id uuid NOT NULL REFERENCES organizations, operation text NOT NULL, key text NOT NULL,
  request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,operation,key)
);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users,
  organization_id uuid REFERENCES organizations, action text NOT NULL, object_id uuid,
  request_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE analytics_snapshots (
  sku_id uuid NOT NULL REFERENCES skus, scope text NOT NULL, cohort text NOT NULL,
  data_origin text NOT NULL CHECK(data_origin IN ('synthetic','live')), version bigint NOT NULL DEFAULT 1,
  as_of timestamptz NOT NULL, data_cutoff timestamptz NOT NULL,
  metric_definitions_version text NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(sku_id,scope,cohort,data_origin)
);
CREATE TABLE forecast_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku_id uuid REFERENCES skus,
  generated_at timestamptz NOT NULL DEFAULT now(), data_cutoff timestamptz NOT NULL,
  status text NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations,
  sku_id uuid NOT NULL REFERENCES skus, location_id text NOT NULL DEFAULT 'all',
  threshold numeric(20,2) CHECK(threshold>0), enabled boolean NOT NULL DEFAULT true,
  UNIQUE(organization_id,sku_id,location_id)
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations,
  delivery_key text NOT NULL, title text NOT NULL, body text NOT NULL, order_id uuid REFERENCES orders,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,delivery_key)
);
CREATE TABLE integration_connections (organization_id uuid REFERENCES organizations, provider text NOT NULL, mode text NOT NULL, state text NOT NULL, PRIMARY KEY(organization_id,provider));
CREATE TABLE rate_limits (key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL, PRIMARY KEY(key,window_start));

CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable history: append a correction event'; END $$;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON business_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_offer_versions BEFORE UPDATE OR DELETE ON offer_versions FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION enforce_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data_origin IS DISTINCT FROM (SELECT data_origin FROM database_identity WHERE singleton) THEN
    RAISE EXCEPTION 'Data origin mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER origin_events BEFORE INSERT OR UPDATE ON business_events FOR EACH ROW EXECUTE FUNCTION enforce_origin();
CREATE TRIGGER origin_orders BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION enforce_origin();
CREATE TRIGGER origin_offers BEFORE INSERT OR UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION enforce_origin();
CREATE TRIGGER origin_analytics BEFORE INSERT OR UPDATE ON analytics_snapshots FOR EACH ROW EXECUTE FUNCTION enforce_origin();
CREATE FUNCTION protect_accepted_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.accepted_quote_version IS NOT NULL AND
    (NEW.quote IS DISTINCT FROM OLD.quote OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR
     NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR
     NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.accepted_quote_version IS DISTINCT FROM OLD.accepted_quote_version) THEN
    RAISE EXCEPTION 'Accepted terms are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_accepted_terms BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_accepted_order();
