import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import Head from "next/head";

function cleanCNPJ(cnpj = "") {
  return cnpj.replace(/\D/g, "");
}

// Feriados nacionais fixos (MM-DD)
const FERIADOS_FIXOS = [
  "01-01", // Ano Novo
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independência
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamação da República
  "11-20", // Consciência Negra
  "12-25", // Natal
];

// Páscoa pelo algoritmo de Meeus/Jones/Butcher
function calcPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

// Retorna lista de feriados do ano como strings YYYY-MM-DD
function feriadosDoAno(ano) {
  const lista = FERIADOS_FIXOS.map((f) => `${ano}-${f}`);

  const pascoa = calcPascoa(ano);
  const addDias = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const fmt = (d) => d.toISOString().slice(0, 10);

  lista.push(fmt(addDias(pascoa, -48))); // Carnaval segunda
  lista.push(fmt(addDias(pascoa, -47))); // Carnaval terça
  lista.push(fmt(addDias(pascoa, -2)));  // Sexta-feira Santa
  lista.push(fmt(pascoa));               // Páscoa
  lista.push(fmt(addDias(pascoa, 60)));  // Corpus Christi

  return lista;
}

function isFeriado(date) {
  const ano = date.getFullYear();
  const feriados = feriadosDoAno(ano);
  const str = date.toISOString().slice(0, 10);
  return feriados.includes(str);
}

function isUtil(date) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false; // domingo ou sábado
  if (isFeriado(date)) return false;
  return true;
}

// Soma N dias úteis a partir de uma data
function addDiasUteis(dataInicio, dias) {
  if (!dataInicio || !dias || dias === "—") return null;
  let d = new Date(dataInicio);
  d.setHours(0, 0, 0, 0);
  let count = 0;
  while (count < dias) {
    d.setDate(d.getDate() + 1);
    if (isUtil(d)) count++;
  }
  return d;
}

// Parseia o formato REAL da API Rodonaves
function parseResponse(data) {
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) return { lastEvent: "Sem dados", lastDate: "—", delivered: false, allEvents: [] };

  const events = item.Events || [];
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;

  const description = lastEvent?.Description || "Sem eventos";
  const date = lastEvent?.Date
    ? new Date(lastEvent.Date).toLocaleString("pt-BR")
    : "—";

  const delivered =
    description.toLowerCase().includes("entrega finalizada") ||
    description.toLowerCase().includes("entregue") ||
    description.toLowerCase().includes("delivered");

  // Data real de entrega — busca nos eventos
  const isEntregue = (desc) => {
    const d = (desc || "").toLowerCase();
    return d.includes("entrega finalizada") || d.includes("entregue") || d.includes("delivered");
  };
  const eventoEntrega = events.slice().reverse().find((ev) => isEntregue(ev.Description));
  const dataEntregaReal = eventoEntrega?.Date
    ? new Date(eventoEntrega.Date).toLocaleString("pt-BR")
    : null;
  // Also update delivered flag based on finalizada
  const deliveredFinal = events.some((ev) => isEntregue(ev.Description));

  // Previsão de entrega = EmissionDate + ExpectedDeliveryDays (dias úteis)
  const emissionRaw = item.EmissionDate ? new Date(item.EmissionDate) : null;
  const expectedDays = item.ExpectedDeliveryDays;
  const previsaoDate = addDiasUteis(emissionRaw, expectedDays);
  const previsaoFormatada = previsaoDate
    ? previsaoDate.toLocaleDateString("pt-BR")
    : "—";

  // Verificar atraso
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const atrasado = !delivered && previsaoDate && previsaoDate < hoje;

  return {
    lastEvent: description,
    lastDate: date,
    delivered,
    atrasado,
    dataEntregaReal,
    previsaoEntrega: previsaoFormatada,
    allEvents: events,
    sender: item.SenderDescription || "—",
    recipient: item.RecipientDescription || "—",
    protocol: item.ProtocolNumber || "—",
    cte: item.CTeNumber || "—",
    expectedDays: expectedDays ?? "—",
    emissionDate: emissionRaw
      ? emissionRaw.toLocaleDateString("pt-BR")
      : "—",
  };
}

function statusColor(event = "", delivered = false) {
  if (delivered) return "#00c48c";
  const s = event.toLowerCase();
  if (s.includes("entregue")) return "#00c48c";
  if (s.includes("trânsito") || s.includes("transito") || s.includes("saiu") || s.includes("transferência")) return "#f5a623";
  if (s.includes("coletado") || s.includes("colet")) return "#4a90e2";
  if (s.includes("erro") || s.includes("não encontrado") || s.includes("devolvido")) return "#e74c3c";
  return "#9b9b9b";
}

