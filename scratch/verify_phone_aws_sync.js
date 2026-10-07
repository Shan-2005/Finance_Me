const http = require('http');

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function evalInPhone(wsUrl, expression) {
  const WS = globalThis.WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    ws.onopen = () => {
      const msg = JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true
        }
      });
      ws.send(msg);
    };
    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      if (parsed.id === 1) {
        ws.close();
        if (parsed.result && parsed.result.result) {
          resolve(parsed.result.result.value);
        } else {
          resolve(null);
        }
      }
    };
    ws.onerror = reject;
  });
}

async function run() {
  const targets = await getTargets();
  const target = targets.find(t => t.type === 'page' || (t.url && t.url.includes('index.html')) || (t.title && t.title.includes('Finance')));
  if (!target || !target.webSocketDebuggerUrl) {
    console.error('Target not found:', targets);
    return;
  }
  const wsUrl = target.webSocketDebuggerUrl;
  console.log('Connected to phone DevTools at:', wsUrl);

  const awsStatus = await evalInPhone(wsUrl, `({
    awsConfigEnabled: window.AWS_CONFIG && window.AWS_CONFIG.enabled,
    awsEndpoint: window.AWS_CONFIG ? window.AWS_CONFIG.lambdaFunctionUrl : null,
    awsApiEnabled: typeof window.awsApi !== 'undefined' && window.awsApi.isEnabled(),
    txnsCount: transactions.length,
    txns: transactions.map(t => ({ id: t.id, merchant: t.merchant, amount: t.amount, type: t.type })),
    bankAccounts: userBankAccounts
  })`);

  console.log('\n--- Phone AWS Status & Decrypted Data ---');
  console.log('AWS Config Enabled:', awsStatus.awsConfigEnabled);
  console.log('AWS Endpoint:', awsStatus.awsEndpoint);
  console.log('AWS API Active:', awsStatus.awsApiEnabled);
  console.log('Total Decrypted Transactions on Phone:', awsStatus.txnsCount);
  console.log('\nTransactions:');
  awsStatus.txns.forEach((t, i) => {
    console.log(`  ${i + 1}. [${t.id}] ${t.merchant}: ₹${t.amount} (${t.type})`);
  });
  console.log('\nBank Passbook:');
  console.log(JSON.stringify(awsStatus.bankAccounts, null, 2));
}

run().catch(console.error);
