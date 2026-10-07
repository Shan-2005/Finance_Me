const http = require('http');

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)[0].webSocketDebuggerUrl));
    }).on('error', reject);
  });
}

async function evalInPhone(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          ws.close();
          if (msg.result && msg.result.result) {
            resolve(msg.result.result.value);
          } else {
            resolve(msg);
          }
        }
      } catch (e) {
        ws.close();
        reject(e);
      }
    };
    ws.onerror = (err) => {
      reject(err);
    };
  });
}

async function main() {
  const wsUrl = await getWsUrl();
  console.log('Connected to Phone DevTools:', wsUrl);

  // Trigger sync from Supabase
  await evalInPhone(wsUrl, 'fetchTransactionsFromSupabase()');

  // Wait 1.5 seconds for decrypt and sync
  await new Promise(r => setTimeout(r, 1500));

  const state = await evalInPhone(wsUrl, `
    JSON.stringify({
      count: transactions.length,
      txns: transactions.map(t => ({ merchant: t.merchant, amount: t.amount, type: t.type })),
      bankAccounts: userBankAccounts,
      totalBankBalanceDisplay: document.getElementById('totalBankBalance') ? document.getElementById('totalBankBalance').innerText : 'N/A'
    })
  `);

  console.log('\n=== LIVE PHONE STATE ===');
  console.log(JSON.stringify(JSON.parse(state), null, 2));
}

main().catch(console.error);
