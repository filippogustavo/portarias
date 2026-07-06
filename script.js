import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager, 
  collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

// CONFIGURAÇÃO DE CACHE FIREBASE
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

const auth = getAuth(app);

let isLoggedIn = false;
let portarias = [];
let servidores = [];
let editingPortaria = null;
let editingServidor = null;
let viewingPortaria = null;
let currentFilter = 'all';
let searchQuery = '';
let searchRelSrvQuery = '';

// ==========================================
// 2. AUTO-LOGOUT (SEGURANÇA POR INATIVIDADE)
// ==========================================
let inactivityTimer;
const TEMPO_LIMITE_MINUTOS = 10; 
const INACTIVITY_TIME_MS = TEMPO_LIMITE_MINUTOS * 60 * 1000; 

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (isLoggedIn) {
    inactivityTimer = setTimeout(async () => {
      await signOut(auth);
      showToast(`Sessão expirada após ${TEMPO_LIMITE_MINUTOS} minutos de inatividade.`, 'error');
    }, INACTIVITY_TIME_MS);
  }
}

['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evento => {
  document.addEventListener(evento, resetInactivityTimer);
});

// ==========================================
// FUNÇÕES DE INTERFACE (GLOBAIS)
// ==========================================
window.closeModalLogin = () => { document.getElementById('modal-login').classList.add('hidden'); document.getElementById('modal-login').classList.remove('flex'); }
window.closeModalPortaria = () => { document.getElementById('modal-portaria').classList.add('hidden'); document.getElementById('modal-portaria').classList.remove('flex'); editingPortaria = null; }
window.closeModalServidor = () => { document.getElementById('modal-servidor').classList.add('hidden'); document.getElementById('modal-servidor').classList.remove('flex'); editingServidor = null; }
window.closeModalImportCSV = () => { document.getElementById('modal-import-csv').classList.add('hidden'); document.getElementById('modal-import-csv').classList.remove('flex'); }
window.closeDetailPortaria = () => { document.getElementById('modal-detail-portaria').classList.add('hidden'); document.getElementById('modal-detail-portaria').classList.remove('flex'); viewingPortaria = null; }

function openModalLogin() { document.getElementById('form-login').reset(); document.getElementById('modal-login').classList.remove('hidden'); document.getElementById('modal-login').classList.add('flex'); }

function updateAdminUI() {
  const loginBtn = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');
  const menuServidores = document.getElementById('menu-servidores');
  
  if (isLoggedIn) {
    loginBtn.classList.add('hidden'); logoutBtn.classList.remove('hidden');
    document.getElementById('btn-new-portaria').classList.remove('hidden');
    document.getElementById('btn-new-servidor').classList.remove('hidden');
    document.getElementById('btn-import-csv').classList.remove('hidden');
    if (menuServidores) { menuServidores.classList.remove('hidden'); menuServidores.classList.add('flex'); }
  } else {
    loginBtn.classList.remove('hidden'); logoutBtn.classList.add('hidden');
    document.getElementById('btn-new-portaria').classList.add('hidden');
    document.getElementById('btn-new-servidor').classList.add('hidden');
    document.getElementById('btn-import-csv').classList.add('hidden');
    if (menuServidores) { menuServidores.classList.add('hidden'); menuServidores.classList.remove('flex'); }
    if (menuServidores && menuServidores.classList.contains('active')) document.querySelector('[data-tab="portarias"]').click();
  }
}

function formatDate(d) { 
  if (!d) return 'Indeterminada'; 
  const [y, m, day] = d.split('-'); 
  return `${day}/${m}/${y}`; 
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeft = type === 'success' ? '4px solid #10b981' : type === 'warn' ? '4px solid #f59e0b' : '4px solid #ef4444';
  t.classList.remove('hidden'); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function getStatus(dateStr) {
  if (!dateStr) return { label: 'Indeterminada', class: 'status-permanent', days: 9999, key: 'ok' };
  
  const today = new Date(); today.setHours(0,0,0,0);
  const val = new Date(dateStr + 'T00:00:00');
  const diff = Math.ceil((val - today) / (1000*60*60*24));
  if (diff < 0) return { label: 'Vencida', class: 'status-expired', days: diff, key: 'expired' };
  if (diff <= 30) return { label: `Vence em ${diff}d`, class: 'status-warn', days: diff, key: 'warn' };
  return { label: `${diff} dias`, class: 'status-ok', days: diff, key: 'ok' };
}

function formatPortariaNum(num) {
  if (!num) return '—';
  let n = esc(num.trim().toUpperCase().replace(/\\/g, '/'));
  if (n.includes('DRG/PEP/IFSP')) return `Nº ${n}`;
  return `Nº ${n} - DRG/PEP/IFSP`;
}

// ==========================================
// SEGURANÇA: ESCAPE DE HTML (ANTI-XSS)
// ==========================================
// Qualquer dado vindo do Firestore (nome, descrição, etc.) deve passar
// por aqui antes de ser inserido via innerHTML, para impedir que texto
// como "<img src=x onerror=...>" seja executado como HTML/JS.
function esc(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// Valida que um link é http/https antes de usá-lo em href,
// bloqueando esquemas perigosos como "javascript:".
function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return esc(url);
  } catch (_) { /* URL inválida */ }
  return '';
}

// ==========================================
// FUNÇÃO DE ORDENAÇÃO DECRESCENTE (POR NÚMERO E ANO)
// ==========================================
function sortDescNum(a, b) {
  const nA = (a.numero || '').replace(/\\/g, '/').split('/');
  const nB = (b.numero || '').replace(/\\/g, '/').split('/');
  
  const pA = { num: parseInt(nA[0]) || 0, ano: parseInt(nA[1]) || 0 };
  const pB = { num: parseInt(nB[0]) || 0, ano: parseInt(nB[1]) || 0 };
  
  if (pA.ano !== pB.ano) return pB.ano - pA.ano; // Anos maiores primeiro
  return pB.num - pA.num; // Números maiores primeiro
}

