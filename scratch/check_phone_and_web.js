const http = require('http');

http.get('http://127.0.0.1:9223/json', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const targets = JSON.parse(d);
      const t = targets.find(x => x.type === 'page' || (x.url && x.url.includes('index.html')) || (x.title && x.title.includes('Finance')));
      if (!t) {
        console.log('No WebView page target found');
        return;
      }
      const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `JSON.stringify({
              txnsCount: typeof transactions !== 'undefined' ? transactions.length : 0,
              txns: typeof transactions !== 'undefined' ? transactions.map(x => ({ id: x.id, merchant: x.merchant, amount: x.amount, ref: x.referenceId })) : [],
              deletedIds: localStorage.getItem('finance_me_deleted_ids'),
              awsEnabled: window.AWS_CONFIG ? window.AWS_CONFIG.enabled : null
            })`,
            returnByValue: true
          }
        }));
      };
      ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.id === 1) {
          console.log('--- PHONE RUNTIME STATE ---');
          console.log(msg.result && msg.result.result ? msg.result.result.value : msg);
          ws.close();
        }
      };
      ws.onerror = err => console.error('WS Error:', err);
    } catch (e) {
      console.error(e);
    }
  });
}).on('error', console.error);
