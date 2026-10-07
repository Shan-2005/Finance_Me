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
  console.log('Connected to phone WebView:', wsUrl);

  // Clear deleted ID blacklist on phone so none of the 7 transactions are blocked
  await evalInPhone(wsUrl, "localStorage.setItem('finance_me_deleted_ids', '[]'); if (window.deletedTxnIds) window.deletedTxnIds.clear();");

  // Reload the page on phone so it picks up fresh assets or trigger sync
  const res = await evalInPhone(wsUrl, "window.transactions.map(t => ({ id: t.id, merchant: t.merchant, amount: t.amount, type: t.type }))");
  console.log('Transactions currently rendered on phone:', res);
}

main().catch(console.error);