function renderRevogaOptions(query = '') {
  const select = document.getElementById('f-portaria-revoga');
  if (!select) return;

  const q = query.toLowerCase();
  
  let disponiveis = portarias.filter(p => 
    p.status !== 'revogada' && 
    (!editingPortaria || p.__backendId !== editingPortaria.__backendId)
  );

  if (q) {
    disponiveis = disponiveis.filter(p => 
      (p.numero || '').toLowerCase().includes(q) || 
      (p.descricao || '').toLowerCase().includes(q)
    );
  }

  // Ordenando de forma decrescente matemática
  disponiveis.sort(sortDescNum);

  let html = '<option value="">-- Nenhuma --</option>';
  disponiveis.forEach(p => {
    const descCurta = esc(p.descricao.length > 45 ? p.descricao.substring(0, 45) + '...' : p.descricao);
    html += `<option value="${esc(p.__backendId)}">Nº ${esc(p.numero)} (${formatDate(p.data_publicacao)}) - ${descCurta}</option>`;
  });

  select.innerHTML = html;
}

document.getElementById('f-search-revoga')?.addEventListener('input', (e) => {
  renderRevogaOptions(e.target.value);
});


// ==========================================
// AUTENTICAÇÃO E DADOS PÚBLICOS
// ==========================================
onAuthStateChanged(auth, (user) => { 
  isLoggedIn = !!user; 
  updateAdminUI(); 
  renderServidores(); 
  renderPortarias(); 
  resetInactivityTimer();
});

onSnapshot(collection(db, "portarias"), (snapshot) => {
  portarias = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  renderPortarias(); renderRelatorios();
}, (error) => console.error("Erro portarias:", error));

onSnapshot(collection(db, "servidores"), (snapshot) => {
  servidores = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  servidores.sort((a,b) => a.nome.localeCompare(b.nome));
  renderServidores(); renderPortarias(); renderRelatorios();
}, (error) => console.error("Erro servidores:", error));

document.getElementById('btn-login').addEventListener('click', (e) => { e.preventDefault(); openModalLogin(); });
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, document.getElementById('f-login-user').value, document.getElementById('f-login-pass').value); window.closeModalLogin(); showToast('Logado!'); } 
  catch (error) { showToast('Erro de login', 'error'); }
});
document.getElementById('btn-logout').addEventListener('click', async () => { await signOut(auth); showToast('Desconectado'); });

// ==========================================
// GESTÃO DE PORTARIAS E VÍNCULOS
// ==========================================
window.openModalPortaria = function(portaria = null) {
  if (!isLoggedIn) return showToast('Acesso negado. Faça login.', 'warn');
  editingPortaria = portaria;
  document.getElementById('modal-title-portaria').textContent = portaria ? 'Editar Portaria' : 'Nova Portaria';
  
  const searchRevoga = document.getElementById('f-search-revoga');
  if (searchRevoga) searchRevoga.value = '';
  renderRevogaOptions();

  if (portaria) {
    document.getElementById('f-portaria-numero').value = portaria.numero || '';
    document.getElementById('f-portaria-pub').value = portaria.data_publicacao || '';
    document.getElementById('f-portaria-desc').value = portaria.descricao || '';
    document.getElementById('f-portaria-validade').value = portaria.data_validade || '';
    document.getElementById('f-portaria-tipo').value = portaria.tipo || '';
    document.getElementById('f-portaria-link').value = portaria.link || '';
  } else { document.getElementById('form-portaria').reset(); }

  const searchVinculo = document.getElementById('f-search-vinculo');
  if(searchVinculo) searchVinculo.value = '';
  renderServidorBindingList(portaria);
  
  document.getElementById('modal-portaria').classList.remove('hidden'); document.getElementById('modal-portaria').classList.add('flex');
};

window.editPortariaDirect = function(id) {
  const p = portarias.find(r => r.__backendId === id);
  if(p) window.openModalPortaria(p);
}

window.revokePortariaDirect = async function(id) {
  if (!isLoggedIn) return;
  if(confirm("Deseja revogar permanentemente esta portaria?")) {
    try { await updateDoc(doc(db, "portarias", id), { status: 'revogada' }); showToast('Portaria revogada!'); window.closeDetailPortaria(); } 
    catch (error) { showToast('Erro ao revogar', 'error'); }
  }
}

function renderServidorBindingList(portaria) {
  const list = document.getElementById('servidor-binding-list');
  if (servidores.length === 0) { list.innerHTML = '<p class="text-slate-500 text-xs">Nenhum servidor cadastrado</p>'; return; }
  const bindingMap = portaria ? JSON.parse(portaria.servidores || '{}') : {};
  list.innerHTML = servidores.map(srv => `
    <div class="bind-row flex items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-slate-200" data-name="${esc(srv.nome.toLowerCase())} ${esc(srv.segmento.toLowerCase())} ${esc(srv.setor.toLowerCase())}">
      <div class="flex items-center gap-3 overflow-hidden">
        <input type="checkbox" data-srv-id="${esc(srv.__backendId)}" ${bindingMap[srv.__backendId] ? 'checked' : ''} class="w-4 h-4 shrink-0 text-accent rounded border-slate-300">
        <div class="flex flex-col min-w-0"><span class="text-sm font-bold text-slate-800 truncate">${esc(srv.nome)}</span><span class="text-xs text-slate-500 truncate">${esc(srv.segmento)} - ${esc(srv.setor)}</span></div>
      </div>
      <input type="number" data-srv-hours="${esc(srv.__backendId)}" value="${bindingMap[srv.__backendId] || ''}" placeholder="0" min="0" class="w-16 p-1.5 text-sm border border-slate-300 rounded bg-slate-50 text-center shrink-0">
    </div>
  `).join('');
}