async function fetchTracking(cnpj, nf, token) {
  const params = new URLSearchParams();
  if (cnpj) params.append("TaxIdRegistration", cleanCNPJ(cnpj));
  if (nf) params.append("InvoiceNumber", String(nf).trim());

  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-rodonaves-token"] = token;

  try {
    const res = await fetch(`/api/tracking?${params.toString()}`, { headers });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, status: res.status };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default function Home() {
  const [rows, setRows] = useState([]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState(null);
  const [tokenStatus, setTokenStatus] = useState(""); // "ok" | "error" | "loading"
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [inputMode, setInputMode] = useState("csv"); // "csv" | "texto"
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef();
  const abortRef = useRef(false);

  const gerarToken = async () => {
    if (!username || !password) return null;
    setTokenStatus("loading");
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTokenStatus("error");
        return null;
      }
      const novoToken = data.access_token || data.token || data.accessToken;
      const expiry = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000);
      setToken(novoToken);
      setTokenExpiry(expiry);
      setTokenStatus("ok");
      return novoToken;
    } catch {
      setTokenStatus("error");
      return null;
    }
  };

  const getTokenValido = async () => {
    if (token && tokenExpiry && Date.now() < tokenExpiry - 60000) return token;
    return await gerarToken();
  };

  const handleFile = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: "",
      complete: (res) => {
        const mapped = res.data.map((r, i) => {
          const keys = Object.keys(r);
          const cnpjKey = keys.find((k) => k.toLowerCase().includes("cnpj"));
          const nfKey = keys.find((k) =>
            k.toLowerCase().includes("nf") ||
            k.toLowerCase().includes("nota") ||
            k.toLowerCase().includes("invoice")
          );
          return {
            id: i,
            cnpj: (cnpjKey ? r[cnpjKey] : r[keys[0]] || "").trim(),
            nf: (nfKey ? r[nfKey] : r[keys[1]] || "").trim(),
          };
        });
        setRows(mapped);
        setResults([]);
        setProgress(0);
      },
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const parsePasteText = () => {
    const linhas = pasteText.trim().split(String.fromCharCode(10));
    const mapped = [];
    let id = 0;
    for (const linha of linhas) {
      const partes = linha.trim().split(/[;,	 ]+/).map(s => s.trim()).filter(Boolean);
      if (partes.length < 2) continue;
      const cnpj = partes[0].trim();
      const nf = partes[1].trim();
      if (!cnpj || !nf) continue;
      mapped.push({ id: id++, cnpj, nf });
    }
    if (mapped.length === 0) {
      alert("Nenhum dado válido encontrado. Use o formato: CNPJ;NF (um por linha)");
      return;
    }
    setRows(mapped);
    setResults([]);
    setProgress(0);
  };

  const runRobot = useCallback(async () => {
    if (!rows.length) return;
    setRunning(true);
    abortRef.current = false;
    setResults([]);
    const out = [];

    // Gera token antes de começar
    let tkn = await getTokenValido();
    if (!tkn) {
      alert("Não foi possível gerar o token. Verifique usuário e senha.");
      setRunning(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      if (abortRef.current) break;
      const row = rows[i];
      setProgress(Math.round(((i + 1) / rows.length) * 100));

      // Renova token a cada 50 requisições
      if (i > 0 && i % 50 === 0) {
        const novo = await gerarToken();
        if (novo) tkn = novo;
      }

      const result = await fetchTracking(row.cnpj, row.nf, tkn);
      const parsed = result.ok ? parseResponse(result.data) : null;

      out.push({
        ...row,
        ok: result.ok,
        lastEvent: result.ok ? parsed.lastEvent : result.error,
        lastDate: result.ok ? parsed.lastDate : "—",
        delivered: result.ok ? parsed.delivered : false,
        atrasado: result.ok ? parsed.atrasado : false,
        previsaoEntrega: result.ok ? parsed.previsaoEntrega : "—",
        dataEntregaReal: result.ok ? parsed.dataEntregaReal : null,
        parsed,
        rawData: result.data,
        httpStatus: result.status,
      });
      setResults([...out]);
      await new Promise((r) => setTimeout(r, 400));
    }
    setRunning(false);
  }, [rows, username, password, token, tokenExpiry]);

  const exportCSV = () => {
    const header = ["CNPJ", "NF", "NF + 1", "Último Status", "Últ. Atualização", "Previsão Entrega", "Data Entrega Real", "Remetente", "Destinatário", "Prazo (dias úteis)", "Emissão", "Entregue", "Atrasado"];
    const lines = results.map((r) => [
      r.cnpj,
      r.nf,
      `1 ${r.nf}`,
      `"${(r.lastEvent || "").replace(/"/g, "'")}"`,
      r.lastDate,
      r.previsaoEntrega || "—",
      r.dataEntregaReal || "—",
      `"${(r.parsed?.sender || "").replace(/"/g, "'")}"`,
      `"${(r.parsed?.recipient || "").replace(/"/g, "'")}"`,
      r.parsed?.expectedDays ?? "—",
      r.parsed?.emissionDate ?? "—",
      r.delivered ? "SIM" : "NÃO",
      r.atrasado ? "SIM" : "NÃO",
    ]);
    const csv = [header, ...lines].map((l) => l.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rastreio_rodonaves.csv";
    a.click();
  };

  const downloadSample = () => {
    const csv = "CNPJ;NF\n12345678000195;1001\n98765432000100;2045";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo_rodonaves.csv";
    a.click();
  };

  const delivered = results.filter((r) => r.delivered).length;
  const errors = results.filter((r) => !r.ok).length;
  const inTransit = results.filter((r) => r.ok && !r.delivered).length;

  const s = {
    page: { minHeight: "100vh", background: "#0a0f1e", fontFamily: "'DM Mono', monospace", color: "#e8e8f0" },
    header: {
      background: "linear-gradient(135deg, #0d1b2a 0%, #12213b 50%, #0a1628 100%)",
      borderBottom: "1px solid #1e3a5f", padding: "24px 32px",
      display: "flex", alignItems: "center", gap: 16,
    },
    card: { background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, padding: "16px 20px", marginBottom: 20 },
    label: { fontSize: 11, color: "#f5a623", letterSpacing: "0.12em", marginBottom: 8 },
    input: {
      width: "100%", background: "#060d1a", border: "1px solid #1e3a5f",
      borderRadius: 6, color: "#e8e8f0", fontSize: 13, padding: "8px 12px",
      outline: "none", boxSizing: "border-box", fontFamily: "inherit",
    },
    th: {
      textAlign: "left", padding: "10px 14px", color: "#6b8cad",
      fontWeight: 600, fontSize: 11, letterSpacing: "0.08em",
      whiteSpace: "nowrap", borderBottom: "1px solid #1e3a5f",
    },
    td: { padding: "9px 14px" },
    btnPrimary: {
      background: "linear-gradient(135deg, #f5a623, #e8541a)", border: "none",
      borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 700,
      padding: "12px 28px", cursor: "pointer", fontFamily: "inherit",
      letterSpacing: "0.05em", boxShadow: "0 0 20px rgba(245,166,35,0.3)",
    },
    btnDisabled: {
      background: "#1e3a5f", border: "none", borderRadius: 8, color: "#4a6a8a",
      fontSize: 14, fontWeight: 700, padding: "12px 28px",
      cursor: "not-allowed", fontFamily: "inherit",
    },
    btnOutline: (color) => ({
      background: `${color}22`, border: `1px solid ${color}`,
      borderRadius: 8, color, fontSize: 14, padding: "12px 20px",
      cursor: "pointer", fontFamily: "inherit",
    }),
  };

  return (
    <>
      <Head>
        <title>Rodonaves Rastreio Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>

      <div style={s.page}>
        <div style={s.header}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: "linear-gradient(135deg, #f5a623, #e8541a)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, boxShadow: "0 0 20px rgba(245,166,35,0.35)",
          }}>🚛</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.05em", color: "#fff" }}>
              RODONAVES <span style={{ color: "#f5a623" }}>RASTREIO</span> BOT
            </div>
            <div style={{ fontSize: 11, color: "#6b8cad", letterSpacing: "0.12em" }}>IMPORTAÇÃO EM LOTE VIA CSV</div>
          </div>
        </div>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

          {/* Credenciais */}
          <div style={s.card}>
            <div style={s.label}>CREDENCIAIS RODONAVES — TOKEN AUTOMÁTICO</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 11, color: "#6b8cad", marginBottom: 4 }}>USUÁRIO</div>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Usuário Rodonaves"
                  style={s.input}
                  autoComplete="username"
                />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 11, color: "#6b8cad", marginBottom: 4 }}>SENHA</div>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha"
                  type="password"
                  style={s.input}
                  autoComplete="current-password"
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  onClick={gerarToken}
                  disabled={!username || !password || tokenStatus === "loading"}
                  style={{
                    background: tokenStatus === "ok" ? "#00c48c22" : "transparent",
                    border: `1px solid ${tokenStatus === "ok" ? "#00c48c" : tokenStatus === "error" ? "#e74c3c" : "#1e3a5f"}`,
                    borderRadius: 6, color: tokenStatus === "ok" ? "#00c48c" : tokenStatus === "error" ? "#e74c3c" : "#8aa8c8",
                    fontSize: 12, padding: "8px 16px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  }}
                >
                  {tokenStatus === "loading" ? "⏳ Gerando..." : tokenStatus === "ok" ? "✓ Token OK" : tokenStatus === "error" ? "✗ Erro" : "🔑 Testar"}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#4a6a8a", marginTop: 8 }}>
              O token é gerado e renovado automaticamente. Suas credenciais ficam só neste navegador.
            </div>
          </div>

          {/* Abas CSV / Texto */}
          <div style={{ display: "flex", gap: 0, marginBottom: 0 }}>
            {[["csv", "📂 Importar CSV"], ["texto", "📋 Colar Texto"]].map(([mode, label]) => (
              <button key={mode} onClick={() => { setInputMode(mode); setRows([]); setResults([]); }}
                style={{
                  flex: 1, padding: "10px 0", fontFamily: "inherit", fontSize: 12,
                  fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer",
                  border: "1px solid #1e3a5f",
                  borderBottom: inputMode === mode ? "none" : "1px solid #1e3a5f",
                  borderRadius: inputMode === mode ? "8px 8px 0 0" : "8px 8px 0 0",
                  background: inputMode === mode ? "#0d1b2a" : "#060d1a",
                  color: inputMode === mode ? "#f5a623" : "#6b8cad",
                  zIndex: inputMode === mode ? 1 : 0,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Painel CSV */}
          {inputMode === "csv" && (
            <div style={{
              border: "1px solid #1e3a5f", borderTop: "none",
              borderRadius: "0 0 12px 12px", marginBottom: 20, background: "#0d1b2a",
            }}>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current.click()}
                style={{
                  border: `2px dashed ${dragOver ? "#f5a623" : "#1e3a5f"}`,
                  borderRadius: 8, margin: 16, padding: "32px 24px", textAlign: "center",
                  cursor: "pointer", transition: "all 0.2s",
                  background: dragOver ? "rgba(245,166,35,0.05)" : "#060d1a",
                }}
              >
                <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
                  onChange={(e) => handleFile(e.target.files[0])} />
                <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 14, color: "#8aa8c8" }}>
                  Arraste o CSV ou <span style={{ color: "#f5a623" }}>clique para selecionar</span>
                </div>
                <div style={{ fontSize: 12, color: "#4a6a8a", marginTop: 6 }}>
                  Colunas: <code style={{ color: "#f5a623" }}>CNPJ</code> e <code style={{ color: "#f5a623" }}>NF</code> — separadas por ; ou ,
                </div>
              </div>
              <div style={{ padding: "0 16px 16px", display: "flex", gap: 12, alignItems: "center" }}>
                <button onClick={downloadSample} style={s.btnOutline("#6b8cad")}>⬇ CSV Modelo</button>
                {rows.length > 0 && (
                  <div style={{ fontSize: 12, color: "#8aa8c8" }}>
                    <span style={{ color: "#00c48c" }}>✓</span> {rows.length} registro(s) carregado(s)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Painel Colar Texto */}
          {inputMode === "texto" && (
            <div style={{
              border: "1px solid #1e3a5f", borderTop: "none",
              borderRadius: "0 0 12px 12px", marginBottom: 20, background: "#0d1b2a", padding: 16,
            }}>
              <div style={{ fontSize: 11, color: "#6b8cad", marginBottom: 8 }}>
                Cole um por linha no formato <code style={{ color: "#f5a623" }}>CNPJ;NF</code> — aceita ponto e vírgula, vírgula, espaço ou tabulação como separador
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="23209013001223;118376 | 23209013001223;117687 | 23209013001223;118232"
                style={{
                  width: "100%", height: 180, background: "#060d1a",
                  border: "1px solid #1e3a5f", borderRadius: 6,
                  color: "#e8e8f0", fontSize: 13, padding: "10px 12px",
                  outline: "none", fontFamily: "monospace", resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center" }}>
                <button
                  onClick={parsePasteText}
                  disabled={!pasteText.trim()}
                  style={{
                    ...(pasteText.trim() ? s.btnPrimary : s.btnDisabled),
                    padding: "9px 20px", fontSize: 13,
                  }}
                >
                  ✓ Carregar Dados
                </button>
                <button
                  onClick={() => { setPasteText(""); setRows([]); setResults([]); }}
                  style={{ ...s.btnOutline("#6b8cad"), padding: "9px 16px", fontSize: 13 }}
                >
                  🗑 Limpar
                </button>
                {rows.length > 0 && (
                  <div style={{ fontSize: 12, color: "#00c48c" }}>
                    ✓ {rows.length} registro(s) carregado(s)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          {rows.length > 0 && results.length === 0 && (
            <div style={{ ...s.card, marginBottom: 20 }}>
              <div style={s.label}>PREVIEW DO CSV</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>{["#", "CNPJ", "NF"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...s.td, color: "#4a6a8a" }}>{r.id + 1}</td>
                      <td style={s.td}>{r.cnpj}</td>
                      <td style={s.td}>{r.nf}</td>
                    </tr>
                  ))}
                  {rows.length > 5 && (
                    <tr><td colSpan={3} style={{ ...s.td, color: "#4a6a8a", fontStyle: "italic" }}>
                      + {rows.length - 5} mais...
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Controles */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={runRobot} disabled={running || rows.length === 0}
              style={running || rows.length === 0 ? s.btnDisabled : s.btnPrimary}>
              {running ? `⏳ PROCESSANDO... ${progress}%` : "▶ INICIAR RASTREIO"}
            </button>
            {running && (
              <button onClick={() => { abortRef.current = true; }} style={s.btnOutline("#e74c3c")}>⏹ PARAR</button>
            )}
            {results.length > 0 && !running && (
              <button onClick={exportCSV} style={s.btnOutline("#00c48c")}>⬇ EXPORTAR CSV</button>
            )}
          </div>

          {running && (
            <div style={{ background: "#1e3a5f", borderRadius: 4, height: 6, marginBottom: 20, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${progress}%`,
                background: "linear-gradient(90deg, #f5a623, #e8541a)",
                transition: "width 0.4s ease",
              }} />
            </div>
          )}

          {/* Resumo */}
          {results.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              {[
                { label: "ENTREGUES", value: delivered, color: "#00c48c" },
                { label: "EM TRÂNSITO", value: inTransit, color: "#f5a623" },
                { label: "ERROS / SEM TOKEN", value: errors, color: "#e74c3c" },
              ].map((c) => (
                <div key={c.label} style={{
                  flex: 1, minWidth: 120,
                  background: `${c.color}11`, border: `1px solid ${c.color}44`,
                  borderRadius: 10, padding: "14px 18px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 10, color: c.color, letterSpacing: "0.1em", marginTop: 2 }}>{c.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tabela */}
          {results.length > 0 && (
            <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
              <div style={{
                padding: "14px 20px", borderBottom: "1px solid #1e3a5f",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={s.label}>RESULTADOS</div>
                <div style={{ fontSize: 12, color: "#6b8cad" }}>{results.length} de {rows.length} processados</div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#060d1a" }}>
                      {["#", "CNPJ", "NF", "ÚLTIMO STATUS", "DATA/HORA", "DESTINATÁRIO", "✓", ""].map((h) => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <>
                        <tr key={`row-${r.id}`} style={{
                          borderBottom: expanded === r.id ? "none" : "1px solid #111e30",
                          background: i % 2 === 0 ? "transparent" : "#060d1a",
                        }}>
                          <td style={{ ...s.td, color: "#4a6a8a" }}>{r.id + 1}</td>
                          <td style={{ ...s.td, color: "#8aa8c8", fontFamily: "monospace" }}>{r.cnpj}</td>
                          <td style={{ ...s.td, color: "#8aa8c8", fontFamily: "monospace" }}>{r.nf}</td>
                          <td style={{ ...s.td, color: "#6b8cad", fontFamily: "monospace", whiteSpace: "nowrap" }}>1 {r.nf}</td>
                          <td style={{ ...s.td, maxWidth: 260 }}>
                            <span style={{
                              display: "inline-block",
                              background: statusColor(r.lastEvent, r.delivered) + "22",
                              color: statusColor(r.lastEvent, r.delivered),
                              border: `1px solid ${statusColor(r.lastEvent, r.delivered)}44`,
                              borderRadius: 4, padding: "2px 8px", fontSize: 11,
                              maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {r.lastEvent || "—"}
                            </span>
                          </td>
                          <td style={{ ...s.td, color: "#6b8cad", whiteSpace: "nowrap" }}>{r.lastDate}</td>
                          <td style={{ ...s.td, whiteSpace: "nowrap" }}>
                            <span style={{ color: r.atrasado ? "#e74c3c" : "#6b8cad" }}>
                              {r.previsaoEntrega || "—"}
                              {r.atrasado && <span style={{ marginLeft: 4, fontSize: 10, color: "#e74c3c" }}>⚠ ATRASADO</span>}
                            </span>
                          </td>
                          <td style={{ ...s.td, color: "#00c48c", whiteSpace: "nowrap" }}>
                            {r.dataEntregaReal || "—"}
                          </td>
                          <td style={{ ...s.td, color: "#8aa8c8", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.parsed?.recipient || "—"}
                          </td>
                          <td style={s.td}>
                            {r.ok
                              ? <span style={{ color: r.delivered ? "#00c48c" : "#f5a623", fontSize: 16 }}>
                                  {r.delivered ? "✓" : "○"}
                                </span>
                              : <span style={{ color: "#e74c3c", fontSize: 11 }}>
                                  {r.httpStatus ? `HTTP ${r.httpStatus}` : "✗"}
                                </span>
                            }
                          </td>
                          <td style={s.td}>
                            {r.ok && r.parsed?.allEvents?.length > 0 && (
                              <button
                                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                                style={{
                                  background: "transparent", border: "1px solid #1e3a5f",
                                  borderRadius: 4, color: "#8aa8c8", fontSize: 10,
                                  padding: "3px 8px", cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                {expanded === r.id ? "▲ fechar" : "▼ eventos"}
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Detalhes expandidos */}
                        {expanded === r.id && r.parsed?.allEvents && (
                          <tr key={`detail-${r.id}`} style={{ borderBottom: "1px solid #111e30" }}>
                            <td colSpan={11} style={{ padding: "0 14px 16px 14px", background: "#060d1a" }}>
                              <div style={{ padding: "12px 0 8px", fontSize: 11, color: "#f5a623", letterSpacing: "0.1em" }}>
                                HISTÓRICO COMPLETO — NF {r.nf}
                              </div>
                              {/* Info */}
                              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
                                {[
                                  ["Remetente", r.parsed.sender],
                                  ["Destinatário", r.parsed.recipient],
                                  ["Protocolo", r.parsed.protocol],
                                  ["CT-e", r.parsed.cte],
                                  ["Emissão", r.parsed.emissionDate],
                                  ["Prazo (dias úteis)", r.parsed.expectedDays !== "—" ? `${r.parsed.expectedDays} dias úteis` : "—"],
                                  ["Previsão Entrega", r.parsed.previsaoEntrega || "—"],
                                  ["Entregue em", r.parsed.dataEntregaReal || "—"],
                                ].map(([label, val]) => (
                                  <div key={label}>
                                    <div style={{ fontSize: 10, color: "#4a6a8a", marginBottom: 2 }}>{label}</div>
                                    <div style={{ fontSize: 12, color: "#8aa8c8" }}>{val}</div>
                                  </div>
                                ))}
                              </div>
                              {/* Timeline */}
                              <div style={{ borderLeft: "2px solid #1e3a5f", paddingLeft: 16 }}>
                                {r.parsed.allEvents.map((ev, ei) => (
                                  <div key={ei} style={{ marginBottom: 10, position: "relative" }}>
                                    <div style={{
                                      position: "absolute", left: -21, top: 4,
                                      width: 8, height: 8, borderRadius: "50%",
                                      background: ei === r.parsed.allEvents.length - 1 ? "#f5a623" : "#1e3a5f",
                                      border: "2px solid #060d1a",
                                    }} />
                                    <div style={{ fontSize: 10, color: "#4a6a8a" }}>
                                      {ev.Date ? new Date(ev.Date).toLocaleString("pt-BR") : "—"}
                                      {ev.EventCode && <span style={{ marginLeft: 8, color: "#2a4a6a" }}>#{ev.EventCode}</span>}
                                    </div>
                                    <div style={{ fontSize: 12, color: "#e8e8f0", marginTop: 2 }}>{ev.Description}</div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ marginTop: 32, fontSize: 11, color: "#2a4a6a", textAlign: "center" }}>
            API: tracking-apigateway.rte.com.br · SAC Rodonaves: 0800 722 6060
          </div>
        </div>
      </div>
    </>
  );
}
