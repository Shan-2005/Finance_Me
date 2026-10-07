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
  console.log('Connecting to WS:', wsUrl);

  const txnsRaw = await evalInPhone(wsUrl, "localStorage.getItem('finance_me_transactions')");
  const txns = JSON.parse(txnsRaw || '[]');
  console.log(`\n=== TRANSACTIONS ON PHONE (Count: ${txns.length}) ===`);
  txns.forEach((t, i) => {
    console.log(`[${i+1}] ${t.date} | ${t.type} | ${t.amount} | ${t.merchant} | Category: ${t.category} | Mode: ${t.mode} | ID: ${t.id}`);
  });

  const profile = await evalInPhone(wsUrl, "localStorage.getItem('finance_me_profile')");
  console.log('\n=== PROFILE ON PHONE ===', profile);

  const deletedIds = await evalInPhone(wsUrl, "localStorage.getItem('finance_me_deleted_ids')");
  console.log('\n=== DELETED IDS ON PHONE ===', deletedIds);

  const authSession = await evalInPhone(wsUrl, "localStorage.getItem('finance_me_auth_session')");
  console.log('\n=== AUTH SESSION ON PHONE ===', authSession);

  require('fs').writeFileSync('scratch/phone_transactions.json', JSON.stringify(txns, null, 2));
  console.log('\nSaved phone transactions to scratch/phone_transactions.json');
}

main().catch(console.error);
