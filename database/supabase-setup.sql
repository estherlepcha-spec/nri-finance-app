-- Run this in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS nri_finance_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL DEFAULT 'default',
  key text NOT NULL,
  value jsonb,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Enable Row Level Security
ALTER TABLE nri_finance_data ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (single user app)
CREATE POLICY "Allow all" ON nri_finance_data FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE nri_finance_data;
