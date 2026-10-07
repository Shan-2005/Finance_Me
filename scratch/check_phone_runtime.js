const http = require('http');

http.get('http://127.0.0.1:9223/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const targets = JSON.parse(data);
      const target = targets.find(t => t.type === 'page' || (t.title && t.title.includes('Finance')));
      if (!target) {
        console.log('Target not found:', targets);
        return;
      }
      const wsUrl = target.webSocketDebuggerUrl;
      console.log('Connecting to:', wsUrl);
      const WS = globalThis.WebSocket;
      const ws = new WS(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `JSON.stringify({
              hasAwsApi: typeof window.awsApi !== 'undefined',
              hasAwsConfig: typeof window.AWS_CONFIG !== 'undefined',
              awsEnabled: window.AWS_CONFIG ? window.AWS_CONFIG.enabled : null,
              awsEndpoint: window.AWS_CONFIG ? window.AWS_CONFIG.lambdaFunctionUrl : null,
              isEnabledFn: window.awsApi && typeof window.awsApi.isEnabled === 'function' ? window.awsApi.isEnabled() : null,
              txnsCount: typeof transactions !== 'undefined' ? transactions.length : null,
              txnIds: typeof transactions !== 'undefined' ? transactions.map(t => t.id) : []
            })`,
            returnByValue: true
          }
        }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          console.log('PHONE EVAL RESULT:', msg.result ? msg.result.result.value : msg);
          ws.close();
        }
      };

      ws.onerror = (e) => console.error('WS Error:', e);
    } catch(err) {
      console.error(err);
    }
  });
}).on('error', console.error);