window.filterServidoresBind = function() {
  const query = document.getElementById('f-search-vinculo').value.toLowerCase();
  document.querySelectorAll('.bind-row').forEach(row => { row.style.display = row.dataset.name.includes(query) ? 'flex' : 'none'; });
}

document.getElementById('form-portaria').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isLoggedIn) return showToast('Acesso negado!', 'error');

  const servidorBinding = {};
  document.querySelectorAll('.bind-row input[type="checkbox"]').forEach(cb => {
    if (cb.checked) {
      const srvId = cb.dataset.srvId;
      const hours = document.querySelector(`input[data-srv-hours="${srvId}"]`).value || 0;
      servidorBinding[srvId] = parseInt(hours);
    }
  });

  const data = { 
    numero: document.getElementById('f-portaria-numero').value.trim(), 
    descricao: document.getElementById('f-portaria-desc').value.trim(), 
    data_publicacao: document.getElementById('f-portaria-pub').value, 
    data_validade: document.getElementById('f-portaria-validade').value, 
    tipo: document.getElementById('f-portaria-tipo').value,
    link: document.getElementById('f-portaria-link').value.trim(),
    servidores: JSON.stringify(servidorBinding), status: 'ativo' 
  };
  const selectRevoga = document.getElementById('f-portaria-revoga');
  const idRevogar = selectRevoga ? selectRevoga.value : null;

  try {
    if (editingPortaria) { await updateDoc(doc(db, "portarias", editingPortaria.__backendId), data); showToast('Portaria atualizada!'); } 
    else { await addDoc(collection(db, "portarias"), data); showToast('Portaria cadastrada!'); }
    if (idRevogar) { await updateDoc(doc(db, "portarias", idRevogar), { status: 'revogada' }); showToast('Anterior revogada!', 'success'); }
    window.closeModalPortaria(); 
  } catch (error) { showToast('Erro ao salvar no banco', 'error'); }
});

// ==========================================
// GESTÃO DE SERVIDORES
// ==========================================
window.openModalServidor = function(srvId = null) { 
  if (!isLoggedIn) return showToast('Faça login', 'warn'); 
  const srv = srvId ? servidores.find(s => s.__backendId === srvId) : null;
  editingServidor = srv;
  document.getElementById('modal-title-servidor').textContent = srv ? 'Editar Servidor' : 'Novo Servidor';
  if (srv) {
    document.getElementById('f-servidor-nome').value = srv.nome || '';
    document.getElementById('f-servidor-segmento').value = srv.segmento || '';
    document.getElementById('f-servidor-setor').value = srv.setor || '';
  } else { document.getElementById('form-servidor').reset(); }
  document.getElementById('modal-servidor').classList.remove('hidden'); document.getElementById('modal-servidor').classList.add('flex'); 
};

window.openModalImportCSV = function() { if (!isLoggedIn) return; document.getElementById('csv-input').value = ''; document.getElementById('modal-import-csv').classList.remove('hidden'); document.getElementById('modal-import-csv').classList.add('flex'); };

window.deleteServidor = async function(id) {
  if (!isLoggedIn) return;
  if(confirm("Excluir permanentemente este servidor?")) {
    try { await deleteDoc(doc(db, "servidores", id)); showToast('Excluído com sucesso'); } catch(e) { showToast('Erro', 'error'); }
  }
}

document.getElementById('form-servidor').addEventListener('submit', async (e) => {
  e.preventDefault(); if (!isLoggedIn) return;
  const data = { nome: document.getElementById('f-servidor-nome').value.trim(), segmento: document.getElementById('f-servidor-segmento').value.trim(), setor: document.getElementById('f-servidor-setor').value.trim() };
  try {
    if (editingServidor) { await updateDoc(doc(db, "servidores", editingServidor.__backendId), data); showToast('Atualizado!'); } 
    else { await addDoc(collection(db, "servidores"), data); showToast('Cadastrado!'); }
    window.closeModalServidor(); 
  } catch (error) { showToast('Erro', 'error'); }
});

// ==========================================
// IMPORTAÇÃO DE SERVIDORES (EM LOTE)
// ==========================================
// Parser simples de linha CSV com suporte a campos entre aspas
// (permite vírgulas dentro do valor, ex: "Almeida, Filippo",Docente,TI)
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { current += char; }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { result.push(current); current = ''; }
      else current += char;
    }
  }
  result.push(current);
  return result.map(s => s.trim());
}

document.getElementById('btn-process-csv')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!isLoggedIn) return showToast('Acesso negado!', 'error');
  const csvText = document.getElementById('csv-input').value.trim();
  if (!csvText) return showToast('O campo está vazio.', 'warn');
  const btn = e.currentTarget;
  btn.innerHTML = 'Importando...'; btn.disabled = true;
  const lines = csvText.split('\n').filter(l => l.trim() !== '');
  let successCount = 0; let skippedCount = 0;
  for (let line of lines) {
    const parts = parseCsvLine(line);
    if (parts.length >= 3) {
      const nome = parts[0]; const segmento = parts[1]; const setor = parts[2];
      if (nome) { try { await addDoc(collection(db, "servidores"), { nome, segmento, setor }); successCount++; } catch (e) { skippedCount++; } }
      else { skippedCount++; }
    } else { skippedCount++; }
  }
  btn.innerHTML = 'Importar'; btn.disabled = false; window.closeModalImportCSV();
  if (successCount > 0) showToast(`${successCount} servidores importados!${skippedCount ? ` (${skippedCount} linha(s) ignorada(s))` : ''}`, 'success');
  else showToast('Nenhum servidor válido encontrado no CSV.', 'warn');
});

