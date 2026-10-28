import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { analisarPortaria, extrairTextoPdf, chaveNumero, extrairRevoga } from "./leitor-portarias.js";

// ==========================================
// 1. CONFIGURAÇÃO DO FIREBASE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyD47CBTe09nbstXgtJZn5OfZiTRlIcqjII",
  authDomain: "portarias-9be36.firebaseapp.com",
  projectId: "portarias-9be36",
  storageBucket: "portarias-9be36.firebasestorage.app",
  messagingSenderId: "895034691886",
  appId: "1:895034691886:web:ae9107225da49703f2aabf"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

// ==========================================
// 2. ESTADO
// ==========================================
const ANO_ATUAL = String(new Date().getFullYear());

let isLoggedIn = false;
let portarias = [];
let servidores = [];
let pendentes = [];        // encontradas pelo robô no site do campus (coleção portarias_pendentes)
let robo = null;           // última execução do robô (documento sistema/robo)
const carregado = { portarias: false, servidores: false };

// Filtros e seleção de cada página
const ui = {
  pagina: 'painel', busca: '',
  painelAno: ANO_ATUAL,
  portAba: 'ativas', portAno: ANO_ATUAL, portTipo: 'todos', portAberta: null,
  servSeg: 'todos', servOrdem: 'horas', servAberto: null, servHist: new Set()
};

let editingPortaria = null;
let editingServidor = null;
let importItens = [];        // PDFs lidos e pendentes do site, aguardando revisão
let itemImportando = null;   // item da importação aberto no formulário de portaria
let importSeq = 0;
let salvandoImportacao = false;

// ==========================================
// 3. AUTO-LOGOUT (SEGURANÇA POR INATIVIDADE)
// ==========================================
let inactivityTimer;
const TEMPO_LIMITE_MINUTOS = 10;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (isLoggedIn) {
    inactivityTimer = setTimeout(async () => {
      await signOut(auth);
      showToast(`Sessão expirada após ${TEMPO_LIMITE_MINUTOS} minutos de inatividade.`, 'erro');
    }, TEMPO_LIMITE_MINUTOS * 60 * 1000);
  }
}
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, resetInactivityTimer));

// ==========================================
// 4. UTILITÁRIOS
// ==========================================
const $ = id => document.getElementById(id);
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// SEGURANÇA (ANTI-XSS): todo dado vindo do Firestore passa por esc() antes de ir para o HTML
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Só aceita links http/https (bloqueia "javascript:" e afins)
function safeUrl(url) {
  if (!url) return '';
  try { const u = new URL(url, location.href); if (u.protocol === 'http:' || u.protocol === 'https:') return esc(url); } catch (_) { /* inválida */ }
  return '';
}
function formatDate(d) { if (!d) return 'Indeterminada'; const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; }
function formatHoras(h) { return Number((Number(h) || 0).toFixed(2)).toLocaleString('pt-BR'); }
function norm(s) { return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function termosBusca() { return norm(ui.busca).split(/\s+/).filter(Boolean); }
function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }
function parseVinculos(json) { try { return JSON.parse(json || '{}') || {}; } catch (_) { return {}; } }

// Realça os termos buscados (ignorando acentos) num texto já escapado
function realce(txt) {
  const t = esc(txt);
  const ts = termosBusca().filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!ts.length) return t;
  const n = norm(t), re = new RegExp(ts.join('|'), 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(n))) { out += t.slice(last, m.index) + '<mark>' + t.slice(m.index, m.index + m[0].length) + '</mark>'; last = m.index + m[0].length; }
  return out + t.slice(last);
}

