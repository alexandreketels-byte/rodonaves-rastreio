import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import Head from "next/head";

function cleanCNPJ(cnpj = "") {
  return cnpj.replace(/\D/g, "");
}

function statusColor(status = "") {
  const s = status.toLowerCase();
  if (s.includes("entregue") || s.includes("delivered")) return "#00c48c";
  if (s.includes("trânsito") || s.includes("transito") || s.includes("saiu")) return "#f5a623";
  if (s.includes("coletado") || s.includes("colet")) return "#4a90e2";
  if (s.includes("erro") || s.includes("não encontrado") || s.includes("error")) return "#e74c3c";
  return "#9b9b9b";
}

function parseLastEvent(data) {
  try {
    if (!data) return "—";
    if (Array.isArray(data)) {
      const last = data[data.length - 1];
      return last?.descricao || last?.description || last?.status || JSON.stringify(last).slice(0, 100);
    }
    if (data.ocorrencias || data.occurrences) {
      const list = data.ocorrencias || data.occurrences;
      const last = Array.isArray(list) ? list[list.length - 1] : list;
      return last?.descricao || last?.description || last?.status || JSON.stringify(last).slice(0, 100);
    }
    if (data.status) return data.status;
    if (data.descricao) return data.descricao;
    if (data.raw) return data.raw.slice(0, 120);
    return JSON.stringify(data).slice(0, 120);
  } catch {
    return "—";
  }
}

