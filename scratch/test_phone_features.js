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
  console.log('Connected to Phone WebView:', wsUrl);

  // Test 1: Test determineTransactionDirection function on phone
  const test1 = await evalInPhone(wsUrl, `
    (() => {
      const msgs = [
        { text: "Dear Customer, INR 5,000.00 has been credited to your Account **1234 on 05-OCT-26 by UPI: Shansa.", expected: "Credit" },
        { text: "You have received Rs. 500.00 from John Doe (UPI Ref: 428910283910). Total Bal: Rs. 14,200.00", expected: "Credit" },
        { text: "Refund of Rs 350.00 has been processed to your A/C ending 4321 for order #9821 paid on Swiggy.", expected: "Credit" },
        { text: "Salary of Rs 85,000.00 credited to A/C XX8912 on 30-SEP-26.", expected: "Credit" },
        { text: "Cashback of Rs 25 credited into your Google Pay linked account.", expected: "Credit" },
        { text: "Shansa sent you ₹5,000 on Google Pay", expected: "Credit" },
        { text: "Sent Rs. 30.00 from HDFC Bank A/C *1009 to BLUEBERRY RESTAURANT on 05/10/26.", expected: "Debit" },
        { text: "Paid Rs. 1,200.00 to Swiggy via GPay UPI Ref 382910.", expected: "Debit" },
        { text: "Rs. 500.00 debited from A/C XX1234 on 05-OCT-26 towards UPI payment to Tea Stall.", expected: "Debit" },
        { text: "Spent Rs. 908.00 on your Credit Card ending 8812 at AMAZON INDIA.", expected: "Debit" }
      ];

      return msgs.map(m => ({
        text: m.text.substring(0, 45) + '...',
        expected: m.expected,
        actual: typeof determineTransactionDirection === 'function' ? determineTransactionDirection(m.text) : 'NOT_FOUND',
        pass: (typeof determineTransactionDirection === 'function' ? determineTransactionDirection(m.text) : null) === m.expected
      }));
    })()
  `);

  console.log('\n=== TEST 1: NOTIFICATION CLASSIFIER ON PHONE ===');
  console.table(test1);

  // Test 2: Test FinancialNotificationClassifier.readNotification on phone
  const test2 = await evalInPhone(wsUrl, `
    (() => {
      const sampleCredit = "Refund of Rs 350.00 has been processed to your A/C ending 4321 for order #9821 paid on Swiggy.";
      const res = notificationClassifier.readNotification({ text: sampleCredit, packageName: 'com.phonepe.app' });
      return {
        isFinancial: res.isFinancial,
        amount: res.parsed ? res.parsed.amount : null,
        type: res.parsed ? res.parsed.type : null,
        merchant: res.parsed ? res.parsed.merchant : null
      };
    })()
  `);
  console.log('\n=== TEST 2: AUTOMATIC NOTIFICATION PARSER OUTPUT ===');
  console.log(test2);

  // Test 3: Test Bank Balance manual setting & rendering
  const test3 = await evalInPhone(wsUrl, `
    (() => {
      // Simulate adding a bank balance
      userBankAccounts['State Bank of India_1234'] = {
        bankName: 'State Bank of India',
        accountMask: '1234',
        balance: 25000,
        lastUpdated: Date.now()
      };
      saveBankAccounts();
      renderBankPassbook();

      const totalEl = document.getElementById('totalBankBalance');
      const deckEl = document.getElementById('bankCardsDeck');
      const cardsCount = deckEl ? deckEl.querySelectorAll('.bank-account-card').length : 0;

      return {
        totalDisplay: totalEl ? totalEl.innerText : 'N/A',
        deckVisible: deckEl ? deckEl.style.display : 'N/A',
        cardsRendered: cardsCount,
        hasEditButton: deckEl ? deckEl.innerHTML.includes('fa-pen') : false,
        hasDeleteButton: deckEl ? deckEl.innerHTML.includes('fa-trash') : false
      };
    })()
  `);
  console.log('\n=== TEST 3: BANK PASSBOOK RENDERING ON PHONE ===');
  console.log(test3);
}

main().catch(console.error);
