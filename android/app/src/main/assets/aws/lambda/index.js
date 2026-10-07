// ============================================================================
// FINANCE ME - AWS Lambda Unified Serverless Backend (100% Always Free Tier)
// Self-Contained: Custom Email/Password Auth + DynamoDB CRUD + SMS Ingestion
// Zero External Dependencies: Uses native Node.js 20.x/22.x crypto & @aws-sdk
// ============================================================================

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand,
  QueryCommand, 
  DeleteCommand, 
  BatchWriteCommand 
} = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TRANSACTIONS_TABLE = process.env.TRANSACTIONS_TABLE || 'FinanceMe_Transactions';
const USERS_TABLE = process.env.USERS_TABLE || 'FinanceMe_Users';
const BALANCES_TABLE = process.env.BALANCES_TABLE || 'FinanceMe_Balances';
const JWT_SECRET = process.env.JWT_SECRET || 'finance_me_super_secret_jwt_key_2026_always_free';
const APP_VERSION = process.env.APP_VERSION || 'aws-v2.1.0';

// Universal CORS Headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-KEY, X-User-Id, x-user-id',
  'Content-Type': 'application/json'
};

function formatResponse(statusCode, data) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data)
  };
}

// ----------------------------------------------------------------------------
// LIGHTWEIGHT NATIVE JWT & PASSWORD CRYPTO (ZERO EXTERNAL LIBRARIES)
// ----------------------------------------------------------------------------

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

function createJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30-day session
  }));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  if (!token) return null;
  const parts = token.replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null; // Expired
    return payload;
  } catch (e) {
    return null;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

function getAuthenticatedUserId(event) {
  const headers = event.headers || {};
  const authHeader = headers['authorization'] || headers['Authorization'];
  const tokenPayload = verifyJwt(authHeader);
  
  if (tokenPayload && tokenPayload.sub) {
    return tokenPayload.sub;
  }

  // Fallback to explicit header / query parameters (used by Android background listener)
  const explicitUid = headers['x-user-id'] || headers['X-User-Id'] || 
                      (event.queryStringParameters && (event.queryStringParameters.user_id || event.queryStringParameters.uid));
  if (explicitUid && explicitUid.trim().length > 3) {
    return explicitUid.trim();
  }

  return null;
}

// ----------------------------------------------------------------------------
// MAIN LAMBDA HANDLER ROUTER
// ----------------------------------------------------------------------------

exports.handler = async (event) => {
  const httpMethod = (event.requestContext && event.requestContext.http) 
    ? event.requestContext.http.method 
    : event.httpMethod || 'GET';

  const rawPath = (event.requestContext && event.requestContext.http)
    ? event.requestContext.http.path
    : event.path || '/';

  // Handle preflight CORS OPTIONS
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    let body = {};
    if (event.body) {
      const decodedBody = event.isBase64Encoded 
        ? Buffer.from(event.body, 'base64').toString('utf8') 
        : event.body;
      try {
        body = JSON.parse(decodedBody);
      } catch (e) {
        body = decodedBody;
      }
    }

    const queryParams = event.queryStringParameters || {};

    // ------------------------------------------------------------------------
    // ROUTE: /api/version
    // ------------------------------------------------------------------------
    if (rawPath.endsWith('/version')) {
      return formatResponse(200, {
        version: APP_VERSION,
        platform: 'AWS Lambda (Always Free Tier)',
        timestamp: new Date().toISOString()
      });
    }

    // ------------------------------------------------------------------------
    // ROUTE: /api/auth/register (Email & Password Registration)
    // ------------------------------------------------------------------------
    if (rawPath.endsWith('/auth/register') && httpMethod === 'POST') {
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';
      const name = (body.name || email.split('@')[0] || 'User').trim();

      if (!email || !password || password.length < 6) {
        return formatResponse(400, { error: 'Valid email and password (min 6 characters) required.' });
      }

      // Check if user already exists
      const existingUser = await docClient.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { email }
      }));

      if (existingUser.Item) {
        return formatResponse(400, { error: 'An account with this email already exists.' });
      }

      const { salt, hash } = hashPassword(password);
      const userId = crypto.randomUUID ? crypto.randomUUID() : 'u_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

      const newUser = {
        email,
        id: userId,
        name,
        salt,
        password_hash: hash,
        created_at: new Date().toISOString()
      };

      await docClient.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: newUser
      }));

      const token = createJwt({ sub: userId, email, name });
      return formatResponse(200, {
        success: true,
        token,
        user: { id: userId, email, name }
      });
    }

    // ------------------------------------------------------------------------
    // ROUTE: /api/auth/login (Email & Password Authentication)
    // ------------------------------------------------------------------------
    if (rawPath.endsWith('/auth/login') && httpMethod === 'POST') {
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!email || !password) {
        return formatResponse(400, { error: 'Email and password are required.' });
      }

      const userRes = await docClient.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { email }
      }));

      if (!userRes.Item) {
        return formatResponse(401, { error: 'Invalid email or password.' });
      }

      const user = userRes.Item;
      const isValid = verifyPassword(password, user.salt, user.password_hash);
      if (!isValid) {
        return formatResponse(401, { error: 'Invalid email or password.' });
      }

      const token = createJwt({ sub: user.id, email: user.email, name: user.name });
      return formatResponse(200, {
        success: true,
        token,
        user: { id: user.id, email: user.email, name: user.name }
      });
    }

    // ------------------------------------------------------------------------
    // ROUTE: /api/auth/me (Check Current User Session)
    // ------------------------------------------------------------------------
    if (rawPath.endsWith('/auth/me') && httpMethod === 'GET') {
      const headers = event.headers || {};
      const authHeader = headers['authorization'] || headers['Authorization'];
      const payload = verifyJwt(authHeader);

      if (!payload || !payload.sub) {
        return formatResponse(401, { error: 'Invalid or expired session token.' });
      }

      return formatResponse(200, {
        user: { id: payload.sub, email: payload.email, name: payload.name }
      });
    }

    // ------------------------------------------------------------------------
    // ROUTE: /api/ingest-notification (SMS / Payment Interceptor)
    // ------------------------------------------------------------------------
    if (rawPath.endsWith('/ingest-notification')) {
      return await handleIngestNotification(queryParams, body, event);
    }

    // ------------------------------------------------------------------------
    // ROUTE: /api/transactions (CRUD)
    // ------------------------------------------------------------------------
    if (rawPath.includes('/transactions')) {
      const userId = getAuthenticatedUserId(event);
      if (!userId) {
        return formatResponse(401, { error: 'Unauthorized: Missing or invalid authentication token.' });
      }

      // GET: Fetch all transactions for this user
      if (httpMethod === 'GET') {
        const queryCmd = new QueryCommand({
          TableName: TRANSACTIONS_TABLE,
          KeyConditionExpression: 'user_id = :uid',
          ExpressionAttributeValues: { ':uid': userId }
        });

        const result = await docClient.send(queryCmd);
        const items = result.Items || [];

        // Sort descending by date/created_at
        items.sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0));
        return formatResponse(200, items);
      }

      // POST: Save or update transaction
      if (httpMethod === 'POST') {
        const txn = typeof body === 'object' ? body : {};
        if (!txn.id) {
          txn.id = crypto.randomUUID ? crypto.randomUUID() : 'tx_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
        }
        txn.user_id = userId;
        if (!txn.created_at) txn.created_at = new Date().toISOString();

        await docClient.send(new PutCommand({
          TableName: TRANSACTIONS_TABLE,
          Item: txn
        }));

        return formatResponse(200, { success: true, item: txn });
      }

      // DELETE: Delete single transaction or all
      if (httpMethod === 'DELETE') {
        const txnId = queryParams.id || (typeof body === 'object' && body.id);

        if (txnId) {
          await docClient.send(new DeleteCommand({
            TableName: TRANSACTIONS_TABLE,
            Key: {
              user_id: userId,
              id: String(txnId)
            }
          }));
          return formatResponse(200, { success: true, deletedId: txnId });
        }

        // Clear all transactions for user
        if (queryParams.clear_all === 'true' || (typeof body === 'object' && body.clear_all)) {
          const listCmd = new QueryCommand({
            TableName: TRANSACTIONS_TABLE,
            KeyConditionExpression: 'user_id = :uid',
            ExpressionAttributeValues: { ':uid': userId },
            ProjectionExpression: 'user_id, id'
          });
          const existing = await docClient.send(listCmd);
          const items = existing.Items || [];

          for (let i = 0; i < items.length; i += 25) {
            const batch = items.slice(i, i + 25).map(item => ({
              DeleteRequest: {
                Key: { user_id: item.user_id, id: item.id }
              }
            }));
            await docClient.send(new BatchWriteCommand({
              RequestItems: { [TRANSACTIONS_TABLE]: batch }
            }));
          }

          return formatResponse(200, { success: true, count: items.length });
        }

        return formatResponse(400, { error: 'Missing transaction id to delete' });
      }
    }

    return formatResponse(404, { error: 'Not Found', path: rawPath });

  } catch (error) {
    console.error('[Lambda Error]:', error);
    return formatResponse(500, { error: error.message || 'Internal Server Error' });
  }
};

