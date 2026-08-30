// Vercel Serverless Endpoint to return current app version / build timestamp
// Endpoint: GET /api/version

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || `v-${Date.now()}`;

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (typeof res.status !== 'function') {
    res.status = function(code) { res.statusCode = code; return res; };
  }
  if (typeof res.json !== 'function') {
    res.json = function(data) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  }

  res.status(200).json({
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
};
