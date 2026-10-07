const { execSync } = require('child_process');
const http = require('http');

const ADB = 'C:\\Users\\areoj\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';

async function main() {
  try {
    const unixSockets = execSync(`"${ADB}" shell "cat /proc/net/unix | grep webview"`, { encoding: 'utf8' });
    console.log('Unix Sockets:', unixSockets.trim());
    const match = unixSockets.match(/webview_devtools_remote_(\d+)/);
    if (!match) {
      console.error('No webview socket found');
      return;
    }
    const pid = match[1];
    console.log('Found webview pid:', pid);
    execSync(`"${ADB}" forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    console.log('Forwarded tcp:9222 to localabstract:webview_devtools_remote_' + pid);
  } catch (e) {
    console.error('ADB forward error:', e.message);
  }

  http.get('http://127.0.0.1:9222/json', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const list = JSON.parse(data);
      if (!list || list.length === 0) {
        console.log('No targets found');
        return;
      }
      const wsUrl = list[0].webSocketDebuggerUrl;
      console.log('Connecting to WS:', wsUrl);
      const ws = new globalThis.WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              return JSON.stringify({
                txnsCount: transactions.length,
                txns: transactions.map(t => ({
                  id: t.id,
                  merchant: t.merchant,
                  amount: t.amount,
                  type: t.type,
                  mode: t.mode,
                  category: t.category,
                  notes: t.notes,
                  date: t.date,
                  rawText: t.rawText
                })),
                reviewQueue: typeof needsReviewTransactions !== 'undefined' ? needsReviewTransactions : [],
                bankAccounts: typeof userBankAccounts !== 'undefined' ? userBankAccounts : []
              });
            })()`,
            returnByValue: true
          }
        }));
      };
      ws.onmessage = (event) => {
        const resp = JSON.parse(event.data);
        if (resp.id === 1) {
          const val = JSON.parse(resp.result.result.value);
          console.log('\n=== LIVE PHONE STATE ===');
          console.log('Total Transactions:', val.txnsCount);
          console.log('\n--- Transactions on Phone ---');
          val.txns.forEach((t, i) => {
            console.log(`[${i+1}] ID: ${t.id} | ${t.type} ₹${t.amount} | Merchant: ${t.merchant} | Notes: ${t.notes || ''} | Raw: ${t.rawText || ''}`);
          });
          console.log('\n--- Review Queue Count:', val.reviewQueue.length);
          val.reviewQueue.forEach((q, i) => {
            console.log(`[Review ${i+1}] ${q.merchant} ₹${q.amount} | Raw: ${q.rawText || ''}`);
          });
          console.log('\n--- Bank Accounts: ---', JSON.stringify(val.bankAccounts, null, 2));
          ws.close();
        }
      };
      ws.onerror = (e) => console.error('WS error:', e);
    });
  }).on('error', (e) => console.error('HTTP error:', e.message));
}

main();
