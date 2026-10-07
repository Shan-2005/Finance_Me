const LAMBDA_URL = 'https://hxdjitmxzpnactimvm5z5e3ebu0ootzf.lambda-url.ap-south-1.on.aws';
const USER_ID = 'efe975a6-6460-4153-b715-2bb05ef1c171';

async function testFetch() {
  const res = await fetch(`${LAMBDA_URL}/api/transactions`, {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': USER_ID
    }
  });

  console.log(`HTTP Status: ${res.status}`);
  const text = await res.text();
  console.log(`Response Body:`, text);
}

testFetch().catch(console.error);
