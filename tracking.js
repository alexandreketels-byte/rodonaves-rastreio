// pages/api/tracking.js
// Este arquivo roda no SERVIDOR — sem CORS!

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { TaxIdRegistration, InvoiceNumber, InvoiceKey, ProtocolNumber, CTeNumber } = req.query;

  const params = new URLSearchParams();
  if (TaxIdRegistration) params.append('TaxIdRegistration', TaxIdRegistration.replace(/\D/g, ''));
  if (InvoiceNumber)     params.append('InvoiceNumber', InvoiceNumber);
  if (InvoiceKey)        params.append('InvoiceKey', InvoiceKey);
  if (ProtocolNumber)    params.append('ProtocolNumber', ProtocolNumber);
  if (CTeNumber)         params.append('CTeNumber', CTeNumber);

  const token = req.headers['x-rodonaves-token'] || '';

  const headers = {
    'accept': 'application/json',
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  try {
    const response = await fetch(
      `https://tracking-apigateway.rte.com.br/api/v1/tracking?${params.toString()}`,
      { headers }
    );

    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { raw: text };
    }

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