// ==========================================
// ABA PRINCIPAL (PORTARIAS ANALÍTICAS EXPANDIDAS)
// ==========================================
window.renderPortarias = function() {
  const list = document.getElementById('portaria-list');
  const anoF = document.getElementById('filter-ano-portaria')?.value || 'Todas'; // Filtro de Ano

  let filtered = portarias.filter(p => {
    // 1. Filtro de Status
    if (currentFilter === 'revogada') {
       if (p.status !== 'revogada') return false;
    } else {
       if (p.status === 'revogada') return false; 
       const s = getStatus(p.data_validade);
       if (currentFilter !== 'all' && s.key !== currentFilter) return false;
    }

    // 2. Filtro de Ano (Lê a data de publicação)
    if (anoF !== 'Todas') {
      const pYear = p.data_publicacao ? p.data_publicacao.split('-')[0] : '';
      if (pYear !== anoF) return false;
    }

    // 3. Filtro de Busca (Lupa)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.numero||'').toLowerCase().includes(q) || (p.descricao||'').toLowerCase().includes(q);
    }
    
    return true;
  });
  
  // Ordenando de forma decrescente matemática
  filtered.sort(sortDescNum);
  
  // Atualiza as Badges respeitando o ano selecionado
  let ok = 0, warn = 0, exp = 0, total = 0;
  portarias.forEach(p => {
    if (p.status === 'revogada') return;
    
    if (anoF !== 'Todas') {
      const pYear = p.data_publicacao ? p.data_publicacao.split('-')[0] : '';
      if (pYear !== anoF) return;
    }

    const s = getStatus(p.data_validade);
    if (s.key === 'ok') ok++; else if (s.key === 'warn') warn++; else exp++;
  });
  
  document.getElementById('stat-total').textContent = ok + warn + exp; 
  document.getElementById('stat-ok').textContent = ok; 
  document.getElementById('stat-warn').textContent = warn; 
  document.getElementById('stat-expired').textContent = exp;

  if (filtered.length === 0) { list.innerHTML = ''; document.getElementById('empty-state').classList.remove('hidden'); return; }
  document.getElementById('empty-state').classList.add('hidden');

  list.innerHTML = filtered.map(p => {
    const isRevogada = p.status === 'revogada';
    const s = isRevogada ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Revogada' } : getStatus(p.data_validade); 
    const tipoTag = p.tipo ? `<span class="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">${esc(p.tipo)}</span>` : '';
    const linkBtn = p.link ? `<a href="${safeUrl(p.link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-accent hover:bg-blue-100 border border-blue-100 rounded-lg text-sm font-bold transition-colors w-full md:w-auto justify-center"><i data-lucide="external-link" style="width:16px;height:16px;"></i> Acessar Documento</a>` : '';

    const binding = JSON.parse(p.servidores || '{}');
    const srvList = Object.keys(binding).length > 0 
      ? Object.keys(binding).map(srvId => { 
          const srv = servidores.find(serv => serv.__backendId === srvId); 
          return `<span class="inline-block px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-sm">${srv ? esc(srv.nome) : 'Removido'} <strong class="text-slate-400 ml-1 font-bold">(${esc(binding[srvId])}h)</strong></span>`; 
        }).join('')
      : '<span class="text-slate-400 text-xs italic">Nenhum servidor vinculado</span>';
    
    const adminBtns = (isLoggedIn && !isRevogada) ? `
      <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-white/80 backdrop-blur-sm p-1 rounded-xl absolute bottom-6 right-6">
        <button onclick="editPortariaDirect('${esc(p.__backendId)}')" title="Editar Portaria" class="p-2 text-slate-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors"><i data-lucide="pencil" style="width:18px;height:18px;"></i></button>
        <button onclick="revokePortariaDirect('${esc(p.__backendId)}')" title="Revogar Portaria" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i data-lucide="file-x" style="width:18px;height:18px;"></i></button>
      </div>
    ` : '';

    return `
      <div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow relative group ${isRevogada ? 'opacity-70 grayscale' : ''}">
        ${adminBtns}
        <div class="flex flex-col md:flex-row md:items-start justify-between gap-6 pr-16 md:pr-0">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <h4 class="font-bold text-slate-800 text-lg">${formatPortariaNum(p.numero)}</h4>
              ${tipoTag}
              <span class="status-pill ${s.class} scale-90 origin-left m-0">${s.label}</span>
            </div>
            <p class="text-slate-600 text-sm mb-5">${esc(p.descricao)}</p>
            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Servidores Vinculados na Portaria</p>
              <div class="flex flex-wrap gap-2">${srvList}</div>
            </div>
          </div>
          <div class="shrink-0 flex flex-col md:items-end gap-3 border-t md:border-t-0 border-slate-200 pt-4 md:pt-0 min-w-[180px]">
            <div class="flex flex-row md:flex-col gap-4 md:gap-1 w-full md:text-right bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <p class="text-xs text-slate-500 uppercase font-bold tracking-wide">Publicação: <strong class="text-slate-800 font-black ml-1">${formatDate(p.data_publicacao)}</strong></p>
              <div class="w-full h-px bg-slate-200 hidden md:block my-1.5"></div>
              <p class="text-xs text-slate-500 uppercase font-bold tracking-wide">Validade: <strong class="text-slate-800 font-black ml-1">${formatDate(p.data_validade)}</strong></p>
            </div>
            ${linkBtn}
          </div>
        </div>
      </div>
    `;
  }).join('');
  if(window.lucide) lucide.createIcons();
}