let toastTimer;
function showToast(msg, tipo = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (tipo === 'ok' ? '' : ' ' + tipo);
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// Situação de uma portaria: vigente | vencer (até 30 dias) | vencida | revogada
function situacao(p) {
  if (p.status === 'revogada') return { st: 'revogada', dias: null };
  if (!p.data_validade) return { st: 'vigente', dias: null };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dias = Math.ceil((new Date(p.data_validade + 'T00:00:00') - hoje) / 864e5);
  return { st: dias < 0 ? 'vencida' : dias <= 30 ? 'vencer' : 'vigente', dias };
}
const ATIVA = st => st === 'vigente' || st === 'vencer';
const COR_ST = { vigente: 'var(--st-good)', vencer: 'var(--st-warn)', vencida: 'var(--st-crit)', revogada: 'var(--st-off)' };

// Máscara do número: até a 115/2026 era "DRG/PEP/IFSP"; a partir da 116/2026 (08/06/2026), "DRG-PEP/IFSP"
function mascaraDe(numero) {
  const [n, ano] = chaveNumero(numero).split('/').map(Number);
  if (!ano) return 'DRG-PEP/IFSP';
  return ano < 2026 || (ano === 2026 && n < 116) ? 'DRG/PEP/IFSP' : 'DRG-PEP/IFSP';
}
function numeroLimpo(num) { return String(num || '').trim().toUpperCase().replace(/\\/g, '/').replace(/\s*-?\s*DRG[\/\-]PEP[\/\-]IFSP\s*$/, ''); }
function formatPortariaNum(num) { return num ? `Nº ${esc(numeroLimpo(num))} - ${mascaraDe(num)}` : '—'; }

// Ordena por ano e número, do mais novo para o mais antigo
function sortDescNum(a, b) {
  const [nA, aA] = (chaveNumero(a.numero) || '0/0').split('/').map(Number);
  const [nB, aB] = (chaveNumero(b.numero) || '0/0').split('/').map(Number);
  return aB - aA || nB - nA;
}
function sortRecentes(a, b) { return (b.data_publicacao || '').localeCompare(a.data_publicacao || '') || sortDescNum(a, b); }

// ==========================================
// 5. DADOS DERIVADOS (calculados quando os dados mudam)
// ==========================================
function prepararPortarias() {
  const porChave = {};
  portarias.forEach(p => {
    p._vinc = parseVinculos(p.servidores);
    const s = situacao(p); p._st = s.st; p._dias = s.dias;
    p._ano = (p.data_publicacao || '').slice(0, 4);
    p._chave = chaveNumero(p.numero);
    p._revoga = extrairRevoga(p.descricao)?.numero || null;
    p._revogadaPor = null;
    p._busca = null;
    if (p._chave) porChave[p._chave] = p;
  });
  // "Revogada pela Nº X": a partir das portarias que dizem revogar outra
  portarias.forEach(p => { const alvo = p._revoga && porChave[p._revoga]; if (alvo && alvo !== p) alvo._revogadaPor = p._chave; });
}

const nomeServidor = id => servidores.find(s => s.__backendId === id);

function buscaPortaria(p) {
  if (p._busca === null) {
    const nomes = Object.keys(p._vinc).map(id => nomeServidor(id)?.nome || '').join(' ');
    p._busca = norm(`${p._chave} ${p.numero} ${p.descricao} ${p.tipo} ${nomes}`);
  }
  return p._busca;
}

// Carga de cada servidor: portarias ativas (vigentes + a vencer) e histórico
function cargaServidores() {
  const mapa = {};
  servidores.forEach(s => { mapa[s.__backendId] = { ativas: [], hist: [], horas: 0 }; });
  portarias.forEach(p => {
    Object.entries(p._vinc).forEach(([id, h]) => {
      const c = mapa[id]; if (!c) return;   // servidor excluído
      const item = { p, horas: Number(h) || 0 };
      if (ATIVA(p._st)) { c.ativas.push(item); c.horas += item.horas; } else c.hist.push(item);
    });
  });
  Object.values(mapa).forEach(c => { c.ativas.sort((a, b) => sortRecentes(a.p, b.p)); c.hist.sort((a, b) => sortRecentes(a.p, b.p)); });
  return mapa;
}

function anosDisponiveis() {
  const anos = new Set([ANO_ATUAL]);
  portarias.forEach(p => { if (p._ano) anos.add(p._ano); });
  return [...anos].sort((a, b) => b - a);
}

// ==========================================
// 6. NAVEGAÇÃO ENTRE PÁGINAS (#painel, #portarias, #servidores)
// ==========================================
const PAGINAS = ['painel', 'portarias', 'servidores'];
let manterBusca = false;

function lerRota() {
  const [pg, sub] = location.hash.replace(/^#/, '').split('/');
  ui.pagina = PAGINAS.includes(pg) ? pg : 'painel';
  // "#portarias/vencer" (atalho do painel): todas as que vencem, de qualquer ano
  if (ui.pagina === 'portarias' && ['ativas', 'vigente', 'vencer', 'vencida', 'revogada'].includes(sub)) { ui.portAba = sub; ui.portAno = 'todos'; }
}

function mostrarPagina() {
  document.querySelectorAll('main[data-pagina]').forEach(m => { m.hidden = m.dataset.pagina !== ui.pagina; });
  document.querySelectorAll('.nav a, .bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.pagina === ui.pagina));
  if (!manterBusca) { ui.busca = ''; $('busca').value = ''; }
  manterBusca = false;
  $('busca').placeholder = ui.pagina === 'servidores' ? 'Buscar servidor ou setor…' : 'Buscar portaria, servidor ou assunto…';
  document.title = { painel: 'Painel', portarias: 'Portarias', servidores: 'Servidores' }[ui.pagina] + ' · Controle de Portarias';
  renderPaginaAtual();
  window.scrollTo(0, 0);
}

function renderPaginaAtual() {
  if (ui.pagina === 'painel') renderPainel();
  else if (ui.pagina === 'portarias') renderPortarias();
  else renderServidores();
  if (window.lucide) lucide.createIcons();
}

// Abre uma portaria específica na página Portarias (usado pelo painel)
function abrirPortaria(id) {
  const p = portarias.find(x => x.__backendId === id);
  if (!p) return;
  ui.portAno = p._ano || 'todos';
  ui.portTipo = 'todos';
  ui.portAba = p._st === 'revogada' ? 'revogada' : p._st === 'vencida' ? 'vencida' : 'ativas';
  ui.portAberta = id;
  if (location.hash === '#portarias') mostrarPagina(); else location.hash = '#portarias';
  setTimeout(() => document.querySelector(`.prow[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }), 50);
}

// ==========================================
// 7. PAINEL
// ==========================================
let painelAnimado = false;

function renderPainel() {
  const anos = anosDisponiveis();
  if (!anos.includes(ui.painelAno)) ui.painelAno = anos[0];
  $('painel-anos').innerHTML = anos.slice(0, 4).reverse().map(a => `<button data-ano="${esc(a)}" class="${a === ui.painelAno ? 'on' : ''}">${esc(a)}</button>`).join('');

  const ano = ui.painelAno;
  const doAno = portarias.filter(p => p._ano === ano);
  const conta = st => doAno.filter(p => p._st === st).length;
  const total = doAno.length, vig = conta('vigente'), venc = conta('vencer'), vcd = conta('vencida'), rev = conta('revogada');
  const pct = n => total ? Math.round(n / total * 100) : 0;

  // Cartões de números
  const kpi = (rotulo, valor, rodape, ico, bg, ink) => `
    <div class="card kpi"><div class="label"><span class="ico" style="background:${bg};color:${ink}"><i data-lucide="${ico}"></i></span>${rotulo}</div>
    <div class="value" data-count="${valor}">${valor}</div><div class="foot">${rodape}</div></div>`;
  $('painel-kpis').innerHTML = `
    <div class="card kpi hero"><div class="label"><span class="ico"><i data-lucide="files"></i></span>Portarias em ${esc(ano)}</div>
      <div class="value" data-count="${total}">${total}</div><div class="foot">Total publicado no ano, incluindo revogadas</div>
      <svg class="spark" width="120" height="40" viewBox="0 0 120 40" aria-hidden="true" id="painel-spark"></svg></div>
    ${kpi('Vigentes', vig, `${pct(vig)}% das portarias do ano`, 'check-circle-2', 'var(--st-good-bg)', 'var(--st-good-ink)')}
    ${kpi('A vencer', venc, 'Nos próximos 30 dias', 'alarm-clock', 'var(--st-warn-bg)', 'var(--st-warn-ink)')}
    ${kpi('Vencidas', vcd, 'Validade expirada', 'alert-octagon', 'var(--st-crit-bg)', 'var(--st-crit-ink)')}
    ${kpi('Revogadas', rev, 'Substituídas por outras', 'file-x', 'var(--st-off-bg)', 'var(--st-off-ink)')}`;

  // Publicações por mês (no ano atual, só até o mês corrente)
  const ultimoMes = ano === ANO_ATUAL ? new Date().getMonth() + 1 : 12;
  const porMes = Array.from({ length: ultimoMes }, (_, i) => doAno.filter(p => +p.data_publicacao.slice(5, 7) === i + 1).length);
  $('painel-mes-sub').textContent = `${ano} · janeiro a ${MESES[ultimoMes - 1].toLowerCase()}`;
  graficoColunas(porMes);
  sparkline(porMes);

  // Situação
  const sit = [
    { nome: 'Vigentes', n: vig, cor: COR_ST.vigente, bg: 'var(--st-good-bg)', ink: 'var(--st-good-ink)', ico: 'check-circle-2' },
    { nome: 'A vencer', n: venc, cor: COR_ST.vencer, bg: 'var(--st-warn-bg)', ink: 'var(--st-warn-ink)', ico: 'alarm-clock' },
    { nome: 'Vencidas', n: vcd, cor: COR_ST.vencida, bg: 'var(--st-crit-bg)', ink: 'var(--st-crit-ink)', ico: 'alert-octagon' },
    { nome: 'Revogadas', n: rev, cor: COR_ST.revogada, bg: 'var(--st-off-bg)', ink: 'var(--st-off-ink)', ico: 'file-x' }
  ];
  $('painel-sit-sub').textContent = `${plural(total, 'publicada', 'publicadas')} em ${ano}`;
  $('painel-stack').innerHTML = total ? sit.filter(s => s.n).map(s => `<div style="width:${s.n / total * 100}%;background:${s.cor}" data-tip="<b>${s.n} ${s.nome.toLowerCase()}</b><br>${pct(s.n)}% do ano"></div>`).join('') : '';
  $('painel-legenda').innerHTML = sit.map(s => `
    <div class="row"><span class="chip" style="background:${s.bg};color:${s.ink}"><i data-lucide="${s.ico}"></i></span>
    <span class="nm">${s.nome}</span><span class="n">${s.n}</span><span class="pc">${pct(s.n)}%</span></div>`).join('');

  // Vencendo nos próximos 30 dias (qualquer ano)
  const vencendo = portarias.filter(p => p._st === 'vencer').sort((a, b) => a._dias - b._dias).slice(0, 6);
  $('painel-vencendo').innerHTML = vencendo.length ? vencendo.map(p => {
    const urg = p._dias <= 7;
    return `<div class="item" data-abrir="${esc(p.__backendId)}"><div class="count" style="background:${urg ? 'var(--st-crit-bg)' : 'var(--st-warn-bg)'};color:${urg ? 'var(--st-crit-ink)' : 'var(--st-warn-ink)'}">
      <div><b>${p._dias}</b><small>${p._dias === 1 ? 'dia' : 'dias'}</small></div></div>
      <div class="body"><div class="t">Nº ${esc(numeroLimpo(p.numero))}</div><div class="d">${esc(p.descricao)}</div></div>
      <span class="date">até ${formatDate(p.data_validade).slice(0, 5)}</span></div>`;
  }).join('') : '<p class="vazio">Nenhuma portaria vence nos próximos 30 dias.</p>';

  // Maior carga horária (portarias ativas)
  const carga = cargaServidores();
  const ranking = servidores.map(s => ({ s, c: carga[s.__backendId] })).filter(x => x.c.horas > 0)
    .sort((a, b) => b.c.horas - a.c.horas || b.c.ativas.length - a.c.ativas.length).slice(0, 6);
  const totalHoras = Object.values(carga).reduce((a, c) => a + c.horas, 0);
  $('painel-carga-sub').textContent = `Horas em portarias ativas · ${formatHoras(totalHoras)} h no total`;
  const maxH = ranking[0]?.c.horas || 1;
  $('painel-carga').innerHTML = ranking.length ? ranking.map(({ s, c }) => barraH(s.nome, s.setor, c.horas / maxH, `${formatHoras(c.horas)} h <small>· ${c.ativas.length} port.</small>`)).join('')
    : '<p class="vazio">Nenhuma hora registrada em portarias ativas.</p>';

  // Por tipo
  $('painel-tipo-sub').textContent = `Portarias de ${ano}`;
  $('painel-tipos').innerHTML = ['Comissão', 'Fiscalização', 'Diversas'].map(t => {
    const n = doAno.filter(p => p.tipo === t).length;
    return barraH(t, '', total ? n / total : 0, `${n} <small>· ${pct(n)}%</small>`);
  }).join('');

  // Publicadas recentemente
  const ICO_TIPO = { 'Comissão': 'users', 'Fiscalização': 'shield-check', 'Diversas': 'file-text' };
  const recentes = doAno.slice().sort(sortRecentes).slice(0, 6);
  $('painel-recentes').innerHTML = recentes.length ? recentes.map(p => `
    <div class="item" data-abrir="${esc(p.__backendId)}"><span class="type-ico"><i data-lucide="${ICO_TIPO[p.tipo] || 'file-text'}"></i></span>
      <div class="body"><div class="t">${formatPortariaNum(p.numero)} ${pillSituacao(p)}
        ${p._revoga ? `<span class="pill" style="background:var(--st-off-bg);color:var(--st-off-ink)"><i data-lucide="repeat"></i>Revoga ${esc(p._revoga)}</span>` : ''}</div>
      <div class="d">${esc(p.descricao)}</div></div><span class="date">${formatDate(p.data_publicacao).slice(0, 5)}</span></div>`).join('')
    : '<p class="vazio">Nenhuma portaria publicada neste ano.</p>';

  renderRobo();
  if (window.lucide) lucide.createIcons();
  requestAnimationFrame(() => setTimeout(() => document.querySelectorAll('#pg-painel .hb-fill').forEach(f => { f.style.width = f.dataset.w + '%'; }), 60));
  if (!painelAnimado && carregado.portarias) { painelAnimado = true; contadores(); }
}

function pillSituacao(p) {
  const m = { vigente: ['Vigente', 'var(--st-good-bg)', 'var(--st-good-ink)', 'check'], vencer: [`Vence em ${p._dias}d`, 'var(--st-warn-bg)', 'var(--st-warn-ink)', 'alarm-clock'],
              vencida: ['Vencida', 'var(--st-crit-bg)', 'var(--st-crit-ink)', 'alert-octagon'], revogada: ['Revogada', 'var(--st-off-bg)', 'var(--st-off-ink)', 'file-x'] }[p._st];
  return `<span class="pill" style="background:${m[1]};color:${m[2]}"><i data-lucide="${m[3]}"></i>${m[0]}</span>`;
}

function barraH(nome, setor, fracao, valor) {
  return `<div><div class="hb-top"><span class="nm">${esc(nome)}${setor ? `<small>${esc(setor)}</small>` : ''}</span><span class="v">${valor}</span></div>
    <div class="hb-track"><div class="hb-fill" style="width:0" data-w="${Math.max(0, Math.min(1, fracao)) * 100}"></div></div></div>`;
}

// Colunas: portarias por mês (barras finas, topo arredondado, valor só no maior e no último mês)
function graficoColunas(valores) {
  const box = $('painel-colunas');
  const W = box.clientWidth || 640, H = 220, padL = 28, padB = 24, padT = 18;
  // Escala "redonda": 4 intervalos com passo 1, 2, 5, 10, 20, 25, 50…
  const passo = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find(p => p * 4 >= Math.max(...valores, 4)) || 1000;
  const max = passo * 4;
  const ticks = [0, 1, 2, 3, 4].map(i => i * passo);
  const ih = H - padB - padT, iw = W - padL;
  const band = iw / Math.max(1, valores.length), bw = Math.min(24, band * .55);
  const y = v => padT + ih - (v / max) * ih;
  const iMax = valores.indexOf(Math.max(...valores)), iLast = valores.length - 1;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Portarias publicadas por mês">`;
  ticks.forEach(t => { s += `<line class="${t ? 'gl' : 'bl'}" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`; });
  valores.forEach((v, i) => {
    const cx = padL + band * i + band / 2, x = cx - bw / 2, top = y(v), h = padT + ih - top, r = Math.min(4, h);
    const path = h > 0 ? `M${x},${padT + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + ih} Z` : '';
    s += `<g class="grp"><path class="bar" d="${path}"/><rect class="hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${ih}" data-tip="<b>${plural(v, 'portaria', 'portarias')}</b><br>${MESES[i]}"/>`;
    if (v && (i === iMax || i === iLast)) s += `<text class="vl" x="${cx}" y="${top - 6}" text-anchor="middle">${v}</text>`;
    s += `<text class="xl" x="${cx}" y="${H - 6}" text-anchor="middle">${MESES_CURTOS[i]}</text></g>`;
  });
  box.innerHTML = s + '</svg>';
  $('painel-colunas-tabela').innerHTML = '<tr><th>Mês</th><th>Portarias</th></tr>' + valores.map((v, i) => `<tr><td>${MESES[i]}</td><td>${v}</td></tr>`).join('');
}

// Mini-linha do cartão principal: acumulado do ano
function sparkline(porMes) {
  let acc = 0; const pts = porMes.map(v => (acc += v));
  const max = Math.max(1, pts[pts.length - 1] || 0), w = 120, h = 40;
  const xy = pts.map((v, i) => [pts.length > 1 ? i * (w - 6) / (pts.length - 1) + 3 : w / 2, h - 4 - (v / max) * (h - 10)]);
  if (!xy.length) { $('painel-spark').innerHTML = ''; return; }
  const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = xy[xy.length - 1];
  $('painel-spark').innerHTML = `<path d="${d} L${last[0]},${h} L${xy[0][0]},${h} Z" fill="rgba(255,255,255,.14)"/><path d="${d}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#fff" stroke="#2f9e41" stroke-width="2"/>`;
}

function contadores() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('#painel-kpis [data-count]').forEach(el => {
    const alvo = +el.dataset.count, t0 = performance.now();
    const passo = t => { const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(alvo * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
  });
}

// Linha do robô de varredura (só para o admin): situação, pendentes e alerta se parar
function renderRobo() {
  const el = $('painel-robo');
  if (!isLoggedIn) { el.hidden = true; return; }
  el.hidden = false;
  const qtdPend = importItens.filter(i => i.pendenteId && !['salva', 'duplicada'].includes(i.estado)).length;
  const botao = qtdPend ? `<button class="btn primary" data-acao="ver-pendentes">Revisar</button>` : '';
  const pend = qtdPend ? `<b>${plural(qtdPend, 'portaria nova encontrada', 'portarias novas encontradas')} no site</b>` : 'nenhuma pendente de revisão';

  if (!robo?.ultima_execucao) {
    el.classList.remove('alerta');
    el.innerHTML = `<div class="bot"><i data-lucide="bot"></i></div><div class="txt"><div><b>Robô de varredura</b> · ainda não registrou nenhuma execução</div>
      <div class="meta">Ele verifica o site do campus todo dia útil às 10h e às 15h · ${pend}</div></div>${botao}`;
    return;
  }
  const ultima = new Date(robo.ultima_execucao);
  const sucesso = robo.ultimo_sucesso ? new Date(robo.ultimo_sucesso) : null;
  const quando = d => { const h = new Date(); h.setHours(0, 0, 0, 0); const dd = new Date(d); dd.setHours(0, 0, 0, 0); const dif = Math.round((h - dd) / 864e5);
    return `${dif === 0 ? 'hoje' : dif === 1 ? 'ontem' : d.toLocaleDateString('pt-BR')}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
  // Parado: sem execução com sucesso há mais de 4 dias (cobre fim de semana e feriado)
  const parado = !sucesso || (Date.now() - sucesso) > 4 * 864e5;
  // Ano novo sem portarias no site a partir de fevereiro: provável mudança no endereço da página
  const semAnoNovo = robo.conferidas_ano_atual === 0 && String(robo.ano) === ANO_ATUAL && new Date().getMonth() >= 1;

  if (robo.sucesso === false || parado || semAnoNovo) {
    el.classList.add('alerta');
    const motivo = robo.sucesso === false ? `A última varredura (${quando(ultima)}) falhou${robo.erro ? ': ' + esc(robo.erro) : ''}.`
      : parado ? `O robô não roda desde ${sucesso ? quando(sucesso) : 'há vários dias'}. Verifique se o computador está ligado.`
      : `O robô não encontrou portarias de ${ANO_ATUAL} no site do campus. Verifique se o endereço da página de portarias do ano mudou.`;
    el.innerHTML = `<div class="bot"><i data-lucide="bot"></i></div><div class="txt"><div><span class="pulse"></span><b>Robô de varredura precisa de atenção</b></div>
      <div class="meta">${motivo} · ${pend}</div></div>${botao}`;
    return;
  }
  el.classList.remove('alerta');
  el.innerHTML = `<div class="bot"><i data-lucide="bot"></i></div><div class="txt">
    <div><span class="pulse"></span><b>Robô de varredura ativo</b> · verifica o site do campus todo dia útil às 10h e às 15h</div>
    <div class="meta">Última varredura: ${quando(ultima)} · ${plural(robo.conferidas || 0, 'portaria conferida', 'portarias conferidas')} no site · ${pend}</div></div>${botao}`;
}

// ==========================================
// 8. PÁGINA PORTARIAS
// ==========================================
function portariasBase() {
  const ts = termosBusca();
  return portarias.filter(p =>
    (ui.portAno === 'todos' || p._ano === ui.portAno) &&
    (ui.portTipo === 'todos' || p.tipo === ui.portTipo) &&
    ts.every(t => buscaPortaria(p).includes(t)));
}
const naAba = (p, aba) => aba === 'ativas' ? ATIVA(p._st) : p._st === aba;
const listaPortarias = () => portariasBase().filter(p => naAba(p, ui.portAba)).sort(sortRecentes);

function renderPortarias() {
  const anos = anosDisponiveis();
  if (ui.portAno !== 'todos' && !anos.includes(ui.portAno)) ui.portAno = ANO_ATUAL;
  $('port-ano').innerHTML = '<option value="todos">Todos os anos</option>' + anos.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  $('port-ano').value = ui.portAno;
  $('port-tipo').value = ui.portTipo;

  const base = portariasBase();
  const abas = [['ativas', 'Ativas'], ['vigente', 'Vigentes'], ['vencer', 'A vencer'], ['vencida', 'Vencidas'], ['revogada', 'Revogadas']];
  $('port-abas').innerHTML = abas.map(([k, n]) => `<button class="tab ${ui.portAba === k ? 'on' : ''}" data-aba="${k}">${n}<span class="c">${base.filter(p => naAba(p, k)).length}</span></button>`).join('');

  const doAno = ui.portAno === 'todos' ? portarias.length : portarias.filter(p => p._ano === ui.portAno).length;
  $('port-sub').textContent = ui.portAno === 'todos' ? `${plural(doAno, 'portaria cadastrada', 'portarias cadastradas')}` : `${plural(doAno, 'publicada', 'publicadas')} em ${ui.portAno}`;
  renderAvisoPendentes();

  const out = $('port-lista');
  if (!carregado.portarias) { out.innerHTML = '<div class="empty">Carregando portarias…</div>'; return; }
  const lista = base.filter(p => naAba(p, ui.portAba)).sort(sortRecentes);
  if (!lista.length) {
    out.innerHTML = portarias.length ? '<div class="empty"><b>Nenhuma portaria encontrada</b>Ajuste a busca ou os filtros.</div>'
      : `<div class="empty"><b>Nenhuma portaria cadastrada</b>${isLoggedIn ? 'Clique em "Nova portaria" para começar.' : ''}</div>`;
    return;
  }
  const grupos = [];
  lista.forEach(p => { const k = (p.data_publicacao || '').slice(0, 7); if (!grupos.length || grupos[grupos.length - 1].k !== k) grupos.push({ k, itens: [] }); grupos[grupos.length - 1].itens.push(p); });
  out.innerHTML = grupos.map(g => {
    const [y, m] = g.k.split('-');
    const titulo = y && m ? `${MESES[+m - 1]} ${y}` : 'Sem data de publicação';
    return `<div class="month">${titulo}<span>${g.itens.length}</span></div><div class="group">${g.itens.map(linhaPortaria).join('')}</div>`;
  }).join('');
}

function textoSituacao(p) {
  if (p._st === 'vencer') return { txt: p._dias === 0 ? 'Vence hoje' : `Vence em ${plural(p._dias, 'dia', 'dias')}`, cls: 'warn' };
  if (p._st === 'vencida') return { txt: 'Vencida', cls: 'crit' };
  if (p._st === 'revogada') return { txt: 'Revogada', cls: '' };
  return { txt: 'Vigente', cls: '' };
}

function linhaPortaria(p) {
  const s = textoSituacao(p), aberta = ui.portAberta === p.__backendId;
  return `
  <div class="prow ${p._st === 'revogada' ? 'off' : ''} ${aberta ? 'open' : ''}" data-id="${esc(p.__backendId)}" role="button" tabindex="0" aria-expanded="${aberta}">
    <span class="dot" style="background:${COR_ST[p._st]}" aria-hidden="true"></span>
    <span class="num">${realce(numeroLimpo(p.numero))}</span>
    <span class="desc">${realce(p.descricao)}</span>
    <span class="tipo">${esc(p.tipo || '')}</span>
    <span class="data">${p.data_publicacao ? formatDate(p.data_publicacao).slice(0, 5) : '—'}</span>
    <span class="st ${s.cls}">${s.txt}</span>
    <span class="chev"><i data-lucide="chevron-down"></i></span>
  </div>
  ${aberta ? detalhePortaria(p) : ''}`;
}

function detalhePortaria(p) {
  const vinc = Object.entries(p._vinc);
  const horas = vinc.reduce((a, [, h]) => a + (Number(h) || 0), 0);
  const extra = p._st === 'revogada' && p._revogadaPor ? `<div><small>Revogada pela</small><b>Nº ${esc(p._revogadaPor)}</b></div>`
              : p._revoga ? `<div><small>Revoga</small><b>Nº ${esc(p._revoga)}</b></div>` : '';
  const pessoas = vinc.map(([id, h]) => { const s = nomeServidor(id); return { nome: s?.nome || 'Servidor excluído', setor: s?.setor || '', h: Number(h) || 0 }; })
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const link = safeUrl(p.link);
  return `
  <div class="detail">
    <p class="full"><b>${formatPortariaNum(p.numero)}</b> · ${realce(p.descricao)}</p>
    <div class="facts">
      <div><small>Tipo</small><b>${esc(p.tipo || '—')}</b></div>
      <div><small>Publicação</small><b>${p.data_publicacao ? formatDate(p.data_publicacao) : '—'}</b></div>
      <div><small>Validade</small><b>${formatDate(p.data_validade)}</b></div>
      ${extra}
    </div>
    ${pessoas.length ? `<div class="people-title">${plural(pessoas.length, 'servidor', 'servidores')} · ${formatHoras(horas)} h</div>
      <ul class="people">${pessoas.map(v => `<li><span>${realce(v.nome)}<small>${esc(v.setor)}</small></span><b>${formatHoras(v.h)} h</b></li>`).join('')}</ul>`
      : '<p class="none">Nenhum servidor vinculado.</p>'}
    <div class="links">
      ${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>Abrir documento</a>` : ''}
      ${isLoggedIn && p._st !== 'revogada' ? `<button data-acao="editar-portaria" data-id="${esc(p.__backendId)}">Editar</button><button class="danger" data-acao="revogar-portaria" data-id="${esc(p.__backendId)}">Revogar</button>` : ''}
    </div>
  </div>`;
}

function renderAvisoPendentes() {
  const el = $('port-pendentes');
  const qtd = importItens.filter(i => i.pendenteId && !['salva', 'duplicada'].includes(i.estado)).length;
  el.hidden = !isLoggedIn || qtd === 0;
  el.innerHTML = `<i data-lucide="globe"></i><span>${plural(qtd, 'portaria nova encontrada', 'portarias novas encontradas')} no site do campus</span><button class="btn primary" data-acao="ver-pendentes">Revisar</button>`;
}

// ==========================================
// 9. PÁGINA SERVIDORES
// ==========================================
const SEGMENTOS = [['todos', 'Todos'], ['Técnico-Administrativo', 'Técnico-administrativos'], ['Docente', 'Docentes'], ['Discente', 'Discentes']];

function servidoresFiltrados(carga) {
  const ts = termosBusca();
  const base = servidores.filter(s => ts.every(t => norm(`${s.nome} ${s.setor} ${s.segmento}`).includes(t)));
  const lista = base.filter(s => ui.servSeg === 'todos' || s.segmento === ui.servSeg);
  const c = id => carga[id];
  const ordem = {
    horas: (a, b) => c(b.__backendId).horas - c(a.__backendId).horas || c(b.__backendId).ativas.length - c(a.__backendId).ativas.length || (a.nome || '').localeCompare(b.nome || ''),
    portarias: (a, b) => c(b.__backendId).ativas.length - c(a.__backendId).ativas.length || c(b.__backendId).horas - c(a.__backendId).horas || (a.nome || '').localeCompare(b.nome || ''),
    nome: (a, b) => (a.nome || '').localeCompare(b.nome || '')
  }[ui.servOrdem];
  return { base, lista: lista.sort(ordem) };
}

function renderServidores() {
  const carga = cargaServidores();
  const { base, lista } = servidoresFiltrados(carga);
  $('serv-ordem').value = ui.servOrdem;
  // Segmentos sem ninguém cadastrado não viram aba
  $('serv-abas').innerHTML = SEGMENTOS.filter(([k]) => k === 'todos' || servidores.some(s => s.segmento === k))
    .map(([k, n]) => `<button class="tab ${ui.servSeg === k ? 'on' : ''}" data-seg="${esc(k)}">${n}<span class="c">${k === 'todos' ? base.length : base.filter(s => s.segmento === k).length}</span></button>`).join('');

  const totalH = Object.values(carga).reduce((a, c) => a + c.horas, 0);
  $('serv-sub').textContent = `${plural(servidores.length, 'cadastrado', 'cadastrados')} · ${formatHoras(totalH)} h em portarias ativas`;

  const out = $('serv-lista');
  if (!carregado.servidores) { out.innerHTML = '<div class="empty">Carregando servidores…</div>'; return; }
  if (!lista.length) {
    out.innerHTML = servidores.length ? '<div class="empty"><b>Nenhum servidor encontrado</b>Ajuste a busca ou o filtro.</div>'
      : `<div class="empty"><b>Nenhum servidor cadastrado</b>${isLoggedIn ? 'Clique em "Novo servidor" para começar.' : ''}</div>`;
    return;
  }
  const maxH = Math.max(1, ...servidores.map(s => carga[s.__backendId].horas));
  out.innerHTML = `<div class="group"><div class="shead"><span>Servidor</span><span class="c-seg">Segmento</span><span class="r">Portarias ativas</span><span class="r">Carga horária</span><span></span></div>
    ${lista.map(s => linhaServidor(s, carga[s.__backendId], maxH)).join('')}</div>`;
}

function linhaServidor(s, c, maxH) {
  const aberto = ui.servAberto === s.__backendId, qa = c.ativas.length;
  return `
  <div class="srow ${aberto ? 'open' : ''}" data-id="${esc(s.__backendId)}" role="button" tabindex="0" aria-expanded="${aberto}">
    <span class="nm"><b>${realce(s.nome)}</b><small>${realce(s.setor)}</small></span>
    <span class="seg-txt">${esc(s.segmento)}</span>
    <span class="qtd r ${qa ? '' : 'zero'}">${qa ? `${qa}<span class="m"> ${qa === 1 ? 'portaria' : 'portarias'}</span>` : '—'}</span>
    <span class="hrs ${c.horas ? '' : 'zero'}"><span class="bar" aria-hidden="true"><i style="width:${c.horas / maxH * 100}%"></i></span><b>${formatHoras(c.horas)} h</b></span>
    <span class="chev"><i data-lucide="chevron-down"></i></span>
  </div>
  ${aberto ? detalheServidor(s, c) : ''}`;
}

function itemPortariaServidor({ p, horas }) {
  const s = p._st === 'vencer' ? `<span class="s warn">Vence em ${p._dias}d</span>`
          : p._st === 'vencida' ? '<span class="s">Vencida</span>' : p._st === 'revogada' ? '<span class="s">Revogada</span>' : '<span class="s"></span>';
  // Número e descrição abrem o documento (área de clique maior que um ícone)
  const link = safeUrl(p.link);
  const tag = (cls, txt, title = '') => link
    ? `<a class="${cls}" href="${link}" target="_blank" rel="noopener noreferrer" title="${title || 'Abrir documento'}">${txt}</a>`
    : `<span class="${cls}"${title ? ` title="${title}"` : ''}>${txt}</span>`;
  return `<li class="${link ? 'com-link' : ''}"><span class="dot" style="background:${COR_ST[p._st]}"></span>${tag('n', esc(numeroLimpo(p.numero)))}
    ${tag('d', esc(p.descricao), esc(p.descricao))}${s}<span class="h">${formatHoras(horas)} h</span></li>`;
}

function detalheServidor(s, c) {
  const verHist = ui.servHist.has(s.__backendId);
  return `
  <div class="sdetail">
    <div class="facts">
      <div><small>Segmento</small><b>${esc(s.segmento) || '—'}</b></div>
      <div><small>Setor</small><b>${esc(s.setor) || '—'}</b></div>
      <div><small>Portarias ativas</small><b>${c.ativas.length}</b></div>
      <div><small>Carga horária</small><b>${formatHoras(c.horas)} h</b></div>
    </div>
    ${c.ativas.length ? `<p class="sub-title">Portarias ativas</p><ul class="plist">${c.ativas.map(itemPortariaServidor).join('')}</ul>` : '<p class="none">Nenhuma portaria ativa no momento.</p>'}
    ${c.hist.length ? `<button class="toggle-hist ${verHist ? 'on' : ''}" data-hist="${esc(s.__backendId)}"><i data-lucide="chevron-right"></i>${verHist ? 'Ocultar' : 'Mostrar'} histórico (${c.hist.length} vencidas ou revogadas)</button>
      ${verHist ? `<ul class="plist hist">${c.hist.map(itemPortariaServidor).join('')}</ul>` : ''}` : ''}
    ${isLoggedIn ? `<div class="links"><button data-acao="editar-servidor" data-id="${esc(s.__backendId)}">Editar</button><button class="danger" data-acao="excluir-servidor" data-id="${esc(s.__backendId)}">Excluir</button></div>` : ''}
  </div>`;
}

// ==========================================
// 10. JANELAS (MODAIS)
// ==========================================
function abrirModal(id) { $(id).hidden = false; if (window.lucide) lucide.createIcons(); setTimeout(() => $(id).querySelector('input:not([type=hidden]):not([type=file]), select, textarea')?.focus(), 30); }
function fecharModal(id) {
  $(id).hidden = true;
  if (id === 'modal-portaria') {
    editingPortaria = null;
    // Se a portaria veio da importação, volta para a lista de importação
    if (itemImportando) { itemImportando = null; abrirImportacao(); }
  }
  if (id === 'modal-servidor') editingServidor = null;
}
document.addEventListener('click', e => {
  const fechar = e.target.closest('[data-fechar]');
  if (fechar) { fecharModal(fechar.closest('.modal').id); return; }
  if (e.target.classList?.contains('modal')) fecharModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const aberto = [...document.querySelectorAll('.modal')].reverse().find(m => !m.hidden);
  if (aberto) { fecharModal(aberto.id); e.stopPropagation(); }
});

// ==========================================
// 11. LOGIN
// ==========================================
function aplicarAdmin() {
  document.body.classList.toggle('admin', isLoggedIn);
  document.querySelectorAll('.so-admin').forEach(el => { el.hidden = !isLoggedIn; });
  document.querySelectorAll('.so-publico').forEach(el => { el.hidden = isLoggedIn; });
  $('admin-email').textContent = auth.currentUser?.email || '';
  if (!isLoggedIn) ['modal-portaria', 'modal-servidor', 'modal-csv', 'modal-importar'].forEach(id => { $(id).hidden = true; });
}

$('btn-entrar').addEventListener('click', () => { $('form-login').reset(); abrirModal('modal-login'); });
$('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, $('f-login-email').value, $('f-login-senha').value); fecharModal('modal-login'); showToast('Bem-vindo!'); }
  catch (_) { showToast('E-mail ou senha incorretos', 'erro'); }
});
$('btn-sair').addEventListener('click', async () => { await signOut(auth); showToast('Você saiu da conta'); });

// ==========================================
// 12. PORTARIAS: CADASTRO, EDIÇÃO E REVOGAÇÃO
// ==========================================
function renderRevogaOptions(query = '') {
  const q = norm(query);
  const disponiveis = portarias.filter(p => p.status !== 'revogada' && (!editingPortaria || p.__backendId !== editingPortaria.__backendId))
    .filter(p => !q || norm(`${p.numero} ${p.descricao}`).includes(q)).sort(sortDescNum);
  const atual = $('f-revoga').value;
  $('f-revoga').innerHTML = '<option value="">Nenhuma</option>' + disponiveis.map(p => {
    const d = p.descricao || '';
    return `<option value="${esc(p.__backendId)}">Nº ${esc(numeroLimpo(p.numero))} (${formatDate(p.data_publicacao)}) · ${esc(d.length > 60 ? d.slice(0, 60) + '…' : d)}</option>`;
  }).join('');
  if (atual && disponiveis.some(p => p.__backendId === atual)) $('f-revoga').value = atual;
}

function renderVinculos(vinculos) {
  const lista = servidores.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  $('f-vinculos').innerHTML = lista.length ? lista.map(s => {
    const marcado = vinculos[s.__backendId] !== undefined;
    return `<label class="bind-row" data-nome="${esc(norm(`${s.nome} ${s.setor} ${s.segmento}`))}">
      <input type="checkbox" data-srv="${esc(s.__backendId)}" ${marcado ? 'checked' : ''}>
      <span class="nm">${esc(s.nome)}<small>${esc(s.setor)}</small></span>
      <input class="input" type="number" min="0" step="1" placeholder="0 h" data-horas="${esc(s.__backendId)}" value="${marcado && vinculos[s.__backendId] ? esc(vinculos[s.__backendId]) : ''}" aria-label="Horas de ${esc(s.nome)}">
    </label>`;
  }).join('') : '<p class="none">Nenhum servidor cadastrado.</p>';
}

// `prefill` preenche uma portaria NOVA (usado pela importação de PDF e pelas pendentes do site)
function abrirFormPortaria(portaria = null, prefill = null) {
  if (!isLoggedIn) return showToast('Faça login para continuar.', 'warn');
  editingPortaria = portaria;
  $('portaria-titulo').textContent = portaria ? `Editar portaria Nº ${numeroLimpo(portaria.numero)}` : prefill ? 'Revisar portaria importada' : 'Nova portaria';
  $('form-portaria').reset();
  const d = portaria || prefill || {};
  $('f-numero').value = d.numero || '';
  $('f-publicacao').value = d.data_publicacao || '';
  $('f-validade').value = d.data_validade || '';
  $('f-tipo').value = d.tipo || '';
  $('f-descricao').value = d.descricao || '';
  $('f-link').value = d.link || '';
  $('f-revoga-busca').value = ''; $('f-vinculo-busca').value = '';
  $('f-revoga').innerHTML = '';
  renderRevogaOptions();
  if (prefill?.revogaId) $('f-revoga').value = prefill.revogaId;
  renderVinculos(parseVinculos(d.servidores));
  abrirModal('modal-portaria');
}

$('f-revoga-busca').addEventListener('input', e => renderRevogaOptions(e.target.value));
$('f-vinculo-busca').addEventListener('input', e => {
  const q = norm(e.target.value);
  document.querySelectorAll('#f-vinculos .bind-row').forEach(r => { r.hidden = !r.dataset.nome.includes(q); });
});
// Digitar horas já marca o servidor
$('f-vinculos').addEventListener('input', e => {
  if (e.target.dataset.horas && e.target.value) e.target.closest('.bind-row').querySelector('input[type=checkbox]').checked = true;
});

$('form-portaria').addEventListener('submit', async e => {
  e.preventDefault();
  if (!isLoggedIn) return showToast('Acesso negado.', 'erro');

  const vinculos = {};
  document.querySelectorAll('#f-vinculos input[type=checkbox]:checked').forEach(cb => {
    // Portarias só usam horas inteiras
    const h = parseInt(document.querySelector(`#f-vinculos input[data-horas="${CSS.escape(cb.dataset.srv)}"]`).value, 10);
    vinculos[cb.dataset.srv] = Number.isFinite(h) && h > 0 ? h : 0;
  });
  const dados = {
    numero: $('f-numero').value.trim(), descricao: $('f-descricao').value.trim(),
    data_publicacao: $('f-publicacao').value, data_validade: $('f-validade').value,
    tipo: $('f-tipo').value, link: $('f-link').value.trim(),
    servidores: JSON.stringify(vinculos), status: 'ativo'
  };
  const idRevogar = $('f-revoga').value || null;

  // Bloqueia número já cadastrado em outra portaria
  const chave = chaveNumero(dados.numero);
  if (chave && portarias.some(p => p._chave === chave && p.__backendId !== editingPortaria?.__backendId)) return showToast(`A portaria Nº ${chave} já está cadastrada.`, 'erro');
  if (dados.data_validade && dados.data_publicacao && dados.data_validade < dados.data_publicacao) return showToast('A validade não pode ser anterior à publicação.', 'erro');

  try {
    let msg;
    if (editingPortaria) { await updateDoc(doc(db, 'portarias', editingPortaria.__backendId), dados); msg = 'Portaria atualizada!'; }
    else { await addDoc(collection(db, 'portarias'), dados); msg = 'Portaria cadastrada!'; }
    if (idRevogar) { await updateDoc(doc(db, 'portarias', idRevogar), { status: 'revogada' }); msg += ' Portaria anterior revogada.'; }
    if (itemImportando) {
      itemImportando.estado = 'salva';
      if (itemImportando.pendenteId) await deleteDoc(doc(db, 'portarias_pendentes', itemImportando.pendenteId));
    }
    showToast(msg);
    fecharModal('modal-portaria');
  } catch (err) { console.error(err); showToast('Erro ao salvar no banco.', 'erro'); }
});

async function revogarPortaria(id) {
  const p = portarias.find(x => x.__backendId === id);
  if (!isLoggedIn || !p) return;
  if (!confirm(`Revogar a portaria ${numeroLimpo(p.numero)}? Esta ação marca a portaria como revogada.`)) return;
  try { await updateDoc(doc(db, 'portarias', id), { status: 'revogada' }); showToast('Portaria revogada.'); }
  catch (_) { showToast('Erro ao revogar.', 'erro'); }
}

// ==========================================
// 13. SERVIDORES: CADASTRO, EDIÇÃO E EXCLUSÃO
// ==========================================
function abrirFormServidor(id = null) {
  if (!isLoggedIn) return showToast('Faça login para continuar.', 'warn');
  editingServidor = id ? servidores.find(s => s.__backendId === id) : null;
  $('servidor-titulo').textContent = editingServidor ? 'Editar servidor' : 'Novo servidor';
  $('form-servidor').reset();
  if (editingServidor) {
    $('f-srv-nome').value = editingServidor.nome || '';
    $('f-srv-segmento').value = editingServidor.segmento || '';
    $('f-srv-setor').value = editingServidor.setor || '';
  }
  abrirModal('modal-servidor');
}

$('form-servidor').addEventListener('submit', async e => {
  e.preventDefault();
  if (!isLoggedIn) return;
  const dados = { nome: $('f-srv-nome').value.trim(), segmento: $('f-srv-segmento').value, setor: $('f-srv-setor').value.trim() };
  try {
    if (editingServidor) { await updateDoc(doc(db, 'servidores', editingServidor.__backendId), dados); showToast('Servidor atualizado!'); }
    else { await addDoc(collection(db, 'servidores'), dados); showToast('Servidor cadastrado!'); }
    fecharModal('modal-servidor');
  } catch (_) { showToast('Erro ao salvar.', 'erro'); }
});

// Ao excluir, o servidor sai das portarias ativas (para não deixar horas órfãs).
// Nas revogadas/vencidas o vínculo é mantido como histórico.
async function excluirServidor(id) {
  const s = servidores.find(x => x.__backendId === id);
  if (!isLoggedIn || !s) return;
  const ativas = portarias.filter(p => ATIVA(p._st) && p._vinc[id] !== undefined);
  const aviso = ativas.length ? `\n\nEle será desvinculado de ${plural(ativas.length, 'portaria ativa', 'portarias ativas')}.` : '';
  if (!confirm(`Excluir permanentemente ${s.nome}?${aviso}`)) return;
  try {
    const batch = writeBatch(db);
    ativas.forEach(p => { const v = { ...p._vinc }; delete v[id]; batch.update(doc(db, 'portarias', p.__backendId), { servidores: JSON.stringify(v) }); });
    batch.delete(doc(db, 'servidores', id));
    await batch.commit();
    if (ui.servAberto === id) ui.servAberto = null;
    showToast('Servidor excluído.');
  } catch (_) { showToast('Erro ao excluir.', 'erro'); }
}

// Importação em lote (CSV). Aceita vírgula ou ponto e vírgula, com campos entre aspas.
function parseCsvLine(line, sep = ',') {
  const result = []; let atual = '', aspas = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (aspas) { if (c === '"' && line[i + 1] === '"') { atual += '"'; i++; } else if (c === '"') aspas = false; else atual += c; }
    else if (c === '"') aspas = true; else if (c === sep) { result.push(atual); atual = ''; } else atual += c;
  }
  result.push(atual);
  return result.map(s => s.trim());
}

$('btn-processar-csv').addEventListener('click', async e => {
  if (!isLoggedIn) return showToast('Acesso negado.', 'erro');
  const texto = $('f-csv').value.trim();
  if (!texto) return showToast('O campo está vazio.', 'warn');
  const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Importando…';
  const linhas = texto.split('\n').filter(l => l.trim());
  const sep = linhas[0].includes(';') ? ';' : ',';
  let ok = 0, ignoradas = 0;
  for (const linha of linhas) {
    const [nome, segmento, setor] = parseCsvLine(linha, sep);
    if (nome && segmento !== undefined && setor !== undefined) { try { await addDoc(collection(db, 'servidores'), { nome, segmento, setor }); ok++; } catch (_) { ignoradas++; } }
    else ignoradas++;
  }
  btn.disabled = false; btn.textContent = 'Importar';
  fecharModal('modal-csv');
  showToast(ok ? `${plural(ok, 'servidor importado', 'servidores importados')}${ignoradas ? ` (${plural(ignoradas, 'linha ignorada', 'linhas ignoradas')})` : ''}` : 'Nenhum servidor válido encontrado.', ok ? 'ok' : 'warn');
});

// ==========================================
// 14. IMPORTAÇÃO DE PORTARIAS (PDF DO SUAP) E PENDENTES DO SITE
// ==========================================
// O texto do PDF é lido no navegador (pdf.js) e os campos são extraídos pelos
// padrões do modelo do SUAP. Nada é salvo sem confirmação do admin.
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const encontrarPorNumero = chave => chave ? portarias.find(p => p._chave === chave) : null;

// Marca como duplicada a portaria já cadastrada ou repetida na lista
function marcarDuplicata(item) {
  if (!item.dados) return;
  const chave = chaveNumero(item.dados.numero);
  if (encontrarPorNumero(chave)) { item.estado = 'duplicada'; item.avisos.unshift('Esta portaria já está cadastrada no sistema.'); }
  else if (importItens.some(o => o !== item && o.dados && !['duplicada', 'lendo'].includes(o.estado) && chaveNumero(o.dados.numero) === chave)) { item.estado = 'duplicada'; item.avisos.unshift('Portaria repetida nesta lista.'); }
}

// Id da portaria a revogar: cadastrada e ativa, ou criada neste mesmo lote
function resolverRevoga(revoga, criadasNoLote = {}) {
  if (!revoga) return null;
  const alvo = encontrarPorNumero(revoga);
  if (alvo) return alvo.status === 'revogada' ? null : alvo.__backendId;
  return criadasNoLote[revoga] || null;
}

function montarDocPortaria(d) {
  return { numero: d.numero, descricao: d.descricao, data_publicacao: d.data_publicacao, data_validade: d.data_validade,
           tipo: d.tipo, link: d.link, servidores: JSON.stringify(d.servidores || {}), status: 'ativo' };
}

async function processarPdfs(files) {
  if (!window.pdfjsLib) return showToast('O leitor de PDF não carregou. Verifique a conexão.', 'erro');
  const pdfs = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) return showToast('Selecione arquivos PDF.', 'warn');
  const novos = pdfs.map(f => ({ id: ++importSeq, arquivo: f.name, file: f, estado: 'lendo', avisos: [], selecionado: true }));
  importItens.push(...novos);
  renderImportacao();
  for (const item of novos) {
    try {
      const texto = await extrairTextoPdf(pdfjsLib, await item.file.arrayBuffer());
      Object.assign(item, analisarPortaria(texto, item.arquivo, servidores));
      marcarDuplicata(item);
    } catch (err) { console.error(err); item.estado = 'erro'; item.avisos = ['Não foi possível ler o PDF.']; }
    delete item.file;
    renderImportacao();
  }
}

const ESTADOS_IMPORT = { lendo: ['Lendo…', ''], pronta: ['Pronta', 'ok'], incompleta: ['Revisar', 'warn'], duplicada: ['Já cadastrada', ''], ignorada: ['Não é portaria', ''], erro: ['Erro', 'crit'], salva: ['Salva', 'ok'] };

function renderImportacao() {
  const qtdSel = importItens.filter(i => i.estado === 'pronta' && i.selecionado).length;
  $('imp-acoes').hidden = importItens.length === 0;
  const btn = $('btn-salvar-importadas');
  btn.textContent = salvandoImportacao ? 'Salvando…' : `Salvar selecionadas (${qtdSel})`;
  btn.disabled = salvandoImportacao || qtdSel === 0;

  $('imp-lista').innerHTML = importItens.map(item => {
    const [rotulo, cls] = ESTADOS_IMPORT[item.estado];
    const d = item.dados;
    const podeRevisar = d && ['pronta', 'incompleta'].includes(item.estado);
    const podeDescartar = item.pendenteId && item.estado !== 'salva';
    let meta = '';
    if (d) {
      const partes = [`Publicação ${d.data_publicacao ? formatDate(d.data_publicacao) : '—'}`, `Validade ${formatDate(d.data_validade)}`, plural(Object.keys(d.servidores || {}).length, 'servidor identificado', 'servidores identificados')];
      if (d.revoga) {
        const alvo = encontrarPorNumero(d.revoga);
        const noLote = importItens.some(o => o !== item && o.dados && chaveNumero(o.dados.numero) === d.revoga);
        partes.push(`Revoga Nº ${esc(d.revoga)} (${alvo ? (alvo.status === 'revogada' ? 'já revogada' : 'será revogada') : noLote ? 'neste lote' : 'não cadastrada'})`);
      }
      meta = `<div class="imp-desc">${esc(d.descricao)}</div><div class="imp-meta">${partes.join(' · ')}</div>`;
    }
    return `
      <div class="imp ${['salva', 'ignorada', 'duplicada'].includes(item.estado) ? 'apagado' : ''}">
        <div class="imp-top">
          ${item.estado === 'pronta' ? `<input type="checkbox" data-sel="${item.id}" ${item.selecionado ? 'checked' : ''} title="Incluir em Salvar selecionadas">` : ''}
          <div class="imp-main">
            <div class="imp-title">${d ? formatPortariaNum(d.numero) : esc(item.arquivo)} ${d ? `<span class="tag">${esc(d.tipo)}</span>` : ''}
              ${item.pendenteId ? '<span class="tag site">Do site</span>' : ''}<span class="tag ${cls}">${rotulo}</span></div>
            ${d ? `<div class="imp-file">${esc(item.arquivo)}</div>` : ''}
          </div>
          <div class="imp-acoes">
            ${podeDescartar ? `<button class="btn" data-acao="descartar-pendente" data-item="${item.id}" title="Não cadastrar esta portaria">Descartar</button>` : ''}
            ${podeRevisar ? `<button class="btn primary" data-acao="revisar-importada" data-item="${item.id}">Revisar</button>` : ''}
          </div>
        </div>
        ${meta}
        ${item.avisos.map(a => `<div class="imp-aviso">• ${esc(a)}</div>`).join('')}
      </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function abrirImportacao() {
  if (!isLoggedIn) return;
  renderImportacao();
  abrirModal('modal-importar');
}

$('imp-lista').addEventListener('change', e => {
  const id = +e.target.dataset.sel; if (!id) return;
  const item = importItens.find(i => i.id === id); if (item) item.selecionado = e.target.checked;
  renderImportacao();
});

function revisarImportada(id) {
  const item = importItens.find(i => i.id === id);
  if (!item?.dados) return;
  $('modal-importar').hidden = true;
  itemImportando = item;
  abrirFormPortaria(null, { ...montarDocPortaria(item.dados), revogaId: resolverRevoga(item.dados.revoga) });
}

async function descartarPendente(id) {
  const item = importItens.find(i => i.id === id);
  if (!item?.pendenteId || !isLoggedIn) return;
  if (!confirm(`Descartar a portaria ${numeroLimpo(item.dados?.numero)}? Ela não será cadastrada e o robô não a trará de novo.`)) return;
  try { await updateDoc(doc(db, 'portarias_pendentes', item.pendenteId), { descartada: true }); showToast('Pendente descartada.'); }
  catch (_) { showToast('Erro ao descartar.', 'erro'); }
}

$('btn-salvar-importadas').addEventListener('click', async () => {
  if (!isLoggedIn || salvandoImportacao) return;
  // Ordem crescente de número, para que revogações dentro do mesmo lote encontrem a portaria revogada
  const itens = importItens.filter(i => i.estado === 'pronta' && i.selecionado).sort((a, b) => sortDescNum(b.dados, a.dados));
  if (!itens.length) return;
  if (!confirm(`Salvar ${plural(itens.length, 'portaria importada', 'portarias importadas')}? As horas dos servidores ficarão como 0 h.`)) return;
  salvandoImportacao = true; renderImportacao();
  const criadasNoLote = {};
  let ok = 0, falhas = 0;
  for (const item of itens) {
    try {
      const ref = await addDoc(collection(db, 'portarias'), montarDocPortaria(item.dados));
      criadasNoLote[chaveNumero(item.dados.numero)] = ref.id;
      const idRevogar = resolverRevoga(item.dados.revoga, criadasNoLote);
      if (idRevogar) await updateDoc(doc(db, 'portarias', idRevogar), { status: 'revogada' });
      if (item.pendenteId) await deleteDoc(doc(db, 'portarias_pendentes', item.pendenteId));
      item.estado = 'salva'; ok++;
    } catch (err) { console.error(err); item.estado = 'erro'; item.avisos = ['Falha ao salvar no banco.', ...item.avisos]; falhas++; }
    renderImportacao();
  }
  salvandoImportacao = false; renderImportacao();
  showToast(falhas ? `${ok} salva(s), ${falhas} com erro.` : `${plural(ok, 'portaria cadastrada', 'portarias cadastradas')}!`, falhas ? 'warn' : 'ok');
});

$('btn-limpar-importadas').addEventListener('click', () => {
  if (salvandoImportacao) return;
  // As pendentes do site continuam na lista até serem salvas ou descartadas
  importItens = importItens.filter(i => i.estado === 'lendo' || (i.pendenteId && i.estado !== 'salva'));
  renderImportacao();
});

$('pdf-input').addEventListener('change', e => { processarPdfs(e.target.files); e.target.value = ''; });
const pdfDrop = $('pdf-drop');
['dragenter', 'dragover'].forEach(ev => pdfDrop.addEventListener(ev, e => { e.preventDefault(); pdfDrop.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(ev => pdfDrop.addEventListener(ev, e => { e.preventDefault(); pdfDrop.classList.remove('drag-over'); }));
pdfDrop.addEventListener('drop', e => processarPdfs(e.dataTransfer.files));

// O robô (robo/varrer-portarias.js, agendado no PC do admin) grava em "portarias_pendentes".
// Aqui elas entram na mesma lista da importação de PDF. Descartadas ficam marcadas
// (não apagadas) para o robô não trazê-las de novo.
function sincronizarPendentes() {
  const ativas = pendentes.filter(p => !p.descartada);
  const ids = new Set(ativas.map(p => p.__backendId));
  importItens = importItens.filter(i => !i.pendenteId || ids.has(i.pendenteId) || i.estado === 'salva');
  ativas.sort(sortDescNum).forEach(p => {
    let item = importItens.find(i => i.pendenteId === p.__backendId);
    if (item?.estado === 'salva') return;
    if (!item) { item = { id: ++importSeq, pendenteId: p.__backendId, arquivo: p.titulo || '', selecionado: true }; importItens.unshift(item); }
    item.dados = { numero: p.numero, data_publicacao: p.data_publicacao || '', data_validade: p.data_validade || '', tipo: p.tipo || 'Diversas',
                   descricao: p.descricao || '', link: p.link || '', revoga: p.revoga || null, servidores: parseVinculos(p.servidores) };
    item.avisos = [...(p.avisos || [])];
    item.estado = item.dados.numero && item.dados.data_publicacao && item.dados.descricao ? 'pronta' : 'incompleta';
    marcarDuplicata(item);
  });
  if (!$('modal-importar').hidden) renderImportacao();
}

// ==========================================
// 15. EXPORTAÇÃO (CSV no padrão do Excel em português: ";" e BOM UTF-8)
// ==========================================
function downloadCSV(nome, linhas) {
  const campo = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + linhas.map(l => l.map(campo).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
  document.body.appendChild(a); a.click(); a.remove();
}
const hojeIso = () => new Date().toISOString().slice(0, 10);

// Exporta exatamente o que está na tela (aba, ano, tipo e busca)
$('btn-exportar-portarias').addEventListener('click', () => {
  const lista = listaPortarias();
  if (!lista.length) return showToast('Não há portarias para exportar.', 'warn');
  const linhas = [['Número', 'Descrição', 'Tipo', 'Situação', 'Publicação', 'Validade', 'Servidores', 'Horas', 'Link']];
  lista.forEach(p => {
    const vinc = Object.entries(p._vinc);
    linhas.push([`${numeroLimpo(p.numero)} - ${mascaraDe(p.numero)}`, p.descricao, p.tipo, textoSituacao(p).txt, p.data_publicacao ? formatDate(p.data_publicacao) : '',
      formatDate(p.data_validade), vinc.map(([id, h]) => `${nomeServidor(id)?.nome || 'Servidor excluído'} (${formatHoras(h)} h)`).join('; '),
      formatHoras(vinc.reduce((a, [, h]) => a + (Number(h) || 0), 0)), p.link]);
  });
  downloadCSV(`portarias_${hojeIso()}.csv`, linhas);
  showToast(`${plural(lista.length, 'portaria exportada', 'portarias exportadas')}.`);
});

$('btn-exportar-servidores').addEventListener('click', () => {
  const carga = cargaServidores();
  const { lista } = servidoresFiltrados(carga);
  if (!lista.length) return showToast('Não há servidores para exportar.', 'warn');
  downloadCSV(`servidores_${hojeIso()}.csv`, [['Nome', 'Segmento', 'Setor', 'Portarias ativas', 'Carga horária (h)'],
    ...lista.map(s => [s.nome, s.segmento, s.setor, carga[s.__backendId].ativas.length, formatHoras(carga[s.__backendId].horas)])]);
  showToast(`${plural(lista.length, 'servidor exportado', 'servidores exportados')}.`);
});

// ==========================================
// 16. EVENTOS DAS PÁGINAS
// ==========================================
// Ações dos botões gerados dinamicamente (data-acao)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const id = b.dataset.id, item = +b.dataset.item;
  ({
    'editar-portaria': () => abrirFormPortaria(portarias.find(p => p.__backendId === id)),
    'revogar-portaria': () => revogarPortaria(id),
    'editar-servidor': () => abrirFormServidor(id),
    'excluir-servidor': () => excluirServidor(id),
    'ver-pendentes': () => abrirImportacao(),
    'revisar-importada': () => revisarImportada(item),
    'descartar-pendente': () => descartarPendente(item)
  })[b.dataset.acao]?.();
});

// Painel
$('painel-anos').addEventListener('click', e => { const b = e.target.closest('[data-ano]'); if (b) { ui.painelAno = b.dataset.ano; renderPainel(); } });
$('pg-painel').addEventListener('click', e => { const it = e.target.closest('[data-abrir]'); if (it) abrirPortaria(it.dataset.abrir); });

// Dica (tooltip) dos gráficos
const tip = $('tip');
document.addEventListener('mouseover', e => { const t = e.target.closest?.('[data-tip]'); if (t) { tip.innerHTML = t.dataset.tip; tip.classList.add('on'); } });
document.addEventListener('mouseout', e => { if (e.target.closest?.('[data-tip]')) tip.classList.remove('on'); });
document.addEventListener('mousemove', e => {
  if (!tip.classList.contains('on')) return;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = (e.clientY - tip.offsetHeight - 12) + 'px';
});

// Portarias
$('port-abas').addEventListener('click', e => { const t = e.target.closest('[data-aba]'); if (t) { ui.portAba = t.dataset.aba; renderPaginaAtual(); } });
$('port-ano').addEventListener('change', e => { ui.portAno = e.target.value; renderPaginaAtual(); });
$('port-tipo').addEventListener('change', e => { ui.portTipo = e.target.value; renderPaginaAtual(); });
function alternarPortaria(row) { ui.portAberta = ui.portAberta === row.dataset.id ? null : row.dataset.id; renderPaginaAtual(); }
$('port-lista').addEventListener('click', e => { if (e.target.closest('.detail')) return; const r = e.target.closest('.prow'); if (r) alternarPortaria(r); });
$('port-lista').addEventListener('keydown', e => { const r = e.target.closest('.prow'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); alternarPortaria(r); } });
$('btn-nova-portaria').addEventListener('click', () => abrirFormPortaria());
$('btn-importar-pdf').addEventListener('click', abrirImportacao);

// Servidores
$('serv-abas').addEventListener('click', e => { const t = e.target.closest('[data-seg]'); if (t) { ui.servSeg = t.dataset.seg; renderPaginaAtual(); } });
$('serv-ordem').addEventListener('change', e => { ui.servOrdem = e.target.value; renderPaginaAtual(); });
function alternarServidor(row) { ui.servAberto = ui.servAberto === row.dataset.id ? null : row.dataset.id; renderPaginaAtual(); }
$('serv-lista').addEventListener('click', e => {
  const h = e.target.closest('[data-hist]');
  if (h) { const id = h.dataset.hist; ui.servHist.has(id) ? ui.servHist.delete(id) : ui.servHist.add(id); renderPaginaAtual(); return; }
  if (e.target.closest('.sdetail')) return;
  const r = e.target.closest('.srow'); if (r) alternarServidor(r);
});
$('serv-lista').addEventListener('keydown', e => { const r = e.target.closest('.srow'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); alternarServidor(r); } });
$('btn-novo-servidor').addEventListener('click', () => abrirFormServidor());
$('btn-importar-csv').addEventListener('click', () => { $('f-csv').value = ''; abrirModal('modal-csv'); });

// Busca do topo: filtra a página atual; no painel, leva para Portarias
let buscaTimer;
$('busca').addEventListener('input', e => {
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(() => {
    ui.busca = e.target.value.trim();
    if (ui.pagina === 'painel' && ui.busca) { manterBusca = true; ui.portAno = 'todos'; ui.portAba = 'ativas'; location.hash = '#portarias'; return; }
    renderPaginaAtual();
  }, 150);
});
document.addEventListener('keydown', e => {
  const busca = $('busca');
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) { e.preventDefault(); busca.focus(); busca.select(); }
  if (e.key === 'Escape' && document.activeElement === busca) { busca.value = ''; ui.busca = ''; renderPaginaAtual(); busca.blur(); }
});

// Tema claro/escuro
$('btn-tema').addEventListener('click', () => {
  const root = document.documentElement;
  const escuro = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = escuro ? 'light' : 'dark';
  try { localStorage.setItem('tema', root.dataset.theme); } catch (_) { /* navegação privada */ }
});

window.addEventListener('hashchange', () => { lerRota(); mostrarPagina(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (ui.pagina === 'painel') renderPainel(); }, 150); });

// ==========================================
// 17. DADOS EM TEMPO REAL (FIRESTORE)
// ==========================================
function atualizarBadges() {
  $('badge-portarias').textContent = portarias.length || '';
  $('badge-servidores').textContent = servidores.length || '';
}

onAuthStateChanged(auth, user => {
  isLoggedIn = !!user;
  aplicarAdmin();
  resetInactivityTimer();
  renderPaginaAtual();
});

onSnapshot(collection(db, 'portarias'), snap => {
  portarias = snap.docs.map(d => ({ __backendId: d.id, ...d.data() }));
  prepararPortarias();
  carregado.portarias = true;
  atualizarBadges(); sincronizarPendentes(); renderPaginaAtual();
}, err => console.error('Erro portarias:', err));

onSnapshot(collection(db, 'servidores'), snap => {
  servidores = snap.docs.map(d => ({ __backendId: d.id, ...d.data() }));
  portarias.forEach(p => { p._busca = null; });
  carregado.servidores = true;
  atualizarBadges(); renderPaginaAtual();
}, err => console.error('Erro servidores:', err));

onSnapshot(collection(db, 'portarias_pendentes'), snap => {
  pendentes = snap.docs.map(d => ({ __backendId: d.id, ...d.data() }));
  sincronizarPendentes(); renderPaginaAtual();
}, err => console.error('Erro pendentes:', err));

onSnapshot(doc(db, 'sistema', 'robo'), snap => {
  robo = snap.exists() ? snap.data() : null;
  if (ui.pagina === 'painel') { renderRobo(); if (window.lucide) lucide.createIcons(); }
}, err => console.error('Erro robô:', err));

// ==========================================
// 18. INICIALIZAÇÃO
// ==========================================
aplicarAdmin();
lerRota();
mostrarPagina();
