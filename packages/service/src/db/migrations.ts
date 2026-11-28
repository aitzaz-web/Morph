// Schema changes, applied in order on start (see migrate in db.ts). Never edit one that has shipped;
// add a new entry instead. Statements are separated by a semicolon at the end of a line.

export const MIGRATIONS: string[] = [
  `CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secret_key_hash TEXT NOT NULL UNIQUE,
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE surfaces (
    tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    surface_id TEXT NOT NULL,
    manifest JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, surface_id)
  );
  CREATE TABLE page_versions (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    surface_id TEXT NOT NULL,
    end_user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    css TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX page_versions_user ON page_versions (tenant_id, surface_id, end_user_id, id);`,
];
