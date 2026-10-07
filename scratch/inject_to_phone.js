const fs = require('fs');
const http = require('http');

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          if (list && list.length > 0 && list[0].webSocketDebuggerUrl) {
            resolve(list[0].webSocketDebuggerUrl);
          } else {
            reject(new Error('No pages found'));
          }
        } catch (e) { reject(e); }
      });
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
  console.log('Connected to Phone WebView:', wsUrl);

  // Read updated app.js
  const appJs = fs.readFileSync('app.js', 'utf8');

  // Inject into phone
  console.log('Injecting updated app.js into phone WebView...');
  await evalInPhone(wsUrl, `
    try {
      ${appJs}
      console.log('✅ Successfully hot-reloaded updated app.js in phone!');
      fetchTransactionsFromSupabase();
      initSupabaseRealtime();
    } catch(err) {
      console.error('Error during hot-reload:', err);
    }
  `);

  // Verify
  const txns = await evalInPhone(wsUrl, 'transactions.map(t => ({ id: t.id, merchant: t.merchant, amount: t.amount, type: t.type }))');
  console.log('\n=== TRANSACTIONS ACTIVE ON PHONE ===');
  console.log(JSON.stringify(txns, null, 2));

  // Check UI totals rendered
  const totalReceived = await evalInPhone(wsUrl, "document.getElementById('totalReceived') ? document.getElementById('totalReceived').innerText : 'N/A'");
  const totalPaid = await evalInPhone(wsUrl, "document.getElementById('totalPaid') ? document.getElementById('totalPaid').innerText : 'N/A'");
  const netCashFlow = await evalInPhone(wsUrl, "document.getElementById('netCashFlow') ? document.getElementById('netCashFlow').innerText : 'N/A'");

  console.log('\n=== RENDERED METRICS ON PHONE ===');
  console.log('Total Received:', totalReceived);
  console.log('Total Paid:', totalPaid);
  console.log('Net Cash Flow:', netCashFlow);
}

main().catch(console.error);
