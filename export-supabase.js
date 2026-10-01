// ============================================================================
// FINANCE ME - Supabase Data Exporter
// Fetches all transactions and balance snapshots from Supabase and saves to JSON
// ============================================================================

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qtejgfhuzquifcobdvfo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';

async function fetchAllTableData(tableName) {
  console.log(`\n⏳ Fetching records from Supabase table: "${tableName}"...`);
  
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&order=created_at.desc`;
  
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`❌ Failed to fetch from "${tableName}": HTTP ${res.status} - ${errText}`);
      return [];
    }

    const data = await res.json();
    console.log(`✅ Successfully fetched ${data.length} records from "${tableName}".`);
    return data;
  } catch (error) {
    console.error(`❌ Network error while fetching "${tableName}":`, error.message);
    return [];
  }
}

async function runExport() {
  console.log('====================================================');
  console.log('  FINANCE ME - SUPABASE TO LOCAL JSON DATA EXPORTER  ');
  console.log('====================================================');
  console.log(`Connecting to: ${SUPABASE_URL}`);

  // 1. Fetch transactions
  const transactions = await fetchAllTableData('transactions');

  // 2. Fetch balance snapshots
  const balances = await fetchAllTableData('balance_snapshots');

  // 3. Compile output package
  const exportPackage = {
    exportedAt: new Date().toISOString(),
    source: SUPABASE_URL,
    totalTransactions: transactions.length,
    totalBalances: balances.length,
    usersFound: Array.from(new Set(transactions.map(t => t.user_id).filter(Boolean))),
    summary: {
      totalIncome: transactions
        .filter(t => t.type === 'Credit' || t.category === 'Income')
        .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0),
      totalExpense: transactions
        .filter(t => t.type === 'Debit' && t.category !== 'Income')
        .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0)
    },
    data: {
      transactions,
      balances
    }
  };

  // 4. Save to disk
  const outputFile = path.join(__dirname, 'supabase_backup_data.json');
  fs.writeFileSync(outputFile, JSON.stringify(exportPackage, null, 2), 'utf-8');

  // 5. Also save clean raw transactions array for direct DynamoDB import
  const rawTxnFile = path.join(__dirname, 'transactions_export.json');
  fs.writeFileSync(rawTxnFile, JSON.stringify(transactions, null, 2), 'utf-8');

  console.log('\n====================================================');
  console.log('🎉 EXPORT COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
  console.log(`📁 Full Export File:     ${outputFile}`);
  console.log(`📁 Transactions Only:    ${rawTxnFile}`);
  console.log(`📊 Total Transactions:   ${exportPackage.totalTransactions}`);
  console.log(`💰 Total Recorded Income:  ₹${exportPackage.summary.totalIncome.toLocaleString('en-IN')}`);
  console.log(`💸 Total Recorded Expense: ₹${exportPackage.summary.totalExpense.toLocaleString('en-IN')}`);
  console.log(`👥 Unique User IDs Found: ${exportPackage.usersFound.length}`);
  console.log('====================================================\n');
}

runExport();
