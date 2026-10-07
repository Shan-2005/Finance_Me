const { execSync } = require('child_process');
const http = require('http');

const ADB = 'C:\\Users\\areoj\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';

async function main() {
  try {
    const unixSockets = execSync(`"${ADB}" shell "cat /proc/net/unix | grep webview"`, { encoding: 'utf8' });
    const match = unixSockets.match(/webview_devtools_remote_(\d+)/);
    if (!match) {
      console.error('No webview socket found');
      return;
    }
    const pid = match[1];
    execSync(`"${ADB}" forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    console.log('Forwarded tcp:9222 to pid:', pid);
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
            expression: `(async () => {
              const junkTxns = transactions.filter(t => {
                const text = ((t.notes || '') + ' ' + (t.rawText || '') + ' ' + (t.merchant || '')).toLowerCase();
                return text.includes('+91') || text.includes('halfway done') || text.includes('whatsapp') || t.id === '2b34bd89-b8ad-451a-84dd-26800cfce88d';
              });

              console.log('Found junk txns to remove:', junkTxns);
              const removed = [];

              for (const junk of junkTxns) {
                // 1. Reverse bank balance deduction
                if (typeof adjustBankBalanceForTransaction === 'function') {
                  adjustBankBalanceForTransaction(junk, true);
                }

                // 2. Remove from transactions array
                transactions = transactions.filter(t => t.id !== junk.id);

                // 3. Delete from AWS cloud
                if (window.awsApi && typeof window.awsApi.deleteTransaction === 'function') {
                  try {
                    await window.awsApi.deleteTransaction(junk.id);
                  } catch (e) {
                    console.warn('AWS delete warning:', e.message);
                  }
                }

                // 4. Record as deleted so it is never re-fetched
                let deletedIds = [];
                try {
                  deletedIds = JSON.parse(localStorage.getItem('finance_me_deleted_ids') || '[]');
                } catch(e) {}
                if (!deletedIds.includes(junk.id)) {
                  deletedIds.push(junk.id);
                  localStorage.setItem('finance_me_deleted_ids', JSON.stringify(deletedIds));
                }

                removed.push(junk);
              }

              // Save & re-render
              saveToLocalStorage();
              renderTransactions();
              updateMetricsAndTaxonomy();
              renderBankPassbook();
              if (typeof renderActivityCalendarAndTimeline === 'function') {
                renderActivityCalendarAndTimeline();
              }

              return {
                removedCount: removed.length,
                removed: removed.map(r => ({ id: r.id, merchant: r.merchant, amount: r.amount, notes: r.notes })),
                remainingCount: transactions.length,
                bankAccounts: userBankAccounts
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          }
        }));
      };
      ws.onmessage = (event) => {
        const resp = JSON.parse(event.data);
        if (resp.id === 1) {
          console.log('\n=== CLEANUP RESULT ===');
          console.log(JSON.stringify(resp.result.result.value, null, 2));
          ws.close();
        }
      };
      ws.onerror = (e) => console.error('WS error:', e);
    });
  }).on('error', (e) => console.error('HTTP error:', e.message));
}

main();