function parseDate(data) {
  try {
    if (!data) return "—";
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (data.ocorrencias) list = data.ocorrencias;
    else if (data.occurrences) list = data.occurrences;
    if (!list.length) return "—";
    const last = list[list.length - 1];
    const raw = last?.dataOcorrencia || last?.date || last?.data || last?.dateTime;
    if (!raw) return "—";
    return new Date(raw).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
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
  const [token, setToken] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [rawResponse, setRawResponse] = useState(null);
  const fileRef = useRef();
  const abortRef = useRef(false);

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
            k.toLowerCase().includes("invoice") ||
            k.toLowerCase().includes("number")
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

  const runRobot = useCallback(async () => {
    if (!rows.length) return;
    setRunning(true);
    abortRef.current = false;
    setResults([]);
    const out = [];

    for (let i = 0; i < rows.length; i++) {
      if (abortRef.current) break;
      const row = rows[i];
      setProgress(Math.round(((i + 1) / rows.length) * 100));

      const result = await fetchTracking(row.cnpj, row.nf, token);
      out.push({
        ...row,
        ok: result.ok,
        lastEvent: result.ok ? parseLastEvent(result.data) : result.error,
        lastDate: result.ok ? parseDate(result.data) : "—",
        rawData: result.data,
        httpStatus: result.status,
      });
      setResults([...out]);
      await new Promise((r) => setTimeout(r, 400));
    }
    setRunning(false);
  }, [rows, token]);

  const exportCSV = () => {
    const header = ["CNPJ", "NF", "Último Status", "Data/Hora", "OK"];
    const lines = results.map((r) => [
      r.cnpj,
      r.nf,
      `"${(r.lastEvent || "").replace(/"/g, "'")}"`,
      r.lastDate,
      r.ok ? "SIM" : "NÃO",
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

  const s = {
    page: { minHeight: "100vh", background: "#0a0f1e", fontFamily: "'DM Mono', monospace", color: "#e8e8f0" },
    header: {
      background: "linear-gradient(135deg, #0d1b2a 0%, #12213b 50%, #0a1628 100%)",
      borderBottom: "1px solid #1e3a5f",
      padding: "24px 32px",
      display: "flex", alignItems: "center", gap: 16,
    },
    icon: {
      width: 44, height: 44, borderRadius: 10,
      background: "linear-gradient(135deg, #f5a623, #e8541a)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 22, boxShadow: "0 0 20px rgba(245,166,35,0.35)",
    },
    card: {
      background: "#0d1b2a", border: "1px solid #1e3a5f",
      borderRadius: 10, padding: "16px 20px", marginBottom: 20,
    },
    label: { fontSize: 11, color: "#f5a623", letterSpacing: "0.12em", marginBottom: 8 },
    input: {
      width: "100%", background: "#060d1a", border: "1px solid #1e3a5f",
      borderRadius: 6, color: "#e8e8f0", fontSize: 13, padding: "8px 12px",
      outline: "none", boxSizing: "border-box", fontFamily: "inherit",
    },
    btnPrimary: {
      background: "linear-gradient(135deg, #f5a623, #e8541a)",
      border: "none", borderRadius: 8, color: "#fff",
      fontSize: 14, fontWeight: 700, padding: "12px 28px",
      cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.05em",
      boxShadow: "0 0 20px rgba(245,166,35,0.3)",
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
    th: {
      textAlign: "left", padding: "10px 14px",
      color: "#6b8cad", fontWeight: 600, fontSize: 11,
      letterSpacing: "0.08em", whiteSpace: "nowrap",
      borderBottom: "1px solid #1e3a5f",
    },
    td: { padding: "9px 14px" },
  };

  return (
    <>
      <Head>
        <title>Rodonaves Rastreio Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>

      <div style={s.page}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.icon}>🚛</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.05em", color: "#fff" }}>
              RODONAVES <span style={{ color: "#f5a623" }}>RASTREIO</span> BOT
            </div>
            <div style={{ fontSize: 11, color: "#6b8cad", letterSpacing: "0.12em" }}>
              IMPORTAÇÃO EM LOTE VIA CSV
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

          {/* Token */}
          <div style={s.card}>
            <div style={s.label}>TOKEN DE AUTENTICAÇÃO (opcional)</div>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer eyJ... (solicite em dev.rodonaves.com.br)"
              style={s.input}
            />
            <div style={{ fontSize: 11, color: "#4a6a8a", marginTop: 6 }}>
              Sem token o bot tenta a API pública. Se retornar 401/403, é necessário credencial.
            </div>
          </div>

          {/* Upload */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current.click()}
            style={{
              border: `2px dashed ${dragOver ? "#f5a623" : "#1e3a5f"}`,
              borderRadius: 12, padding: "40px 24px", textAlign: "center",
              cursor: "pointer", marginBottom: 20, transition: "all 0.2s",
              background: dragOver ? "rgba(245,166,35,0.05)" : "#060d1a",
            }}
          >
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])} />
            <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
            <div style={{ fontSize: 14, color: "#8aa8c8" }}>
              Arraste o CSV ou <span style={{ color: "#f5a623" }}>clique para selecionar</span>
            </div>
            <div style={{ fontSize: 12, color: "#4a6a8a", marginTop: 6 }}>
              Colunas: <code style={{ color: "#f5a623" }}>CNPJ</code> e <code style={{ color: "#f5a623" }}>NF</code> — separadas por ; ou ,
            </div>
          </div>

          {/* Actions row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={downloadSample} style={s.btnOutline("#6b8cad")}>
              ⬇ CSV Modelo
            </button>
            {rows.length > 0 && (
              <div style={{ fontSize: 12, color: "#8aa8c8", padding: "7px 0" }}>
                <span style={{ color: "#00c48c" }}>✓</span> {rows.length} registro(s) — {results.length} processado(s)
              </div>
            )}
          </div>

          {/* Preview */}
          {rows.length > 0 && results.length === 0 && (
            <div style={{ ...s.card, marginBottom: 20 }}>
              <div style={s.label}>PREVIEW DO CSV</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["#", "CNPJ", "NF"].map((h) => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
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

          {/* Run controls */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              onClick={runRobot}
              disabled={running || rows.length === 0}
              style={running || rows.length === 0 ? s.btnDisabled : s.btnPrimary}
            >
              {running ? `⏳ PROCESSANDO... ${progress}%` : "▶ INICIAR RASTREIO"}
            </button>
            {running && (
              <button onClick={() => { abortRef.current = true; }} style={s.btnOutline("#e74c3c")}>
                ⏹ PARAR
              </button>
            )}
            {results.length > 0 && !running && (
              <button onClick={exportCSV} style={s.btnOutline("#00c48c")}>
                ⬇ EXPORTAR CSV
              </button>
            )}
          </div>

          {/* Progress bar */}
          {running && (
            <div style={{ background: "#1e3a5f", borderRadius: 4, height: 6, marginBottom: 24, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${progress}%`,
                background: "linear-gradient(90deg, #f5a623, #e8541a)",
                transition: "width 0.4s ease",
              }} />
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
              <div style={{
                padding: "14px 20px", borderBottom: "1px solid #1e3a5f",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={s.label}>RESULTADOS</div>
                <div style={{ fontSize: 12, color: "#6b8cad" }}>
                  ✓ {results.filter(r => r.ok).length} &nbsp; ✗ {results.filter(r => !r.ok).length}
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#060d1a" }}>
                      {["#", "CNPJ", "NF", "ÚLTIMO STATUS", "DATA/HORA", ""].map((h) => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={r.id} style={{
                        borderBottom: "1px solid #111e30",
                        background: i % 2 === 0 ? "transparent" : "#060d1a",
                      }}>
                        <td style={{ ...s.td, color: "#4a6a8a" }}>{r.id + 1}</td>
                        <td style={{ ...s.td, color: "#8aa8c8", fontFamily: "monospace" }}>{r.cnpj}</td>
                        <td style={{ ...s.td, color: "#8aa8c8", fontFamily: "monospace" }}>{r.nf}</td>
                        <td style={{ ...s.td, maxWidth: 300 }}>
                          <span style={{
                            display: "inline-block",
                            background: statusColor(r.lastEvent) + "22",
                            color: statusColor(r.lastEvent),
                            border: `1px solid ${statusColor(r.lastEvent)}44`,
                            borderRadius: 4, padding: "2px 8px", fontSize: 11,
                            maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {r.lastEvent || "—"}
                          </span>
                        </td>
                        <td style={{ ...s.td, color: "#6b8cad", whiteSpace: "nowrap" }}>{r.lastDate}</td>
                        <td style={s.td}>
                          {r.ok && r.rawData ? (
                            <button
                              onClick={() => setRawResponse(rawResponse?.id === r.id ? null : { id: r.id, data: r.rawData })}
                              style={{
                                background: "transparent", border: "1px solid #1e3a5f",
                                borderRadius: 4, color: "#8aa8c8", fontSize: 10,
                                padding: "3px 8px", cursor: "pointer", fontFamily: "inherit",
                              }}
                            >
                              {rawResponse?.id === r.id ? "▲ fechar" : "▼ detalhes"}
                            </button>
                          ) : (
                            <span style={{ color: "#e74c3c", fontSize: 11 }}>
                              {r.httpStatus ? `HTTP ${r.httpStatus}` : "✗ erro"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* JSON drawer */}
          {rawResponse && (
            <div style={{ marginTop: 12, background: "#060d1a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 16 }}>
              <div style={{ ...s.label, marginBottom: 10 }}>RESPOSTA COMPLETA — REGISTRO #{rawResponse.id + 1}</div>
              <pre style={{
                margin: 0, fontSize: 11, color: "#8aa8c8",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 300, overflow: "auto",
              }}>
                {JSON.stringify(rawResponse.data, null, 2)}
              </pre>
            </div>
          )}

          <div style={{ marginTop: 32, fontSize: 11, color: "#2a4a6a", textAlign: "center" }}>
            Proxy: /api/tracking → tracking-apigateway.rte.com.br &nbsp;·&nbsp; dev.rodonaves.com.br
          </div>
        </div>
      </div>
    </>
  );
}
