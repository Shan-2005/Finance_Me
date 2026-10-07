const http = require('http');
http.get('http://127.0.0.1:9223/json', (res) => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    try {
      const targets = JSON.parse(b);
      const target = targets.find(t => t.type === 'page' || (t.title && t.title.includes('Finance')));
      if (!target) return console.log('No target');
      const WS = globalThis.WebSocket;
      const ws = new WS(target.webSocketDebuggerUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `JSON.stringify({
              authHeaders: window.awsApi ? window.awsApi.getAuthHeaders() : null,
              currentUser: typeof currentUser !== 'undefined' ? currentUser : null,
              session: window.awsApi ? window.awsApi.getSession() : null,
              deletedIds: localStorage.getItem('finance_me_deleted_ids'),
              txns: transactions.map(t => ({ id: t.id, merchant: t.merchant }))
            })`,
            returnByValue: true
          }
        }));
      };
      ws.onmessage = m => {
        console.log('Phone User Identity:', JSON.parse(m.data).result.result.value);
        ws.close();
      };
    } catch(e) {
      console.error(e);
    }
  });
});
