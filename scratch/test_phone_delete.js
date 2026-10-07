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
            expression: `(async () => {
              try {
                const res = await window.awsApi.deleteTransaction("8507e073-7cda-4004-a7f3-cc5b33376523");
                return { success: true, res };
              } catch (e) {
                return { success: false, error: e.message, stack: e.stack };
              }
            })()`,
            awaitPromise: true,
            returnByValue: true
          }
        }));
      };
      ws.onmessage = msg => {
        const parsed = JSON.parse(msg.data);
        console.log('Result from phone calling deleteTransaction:', JSON.stringify(parsed, null, 2));
        ws.close();
      };
      ws.onerror = (e) => console.error('WS Error:', e);
    } catch(e) {
      console.error(e);
    }
  });
}).on('error', console.error);
