export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { TaxIdRegistration, InvoiceNumber } = req.query;
  const params = new URLSearchParams();
  if (TaxIdRegistration) params.append('TaxIdRegistration', TaxIdRegistration.replace(/\D/g, ''));
  if (InvoiceNumber) params.append('InvoiceNumber', InvoiceNumber);
  const token = req.headers['x-rodonaves-token'] || '';
  const headers = { 'accept': 'application/json' };
  if (token) headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  try {
    const response = await fetch(`https://tracking-apigateway.rte.com.br/api/v1/tracking?${params.toString()}`, { headers });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { raw: await response.text() };
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
