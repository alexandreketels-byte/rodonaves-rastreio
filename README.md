# 🚛 Rodonaves Rastreio Bot

Robô para rastreio em lote de mercadorias via CSV usando a API da Rodonaves.

## Como usar

1. Importe um CSV com colunas `CNPJ` e `NF`
2. Clique em "Iniciar Rastreio"
3. Exporte os resultados em CSV

### Formato do CSV de entrada
```
CNPJ;NF
12345678000195;1001
98765432000100;2045
```

## Deploy no Vercel (recomendado)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Faça upload deste projeto no GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Clique em **Deploy** — pronto!

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse: http://localhost:3000

## Autenticação

A API da Rodonaves pode exigir token. Solicite em [dev.rodonaves.com.br](https://dev.rodonaves.com.br) e cole no campo de token no app.

## Como funciona o proxy

O arquivo `pages/api/tracking.js` roda no servidor (Vercel), fazendo a chamada para a Rodonaves sem bloqueio de CORS. O front-end chama `/api/tracking` em vez da API diretamente.
