const http = require('http');

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9223/json', (res) => {
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
    console.error('Target not found in targets:', targets);
    return;
  }
  const wsUrl = target.webSocketDebuggerUrl;
  console.log('Connected to phone WebView at:', wsUrl);

  // 1. Purge residual user_vault_bank_accounts from phone transactions if present
  const purgeResult = await evalInPhone(wsUrl, `
    (() => {
      const beforeLen = transactions.length;
      transactions = transactions.filter(t => t && t.id !== 'user_vault_bank_accounts');
      const afterLen = transactions.length;
      if (beforeLen !== afterLen) {
        saveToLocalStorage();
        renderTransactions();
        updateMetricsAndTaxonomy();
      }
      return { beforeLen, afterLen, purged: beforeLen !== afterLen };
    })()
  `);
  console.log('Purge placeholder row result:', purgeResult);

  // 2. Read live transactions on phone
  const txns = await evalInPhone(wsUrl, `
    transactions.map(t => ({ id: t.id, merchant: t.merchant, amount: t.amount, type: t.type }))
  `);
  console.log('\n--- Live Phone Transactions (Count: ' + (txns ? txns.length : 0) + ') ---');
  if (Array.isArray(txns)) {
    txns.forEach((t, i) => {
      console.log(` ${i + 1}. [${t.id}] ${t.merchant}: ₹${t.amount} (${t.type})`);
    });
  }

  // 3. Read live bank accounts on phone
  const bankAccounts = await evalInPhone(wsUrl, `userBankAccounts`);
  console.log('\n--- Live Phone Bank Passbook ---');
  console.log(JSON.stringify(bankAccounts, null, 2));
}

run().catch(console.error);