// ==========================================
// ABA SERVIDORES
// ==========================================
window.renderServidores = function() {
  const list = document.getElementById('servidor-list');
  const empty = document.getElementById('servidor-empty');
  if (!list) return; 
  if (servidores.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  
  list.innerHTML = servidores.map(s => `
    <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative group flex justify-between items-center transition-all hover:border-slate-300">
      <div class="flex flex-col gap-1 pr-4 min-w-0">
        <p class="font-bold text-slate-800 text-lg truncate" title="${esc(s.nome)}">${esc(s.nome)}</p>
        <div class="flex flex-wrap gap-2 mt-2">
          <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-semibold">${esc(s.segmento)}</span>
          <span class="bg-blue-50 text-accent px-2 py-1 rounded text-xs font-semibold">${esc(s.setor)}</span>
        </div>
      </div>
      ${isLoggedIn ? `
        <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-white/80 backdrop-blur-sm p-1 rounded-xl">
          <button onclick="openModalServidor('${esc(s.__backendId)}')" title="Editar Servidor" class="p-2 text-slate-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors"><i data-lucide="pencil" style="width:18px;height:18px;"></i></button>
          <button onclick="deleteServidor('${esc(s.__backendId)}')" title="Excluir Servidor" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i data-lucide="trash-2" style="width:18px;height:18px;"></i></button>
        </div>
      ` : ''}
    </div>
  `).join('');
  if(window.lucide) lucide.createIcons();
}

// ==========================================
// JANELA DE DETALHES (USADA APENAS NO RELATÓRIO COMPACTO)
// ==========================================
window.openDetailPortaria = function(id) {
  const p = portarias.find(r => r.__backendId === id);
  if (!p) return;
  viewingPortaria = p;
  const s = p.status === 'revogada' ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Portaria Revogada' } : getStatus(p.data_validade);
  document.getElementById('detail-title-portaria').textContent = `Portaria nº ${p.numero}`;
  
  const binding = JSON.parse(p.servidores || '{}');
  const srvList = Object.keys(binding).length > 0 
    ? Object.keys(binding).map(srvId => { const srv = servidores.find(s => s.__backendId === srvId); return `<span class="inline-block px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium text-xs mr-1 mb-1 border border-slate-200">${srv ? esc(srv.nome) : 'Removido'} (${esc(binding[srvId])}h)</span>`; }).join('')
    : '<span class="text-slate-500 text-sm">Nenhum servidor</span>';
    
  const tipoHtml = p.tipo ? `<p class="text-slate-500 text-xs font-bold uppercase mb-1">Tipo</p><p class="text-slate-800 font-medium">${esc(p.tipo)}</p>` : '';
  const linkHtml = p.link ? `<a href="${safeUrl(p.link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 mt-3 text-sm font-bold text-accent hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors w-fit"><i data-lucide="external-link" style="width:16px;height:16px;"></i> Ver documento oficial</a>` : '';

  document.getElementById('detail-body-portaria').innerHTML = `
    <div><span class="status-pill ${s.class}">${s.label}</span></div>
    <p class="text-slate-800 font-medium mt-2 text-lg">${esc(p.descricao)}</p>
    ${linkHtml}
    <div class="grid grid-cols-2 gap-3 text-sm mt-5">
      <div class="bg-slate-50 p-3 rounded-lg"><p class="text-slate-500 text-[10px] uppercase font-bold">Publicação</p><p class="text-slate-800 font-medium">${formatDate(p.data_publicacao)}</p></div>
      <div class="bg-slate-50 p-3 rounded-lg"><p class="text-slate-500 text-[10px] uppercase font-bold">Validade</p><p class="text-slate-800 font-medium">${formatDate(p.data_validade)}</p></div>
    </div>
    <div class="mt-5"><p class="text-slate-500 text-xs mb-2 uppercase font-bold tracking-wide">Servidores Vinculados</p><div>${srvList}</div></div>
  `;
  document.getElementById('modal-detail-portaria').classList.remove('hidden'); document.getElementById('modal-detail-portaria').classList.add('flex');
  document.getElementById('btn-edit-portaria').style.display = (isLoggedIn && p.status !== 'revogada') ? 'flex' : 'none';
  document.getElementById('btn-revoke-portaria').style.display = (isLoggedIn && p.status !== 'revogada') ? 'flex' : 'none';
  if(window.lucide) lucide.createIcons();
}

document.getElementById('btn-edit-portaria').addEventListener('click', () => { 
  if (viewingPortaria) { const temp = viewingPortaria; window.closeDetailPortaria(); window.openModalPortaria(temp); } 
});
document.getElementById('btn-revoke-portaria').addEventListener('click', async () => {
  if (!viewingPortaria || !isLoggedIn) return;
  try { await updateDoc(doc(db, "portarias", viewingPortaria.__backendId), { status: 'revogada' }); window.closeDetailPortaria(); showToast('Portaria revogada!'); } 
  catch (error) { showToast('Erro', 'error'); }
});

// ==========================================
// RELATÓRIOS (COM HISTÓRICO CLICÁVEL)
// ==========================================
window.toggleServidorPorts = function(id) {
  const el = document.getElementById('expand-srv-' + id);
  const icon = document.getElementById('icon-srv-' + id);
  if(el) {
    el.classList.toggle('hidden');
    icon.style.transform = el.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
  }
}

window.togglePortariaDetails = function(id) {
  const el = document.getElementById('expand-port-' + id);
  const iconDesk = document.getElementById('icon-port-desk-' + id);
  if(el) {
    el.classList.toggle('hidden');
    const rotate = el.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    if(iconDesk) iconDesk.style.transform = rotate;
  }
}

window.renderRelatorios = function() {
  // RELATÓRIO DE SERVIDORES
  const srvHoras = {}; const srvPortarias = {}; let totalHoras = 0;
  servidores.forEach(s => { srvHoras[s.__backendId] = 0; srvPortarias[s.__backendId] = 0; });
  
  portarias.forEach(p => {
    // IGNORA APENAS AS VENCIDAS E REVOGADAS
    if (p.status === 'revogada' || getStatus(p.data_validade).key === 'expired') return; 
    
    const binding = JSON.parse(p.servidores || '{}');
    Object.keys(binding).forEach(srvId => { 
      srvHoras[srvId] = (srvHoras[srvId] || 0) + binding[srvId]; 
      srvPortarias[srvId] = (srvPortarias[srvId] || 0) + 1; 
      totalHoras += binding[srvId]; 
    });
  });
  
  document.getElementById('stat-srv-total').textContent = servidores.length; 
  document.getElementById('stat-srv-horas').textContent = totalHoras;

  const srvDiv = document.getElementById('relatorio-servidores'); 
  const srvEmpty = document.getElementById('relatorio-servidores-empty');
  
  if (srvDiv) {
    let srvFiltrados = [...servidores]; 
    if (searchRelSrvQuery) {
      const q = searchRelSrvQuery.toLowerCase();
      srvFiltrados = srvFiltrados.filter(s => s.nome.toLowerCase().includes(q));
    }

    srvFiltrados.sort((a, b) => (srvHoras[b.__backendId] || 0) - (srvHoras[a.__backendId] || 0));

    if (srvFiltrados.length === 0) { 
      srvDiv.innerHTML = ''; srvEmpty.classList.remove('hidden'); 
    } else {
      srvEmpty.classList.add('hidden');
      srvDiv.innerHTML = srvFiltrados.map(s => {
        
        const allLinkedPorts = portarias.filter(p => {
          const binding = JSON.parse(p.servidores || '{}');
          return binding[s.__backendId] !== undefined;
        });
        
        // Separação Inteligente: Ativas (Vigentes + Indeterminadas) e Inativas (Revogadas + Vencidas)
        const activePorts = allLinkedPorts.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key !== 'expired');
        const inactivePorts = allLinkedPorts.filter(p => p.status === 'revogada' || getStatus(p.data_validade).key === 'expired');

        // Ordenando de forma decrescente matemática
        activePorts.sort(sortDescNum);
        inactivePorts.sort(sortDescNum);

        const activeHtml = activePorts.length > 0 
          ? activePorts.map(p => {
              const inner = `<strong class="text-slate-800">Nº ${esc(p.numero)} - DRG/PEP/IFSP</strong> - ${esc(p.descricao)}`;
              return p.link 
                ? `<a href="${safeUrl(p.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="block text-xs text-slate-600 py-2 border-b border-slate-100 last:border-0 hover:bg-blue-50 hover:text-blue-700 transition-colors px-2 rounded cursor-pointer">${inner}</a>`
                : `<div class="text-xs text-slate-600 py-2 border-b border-slate-100 last:border-0 px-2 rounded">${inner}</div>`;
            }).join('')
          : '<div class="text-xs text-slate-400 py-2 italic px-2">Nenhuma portaria ativa</div>';
          
        const inactiveHtml = inactivePorts.length > 0
          ? `<p class="text-[10px] font-bold text-red-400 uppercase tracking-wider mt-4 mb-1 px-2">Histórico: Revogadas / Vencidas</p>` + 
            inactivePorts.map(p => {
              const labelStatus = p.status === 'revogada' ? 'Revogada' : 'Vencida';
              const inner = `<strong class="text-slate-700">Nº ${esc(p.numero)} - DRG/PEP/IFSP</strong> <span class="bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[9px] font-bold ml-1 uppercase">${labelStatus}</span><br/><span class="line-clamp-1 mt-0.5">${esc(p.descricao)}</span>`;
              return p.link
                ? `<a href="${safeUrl(p.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="block text-xs text-slate-500 py-2 border-b border-slate-100 last:border-0 hover:bg-red-50 hover:text-red-700 transition-colors px-2 rounded bg-slate-50 opacity-90 cursor-pointer">${inner}</a>`
                : `<div class="text-xs text-slate-500 py-2 border-b border-slate-100 last:border-0 px-2 rounded bg-slate-50 opacity-80">${inner}</div>`;
            }).join('')
          : '';

        return `
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-colors cursor-pointer group" onclick="toggleServidorPorts('${esc(s.__backendId)}')">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="font-bold text-slate-800 text-base truncate">${esc(s.nome)}</p>
                  <i id="icon-srv-${esc(s.__backendId)}" data-lucide="chevron-down" style="width:16px;height:16px;" class="text-slate-400 transition-transform"></i>
                </div>
                <p class="text-slate-500 text-xs mt-1 font-medium">${esc(s.segmento)} • ${esc(s.setor)}</p>
              </div>
              <div class="flex gap-3 shrink-0">
                <div class="flex items-center gap-1.5 text-slate-700 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg border border-amber-100 font-bold text-sm"><i data-lucide="clock" style="width:16px;height:16px;"></i> ${srvHoras[s.__backendId] || 0}h</div>
                <div class="flex items-center gap-1.5 text-slate-700 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-100 font-bold text-sm"><i data-lucide="file-text" style="width:16px;height:16px;"></i> ${srvPortarias[s.__backendId] || 0} port.</div>
              </div>
            </div>
            <div id="expand-srv-${esc(s.__backendId)}" class="hidden mt-4 pt-2 border-t border-slate-100 w-full" onclick="event.stopPropagation()">
              <p class="text-[10px] font-bold text-slate-400 uppercase mb-1 px-2">Portarias Vigentes</p>
              ${activeHtml} ${inactiveHtml}
            </div>
          </div>`;
      }).join('');
    }
  }

  // RELATÓRIO DE PORTARIAS
  const filterTipo = document.getElementById('filter-tipo-rel-portaria')?.value || 'Todas';
  const filterAnoRel = document.getElementById('filter-ano-rel-portaria')?.value || 'Todas'; // NOVO: Filtro Ano

  let portariasFiltradas = portarias;
  
  if (filterTipo !== 'Todas') { 
    portariasFiltradas = portariasFiltradas.filter(p => p.tipo === filterTipo); 
  }
  
  if (filterAnoRel !== 'Todas') {
    portariasFiltradas = portariasFiltradas.filter(p => {
      const pYear = p.data_publicacao ? p.data_publicacao.split('-')[0] : '';
      return pYear === filterAnoRel;
    });
  }
  
  const vigentes = portariasFiltradas.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'ok').sort(sortDescNum);
  const aVencer = portariasFiltradas.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'warn').sort(sortDescNum);
  const vencidas = portariasFiltradas.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'expired').sort(sortDescNum);
  const revogadas = portariasFiltradas.filter(p => p.status === 'revogada').sort(sortDescNum); 

  document.getElementById('stat-port-vigentes').textContent = vigentes.length; 
  document.getElementById('stat-port-vencer').textContent = aVencer.length; 
  document.getElementById('stat-port-vencidas').textContent = vencidas.length;
  document.getElementById('stat-port-revogadas').textContent = revogadas.length;

  const renderPortariaListExpandable = (arr, divId) => {
    const div = document.getElementById(divId);
    if (!div) return;
    if (arr.length === 0) { 
      div.innerHTML = '<p class="text-slate-500 text-sm font-medium p-4 bg-white rounded-xl border border-slate-200 text-center shadow-sm">Nenhuma portaria encontrada</p>'; 
    } else {
      div.innerHTML = arr.map(p => {
        const isRevogada = p.status === 'revogada';
        const s = isRevogada ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Revogada' } : getStatus(p.data_validade); 
        const tipoTag = p.tipo ? `<span class="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ml-1">${esc(p.tipo)}</span>` : '';
        
        const binding = JSON.parse(p.servidores || '{}');
        const srvList = Object.keys(binding).map(srvId => { 
          const srv = servidores.find(serv => serv.__backendId === srvId); 
          return `<span class="inline-block px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-700 shadow-sm mb-1 mr-1">${srv ? esc(srv.nome) : 'Removido'} (${esc(binding[srvId])}h)</span>`; 
        }).join('') || '<span class="text-slate-400 text-xs italic">Nenhum servidor vinculado</span>';

        const linkBtn = p.link ? `<a href="${safeUrl(p.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-50 text-accent hover:bg-blue-100 border border-blue-100 rounded-lg text-xs font-bold transition-colors w-full mt-2 md:mt-0"><i data-lucide="external-link" style="width:14px;height:14px;"></i> Acessar Documento</a>` : '';

        return `
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-colors cursor-pointer group ${isRevogada ? 'opacity-70 grayscale' : ''}" onclick="togglePortariaDetails('${esc(p.__backendId)}')">
            <div class="flex items-center justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex gap-2 items-center flex-wrap">
                  <span class="font-bold text-slate-800 text-base truncate">Nº ${esc(p.numero)} - DRG/PEP/IFSP</span>
                  ${tipoTag}
                  <span class="status-pill ${s.class} scale-90 origin-left m-0">${s.label}</span>
                </div>
                <p class="text-slate-600 text-sm mt-1 line-clamp-1">${esc(p.descricao)}</p>
              </div>
              <i id="icon-port-desk-${esc(p.__backendId)}" data-lucide="chevron-down" style="width:20px;height:20px;" class="text-slate-400 transition-transform hidden md:block shrink-0"></i>
            </div>
            <div id="expand-port-${esc(p.__backendId)}" class="hidden mt-4 pt-4 border-t border-slate-100 w-full cursor-default" onclick="event.stopPropagation()">
              <div class="flex flex-col md:flex-row justify-between gap-5">
                <div class="flex-1"><p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Servidores Vinculados</p><div>${srvList}</div></div>
                <div class="flex flex-col gap-3 md:items-end shrink-0">
                  <div class="flex gap-3 text-sm bg-slate-50 p-2.5 rounded-xl border border-slate-200 w-full md:w-auto">
                    <span><strong class="text-slate-500 text-[10px] uppercase block mb-0.5">Publicação</strong> ${formatDate(p.data_publicacao)}</span>
                    <div class="w-px bg-slate-200"></div>
                    <span><strong class="text-slate-500 text-[10px] uppercase block mb-0.5">Validade</strong> ${formatDate(p.data_validade)}</span>
                  </div>
                  ${linkBtn}
                </div>
              </div>
            </div>
          </div>`;
      }).join('');
    }
  };

  renderPortariaListExpandable(vigentes, 'relatorio-vigentes'); 
  renderPortariaListExpandable(aVencer, 'relatorio-vencer'); 
  renderPortariaListExpandable(vencidas, 'relatorio-vencidas');
  renderPortariaListExpandable(revogadas, 'relatorio-revogadas'); 
  if(window.lucide) lucide.createIcons();
}

