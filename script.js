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
// 2. SEGURANÇA E AUXILIARES
// ==========================================
let inactivityTimer;
const TEMPO_LIMITE_MINUTOS = 5; 
const INACTIVITY_TIME_MS = TEMPO_LIMITE_MINUTOS * 60 * 1000; 

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (isLoggedIn) {
    inactivityTimer = setTimeout(async () => {
      await signOut(auth);
      showToast(`Sessão expirada por inatividade.`, 'error');
    }, INACTIVITY_TIME_MS);
  }
}

['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(e => document.addEventListener(e, resetInactivityTimer));

window.closeModalLogin = () => { document.getElementById('modal-login').classList.add('hidden'); }
window.closeModalPortaria = () => { document.getElementById('modal-portaria').classList.add('hidden'); editingPortaria = null; }
window.closeModalServidor = () => { document.getElementById('modal-servidor').classList.add('hidden'); editingServidor = null; }
window.closeModalImportCSV = () => { document.getElementById('modal-import-csv').classList.add('hidden'); }
window.closeDetailPortaria = () => { document.getElementById('modal-detail-portaria').classList.add('hidden'); viewingPortaria = null; }

function updateAdminUI() {
  const loginBtn = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');
  const menuServidores = document.getElementById('menu-servidores');
  if (isLoggedIn) {
    loginBtn.classList.add('hidden'); logoutBtn.classList.remove('hidden');
    document.querySelectorAll('#btn-new-portaria, #btn-new-servidor, #btn-import-csv').forEach(el => el.classList.remove('hidden'));
    menuServidores?.classList.remove('hidden');
  } else {
    loginBtn.classList.remove('hidden'); logoutBtn.classList.add('hidden');
    document.querySelectorAll('#btn-new-portaria, #btn-new-servidor, #btn-import-csv').forEach(el => el.classList.add('hidden'));
    menuServidores?.classList.add('hidden');
  }
}

function formatDate(d) { if (!d) return 'Indeterminada'; const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; }

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeft = type === 'success' ? '4px solid #10b981' : '4px solid #ef4444';
  t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3000);
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
  let n = num.trim().toUpperCase().replace(/\\/g, '/');
  return n.includes('DRG/PEP/IFSP') ? `Nº ${n}` : `Nº ${n} - DRG/PEP/IFSP`;
}

// ==========================================
// 3. LOGICA DE REVOGAÇÃO (MELHORADA)
// ==========================================
function renderRevogaOptions(query = '') {
  const select = document.getElementById('f-portaria-revoga');
  if (!select) return;

  const q = query.toLowerCase();
  
  // Filtramos portarias que não estão revogadas e ignoramos a que está sendo editada
  let disponiveis = portarias.filter(p => 
    p.status !== 'revogada' && 
    (!editingPortaria || p.__backendId !== editingPortaria.__backendId)
  );

  // Filtro de busca
  if (q) {
    disponiveis = disponiveis.filter(p => 
      p.numero.toLowerCase().includes(q) || 
      p.descricao.toLowerCase().includes(q)
    );
  }

  // Ordenação: Mostra as MAIS RECENTES primeiro (por data de publicação)
  disponiveis.sort((a, b) => (b.data_publicacao || '').localeCompare(a.data_publicacao || ''));

  let html = '<option value="">-- Nenhuma selecionada --</option>';
  disponiveis.forEach(p => {
    // Mostramos o número e um pedaço da descrição para facilitar a identificação
    const descCurta = p.descricao.length > 45 ? p.descricao.substring(0, 45) + '...' : p.descricao;
    html += `<option value="${p.__backendId}">Nº ${p.numero} (${formatDate(p.data_publicacao)}) - ${descCurta}</option>`;
  });

  select.innerHTML = html;
}

// Escutador do campo de busca de revogação
document.getElementById('f-search-revoga')?.addEventListener('input', (e) => {
  renderRevogaOptions(e.target.value);
});

// ==========================================
// 4. SINCRONIZAÇÃO E CADASTRO
// ==========================================
onAuthStateChanged(auth, user => { isLoggedIn = !!user; updateAdminUI(); renderServidores(); renderPortarias(); resetInactivityTimer(); });

