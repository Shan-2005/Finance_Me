// DEBUG endpoint — See exactly what MacroDroid sends
// https://finance-me-smoky-rho.vercel.app/api/debug-sms

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = {
    method: req.method,
    contentType: req.headers['content-type'],
    bodyType: typeof req.body,
    bodyRaw: req.body,
    queryParams: req.query,
    bodyStringified: JSON.stringify(req.body),
    allHeaders: req.headers
  };

  return res.status(200).json(payload);
};
