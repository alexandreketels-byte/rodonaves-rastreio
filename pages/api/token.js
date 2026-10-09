export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username e password obrigatórios' });
  try {
    const body = new URLSearchParams();
    body.append('auth_type', 'DEV');
    body.append('grant_type', 'password');
    body.append('username', username);
    body.append('password', password);
    const response = await fetch('https://tracking-apigateway.rte.com.br/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error_description || 'Erro ao gerar token' });
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