// ==========================================
// EVENTOS E MENUS LATERAL
// ==========================================
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const sidebar = document.getElementById('sidebar');
let isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

function applySidebarState() {
  if (!sidebar) return;
  const texts = document.querySelectorAll('.sidebar-text');
  if (isSidebarCollapsed) {
    sidebar.classList.remove('w-64', 'px-4'); sidebar.classList.add('w-20', 'px-2'); 
    texts.forEach(el => el.style.display = 'none');
    document.querySelectorAll('.sidebar-btn').forEach(btn => { btn.classList.remove('px-4'); btn.classList.add('px-0', 'justify-center'); });
  } else {
    sidebar.classList.remove('w-20', 'px-2'); sidebar.classList.add('w-64', 'px-4');
    texts.forEach(el => el.style.display = 'block');
    document.querySelectorAll('.sidebar-btn').forEach(btn => { btn.classList.remove('px-0', 'justify-center'); btn.classList.add('px-4'); });
  }
}
applySidebarState();
if (btnToggleSidebar) {
  btnToggleSidebar.addEventListener('click', () => { isSidebarCollapsed = !isSidebarCollapsed; localStorage.setItem('sidebarCollapsed', isSidebarCollapsed); applySidebarState(); });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active', 'bg-blue-50', 'text-accent'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active', 'bg-blue-50', 'text-accent'); 
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    if (tab.startsWith('rel-')) window.renderRelatorios(); 
    if(window.lucide) lucide.createIcons();
  });
});