// ----------------------------------------------------------------------------
// NOTIFICATION INGESTION LOGIC (Multi-Pass Regex & Deduplication Engine)
// ----------------------------------------------------------------------------
async function handleIngestNotification(queryParams, body, event) {
  let rawText = '';

  if (queryParams) {
    rawText = queryParams.sms || queryParams.rawText || queryParams.text || queryParams.message || queryParams.body || '';
  }

  if (!rawText || rawText.trim().length < 3) {
    if (typeof body === 'string' && body.trim().length > 0) {
      rawText = body;
    } else if (body && typeof body === 'object' && !Array.isArray(body)) {
      rawText = body.rawText || body.notificationText || body.text || body.message ||
                body.sms_body || body.sms_message || body.body || body.sms ||
                body.content || body.data || '';
      if (!rawText) {
        const vals = Object.values(body).filter(v => typeof v === 'string' && v.trim().length > 3);
        if (vals.length > 0) rawText = vals.join(' ');
      }
    }
  }

  // Sanitizer
  if (typeof rawText === 'string' && (rawText.trim().startsWith('{') || rawText.includes('"sms":') || rawText.includes('"text":'))) {
    const jsonMatch = rawText.match(/"(?:sms|text|message|sms_body|rawText|content)"\s*:\s*"([\s\S]*?)"(?:\s*\}|\s*,)/i);
    if (jsonMatch && jsonMatch[1]) {
      rawText = jsonMatch[1];
    } else {
      rawText = rawText.replace(/^\s*\{\s*"(?:sms|text|message)"\s*:\s*"?/i, '').replace(/["\}]*\s*$/g, '');
    }
  }

  // Reject WhatsApp and messaging chat noise immediately
  let senderApp = '';
  if (body && typeof body === 'object') senderApp = String(body.sender || '').toLowerCase();
  if (senderApp.includes('whatsapp') || senderApp.includes('telegram') || senderApp.includes('instagram') || senderApp.includes('facebook')) {
    return formatResponse(200, {
      success: false,
      error: 'IGNORED_CHAT_APP',
      message: 'WhatsApp and social chat notifications are filtered out to prevent clutter.'
    });
  }

  // Reject placeholder macros
  const isPlaceholder = /^[\{\[\(]\s*(sms_body|sms_message|not_text|notification_text|sms_number|not_title)\s*[\}\]\)]$/i.test(rawText.trim()) ||
                        /^(?:\[|\{)?sms_body(?:\]|\})?$/i.test(rawText.trim()) ||
                        /^(?:\[|\{)?not_text(?:\]|\})?$/i.test(rawText.trim());

  if (isPlaceholder || !rawText || rawText.trim().length < 3) {
    return formatResponse(200, {
      success: false,
      error: 'MACRODROID_UNEXPANDED_VARIABLE',
      tip: 'In MacroDroid HTTP configuration, use the Magic Text button (...) to select "SMS Body" or "Notification Text".'
    });
  }

  // Clean multiline newlines into single spaces and strip phone numbers like +91 73052 71712
  const cleanText = rawText
    .replace(/\+91[\s-]?\d{4,5}[\s-]?\d{4,5}/g, '')
    .replace(/\+91[\s-]?\d+/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Multi-pass Amount Extraction
  const rsPrefixRegex = /(?:₹|rs\.?|re\.?|rupee|rupees|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const rsSuffixRegex = /([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|re\.?|rupee|rupees|inr)\b/i;
  const beforeKwRegex = /([\d,]+(?:\.\d{1,2})?)\s+(?:debited|credited|sent|paid|spent|deducted)/i;
  const afterKwRegex = /(?:debited|credited|paid|sent|spent|transferred|withdrawn)\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i;

  let amount = 0;
  let amtM;
  if ((amtM = cleanText.match(rsPrefixRegex)))   amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!amount && (amtM = cleanText.match(rsSuffixRegex))) amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!amount && (amtM = cleanText.match(beforeKwRegex))) amount = parseFloat(amtM[1].replace(/,/g, ''));
  if (!amount && (amtM = cleanText.match(afterKwRegex)))  amount = parseFloat(amtM[1].replace(/,/g, ''));

  if (!amount || isNaN(amount) || amount <= 0) {
    return formatResponse(200, {
      success: false,
      error: 'NO_TRANSACTION_AMOUNT_FOUND',
      receivedText: cleanText
    });
  }

  // Credit vs Debit
  const isDebitText = /\bsent\b|\bdebited\b|\bspent\b|\bpaid\b|\bwithdrawn\b/i.test(cleanText);
  const isCreditText = /credit alert|credited|received rs|received inr|received ₹|\bcredited to\b|\breceived\b/i.test(cleanText);

  // Strict verification: If neither debit nor credit verb is found, reject non-transactional text
  if (!isDebitText && !isCreditText) {
    return formatResponse(200, {
      success: false,
      error: 'NO_TRANSACTION_ACTION_FOUND',
      receivedText: cleanText
    });
  }
  
  let type = 'Debit';
  if (isDebitText) type = 'Debit';
  else if (isCreditText) type = 'Credit';
  const isCredit = type === 'Credit';

  // Merchant Extraction
  let merchant = 'UPI Transfer';
  if (!isCredit) {
    const p1 = cleanText.match(/\bTo\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+On\b|\s+on\b|\s+Ref\b|\s+ref\b|\s+Not\b|\s+not\b|\s+A\/C\b|\.|$)/i);
    const p2 = cleanText.match(/\bto\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,35}?)\s+via\b/i);
    const p3 = cleanText.match(/\btowards\s+([A-Za-z][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+via|\s+on|\s+ref|\.|$)/i);
    const p4 = cleanText.match(/\bat\s+([A-Za-z][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+on|\s+via|\s+ref|\.|$)/i);

    const BANK_ONLY = /^(hdfc|sbi|icici|axis|kotak|paytm|phonepe|npci|bank|a\/c|account)$/i;
    for (const m of [p1, p2, p3, p4]) {
      if (m) {
        const candidate = m[1].trim();
        if (!BANK_ONLY.test(candidate) && !/^\d+$/.test(candidate)) {
          merchant = candidate;
          break;
        }
      }
    }
  } else {
    const fromMatch = cleanText.match(/\bfrom\s+(?:VPA\s+)?([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+\(UPI|\s+Ref\b|\s+on\b|\.|$)/i);
    if (fromMatch) {
      let sender = fromMatch[1].trim();
      if (sender.includes('@')) sender = sender.split('@')[0].replace(/\d+$/, '');
      if (!/^(hdfc|sbi|icici|axis|kotak|bank|npci|system)$/i.test(sender)) {
        merchant = sender;
      }
    }
  }

  merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 36).trim();

  // Category
  let category = 'Unwanted / Leak';
  if (isCredit) {
    category = 'Income';
  } else if (/sip|mutual|zerodha|groww|invest|stocks|gold|nps/i.test(cleanText + merchant)) {
    category = 'Investments';
  } else if (/rent|loan|emi|bill|electricity|water|gas|maintenance|broadband|wifi|salary|school|college/i.test(cleanText + merchant)) {
    category = 'Unavoidable / Rent';
  }

  // Payment Mode
  let mode = 'GPay / UPI Auto-Sync';
  if (/credit card|card ending/i.test(cleanText)) mode = 'Credit Card';
  else if (/netbank|neft|rtgs|imps/i.test(cleanText)) mode = 'Net Banking';

  // IST Time (UTC + 5:30)
  const nowUTC = new Date();
  const nowIST = new Date(nowUTC.getTime() + (5.5 * 60 * 60 * 1000));
  const hh = String(nowIST.getUTCHours()).padStart(2, '0');
  const mm = String(nowIST.getUTCMinutes()).padStart(2, '0');
  const ss = String(nowIST.getUTCSeconds()).padStart(2, '0');
  const ampm = nowIST.getUTCHours() < 12 ? 'AM' : 'PM';
  const h12 = nowIST.getUTCHours() % 12 || 12;
  const timeIST = `${String(h12).padStart(2,'0')}:${mm}:${ss} ${ampm}`;

  // Bank name sanitization
  if (merchant.toLowerCase().startsWith('hdfc') || merchant.toLowerCase().startsWith('sbi') || merchant.toLowerCase().startsWith('icici') || merchant.toLowerCase().startsWith('axis')) {
    merchant = isCredit 
      ? (/salary/i.test(cleanText) ? 'Salary Credit' : `${merchant} Deposit`) 
      : `${merchant} Bank Transfer`;
  }
  merchant = merchant.replace(/\b\w/g, l => l.toUpperCase());

  // Determine User ID (from JWT, x-user-id header, or query)
  const userId = getAuthenticatedUserId(event) || 'default_user';

  const txnId = crypto.randomUUID ? crypto.randomUUID() : 'f' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

  const parsedTransaction = {
    user_id: userId,
    id: txnId,
    merchant: merchant || (isCredit ? 'Received Payment' : 'UPI Transfer'),
    amount: amount,
    type,
    category,
    mode,
    date: nowIST.toISOString(),
    created_at: nowUTC.toISOString(),
    raw_text: cleanText.substring(0, 500),
    notes: `[Auto-Captured] ${cleanText.substring(0, 200)}`
  };

  // Deduplication check (within 90s)
  try {
    const recentQuery = new QueryCommand({
      TableName: TRANSACTIONS_TABLE,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      Limit: 10
    });
    const recent = await docClient.send(recentQuery);
    const ninetySecAgo = Date.now() - 90 * 1000;

    const isDup = (recent.Items || []).some(item => {
      const itemTime = new Date(item.created_at || item.date || 0).getTime();
      return itemTime > ninetySecAgo && Math.abs(Number(item.amount) - amount) < 0.01 && item.merchant === parsedTransaction.merchant;
    });

    if (isDup) {
      return formatResponse(200, {
        success: true,
        deduplicated: true,
        message: 'Duplicate SMS detected within 90s window — skipped.',
        parsed: { merchant: parsedTransaction.merchant, amount: parsedTransaction.amount, type }
      });
    }
  } catch (dupErr) {
    console.warn('[Deduplication Warning]:', dupErr.message);
  }

  // Insert into DynamoDB
  await docClient.send(new PutCommand({
    TableName: TRANSACTIONS_TABLE,
    Item: parsedTransaction
  }));

  return formatResponse(200, {
    success: true,
    inserted: parsedTransaction,
    parsed: {
      merchant: parsedTransaction.merchant,
      amount: parsedTransaction.amount,
      type: parsedTransaction.type,
      category: parsedTransaction.category,
      time_ist: timeIST,
      raw_received: cleanText.substring(0, 100)
    }
  });
}
