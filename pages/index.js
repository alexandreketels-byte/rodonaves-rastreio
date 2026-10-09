import { useState, useRef, useCallback, useEffect } from "react";
import Papa from "papaparse";
import Head from "next/head";

// ── Feriados nacionais ──────────────────────────────────────────────
const FERIADOS_FIXOS = ["01-01","04-21","05-01","09-07","10-12","11-02","11-15","11-20","12-25"];
function calcPascoa(ano) {
  const a=ano%19,b=Math.floor(ano/100),c=ano%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mes=Math.floor((h+l-7*m+114)/31),dia=((h+l-7*m+114)%31)+1;
  return new Date(ano,mes-1,dia);
}
function feriadosDoAno(ano) {
  const lista = FERIADOS_FIXOS.map(f => `${ano}-${f}`);
  const p = calcPascoa(ano);
  const add = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
  const fmt = d => d.toISOString().slice(0,10);
  lista.push(fmt(add(p,-48)),fmt(add(p,-47)),fmt(add(p,-2)),fmt(p),fmt(add(p,60)));
  return lista;
}
function isUtil(date) {
  const dow = date.getDay();
  if (dow===0||dow===6) return false;
  return !feriadosDoAno(date.getFullYear()).includes(date.toISOString().slice(0,10));
}
function addDiasUteis(dataInicio, dias) {
  if (!dataInicio||!dias||dias==="—") return null;
  let d = new Date(dataInicio); d.setHours(0,0,0,0);
  let count=0;
  while(count<dias) { d.setDate(d.getDate()+1); if(isUtil(d)) count++; }
  return d;
}

// ── Parseia resposta da API Rodonaves ───────────────────────────────
function parseResponse(data) {
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) return { lastEvent:"Sem dados", lastDate:"—", delivered:false, allEvents:[] };
  const events = item.Events || [];
  const lastEv = events.length>0 ? events[events.length-1] : null;
  const description = lastEv?.Description || "Sem eventos";
  const date = lastEv?.Date ? new Date(lastEv.Date).toLocaleString("pt-BR") : "—";
  const isEntregue = desc => { const d=(desc||"").toLowerCase(); return d.includes("entrega finalizada")||d.includes("entregue")||d.includes("delivered"); };
  const delivered = isEntregue(description);
  const eventoEntrega = events.slice().reverse().find(ev=>isEntregue(ev.Description));
  const dataEntregaReal = eventoEntrega?.Date ? new Date(eventoEntrega.Date).toLocaleString("pt-BR") : null;
  // Extrai apenas YYYY-MM-DD para evitar conversão UTC→BRT (-3h) que adiantava 1 dia na previsão
  let emissionRaw = null;
  if (item.EmissionDate) {
    const p = item.EmissionDate.split('T')[0].split('-');
    emissionRaw = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  }
  const expectedDays = item.ExpectedDeliveryDays;
  const previsaoDate = addDiasUteis(emissionRaw, expectedDays);
  const previsaoFormatada = previsaoDate ? previsaoDate.toLocaleDateString("pt-BR") : "—";
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const atrasado = !delivered && previsaoDate && previsaoDate < hoje;
  return {
    lastEvent:description, lastDate:date, delivered, atrasado, dataEntregaReal,
    previsaoEntrega:previsaoFormatada, allEvents:events,
    sender:item.SenderDescription||"—", recipient:item.RecipientDescription||"—",
    protocol:item.ProtocolNumber||"—", cte:item.CTeNumber||"—",
    expectedDays:expectedDays??"—",
    emissionDate:emissionRaw?emissionRaw.toLocaleDateString("pt-BR"):"—",
  };
}

function statusColor(event="", delivered=false) {
  if (delivered) return "#00c48c";
  const s=event.toLowerCase();
  if (s.includes("entrega finalizada")||s.includes("entregue")) return "#00c48c";
  if (s.includes("trânsito")||s.includes("transito")||s.includes("saiu")||s.includes("transferência")) return "#f5a623";
  if (s.includes("coletado")||s.includes("colet")) return "#4a90e2";
  if (s.includes("erro")||s.includes("não encontrado")||s.includes("devolvido")) return "#e74c3c";
  return "#9b9b9b";
}

