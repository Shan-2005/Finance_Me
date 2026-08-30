-- ==========================================================================
-- FINANCE ME - Supabase PostgreSQL Database Schema (Multi-Tenant Auth)
-- Paste and run this in the Supabase SQL Editor (https://supabase.com)
-- ==========================================================================

-- 1. Create Transactions Table with User ID FK
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  merchant TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  mode TEXT NOT NULL,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  raw_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add user_id column if table already exists without it
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='user_id') THEN
    ALTER TABLE transactions ADD COLUMN user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  END IF;
END $$;

-- Enable Row Level Security (RLS)
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Remove public access policies
DROP POLICY IF EXISTS "Allow public read access" ON transactions;
DROP POLICY IF EXISTS "Allow public insert access" ON transactions;
DROP POLICY IF EXISTS "Allow public update access" ON transactions;
DROP POLICY IF EXISTS "Allow public delete access" ON transactions;
DROP POLICY IF EXISTS "Users view own transactions" ON transactions;
DROP POLICY IF EXISTS "Users insert own transactions" ON transactions;
DROP POLICY IF EXISTS "Users update own transactions" ON transactions;
DROP POLICY IF EXISTS "Users delete own transactions" ON transactions;

-- Enforce Strict Per-User Row Level Security
CREATE POLICY "Users view own transactions" ON transactions 
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own transactions" ON transactions 
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NOT NULL);

CREATE POLICY "Users update own transactions" ON transactions 
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users delete own transactions" ON transactions 
  FOR DELETE USING (auth.uid() = user_id);

-- Create Index on user_id for high performance queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);


-- ==========================================================================
-- 2. Balance Snapshots Table (Multi-Tenant)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  amount NUMERIC(14, 2) NOT NULL,
  bank_name TEXT DEFAULT 'My Bank',
  source TEXT DEFAULT 'manual',   -- 'manual' | 'sms' | 'import'
  notes TEXT,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_snapshots' AND column_name='user_id') THEN
    ALTER TABLE balance_snapshots ADD COLUMN user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
  END IF;
END $$;

ALTER TABLE balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read balance" ON balance_snapshots;
DROP POLICY IF EXISTS "Allow public insert balance" ON balance_snapshots;
DROP POLICY IF EXISTS "Allow public delete balance" ON balance_snapshots;
DROP POLICY IF EXISTS "Users view own balances" ON balance_snapshots;
DROP POLICY IF EXISTS "Users insert own balances" ON balance_snapshots;
DROP POLICY IF EXISTS "Users delete own balances" ON balance_snapshots;

CREATE POLICY "Users view own balances" ON balance_snapshots 
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own balances" ON balance_snapshots 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own balances" ON balance_snapshots 
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_balance_snapshots_user_id ON balance_snapshots(user_id);
