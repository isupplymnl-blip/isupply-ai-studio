-- ─────────────────────────────────────────────────────────────────────────────
-- iSupply AI Studio — Initial Schema
-- Run this in Supabase SQL Editor or via supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

-- Reference images (one row per uploaded asset)
CREATE TABLE IF NOT EXISTS reference_images (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  storage_path TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Tags associated with each reference image
CREATE TABLE IF NOT EXISTS image_tags (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id   UUID        NOT NULL REFERENCES reference_images(id) ON DELETE CASCADE,
  tag        TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_tags       ENABLE ROW LEVEL SECURITY;

-- Open policies (add auth rules later)
CREATE POLICY "allow_all_reference_images"
  ON reference_images FOR ALL USING (true);

CREATE POLICY "allow_all_image_tags"
  ON image_tags FOR ALL USING (true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_image_tags_tag      ON image_tags(tag);
CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id);
