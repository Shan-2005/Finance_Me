// ============================================================================
// FINANCE ME - AWS DynamoDB Data Importer
// Batch imports the exported transactions JSON into AWS Lambda / DynamoDB
// ============================================================================

const fs = require('fs');
const path = require('path');

// Reads from aws-config.js if available, or environment variable
let LAMBDA_URL = process.env.LAMBDA_URL || '';

if (!LAMBDA_URL) {
  try {
    const configPath = path.join(__dirname, 'aws-config.js');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/lambdaFunctionUrl:\s*['"]([^'"]+)['"]/);
      if (match && match[1]) LAMBDA_URL = match[1];
    }
  } catch (e) {}
}

async function runImport() {
  console.log('====================================================');
  console.log('  FINANCE ME - AWS DYNAMODB DATA IMPORTER           ');
  console.log('====================================================');

  if (!LAMBDA_URL || !LAMBDA_URL.startsWith('http')) {
    console.error('❌ Error: Missing AWS Lambda Function URL!');
    console.log('👉 Please paste your Lambda Function URL into aws-config.js (lambdaFunctionUrl) or pass it as an environment variable:');
    console.log('   $env:LAMBDA_URL="https://xxxxxx.lambda-url.ap-south-1.on.aws"; node import-to-aws.js\n');
    process.exit(1);
  }

  const exportFilePath = path.join(__dirname, 'transactions_export.json');
  if (!fs.existsSync(exportFilePath)) {
    console.error(`❌ Export file not found at: ${exportFilePath}`);
    console.log('👉 Please run: node export-supabase.js first.');
    process.exit(1);
  }

  const raw = fs.readFileSync(exportFilePath, 'utf8');
  const items = JSON.parse(raw);
  console.log(`📦 Loaded ${items.length} transactions from "${exportFilePath}".`);
  console.log(`🚀 Uploading to AWS Lambda endpoint: ${LAMBDA_URL}/api/transactions\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < items.length; i++) {
    const txn = items[i];
    process.stdout.write(`⏳ [${i + 1}/${items.length}] Uploading "${txn.merchant}" (₹${txn.amount})... `);

    try {
      const res = await fetch(`${LAMBDA_URL.replace(/\/$/, '')}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': txn.user_id || 'default_user'
        },
        body: JSON.stringify(txn)
      });

      if (res.ok) {
        successCount++;
        console.log('✅ OK');
      } else {
        failCount++;
        console.log(`❌ Failed (HTTP ${res.status})`);
      }
    } catch (err) {
      failCount++;
      console.log(`❌ Error (${err.message})`);
    }
  }

  console.log('\n====================================================');
  console.log(`🎉 IMPORT COMPLETE: ${successCount} succeeded, ${failCount} failed.`);
  console.log('====================================================\n');
}

runImport();