document.querySelectorAll('.tab-rel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-rel-btn').forEach(b => {
      b.classList.remove('active', 'bg-blue-50', 'text-accent');
      b.classList.add('bg-transparent', 'text-slate-500');
    });
    document.querySelectorAll('[id^="rel-"][id$="-content"]').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active', 'bg-blue-50', 'text-accent');
    btn.classList.remove('bg-transparent', 'text-slate-500');
    document.getElementById(`rel-${btn.dataset.tabRel}-content`).classList.remove('hidden');
  });
});

document.getElementById('btn-new-portaria').addEventListener('click', (e) => { e.preventDefault(); window.openModalPortaria(); });
document.getElementById('btn-new-servidor').addEventListener('click', (e) => { e.preventDefault(); window.openModalServidor(); });
document.getElementById('btn-import-csv').addEventListener('click', (e) => { e.preventDefault(); window.openModalImportCSV(); });

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => {
      const isRevogadaBtn = b.dataset.filter === 'revogada';
      b.classList.remove('bg-accent', 'bg-red-100', 'text-white', 'text-red-700', 'shadow-sm');
      b.classList.add('bg-transparent', 'text-slate-500');
      b.classList.toggle('hover:text-red-600', isRevogadaBtn);
      b.classList.toggle('hover:bg-red-50', isRevogadaBtn);
      b.classList.toggle('hover:text-slate-800', !isRevogadaBtn);
      b.classList.toggle('hover:bg-slate-50', !isRevogadaBtn);
    });
    const isRevogada = btn.dataset.filter === 'revogada';
    btn.classList.remove('bg-transparent', 'text-slate-500', 'hover:text-red-600', 'hover:bg-red-50', 'hover:text-slate-800', 'hover:bg-slate-50');
    btn.classList.add('shadow-sm');
    btn.classList.add(...(isRevogada ? ['bg-red-100', 'text-red-700'] : ['bg-accent', 'text-white']));
    renderPortarias();
  });
});

