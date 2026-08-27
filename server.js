const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SERVER_BUILD_ID = `local-${Date.now()}`;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Anti-caching headers for developer auto-updates
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Handle version API endpoint
  if (req.method === 'GET' && req.url === '/api/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ version: SERVER_BUILD_ID, timestamp: new Date().toISOString() }));
  }

  // Handle API ingestion endpoint
  if (req.method === 'POST' && req.url === '/api/ingest-notification') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { rawText, sender, timestamp } = JSON.parse(body || '{}');
        
        if (!rawText) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'rawText is required' }));
        }

        const amountRegex = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
        const merchantRegex = /(?:at|vpa|to|info|paid to|transferred to)\s+([\w\s&.\-@]+?)(?=\s+on|\s+ref|\s+upi|\s+val|\s+avl|\s+bal|\.|$)/i;
        const typeRegex = /(debited|credited|sent|received|paid)/i;

        const amountMatch = rawText.match(amountRegex);
        const merchantMatch = rawText.match(merchantRegex);
        const typeMatch = rawText.match(typeRegex);

        const parsed = {
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
          merchant: merchantMatch ? merchantMatch[1].trim() : 'Unknown Merchant',
          type: (typeMatch && /credited|received/i.test(typeMatch[1])) ? 'Credit' : 'Debit',
          timestamp: timestamp || new Date().toISOString(),
          raw: rawText,
          source: sender || 'GPay/UPI Notification'
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, parsedTransaction: parsed }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Static file serving
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/html';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err2, fallbackContent) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(fallbackContent);
          }
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Finance Me App running on http://localhost:${PORT}`);
});
