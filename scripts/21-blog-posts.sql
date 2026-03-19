-- ============================================================================
-- Migration 21: Blog Posts Table
-- AI-generated SEO blog posts stored per tenant, served via public API
-- ============================================================================

CREATE TABLE IF NOT EXISTS blog_posts (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  excerpt         TEXT,
  content         TEXT NOT NULL,        -- HTML content
  category        TEXT,
  published_at    TIMESTAMPTZ,
  reading_time    INTEGER DEFAULT 5,    -- minutes
  meta_description TEXT,
  seo_keyword     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  ai_generated    BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, slug)
);

-- Composite indexes with tenant_id first (per CLAUDE.md convention)
CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_status ON blog_posts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_published ON blog_posts(tenant_id, published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_keyword ON blog_posts(tenant_id, seo_keyword);

-- Enable RLS
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy (service role bypasses, scoped client enforces)
CREATE POLICY tenant_isolation ON blog_posts
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);

-- Public read policy for published posts (no auth needed — used by embed widgets)
CREATE POLICY public_read_published ON blog_posts
  FOR SELECT
  USING (status = 'published');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_blog_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_blog_posts_updated_at();
