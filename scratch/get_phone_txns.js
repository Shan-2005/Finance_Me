const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const wsUrl = list[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: 'JSON.stringify({ net: document.getElementById("dashNetCashFlow")?.innerText, received: document.getElementById("dashIncome")?.innerText, paid: document.getElementById("dashExpenses")?.innerText, count: transactions.length })',
          returnByValue: true
        }
      }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      console.log('Transactions on phone:');
      console.log(JSON.stringify(msg.result.result.value, null, 2));
      process.exit(0);
    };
  });
});