document.getElementById('search-input').addEventListener('input', (e) => { searchQuery = e.target.value; renderPortarias(); });
document.getElementById('search-rel-srv')?.addEventListener('input', (e) => { searchRelSrvQuery = e.target.value; window.renderRelatorios(); });

// ESCUTADORES DOS NOVOS FILTROS DE ANO
document.getElementById('filter-ano-portaria')?.addEventListener('change', window.renderPortarias);
document.getElementById('filter-ano-rel-portaria')?.addEventListener('change', window.renderRelatorios);
document.getElementById('filter-tipo-rel-portaria')?.addEventListener('change', window.renderRelatorios);

function downloadCSV(filename, data) { 
  const blob = new Blob([data.join('\n')], { type: 'text/csv;charset=utf-8;' }); 
  const link = document.createElement('a'); 
  link.href = URL.createObjectURL(blob); 
  link.download = filename; 
  document.body.appendChild(link); 
  link.click(); 
  document.body.removeChild(link); 
}

function csvField(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

document.getElementById('btn-export-servidores').addEventListener('click', (e) => {
  e.preventDefault();
  if (servidores.length === 0) return showToast('Não há servidores para exportar', 'warn');
  const srvHoras = {}; const srvPortarias = {};
  servidores.forEach(s => { srvHoras[s.__backendId] = 0; srvPortarias[s.__backendId] = 0; });
  portarias.forEach(p => {
    if (p.status === 'revogada' || getStatus(p.data_validade).key === 'expired') return;
    const binding = JSON.parse(p.servidores || '{}');
    Object.keys(binding).forEach(srvId => { srvHoras[srvId] = (srvHoras[srvId] || 0) + binding[srvId]; srvPortarias[srvId] = (srvPortarias[srvId] || 0) + 1; });
  });
  const csv = ['"Nome","Segmento","Setor","Total de Horas","Quantidade de Portarias Ativas"'];
  servidores.forEach(s => { csv.push(`${csvField(s.nome)},${csvField(s.segmento)},${csvField(s.setor)},${srvHoras[s.__backendId] || 0},${srvPortarias[s.__backendId] || 0}`); });
  downloadCSV(`relatorio_servidores_${new Date().toISOString().split('T')[0]}.csv`, csv); showToast('Download iniciado!', 'success');
});

document.getElementById('btn-export-portarias').addEventListener('click', (e) => {
  e.preventDefault();
  if (portarias.length === 0) return showToast('Não há portarias para exportar', 'warn');
  const csv = ['"Número","Descrição","Tipo","Link","Data Publicação","Data Validade","Status"'];
  portarias.forEach(p => {
    const s = p.status === 'revogada' ? 'Revogada' : getStatus(p.data_validade).label;
    csv.push(`${csvField(p.numero)},${csvField(p.descricao)},${csvField(p.tipo)},${csvField(p.link)},${csvField(p.data_publicacao)},${csvField(p.data_validade)},${csvField(s)}`);
  });
  downloadCSV(`relatorio_portarias_${new Date().toISOString().split('T')[0]}.csv`, csv); showToast('Download iniciado!', 'success');
});

// INICIALIZAÇÃO DA INTERFACE DO USUÁRIO
updateAdminUI();
if(window.lucide) lucide.createIcons();