function cleanCNPJ(cnpj="") { return cnpj.replace(/\D/g,""); }
function fmtCNPJ(c="") {
  const d=c.replace(/\D/g,"");
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5")||c;
}

async function fetchTracking(cnpj, nf, token) {
  const params = new URLSearchParams();
  if (cnpj) params.append("TaxIdRegistration", cleanCNPJ(cnpj));
  if (nf) params.append("InvoiceNumber", String(nf).trim());
  const headers = { "Content-Type":"application/json" };
  if (token) headers["x-rodonaves-token"] = token;
  try {
    const res = await fetch(`/api/tracking?${params.toString()}`, { headers });
    const data = await res.json();
    if (!res.ok) return { ok:false, error:data?.error||`HTTP ${res.status}`, status:res.status };
    return { ok:true, data };
  } catch(e) { return { ok:false, error:e.message }; }
}

// ── Componente principal ────────────────────────────────────────────
export default function Home() {
  const ls = k => typeof window!=="undefined" ? localStorage.getItem(k) : null;
  const lsSet = (k,v) => { if(typeof window!=="undefined") localStorage.setItem(k,v); };

  const [username, setUsername] = useState(()=>ls("rodo_user")||"");
  const [password, setPassword] = useState(()=>ls("rodo_pass")||"");
  const [cnpjs, setCnpjs] = useState(()=>{
    const s=ls("rodo_cnpjs"); return s?JSON.parse(s):["23209013001223","23209013001142"];
  });
  const [selectedCnpj, setSelectedCnpj] = useState("");
  const [nfText, setNfText] = useState("");
  const [showCnpjManager, setShowCnpjManager] = useState(false);
  const [newCnpj, setNewCnpj] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");

  const [token, setToken] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState(null);
  const [tokenStatus, setTokenStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [inputMode, setInputMode] = useState("cnpj");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef();
  const abortRef = useRef(false);

  const saveCnpjs = list => { setCnpjs(list); lsSet("rodo_cnpjs", JSON.stringify(list)); };

  const gerarToken = async () => {
    if (!username||!password) return null;
    setTokenStatus("loading");
    try {
      const res = await fetch("/api/token",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username,password}) });
      const data = await res.json();
      if (!res.ok) { setTokenStatus("error"); return null; }
      const novo = data.access_token||data.token||data.accessToken;
      const exp = Date.now()+(data.expires_in?data.expires_in*1000:3600000);
      setToken(novo); setTokenExpiry(exp); setTokenStatus("ok");
      return novo;
    } catch { setTokenStatus("error"); return null; }
  };
  const getTokenValido = async () => {
    if (token&&tokenExpiry&&Date.now()<tokenExpiry-60000) return token;
    return await gerarToken();
  };

  // Gera token automaticamente ao carregar se já tiver credenciais salvas
  useEffect(() => {
    if (username && password) gerarToken();
  }, []);

  const handleFile = file => {
    if (!file) return;
    Papa.parse(file,{ header:true, skipEmptyLines:true, delimiter:"", complete:res=>{
      const mapped = res.data.map((r,i)=>{
        const keys=Object.keys(r);
        const ck=keys.find(k=>k.toLowerCase().includes("cnpj"));
        const nk=keys.find(k=>k.toLowerCase().includes("nf")||k.toLowerCase().includes("nota")||k.toLowerCase().includes("invoice"));
        return { id:i, cnpj:(ck?r[ck]:r[keys[0]]||"").trim(), nf:(nk?r[nk]:r[keys[1]]||"").trim() };
      });
      setRows(mapped); setResults([]); setProgress(0);
    }});
  };

  const parsePasteText = () => {
    const linhas = pasteText.trim().split(String.fromCharCode(10));
    const mapped=[]; let id=0;
    for(const linha of linhas){
      const partes=linha.trim().split(/[;,]+/).map(s=>s.trim()).filter(Boolean);
      if(partes.length<2) continue;
      mapped.push({id:id++,cnpj:partes[0],nf:partes[1]});
    }
    if(!mapped.length){alert("Nenhum dado válido. Use CNPJ;NF por linha.");return;}
    setRows(mapped); setResults([]); setProgress(0);
  };

  const parseNfByCnpj = () => {
    if(!selectedCnpj){alert("Selecione um CNPJ!");return;}
    const linhas=nfText.trim().split(String.fromCharCode(10));
    const mapped=[]; let id=0;
    for(const linha of linhas){
      const nf=linha.trim().replace(/\D/g,"");
      if(!nf) continue;
      mapped.push({id:id++,cnpj:selectedCnpj,nf});
    }
    if(!mapped.length){alert("Nenhuma NF válida encontrada.");return;}
    setRows(mapped); setResults([]); setProgress(0);
  };

  const runRobot = useCallback(async()=>{
    if(!rows.length) return;
    setRunning(true); abortRef.current=false; setResults([]);
    let tkn=await getTokenValido();
    if(!tkn){alert("Não foi possível gerar o token. Verifique usuário e senha.");setRunning(false);return;}
    const out=[];
    for(let i=0;i<rows.length;i++){
      if(abortRef.current) break;
      const row=rows[i];
      setProgress(Math.round(((i+1)/rows.length)*100));
      if(i>0&&i%50===0){const novo=await gerarToken();if(novo)tkn=novo;}
      const result=await fetchTracking(row.cnpj,row.nf,tkn);
      const parsed=result.ok?parseResponse(result.data):null;
      out.push({...row,ok:result.ok,lastEvent:result.ok?parsed.lastEvent:result.error,lastDate:result.ok?parsed.lastDate:"—",delivered:result.ok?parsed.delivered:false,atrasado:result.ok?parsed.atrasado:false,previsaoEntrega:result.ok?parsed.previsaoEntrega:"—",dataEntregaReal:result.ok?parsed.dataEntregaReal:null,parsed,rawData:result.data,httpStatus:result.status});
      setResults([...out]);
      await new Promise(r=>setTimeout(r,400));
    }
    setRunning(false);
  },[rows,username,password,token,tokenExpiry]);

  const exportCSV = () => {
    const header=["CNPJ","NF","NF + 1","Último Status","Últ. Atualização","Previsão Entrega","Data Entrega Real","Remetente","Destinatário","Prazo (dias úteis)","Emissão","Entregue","Atrasado"];
    const lines=results.map(r=>[r.cnpj,r.nf,`1 ${r.nf}`,`"${(r.lastEvent||"").replace(/"/g,"'")}"`,r.lastDate,r.previsaoEntrega||"—",r.dataEntregaReal||"—",`"${(r.parsed?.sender||"").replace(/"/g,"'")}"`,`"${(r.parsed?.recipient||"").replace(/"/g,"'")}"`,r.parsed?.expectedDays??"—",r.parsed?.emissionDate??"—",r.delivered?"SIM":"NÃO",r.atrasado?"SIM":"NÃO"]);
    const csv=[header,...lines].map(l=>l.join(";")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="rastreio_rodonaves.csv"; a.click();
  };

  const downloadSample = () => {
    const csv="CNPJ;NF\n23209013001223;118376\n23209013001142;117687";
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="modelo_rodonaves.csv"; a.click();
  };

  const delivered=results.filter(r=>r.delivered).length;
  const errors=results.filter(r=>!r.ok).length;
  const inTransit=results.filter(r=>r.ok&&!r.delivered).length;

  const s = {
    page:{ minHeight:"100vh", background:"#0a0f1e", fontFamily:"'DM Mono',monospace", color:"#e8e8f0" },
    card:{ background:"#0d1b2a", border:"1px solid #1e3a5f", borderRadius:10, padding:"16px 20px", marginBottom:20 },
    label:{ fontSize:11, color:"#f5a623", letterSpacing:"0.12em", marginBottom:8 },
    input:{ width:"100%", background:"#060d1a", border:"1px solid #1e3a5f", borderRadius:6, color:"#e8e8f0", fontSize:13, padding:"8px 12px", outline:"none", boxSizing:"border-box", fontFamily:"inherit" },
    th:{ textAlign:"left", padding:"10px 14px", color:"#6b8cad", fontWeight:600, fontSize:11, letterSpacing:"0.08em", whiteSpace:"nowrap", borderBottom:"1px solid #1e3a5f" },
    td:{ padding:"9px 14px" },
    btnPrimary:{ background:"linear-gradient(135deg,#f5a623,#e8541a)", border:"none", borderRadius:8, color:"#fff", fontSize:14, fontWeight:700, padding:"12px 28px", cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.05em", boxShadow:"0 0 20px rgba(245,166,35,0.3)" },
    btnDisabled:{ background:"#1e3a5f", border:"none", borderRadius:8, color:"#4a6a8a", fontSize:14, fontWeight:700, padding:"12px 28px", cursor:"not-allowed", fontFamily:"inherit" },
    btnOutline:(c)=>({ background:`${c}22`, border:`1px solid ${c}`, borderRadius:8, color:c, fontSize:14, padding:"12px 20px", cursor:"pointer", fontFamily:"inherit" }),
    tab:(active)=>({ flex:1, padding:"10px 0", fontFamily:"inherit", fontSize:12, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer", border:"1px solid #1e3a5f", borderBottom:active?"none":"1px solid #1e3a5f", borderRadius:"8px 8px 0 0", background:active?"#0d1b2a":"#060d1a", color:active?"#f5a623":"#6b8cad" }),
    panelWrap:{ border:"1px solid #1e3a5f", borderTop:"none", borderRadius:"0 0 12px 12px", marginBottom:20, background:"#0d1b2a" },
  };

  return (
    <>
      <Head>
        <title>Rodonaves Rastreio Bot</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>
      <div style={s.page}>
        {/* Header */}
        <div style={{ background:"linear-gradient(135deg,#0d1b2a,#12213b,#0a1628)", borderBottom:"1px solid #1e3a5f", padding:"24px 32px", display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ width:44,height:44,borderRadius:10,background:"linear-gradient(135deg,#f5a623,#e8541a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 0 20px rgba(245,166,35,0.35)" }}>🚛</div>
          <div>
            <div style={{ fontSize:20,fontWeight:700,letterSpacing:"0.05em",color:"#fff" }}>RODONAVES <span style={{color:"#f5a623"}}>RASTREIO</span> BOT</div>
            <div style={{ fontSize:11,color:"#6b8cad",letterSpacing:"0.12em" }}>IMPORTAÇÃO EM LOTE VIA CSV</div>
          </div>
        </div>

        <div style={{ maxWidth:1100,margin:"0 auto",padding:"32px 24px" }}>

          {/* Credenciais */}
          <div style={s.card}>
            <div style={s.label}>CREDENCIAIS RODONAVES — TOKEN AUTOMÁTICO</div>
            <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
              <div style={{ flex:1,minWidth:180 }}>
                <div style={{ fontSize:11,color:"#6b8cad",marginBottom:4 }}>USUÁRIO</div>
                <input value={username} onChange={e=>{setUsername(e.target.value);lsSet("rodo_user",e.target.value);}} placeholder="Usuário Rodonaves" style={s.input} autoComplete="username" />
              </div>
              <div style={{ flex:1,minWidth:180 }}>
                <div style={{ fontSize:11,color:"#6b8cad",marginBottom:4 }}>SENHA</div>
                <input value={password} onChange={e=>{setPassword(e.target.value);lsSet("rodo_pass",e.target.value);}} placeholder="Senha" type="password" style={s.input} autoComplete="current-password" />
              </div>
              <div style={{ display:"flex",alignItems:"flex-end" }}>
                <button onClick={gerarToken} disabled={!username||!password||tokenStatus==="loading"} style={{ background:tokenStatus==="ok"?"#00c48c22":"transparent", border:`1px solid ${tokenStatus==="ok"?"#00c48c":tokenStatus==="error"?"#e74c3c":"#1e3a5f"}`, borderRadius:6,color:tokenStatus==="ok"?"#00c48c":tokenStatus==="error"?"#e74c3c":"#8aa8c8",fontSize:12,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap" }}>
                  {tokenStatus==="loading"?"⏳ Gerando...":tokenStatus==="ok"?"✓ Token OK":tokenStatus==="error"?"✗ Erro":"🔑 Testar"}
                </button>
              </div>
            </div>
            <div style={{ fontSize:11,color:"#4a6a8a",marginTop:8 }}>Token gerado e renovado automaticamente. Credenciais salvas neste navegador.</div>
          </div>

          {/* Abas */}
          <div style={{ display:"flex",gap:0,marginBottom:0 }}>
            {[["cnpj","🏢 Por CNPJ"],["csv","📂 Importar CSV"],["texto","📋 Colar Texto"]].map(([mode,label])=>(
              <button key={mode} onClick={()=>{setInputMode(mode);setRows([]);setResults([]);}} style={s.tab(inputMode===mode)}>{label}</button>
            ))}
          </div>

          {/* Aba CNPJ */}
          {inputMode==="cnpj" && (
            <div style={s.panelWrap}>
              <div style={{ padding:16 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                  <div style={s.label}>SELECIONE O CNPJ E COLE AS NFs</div>
                  <button onClick={()=>setShowCnpjManager(!showCnpjManager)} style={{ background:"transparent",border:"1px solid #1e3a5f",borderRadius:6,color:"#8aa8c8",fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit" }}>
                    ⚙ Gerenciar CNPJs
                  </button>
                </div>

                {/* Gerenciador de CNPJs */}
                {showCnpjManager && (
                  <div style={{ background:"#060d1a",border:"1px solid #1e3a5f",borderRadius:8,padding:14,marginBottom:14 }}>
                    <div style={{ fontSize:11,color:"#f5a623",letterSpacing:"0.1em",marginBottom:10 }}>GERENCIAR CNPJs</div>
                    {cnpjs.map((c,i)=>(
                      <div key={i} style={{ display:"flex",gap:8,alignItems:"center",marginBottom:8 }}>
                        {editIdx===i
                          ? <input value={editVal} onChange={e=>setEditVal(e.target.value)} style={{...s.input,flex:1}} />
                          : <div style={{ flex:1,fontSize:13,color:"#8aa8c8",fontFamily:"monospace" }}>{fmtCNPJ(c)}</div>
                        }
                        {editIdx===i
                          ? <>
                              <button onClick={()=>{const l=[...cnpjs];l[i]=editVal.replace(/\D/g,"");saveCnpjs(l);setEditIdx(null);}} style={{ background:"#00c48c22",border:"1px solid #00c48c",borderRadius:4,color:"#00c48c",fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit" }}>✓</button>
                              <button onClick={()=>setEditIdx(null)} style={{ background:"transparent",border:"1px solid #1e3a5f",borderRadius:4,color:"#6b8cad",fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit" }}>✗</button>
                            </>
                          : <>
                              <button onClick={()=>{setEditIdx(i);setEditVal(c);}} style={{ background:"transparent",border:"1px solid #1e3a5f",borderRadius:4,color:"#6b8cad",fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit" }}>✏</button>
                              <button onClick={()=>{const l=cnpjs.filter((_,j)=>j!==i);saveCnpjs(l);if(selectedCnpj===c)setSelectedCnpj("");}} style={{ background:"transparent",border:"1px solid #e74c3c",borderRadius:4,color:"#e74c3c",fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit" }}>🗑</button>
                            </>
                        }
                      </div>
                    ))}
                    <div style={{ display:"flex",gap:8,marginTop:10 }}>
                      <input value={newCnpj} onChange={e=>setNewCnpj(e.target.value)} placeholder="Novo CNPJ (só números)" style={{...s.input,flex:1}} />
                      <button onClick={()=>{if(newCnpj.replace(/\D/g,"").length===14){saveCnpjs([...cnpjs,newCnpj.replace(/\D/g,"")]);setNewCnpj("");}else alert("CNPJ deve ter 14 dígitos.");}} style={{ background:"#f5a62322",border:"1px solid #f5a623",borderRadius:6,color:"#f5a623",fontSize:12,padding:"8px 14px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap" }}>+ Adicionar</button>
                    </div>
                  </div>
                )}

                {/* Dropdown CNPJ */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11,color:"#6b8cad",marginBottom:6 }}>CNPJ</div>
                  <select value={selectedCnpj} onChange={e=>setSelectedCnpj(e.target.value)} style={{...s.input,cursor:"pointer"}}>
                    <option value="">— Selecione o CNPJ —</option>
                    {cnpjs.map((c,i)=><option key={i} value={c}>{fmtCNPJ(c)}</option>)}
                  </select>
                </div>

                {/* NFs */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11,color:"#6b8cad",marginBottom:6 }}>NÚMEROS DAS NFs (uma por linha)</div>
                  <textarea value={nfText} onChange={e=>setNfText(e.target.value)} placeholder={"118376\n117687\n118232"} style={{ width:"100%",height:160,background:"#060d1a",border:"1px solid #1e3a5f",borderRadius:6,color:"#e8e8f0",fontSize:13,padding:"10px 12px",outline:"none",fontFamily:"monospace",resize:"vertical",boxSizing:"border-box" }} />
                </div>

                <div style={{ display:"flex",gap:12,alignItems:"center",flexWrap:"wrap" }}>
                  <button onClick={parseNfByCnpj} disabled={!selectedCnpj||!nfText.trim()} style={selectedCnpj&&nfText.trim()?{...s.btnPrimary,padding:"9px 20px",fontSize:13}:{...s.btnDisabled,padding:"9px 20px",fontSize:13}}>
                    ✓ Carregar NFs
                  </button>
                  <button onClick={()=>{setNfText("");setSelectedCnpj("");setRows([]);setResults([]);}} style={{...s.btnOutline("#6b8cad"),padding:"9px 16px",fontSize:13}}>🗑 Limpar</button>
                  {rows.length>0&&<div style={{fontSize:12,color:"#00c48c"}}>✓ {rows.length} registro(s) carregado(s)</div>}
                </div>
              </div>
            </div>
          )}

          {/* Aba CSV */}
          {inputMode==="csv" && (
            <div style={s.panelWrap}>
              <div onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onClick={()=>fileRef.current.click()}
                style={{ border:`2px dashed ${dragOver?"#f5a623":"#1e3a5f"}`,borderRadius:8,margin:16,padding:"32px 24px",textAlign:"center",cursor:"pointer",background:dragOver?"rgba(245,166,35,0.05)":"#060d1a" }}>
                <input ref={fileRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])} />
                <div style={{fontSize:32,marginBottom:8}}>📂</div>
                <div style={{fontSize:14,color:"#8aa8c8"}}>Arraste o CSV ou <span style={{color:"#f5a623"}}>clique para selecionar</span></div>
                <div style={{fontSize:12,color:"#4a6a8a",marginTop:6}}>Colunas: <code style={{color:"#f5a623"}}>CNPJ</code> e <code style={{color:"#f5a623"}}>NF</code></div>
              </div>
              <div style={{padding:"0 16px 16px",display:"flex",gap:12,alignItems:"center"}}>
                <button onClick={downloadSample} style={s.btnOutline("#6b8cad")}>⬇ CSV Modelo</button>
                {rows.length>0&&<div style={{fontSize:12,color:"#8aa8c8"}}><span style={{color:"#00c48c"}}>✓</span> {rows.length} registro(s)</div>}
              </div>
            </div>
          )}

          {/* Aba Texto */}
          {inputMode==="texto" && (
            <div style={{...s.panelWrap,padding:16}}>
              <div style={{fontSize:11,color:"#6b8cad",marginBottom:8}}>Cole um por linha: <code style={{color:"#f5a623"}}>CNPJ;NF</code> — aceita ponto e vírgula, vírgula, espaço ou tabulação</div>
              <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder="23209013001223;118376 | 23209013001142;117687" style={{width:"100%",height:180,background:"#060d1a",border:"1px solid #1e3a5f",borderRadius:6,color:"#e8e8f0",fontSize:13,padding:"10px 12px",outline:"none",fontFamily:"monospace",resize:"vertical",boxSizing:"border-box"}} />
              <div style={{display:"flex",gap:12,marginTop:10,alignItems:"center"}}>
                <button onClick={parsePasteText} disabled={!pasteText.trim()} style={pasteText.trim()?{...s.btnPrimary,padding:"9px 20px",fontSize:13}:{...s.btnDisabled,padding:"9px 20px",fontSize:13}}>✓ Carregar Dados</button>
                <button onClick={()=>{setPasteText("");setRows([]);setResults([]);}} style={{...s.btnOutline("#6b8cad"),padding:"9px 16px",fontSize:13}}>🗑 Limpar</button>
                {rows.length>0&&<div style={{fontSize:12,color:"#00c48c"}}>✓ {rows.length} registro(s)</div>}
              </div>
            </div>
          )}

          {/* Preview */}
          {rows.length>0&&results.length===0&&(
            <div style={{...s.card,marginBottom:20}}>
              <div style={s.label}>PREVIEW</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr>{["#","CNPJ","NF"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0,5).map(r=><tr key={r.id}><td style={{...s.td,color:"#4a6a8a"}}>{r.id+1}</td><td style={s.td}>{fmtCNPJ(r.cnpj)}</td><td style={s.td}>{r.nf}</td></tr>)}
                  {rows.length>5&&<tr><td colSpan={3} style={{...s.td,color:"#4a6a8a",fontStyle:"italic"}}>+ {rows.length-5} mais...</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* Controles */}
          <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
            <button onClick={runRobot} disabled={running||rows.length===0} style={running||rows.length===0?s.btnDisabled:s.btnPrimary}>
              {running?`⏳ PROCESSANDO... ${progress}%`:"▶ INICIAR RASTREIO"}
            </button>
            {running&&<button onClick={()=>{abortRef.current=true;}} style={s.btnOutline("#e74c3c")}>⏹ PARAR</button>}
            {results.length>0&&!running&&<button onClick={exportCSV} style={s.btnOutline("#00c48c")}>⬇ EXPORTAR CSV</button>}
          </div>

          {running&&(
            <div style={{background:"#1e3a5f",borderRadius:4,height:6,marginBottom:20,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress}%`,background:"linear-gradient(90deg,#f5a623,#e8541a)",transition:"width 0.4s ease"}} />
            </div>
          )}

          {/* Resumo */}
          {results.length>0&&(
            <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
              {[["ENTREGUES",delivered,"#00c48c"],["EM TRÂNSITO",inTransit,"#f5a623"],["ERROS",errors,"#e74c3c"]].map(([label,val,color])=>(
                <div key={label} style={{flex:1,minWidth:120,background:`${color}11`,border:`1px solid ${color}44`,borderRadius:10,padding:"14px 18px",textAlign:"center"}}>
                  <div style={{fontSize:28,fontWeight:700,color}}>{val}</div>
                  <div style={{fontSize:10,color,letterSpacing:"0.1em",marginTop:2}}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tabela */}
          {results.length>0&&(
            <div style={{background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:"1px solid #1e3a5f",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={s.label}>RESULTADOS</div>
                <div style={{fontSize:12,color:"#6b8cad"}}>{results.length} de {rows.length} processados</div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"#060d1a"}}>
                      {["#","CNPJ","NF","NF+1","ÚLTIMO STATUS","ÚLT. ATUALIZAÇÃO","PREVISÃO ENTREGA","ENTREGUE EM","DESTINATÁRIO","✓",""].map(h=><th key={h} style={s.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r,i)=>(
                      <>
                        <tr key={`r-${r.id}`} style={{borderBottom:expanded===r.id?"none":"1px solid #111e30",background:i%2===0?"transparent":"#060d1a"}}>
                          <td style={{...s.td,color:"#4a6a8a"}}>{r.id+1}</td>
                          <td style={{...s.td,color:"#8aa8c8",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmtCNPJ(r.cnpj)}</td>
                          <td style={{...s.td,color:"#8aa8c8",fontFamily:"monospace"}}>{r.nf}</td>
                          <td style={{...s.td,color:"#6b8cad",fontFamily:"monospace",whiteSpace:"nowrap"}}>1 {r.nf}</td>
                          <td style={{...s.td,maxWidth:260}}>
                            <span style={{display:"inline-block",background:statusColor(r.lastEvent,r.delivered)+"22",color:statusColor(r.lastEvent,r.delivered),border:`1px solid ${statusColor(r.lastEvent,r.delivered)}44`,borderRadius:4,padding:"2px 8px",fontSize:11,maxWidth:250,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {r.lastEvent||"—"}
                            </span>
                          </td>
                          <td style={{...s.td,color:"#6b8cad",whiteSpace:"nowrap"}}>{r.lastDate}</td>
                          <td style={{...s.td,whiteSpace:"nowrap"}}>
                            <span style={{color:r.atrasado?"#e74c3c":"#6b8cad"}}>
                              {r.previsaoEntrega||"—"}
                              {r.atrasado&&<span style={{marginLeft:4,fontSize:10,color:"#e74c3c"}}>⚠</span>}
                            </span>
                          </td>
                          <td style={{...s.td,color:"#00c48c",whiteSpace:"nowrap"}}>{r.dataEntregaReal||"—"}</td>
                          <td style={{...s.td,color:"#8aa8c8",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.parsed?.recipient||"—"}</td>
                          <td style={s.td}>
                            {r.ok
                              ?<span style={{color:r.delivered?"#00c48c":"#f5a623",fontSize:16}}>{r.delivered?"✓":"○"}</span>
                              :<span style={{color:"#e74c3c",fontSize:11}}>{r.httpStatus?`HTTP ${r.httpStatus}`:"✗"}</span>
                            }
                          </td>
                          <td style={s.td}>
                            {r.ok&&r.parsed?.allEvents?.length>0&&(
                              <button onClick={()=>setExpanded(expanded===r.id?null:r.id)} style={{background:"transparent",border:"1px solid #1e3a5f",borderRadius:4,color:"#8aa8c8",fontSize:10,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>
                                {expanded===r.id?"▲ fechar":"▼ eventos"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded===r.id&&r.parsed?.allEvents&&(
                          <tr key={`d-${r.id}`} style={{borderBottom:"1px solid #111e30"}}>
                            <td colSpan={11} style={{padding:"0 14px 16px 14px",background:"#060d1a"}}>
                              <div style={{padding:"12px 0 8px",fontSize:11,color:"#f5a623",letterSpacing:"0.1em"}}>HISTÓRICO — NF {r.nf}</div>
                              <div style={{display:"flex",gap:24,flexWrap:"wrap",marginBottom:14}}>
                                {[["Remetente",r.parsed.sender],["Destinatário",r.parsed.recipient],["Protocolo",r.parsed.protocol],["CT-e",r.parsed.cte],["Emissão",r.parsed.emissionDate],["Prazo",r.parsed.expectedDays!=="—"?`${r.parsed.expectedDays} dias úteis`:"—"],["Previsão",r.parsed.previsaoEntrega||"—"],["Entregue em",r.parsed.dataEntregaReal||"—"]].map(([label,val])=>(
                                  <div key={label}><div style={{fontSize:10,color:"#4a6a8a",marginBottom:2}}>{label}</div><div style={{fontSize:12,color:"#8aa8c8"}}>{val}</div></div>
                                ))}
                              </div>
                              <div style={{borderLeft:"2px solid #1e3a5f",paddingLeft:16}}>
                                {r.parsed.allEvents.map((ev,ei)=>(
                                  <div key={ei} style={{marginBottom:10,position:"relative"}}>
                                    <div style={{position:"absolute",left:-21,top:4,width:8,height:8,borderRadius:"50%",background:ei===r.parsed.allEvents.length-1?"#f5a623":"#1e3a5f",border:"2px solid #060d1a"}} />
                                    <div style={{fontSize:10,color:"#4a6a8a"}}>{ev.Date?new Date(ev.Date).toLocaleString("pt-BR"):"—"}{ev.EventCode&&<span style={{marginLeft:8,color:"#2a4a6a"}}>#{ev.EventCode}</span>}</div>
                                    <div style={{fontSize:12,color:"#e8e8f0",marginTop:2}}>{ev.Description}</div>
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
          <div style={{marginTop:32,fontSize:11,color:"#2a4a6a",textAlign:"center"}}>API: tracking-apigateway.rte.com.br · SAC Rodonaves: 0800 722 6060</div>
        </div>
      </div>
    </>
  );
}