onSnapshot(collection(db, "portarias"), snapshot => {
  portarias = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  renderPortarias(); renderRelatorios();
});

onSnapshot(collection(db, "servidores"), snapshot => {
  servidores = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  servidores.sort((a,b) => a.nome.localeCompare(b.nome));
  renderServidores(); renderPortarias(); renderRelatorios();
});

document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, document.getElementById('f-login-user').value, document.getElementById('f-login-pass').value); window.closeModalLogin(); showToast('Acesso autorizado!'); } 
  catch (err) { showToast('Usuário ou senha inválidos', 'error'); }
});
document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

window.openModalPortaria = function(portaria = null) {
  if (!isLoggedIn) return showToast('Área restrita ao Administrador', 'error');
  editingPortaria = portaria;
  document.getElementById('modal-title-portaria').textContent = portaria ? 'Editar Portaria' : 'Nova Portaria';
  document.getElementById('form-portaria').reset();
  document.getElementById('f-search-revoga').value = ''; // Limpa a busca ao abrir

  if (portaria) {
    document.getElementById('f-portaria-numero').value = portaria.numero || '';
    document.getElementById('f-portaria-pub').value = portaria.data_publicacao || '';
    document.getElementById('f-portaria-desc').value = portaria.descricao || '';
    document.getElementById('f-portaria-validade').value = portaria.data_validade || '';
    document.getElementById('f-portaria-tipo').value = portaria.tipo || '';
    document.getElementById('f-portaria-link').value = portaria.link || '';
  }

  renderRevogaOptions(); // Popula o select de revogação
  renderServidorBindingList(portaria);
  document.getElementById('modal-portaria').classList.remove('hidden');
};

document.getElementById('form-portaria').addEventListener('submit', async e => {
  e.preventDefault();
  const binding = {};
  document.querySelectorAll('.bind-row input[type="checkbox"]:checked').forEach(cb => {
    binding[cb.dataset.srvId] = parseInt(document.querySelector(`input[data-srv-hours="${cb.dataset.srvId}"]`).value || 0);
  });

  const data = {
    numero: document.getElementById('f-portaria-numero').value.trim(),
    descricao: document.getElementById('f-portaria-desc').value.trim(),
    data_publicacao: document.getElementById('f-portaria-pub').value,
    data_validade: document.getElementById('f-portaria-validade').value,
    tipo: document.getElementById('f-portaria-tipo').value,
    link: document.getElementById('f-portaria-link').value.trim(),
    servidores: JSON.stringify(binding), status: 'ativo'
  };

  const idRevogar = document.getElementById('f-portaria-revoga').value;

  try {
    if (editingPortaria) await updateDoc(doc(db, "portarias", editingPortaria.__backendId), data);
    else await addDoc(collection(db, "portarias"), data);
    
    if (idRevogar) await updateDoc(doc(db, "portarias", idRevogar), { status: 'revogada' });
    
    window.closeModalPortaria(); showToast('Salvo com sucesso!');
  } catch (err) { showToast('Erro ao salvar no banco', 'error'); }
});

// ==========================================
// 5. GESTÃO DE SERVIDORES
// ==========================================
window.openModalServidor = function(id = null) {
  if (!isLoggedIn) return;
  editingServidor = id ? servidores.find(s => s.__backendId === id) : null;
  document.getElementById('modal-title-servidor').textContent = editingServidor ? 'Editar Servidor' : 'Novo Servidor';
  document.getElementById('form-servidor').reset();
  if (editingServidor) {
    document.getElementById('f-servidor-nome').value = editingServidor.nome;
    document.getElementById('f-servidor-segmento').value = editingServidor.segmento;
    document.getElementById('f-servidor-setor').value = editingServidor.setor;
  }
  document.getElementById('modal-servidor').classList.remove('hidden');
};

