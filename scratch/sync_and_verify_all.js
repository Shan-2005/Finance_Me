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
    console.error('Target not found:', targets);
    return;
  }
  const wsUrl = target.webSocketDebuggerUrl;
  console.log('Connected to phone WebView at:', wsUrl);

  const result = await evalInPhone(wsUrl, `
    (() => {
      // 1. Check if the 30 Rs SMS is in transactions
      const has30 = transactions.some(t => t.merchant && t.merchant.includes('RIDVEY') || (t.amount == 30 && String(t.notes || '').includes('130822136517')));
      
      let captured30 = false;
      if (!has30) {
        const sms30 = "Sent Rs.30.00\\nFrom HDFC Bank A/C *1009\\nTo RIDVEY SUPER MARKET\\nOn 06/10/26\\nRef 130822136517\\nNot You?\\nCall 18002586161/SMS BLOCK UPI to 7308080808";
        window.onNotificationCaptured(sms30, 'VM-HDFCBK-T', 1791286476317);
        captured30 = true;
      }

      // 2. Ensure Bank Passbook has HDFC Bank *1009
      let hdfcAcc = userBankAccounts['HDFC Bank_1009'] || Object.values(userBankAccounts).find(a => a.accountMask === '1009');
      if (!hdfcAcc) {
        userBankAccounts['HDFC Bank_1009'] = {
          bankName: 'HDFC Bank',
          accountMask: '1009',
          balance: 4879.00,
          lastUpdated: Date.now()
        };
        saveBankAccounts();
        renderBankPassbook();
      }

      renderTransactions();
      updateMetricsAndTaxonomy();
      if (typeof renderActivityCalendarAndTimeline === 'function') {
        renderActivityCalendarAndTimeline();
      }

      return JSON.stringify({
        captured30,
        txnsCount: transactions.length,
        todayTxns: transactions.filter(t => (t.date || '').includes('2026-10-06')).map(t => ({
          id: t.id,
          merchant: t.merchant,
          amount: t.amount,
          type: t.type,
          acc: t.accountMask,
          ref: t.referenceId
        })),
        bankAccounts: userBankAccounts
      });
    })()
  `);

  console.log('PHONE EVAL RESULT:', JSON.stringify(result, null, 2));
}

run().catch(console.error);
