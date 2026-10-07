// Test script for api/ingest-notification.js using mock req/res

const ingest = require('../api/ingest-notification');

async function simulateRequest(body, query = {}) {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      headers: {
        'x-user-id': '00000000-0000-0000-0000-000000000000'
      },
      query,
      body
    };

    const res = {
      statusCode: 200,
      setHeader: () => {},
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        resolve({ code: this.statusCode, data });
      },
      end: function() {
        resolve({ code: this.statusCode, data: null });
      }
    };

    ingest(req, res).catch(err => {
      resolve({ code: 500, error: err.message });
    });
  });
}

async function runTests() {
  console.log("================ INGEST API END-TO-END TEST ================\n");

  const testCases = [
    {
      name: "1. Real Grocery Debit (HDFC Bank)",
      payload: { sms: "Sent Rs.80.00 From HDFC Bank A/C *1009 To RIDVEY SUPER MARKET On 07/10/26 Ref 130883949181" },
      expectTxn: true
    },
    {
      name: "2. Real Restaurant Debit (HDFC Bank)",
      payload: { sms: "Sent Rs.127.00 From HDFC Bank A/C *1009 To MRUDULAS HOSPITALITY SERV On 07/10/26 Ref 130863669642" },
      expectTxn: true
    },
    {
      name: "3. Real Salary / Account Credit (SBI)",
      payload: { sms: "Dear SBI User, your A/c X1009-credited by Rs.1000 on 01Oct26 transfer from Rose Isabel Dhilbhar Ref No 664030036641 -SBI" },
      expectTxn: true
    },
    {
      name: "4. OTP Security Code (Must be filtered out)",
      payload: { sms: "Your OTP for JioPay login is 394821. Valid for 10 minutes. Do not share this with anyone." },
      expectTxn: false
    },
    {
      name: "5. Promotional Loan Offer (Must be filtered out)",
      payload: { sms: "Congratulations! You have pre-approved personal loan of Rs 5,00,000 at 10.5% interest. Apply now." },
      expectTxn: false
    },
    {
      name: "6. Personal Chat Noise (Must be filtered out)",
      payload: { sms: "Hey are you free this evening? Let's catch up at 6pm" },
      expectTxn: false
    }
  ];

  for (const tc of testCases) {
    const res = await simulateRequest(tc.payload);
    console.log(`[TEST] ${tc.name}`);
    if (res.data?.success) {
      console.log(`  -> Status: SUCCESS (Transaction Inserted/Parsed)`);
      console.log(`  -> Parsed:`, res.data.parsed);
    } else if (res.data?.filtered) {
      console.log(`  -> Status: FILTERED OUT (${res.data.reason}) | Conf: ${((res.data.confidence || 0) * 100).toFixed(1)}%`);
    } else {
      console.log(`  -> Status: RESPONSE:`, res.data);
    }
    console.log();
  }
}

runTests();
