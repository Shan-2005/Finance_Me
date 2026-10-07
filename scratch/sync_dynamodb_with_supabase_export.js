const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  DeleteCommand,
  PutCommand 
} = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

process.env.AWS_PROFILE = 'joeshan';
const REGION = 'ap-south-1';
const TABLE_NAME = 'FinanceMe_Transactions_prod';

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log(`=== Inspecting DynamoDB table: ${TABLE_NAME} ===`);
  
  // 1. Scan all existing records
  let allExisting = [];
  let lastEvaluatedKey = undefined;
  do {
    const scanRes = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey
    }));
    if (scanRes.Items) allExisting.push(...scanRes.Items);
    lastEvaluatedKey = scanRes.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Found total ${allExisting.length} existing items in DynamoDB.`);

  // 2. Read 9 authentic exported records from transactions_export.json
  const exportFile = path.join(__dirname, '..', 'transactions_export.json');
  const validData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  const validIds = new Set(validData.map(d => String(d.id)));
  console.log(`Loaded ${validData.length} authentic records from transactions_export.json.`);

  // 3. Delete any record that is NOT one of our 9 authentic records
  const toDelete = allExisting.filter(it => !validIds.has(String(it.id)));
  console.log(`Identified ${toDelete.length} stale / obsolete records to delete.`);

  for (let i = 0; i < toDelete.length; i++) {
    const item = toDelete[i];
    let retries = 5;
    while (retries > 0) {
      try {
        await docClient.send(new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            user_id: item.user_id,
            id: String(item.id)
          }
        }));
        if ((i + 1) % 25 === 0 || i === toDelete.length - 1) {
          console.log(` -> Deleted ${i + 1} / ${toDelete.length} obsolete items...`);
        }
        await sleep(150); // Paced to stay strictly under 5 WCU
        break;
      } catch (err) {
        if (err.name === 'ProvisionedThroughputExceededException') {
          console.log(`    Throttled, waiting 1s before retry (${retries} retries left)...`);
          await sleep(1000);
          retries--;
        } else {
          console.error(`Error deleting item ${item.id}:`, err.message);
          break;
        }
      }
    }
  }

  // 4. Insert or update the 9 authentic records
  console.log(`\nInserting / updating ${validData.length} authentic encrypted records into DynamoDB...`);
  for (const item of validData) {
    let retries = 5;
    while (retries > 0) {
      try {
        await docClient.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: item
        }));
        console.log(` -> Synced: [${item.id}] ${item.merchant}`);
        await sleep(200);
        break;
      } catch (err) {
        if (err.name === 'ProvisionedThroughputExceededException') {
          await sleep(1000);
          retries--;
        } else {
          throw err;
        }
      }
    }
  }

  // 5. Final verification scan
  const finalScan = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  console.log(`\n======================================================`);
  console.log(`🎉 VERIFICATION: DynamoDB now contains ${finalScan.Items.length} records.`);
  console.log(`======================================================`);
  finalScan.Items.forEach((it, idx) => {
    console.log(`   ${idx + 1}. [${it.id}] ${it.merchant} (${it.type})`);
  });
}

run().catch(console.error);