document.getElementById('form-servidor').addEventListener('submit', async e => {
  e.preventDefault();
  const data = { nome: document.getElementById('f-servidor-nome').value.trim(), segmento: document.getElementById('f-servidor-segmento').value, setor: document.getElementById('f-servidor-setor').value.trim() };
  try {
    if (editingServidor) await updateDoc(doc(db, "servidores", editingServidor.__backendId), data);
    else await addDoc(collection(db, "servidores"), data);
    window.closeModalServidor(); showToast('Servidor salvo!');
  } catch (e) {}
});

window.deleteServidor = async id => {
  if (confirm("Excluir permanentemente este servidor?")) await deleteDoc(doc(db, "servidores", id));
};

document.getElementById('btn-process-csv')?.addEventListener('click', async e => {
  const txt = document.getElementById('csv-input').value.trim();
  if (!txt) return;
  e.currentTarget.disabled = true;
  for (let line of txt.split('\n')) {
    const p = line.split(',');
    if (p.length >= 3) await addDoc(collection(db, "servidores"), { nome: p[0].trim(), segmento: p[1].trim(), setor: p[2].trim() });
  }
  window.closeModalImportCSV(); showToast('Importação concluída!');
});

// ==========================================
// 6. RENDERIZAÇÃO DE LISTAS E RELATÓRIOS
// ==========================================
window.renderPortarias = function() {
  const list = document.getElementById('portaria-list');
  let f = portarias.filter(p => {
    if (currentFilter === 'revogada') return p.status === 'revogada';
    if (p.status === 'revogada') return false;
    const s = getStatus(p.data_validade);
    if (currentFilter !== 'all' && s.key !== currentFilter) return false;
    return !searchQuery || p.numero.toLowerCase().includes(searchQuery.toLowerCase()) || p.descricao.toLowerCase().includes(searchQuery.toLowerCase());
  });

  f.sort((a,b) => (b.data_publicacao || '').localeCompare(a.data_publicacao || ''));

  let stats = { total: 0, ok: 0, warn: 0, exp: 0 };
  portarias.forEach(p => { if(p.status!=='revogada'){ const s = getStatus(p.data_validade); stats.total++; stats[s.key]++; } });
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-ok').textContent = stats.ok;
  document.getElementById('stat-warn').textContent = stats.warn;
  document.getElementById('stat-expired').textContent = stats.exp;

  if (!f.length) { list.innerHTML = ''; document.getElementById('empty-state').classList.remove('hidden'); return; }
  document.getElementById('empty-state').classList.add('hidden');

  list.innerHTML = f.map(p => {
    const s = p.status === 'revogada' ? { class: 'bg-slate-200 text-slate-600', label: 'Revogada' } : getStatus(p.data_validade);
    const bind = JSON.parse(p.servidores || '{}');
    const srvs = Object.keys(bind).map(id => {
      const srv = servidores.find(s => s.__backendId === id);
      return `<span class="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-semibold">${srv ? srv.nome : 'Removido'} (${bind[id]}h)</span>`;
    }).join('') || '<span class="text-xs italic text-slate-400">Nenhum vínculo</span>';

    return `
      <div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm relative group ${p.status==='revogada'?'opacity-60 grayscale':''}">
        ${isLoggedIn && p.status!=='revogada' ? `<div class="absolute bottom-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onclick="openModalPortaria(portarias.find(x=>x.__backendId==='${p.__backendId}'))" class="p-2 bg-white shadow rounded-lg hover:text-accent"><i data-lucide="pencil" style="width:16px;"></i></button></div>`:''}
        <div class="flex flex-col md:flex-row justify-between gap-6">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <h4 class="font-bold text-slate-800 text-lg">${formatPortariaNum(p.numero)}</h4>
              <span class="status-pill ${s.class} scale-90 m-0">${s.label}</span>
            </div>
            <p class="text-slate-600 text-sm mb-4">${p.descricao}</p>
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-wrap gap-2">${srvs}</div>
          </div>
          <div class="shrink-0 flex flex-col md:items-end gap-3">
             <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 text-[10px] uppercase font-bold text-slate-500">
               Pub: <span class="text-slate-800">${formatDate(p.data_publicacao)}</span><br>
               Val: <span class="text-slate-800">${formatDate(p.data_validade)}</span>
             </div>
             ${p.link ? `<a href="${p.link}" target="_blank" class="px-4 py-2 bg-blue-50 text-accent rounded-lg text-xs font-bold hover:bg-blue-100 flex items-center gap-2"><i data-lucide="external-link" style="width:14px;"></i> Ver Portaria</a>`:''}
          </div>
        </div>
      </div>`;
  }).join('');
  lucide.createIcons();
};

window.renderServidores = function() {
  const list = document.getElementById('servidor-list');
  if (!list) return;
  list.innerHTML = servidores.map(s => `
    <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm group relative flex justify-between items-center">
      <div class="min-w-0"><p class="font-bold text-slate-800 truncate">${s.nome}</p><p class="text-[10px] text-slate-400 mt-1">${s.segmento} • ${s.setor}</p></div>
      ${isLoggedIn ? `<div class="flex gap-1"><button onclick="openModalServidor('${s.__backendId}')" class="p-2 text-slate-400 hover:text-accent"><i data-lucide="pencil" style="width:14px;"></i></button><button onclick="deleteServidor('${s.__backendId}')" class="p-2 text-slate-400 hover:text-red-500"><i data-lucide="trash-2" style="width:14px;"></i></button></div>`:''}
    </div>`).join('');
  lucide.createIcons();
};

function renderServidorBindingList(portaria) {
  const list = document.getElementById('servidor-binding-list');
  const bindingMap = portaria ? JSON.parse(portaria.servidores || '{}') : {};
  list.innerHTML = servidores.map(s => `
    <div class="bind-row flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200" data-name="${s.nome.toLowerCase()}">
      <div class="flex items-center gap-2"><input type="checkbox" data-srv-id="${s.__backendId}" ${bindingMap[s.__backendId]?'checked':''} class="w-4 h-4"><span class="text-xs font-bold">${s.nome}</span></div>
      <input type="number" data-srv-hours="${s.__backendId}" value="${bindingMap[s.__backendId]||''}" placeholder="0" class="w-12 p-1 text-xs border rounded text-center">
    </div>`).join('');
}

window.filterServidoresBind = () => {
  const q = document.getElementById('f-search-vinculo').value.toLowerCase();
  document.querySelectorAll('.bind-row').forEach(r => r.style.display = r.dataset.name.includes(q) ? 'flex' : 'none');
};

window.renderRelatorios = function() {
  const srvH = {}; servidores.forEach(s => srvH[s.__backendId] = 0);
  portarias.forEach(p => {
    if (p.status==='revogada' || getStatus(p.data_validade).key==='expired') return;
    const b = JSON.parse(p.servidores || '{}');
    Object.keys(b).forEach(id => srvH[id] = (srvH[id]||0) + b[id]);
  });
  document.getElementById('stat-srv-total').textContent = servidores.length;
  document.getElementById('stat-srv-horas').textContent = Object.values(srvH).reduce((a,b)=>a+b,0);
  
  const div = document.getElementById('relatorio-servidores');
  div.innerHTML = servidores.sort((a,b) => srvH[b.__backendId] - srvH[a.__backendId]).map(s => `
    <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm cursor-pointer" onclick="this.querySelector('.exp').classList.toggle('hidden')">
      <div class="flex justify-between items-center">
        <div class="min-w-0"><p class="font-bold text-slate-800 text-sm">${s.nome}</p><p class="text-[10px] text-slate-400">${s.segmento}</p></div>
        <div class="flex gap-2"><span class="bg-amber-50 text-amber-700 px-3 py-1 rounded-lg font-bold text-xs">${srvH[s.__backendId]}h</span></div>
      </div>
      <div class="exp hidden mt-3 pt-3 border-t border-slate-100 space-y-2">
        ${portarias.filter(p => JSON.parse(p.servidores||'{}')[s.__backendId]!==undefined).map(p => `
          <div class="text-[10px] text-slate-500 py-1 border-b border-slate-50 last:border-0">
            <span class="font-bold text-slate-700">${p.numero}</span> - ${p.status==='revogada'?'REVOGADA':getStatus(p.data_validade).label}
          </div>`).join('') || '<p class="text-[10px] italic">Sem histórico</p>'}
      </div>
    </div>`).join('');

  // Portarias Relatório
  const typeF = document.getElementById('filter-tipo-rel-portaria').value;
  const ps = typeF === 'Todas' ? portarias : portarias.filter(p => p.tipo === typeF);
  const vig = ps.filter(p => p.status!=='revogada' && getStatus(p.data_validade).key==='ok');
  const ven = ps.filter(p => p.status!=='revogada' && getStatus(p.data_validade).key==='expired');
  const war = ps.filter(p => p.status!=='revogada' && getStatus(p.data_validade).key==='warn');
  const rev = ps.filter(p => p.status==='revogada');

  document.getElementById('stat-port-vigentes').textContent = vig.length;
  document.getElementById('stat-port-vencidas').textContent = ven.length;
  document.getElementById('stat-port-vencer').textContent = war.length;
  document.getElementById('stat-port-revogadas').textContent = rev.length;

  const renderL = (arr, id) => {
    document.getElementById(id).innerHTML = arr.map(p => `
      <div class="bg-white border border-slate-200 rounded-xl p-3 text-xs">
        <div class="flex justify-between items-center mb-1">
          <span class="font-bold text-slate-800">${formatPortariaNum(p.numero)}</span>
          <span class="text-[10px] text-slate-400">${formatDate(p.data_publicacao)}</span>
        </div>
        <p class="text-slate-500 line-clamp-1">${p.descricao}</p>
      </div>`).join('') || '<p class="text-xs text-center p-4 text-slate-400">Nenhuma encontrada</p>';
  };
  renderL(vig, 'relatorio-vigentes'); renderL(war, 'relatorio-vencer'); renderL(ven, 'relatorio-vencidas'); renderL(rev, 'relatorio-revogadas');
  lucide.createIcons();
};

document.getElementById('filter-tipo-rel-portaria').addEventListener('change', renderRelatorios);
document.getElementById('search-input').addEventListener('input', e => { searchQuery = e.target.value; renderPortarias(); });
document.getElementById('search-rel-srv').addEventListener('input', e => { searchRelSrvQuery = e.target.value; renderRelatorios(); });

document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active', 'bg-blue-50', 'text-accent'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  btn.classList.add('active', 'bg-blue-50', 'text-accent');
  document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  if (btn.dataset.tab.startsWith('rel-')) renderRelatorios();
}));

document.querySelectorAll('.tab-rel-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-rel-btn').forEach(b => b.classList.remove('active', 'bg-blue-50', 'text-accent'));
  document.querySelectorAll('[id^="rel-"][id$="-content"]').forEach(c => c.classList.add('hidden'));
  btn.classList.add('active', 'bg-blue-50', 'text-accent');
  document.getElementById(`rel-${btn.dataset.tabRel}-content`).classList.remove('hidden');
}));

document.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', () => {
  currentFilter = btn.dataset.filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('bg-accent', 'text-white'));
  btn.classList.add('bg-accent', 'text-white');
  renderPortarias();
}));

document.getElementById('btn-login').addEventListener('click', () => document.getElementById('modal-login').classList.remove('hidden'));
document.getElementById('btn-new-portaria').addEventListener('click', () => openModalPortaria());
document.getElementById('btn-new-servidor').addEventListener('click', () => openModalServidor());
document.getElementById('btn-import-csv').addEventListener('click', () => document.getElementById('modal-import-csv').classList.remove('hidden'));

// Exportação CSV simplificada
function down(f, d) { const b = new Blob([d.join('\n')], {type:'text/csv;charset=utf-8'}); const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = f; l.click(); }
document.getElementById('btn-export-servidores').addEventListener('click', () => {
  const c = ['"Nome","Segmento","Horas"'];
  servidores.forEach(s => c.push(`"${s.nome}","${s.segmento}",${Object.keys(portarias).length}`));
  down('servidores.csv', c);
});

// Sidebar
document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('w-64'); sb.classList.toggle('w-20');
  document.querySelectorAll('.sidebar-text').forEach(t => t.classList.toggle('hidden'));
});

// INICIALIZAÇÃO DA INTERFACE DO USUÁRIO
updateAdminUI();
if(window.lucide) lucide.createIcons();
