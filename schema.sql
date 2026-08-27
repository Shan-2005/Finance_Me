-- ==========================================================================
-- FINANCE ME - Supabase PostgreSQL Database Schema
-- Paste and run this in the Supabase SQL Editor (https://supabase.com)
-- ==========================================================================

-- 1. Create Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  mode TEXT NOT NULL,
  date DATE NOT NULL,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  raw_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Row Level Security (RLS) & Set Permissive Policies
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON transactions;
CREATE POLICY "Allow public read access" ON transactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access" ON transactions;
CREATE POLICY "Allow public insert access" ON transactions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access" ON transactions;
CREATE POLICY "Allow public update access" ON transactions FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public delete access" ON transactions;
CREATE POLICY "Allow public delete access" ON transactions FOR DELETE USING (true);

-- ==========================================================================
-- 3. Balance Snapshots Table (Approach 2: Missed Call + Approach 4: Manual)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  amount NUMERIC(14, 2) NOT NULL,
  bank_name TEXT DEFAULT 'My Bank',
  source TEXT DEFAULT 'manual',   -- 'manual' | 'sms' | 'import'
  notes TEXT,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read balance" ON balance_snapshots;
CREATE POLICY "Allow public read balance" ON balance_snapshots FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert balance" ON balance_snapshots;
CREATE POLICY "Allow public insert balance" ON balance_snapshots FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete balance" ON balance_snapshots;
CREATE POLICY "Allow public delete balance" ON balance_snapshots FOR DELETE USING (true);
