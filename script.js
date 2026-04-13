import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ==========================================
// 1. CONFIGURAÇÃO DO FIREBASE (Mantenha as suas chaves aqui)
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
const db = getFirestore(app);
const auth = getAuth(app);

let isLoggedIn = false;
let portarias = [];
let servidores = [];
let editingPortaria = null;
let viewingPortaria = null;
let currentFilter = 'all';
let searchQuery = '';

// ==========================================
// FUNÇÕES DE INTERFACE (Globais)
// ==========================================
window.closeModalLogin = () => { document.getElementById('modal-login').classList.add('hidden'); document.getElementById('modal-login').classList.remove('flex'); }
window.closeModalPortaria = () => { document.getElementById('modal-portaria').classList.add('hidden'); document.getElementById('modal-portaria').classList.remove('flex'); editingPortaria = null; }
window.closeModalServidor = () => { document.getElementById('modal-servidor').classList.add('hidden'); document.getElementById('modal-servidor').classList.remove('flex'); }
window.closeModalImportCSV = () => { document.getElementById('modal-import-csv').classList.add('hidden'); document.getElementById('modal-import-csv').classList.remove('flex'); }
window.closeDetailPortaria = () => { document.getElementById('modal-detail-portaria').classList.add('hidden'); document.getElementById('modal-detail-portaria').classList.remove('flex'); viewingPortaria = null; }

function openModalLogin() { document.getElementById('form-login').reset(); document.getElementById('modal-login').classList.remove('hidden'); document.getElementById('modal-login').classList.add('flex'); }

function updateAdminUI() {
  const loginBtn = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');
  if (isLoggedIn) {
    loginBtn.classList.add('hidden'); logoutBtn.classList.remove('hidden');
    document.getElementById('btn-new-portaria').classList.remove('hidden');
    document.getElementById('btn-new-servidor').classList.remove('hidden');
    document.getElementById('btn-import-csv').classList.remove('hidden');
  } else {
    loginBtn.classList.remove('hidden'); logoutBtn.classList.add('hidden');
    document.getElementById('btn-new-portaria').classList.add('hidden');
    document.getElementById('btn-new-servidor').classList.add('hidden');
    document.getElementById('btn-import-csv').classList.add('hidden');
  }
}

function formatDate(d) { if (!d) return '—'; const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; }

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeft = type === 'success' ? '4px solid #10b981' : type === 'warn' ? '4px solid #f59e0b' : '4px solid #ef4444';
  t.classList.remove('hidden'); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function getStatus(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const val = new Date(dateStr + 'T00:00:00');
  const diff = Math.ceil((val - today) / (1000*60*60*24));
  if (diff < 0) return { label: 'Vencida', class: 'status-expired', days: diff, key: 'expired' };
  if (diff <= 30) return { label: `Vence em ${diff}d`, class: 'status-warn', days: diff, key: 'warn' };
  return { label: `${diff} dias`, class: 'status-ok', days: diff, key: 'ok' };
}

// ==========================================
// AUTENTICAÇÃO E DADOS PÚBLICOS
// ==========================================
onAuthStateChanged(auth, (user) => { isLoggedIn = !!user; updateAdminUI(); renderServidores(); });

onSnapshot(collection(db, "portarias"), (snapshot) => {
  portarias = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  renderPortarias(); renderRelatorio();
}, (error) => console.error("Erro portarias:", error));

onSnapshot(collection(db, "servidores"), (snapshot) => {
  servidores = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  // Ordena servidores por nome alfabeticamente
  servidores.sort((a,b) => a.nome.localeCompare(b.nome));
  renderServidores(); renderRelatorio();
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
  if (!isLoggedIn) {
    showToast('Acesso negado. Faça login para gerenciar portarias.', 'warn');
    return;
  }
  
  editingPortaria = portaria;
  const modalTitle = document.getElementById('modal-title-portaria');
  const form = document.getElementById('form-portaria');
  
  // Muda o título do modal dependendo da ação
  modalTitle.textContent = portaria ? 'Editar Portaria' : 'Nova Portaria';
  
  if (portaria) {
    // CARREGAMENTO DOS DADOS NO FORMULÁRIO
    document.getElementById('f-portaria-numero').value = portaria.numero || '';
    document.getElementById('f-portaria-pub').value = portaria.data_publicacao || '';
    document.getElementById('f-portaria-desc').value = portaria.descricao || '';
    document.getElementById('f-portaria-validade').value = portaria.data_validade || '';
    
    // Se houver uma portaria já marcada para revogar, você pode carregar aqui se desejar
    if (document.getElementById('f-portaria-revoga')) {
      document.getElementById('f-portaria-revoga').value = portaria.revogaAnterior || '';
    }
  } else {
    form.reset();
    if (document.getElementById('f-portaria-revoga')) {
      document.getElementById('f-portaria-revoga').value = '';
    }
  }

  // Carrega a lista de servidores marcando os que já pertencem a esta portaria
  renderServidorBindingList(portaria);
  
  document.getElementById('modal-portaria').classList.remove('hidden');
  document.getElementById('modal-portaria').classList.add('flex');
};

function renderServidorBindingList(portaria) {
  const list = document.getElementById('servidor-binding-list');
  if (servidores.length === 0) { list.innerHTML = '<p class="text-slate-500 text-xs">Nenhum servidor cadastrado</p>'; return; }
  
  const bindingMap = portaria ? JSON.parse(portaria.servidores || '{}') : {};
  
  // NOVO LAYOUT: Não amassa o nome. Usa grid/flex com truncate.
  list.innerHTML = servidores.map(srv => `
    <div class="bind-row flex items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-slate-200" data-name="${srv.nome.toLowerCase()} ${srv.segmento.toLowerCase()} ${srv.setor.toLowerCase()}">
      <div class="flex items-center gap-3 overflow-hidden">
        <input type="checkbox" data-srv-id="${srv.__backendId}" ${bindingMap[srv.__backendId] ? 'checked' : ''} class="w-4 h-4 shrink-0 text-accent rounded border-slate-300">
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-slate-800 truncate">${srv.nome}</span>
          <span class="text-xs text-slate-500 truncate">${srv.segmento} - ${srv.setor}</span>
        </div>
      </div>
      <input type="number" data-srv-hours="${srv.__backendId}" value="${bindingMap[srv.__backendId] || ''}" placeholder="0" min="0" class="w-16 p-1.5 text-sm border border-slate-300 rounded bg-slate-50 text-center shrink-0">
    </div>
  `).join('');
}

// FUNÇÃO DE BUSCA DENTRO DO MODAL (Filtra a lista sem recarregar o HTML)
window.filterServidoresBind = function() {
  const query = document.getElementById('f-search-vinculo').value.toLowerCase();
  document.querySelectorAll('.bind-row').forEach(row => {
    if(row.dataset.name.includes(query)) row.style.display = 'flex';
    else row.style.display = 'none';
  });
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
    servidores: JSON.stringify(servidorBinding), 
    status: 'ativo' 
  };

  const idRevogar = document.getElementById('f-portaria-revoga').value;

  try {
    if (editingPortaria) {
      await updateDoc(doc(db, "portarias", editingPortaria.__backendId), data);
      showToast('Portaria atualizada!');
    } else {
      await addDoc(collection(db, "portarias"), data);
      showToast('Portaria cadastrada!');
      // Se selecionou uma para revogar, revoga a anterior logo em seguida
      if (idRevogar) {
        await updateDoc(doc(db, "portarias", idRevogar), { status: 'revogada' });
        showToast('Portaria anterior revogada automaticamente!', 'success');
      }
    }
    window.closeModalPortaria(); 
  } catch (error) { showToast('Erro ao salvar no banco', 'error'); }
});

// ==========================================
// GESTÃO E EXCLUSÃO DE SERVIDORES
// ==========================================
window.openModalServidor = function() { if (!isLoggedIn) return showToast('Faça login', 'warn'); document.getElementById('form-servidor').reset(); document.getElementById('modal-servidor').classList.remove('hidden'); document.getElementById('modal-servidor').classList.add('flex'); };
window.openModalImportCSV = function() { if (!isLoggedIn) return showToast('Faça login', 'warn'); document.getElementById('csv-input').value = ''; document.getElementById('modal-import-csv').classList.remove('hidden'); document.getElementById('modal-import-csv').classList.add('flex'); };

// Nova Função Global: Excluir Servidor
window.deleteServidor = async function(id) {
  if (!isLoggedIn) return;
  if(confirm("ATENÇÃO: Tem certeza que deseja excluir permanentemente este servidor? Ele aparecerá como 'Removido' nas portarias vinculadas.")) {
    try {
      await deleteDoc(doc(db, "servidores", id));
      showToast('Servidor excluído com sucesso');
    } catch(e) { showToast('Erro ao excluir', 'error'); }
  }
}

document.getElementById('form-servidor').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await addDoc(collection(db, "servidores"), {
      nome: document.getElementById('f-servidor-nome').value.trim(),
      segmento: document.getElementById('f-servidor-segmento').value.trim(),
      setor: document.getElementById('f-servidor-setor').value.trim()
    });
    window.closeModalServidor(); showToast('Servidor cadastrado!');
  } catch (error) { showToast('Erro ao salvar', 'error'); }
});

// ==========================================
// RENDERIZAÇÃO NA TELA
// ==========================================
function renderPortarias() {
  const list = document.getElementById('portaria-list');
  let filtered = portarias.filter(p => {
    // Nova lógica de Filtro: Aba Revogadas vs Abas Ativas
    if (currentFilter === 'revogada') return p.status === 'revogada';
    if (p.status === 'revogada') return false; // Oculta revogadas de "Todas, Vigentes, A Vencer"

    const s = getStatus(p.data_validade);
    if (currentFilter !== 'all' && s.key !== currentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.numero||'').toLowerCase().includes(q) || (p.descricao||'').toLowerCase().includes(q);
    }
    return true;
  });
  
  filtered.sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  
  // Atualiza os contadores no topo (ignora revogadas)
  let ok = 0, warn = 0, exp = 0;
  portarias.forEach(p => {
    if (p.status === 'revogada') return;
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
    const s = p.status === 'revogada' ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Revogada' } : getStatus(p.data_validade);
    return `
      <div class="bg-card border border-slate-200 rounded-2xl p-5 card-hover cursor-pointer ${p.status === 'revogada' ? 'opacity-70 grayscale' : ''}" onclick="openDetailPortaria('${p.__backendId}')">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex gap-3 items-center flex-wrap"><span class="font-bold text-slate-800 text-lg truncate">Portaria nº ${p.numero}</span><span class="status-pill ${s.class}">${s.label}</span></div>
            <p class="text-slate-600 text-sm mt-2 line-clamp-2">${p.descricao}</p>
          </div>
          <i data-lucide="chevron-right" style="width:20px;height:20px;color:#cbd5e1;" class="shrink-0"></i>
        </div>
      </div>
    `;
  }).join('');
  if(window.lucide) lucide.createIcons();
}

function renderServidores() {
  const list = document.getElementById('servidor-list');
  const empty = document.getElementById('servidor-empty');
  if (servidores.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  
  list.innerHTML = servidores.map(s => `
    <div class="bg-card border border-slate-200 rounded-2xl p-5 shadow-sm relative group">
      <div class="flex flex-col gap-1 pr-6">
        <p class="font-bold text-slate-800 text-lg truncate" title="${s.nome}">${s.nome}</p>
        <div class="flex flex-wrap gap-2 mt-2">
          <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-semibold">${s.segmento}</span>
          <span class="bg-blue-50 text-accent px-2 py-1 rounded text-xs font-semibold">${s.setor}</span>
        </div>
      </div>
      ${isLoggedIn ? `<button onclick="deleteServidor('${s.__backendId}')" class="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"><i data-lucide="trash-2" style="width:18px;height:18px;"></i></button>` : ''}
    </div>
  `).join('');
  if(window.lucide) lucide.createIcons();
}

// ... Mantido restante do Relatório, Detalhes e CSV iguais à versão anterior ...
window.openDetailPortaria = function(id) {
  const p = portarias.find(r => r.__backendId === id);
  if (!p) return;
  viewingPortaria = p;
  const s = p.status === 'revogada' ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Portaria Revogada' } : getStatus(p.data_validade);
  document.getElementById('detail-title-portaria').textContent = `Portaria nº ${p.numero}`;
  
  const binding = JSON.parse(p.servidores || '{}');
  const srvList = Object.keys(binding).length > 0 
    ? Object.keys(binding).map(srvId => { const srv = servidores.find(s => s.__backendId === srvId); return `<span class="inline-block px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium text-xs mr-1 mb-1 border border-slate-200">${srv ? srv.nome : 'Removido'} (${binding[srvId]}h)</span>`; }).join('')
    : '<span class="text-slate-500 text-sm">Nenhum servidor</span>';
    
  document.getElementById('detail-body-portaria').innerHTML = `
    <div><span class="status-pill ${s.class}">${s.label}</span></div>
    <p class="text-slate-800 font-medium mt-2">${p.descricao}</p>
    <div class="grid grid-cols-2 gap-3 text-sm mt-4">
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-3"><p class="text-slate-500 text-xs font-bold uppercase mb-1">Publicação</p><p class="text-slate-800 font-medium">${formatDate(p.data_publicacao)}</p></div>
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-3"><p class="text-slate-500 text-xs font-bold uppercase mb-1">Validade</p><p class="text-slate-800 font-medium">${formatDate(p.data_validade)}</p></div>
    </div>
    <div class="mt-4"><p class="text-slate-500 text-xs mb-2 uppercase font-bold tracking-wide">Servidores Vinculados</p><div>${srvList}</div></div>
  `;
  document.getElementById('modal-detail-portaria').classList.remove('hidden'); document.getElementById('modal-detail-portaria').classList.add('flex');
  
  // Oculta botão de revogar se já estiver revogada
  document.getElementById('btn-edit-portaria').style.display = (isLoggedIn && p.status !== 'revogada') ? 'flex' : 'none';
  document.getElementById('btn-revoke-portaria').style.display = (isLoggedIn && p.status !== 'revogada') ? 'flex' : 'none';
}

// Editar portaria
document.getElementById('btn-edit-portaria').addEventListener('click', () => { 
  if (viewingPortaria) {
    window.closeDetailPortaria(); 
    window.openModalPortaria(viewingPortaria); 
  } else {
    showToast('Erro ao carregar dados da portaria.', 'error');
  }
});

// Revogar portaria
document.getElementById('btn-revoke-portaria').addEventListener('click', async () => {
  if (!viewingPortaria || !isLoggedIn) return;
  try { await updateDoc(doc(db, "portarias", viewingPortaria.__backendId), { status: 'revogada' }); window.closeDetailPortaria(); showToast('Portaria revogada!'); } 
  catch (error) { showToast('Erro ao revogar', 'error'); }
});

// ==========================================
// RELATÓRIOS
// ==========================================
window.renderRelatorios = function() {
  // 1. Relatório de Servidores
  const srvHoras = {}; const srvPortarias = {}; let totalHoras = 0;
  servidores.forEach(s => { srvHoras[s.__backendId] = 0; srvPortarias[s.__backendId] = 0; });
  
  portarias.forEach(p => {
    if (p.status === 'revogada') return; // Horas de revogadas não contam
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
  if (servidores.length === 0) { srvDiv.innerHTML = ''; srvEmpty.classList.remove('hidden'); } else {
    srvEmpty.classList.add('hidden');
    srvDiv.innerHTML = servidores.map(s => `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm">
        <p class="font-bold text-slate-800 text-lg">${s.nome}</p>
        <p class="text-slate-500 text-xs mt-1 font-medium">${s.segmento} • ${s.setor}</p>
        <div class="flex gap-4 mt-4 text-sm font-bold">
          <div class="flex items-center gap-1.5 text-slate-700 bg-white px-3 py-1.5 rounded-lg border border-slate-200"><i data-lucide="clock" style="width:16px;height:16px;color:#f59e0b;"></i> ${srvHoras[s.__backendId] || 0}h</div>
          <div class="flex items-center gap-1.5 text-slate-700 bg-white px-3 py-1.5 rounded-lg border border-slate-200"><i data-lucide="file-text" style="width:16px;height:16px;color:#10b981;"></i> ${srvPortarias[s.__backendId] || 0} port.</div>
        </div>
      </div>
    `).join('');
  }

  // 2. Relatório de Portarias (Incluindo Revogadas)
  const vigentes = portarias.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'ok').sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  const aVencer = portarias.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'warn').sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  const vencidas = portarias.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'expired').sort((a, b) => getStatus(b.data_validade).days - getStatus(a.data_validade).days);
  const revogadas = portarias.filter(p => p.status === 'revogada'); // Filtro novo!

  document.getElementById('stat-port-vigentes').textContent = vigentes.length; 
  document.getElementById('stat-port-vencer').textContent = aVencer.length; 
  document.getElementById('stat-port-vencidas').textContent = vencidas.length;
  document.getElementById('stat-port-revogadas').textContent = revogadas.length;

  const renderPortariaList = (arr, divId) => {
    const div = document.getElementById(divId);
    if (arr.length === 0) { div.innerHTML = '<p class="text-slate-500 text-sm font-medium p-4 bg-slate-50 rounded-xl border border-slate-200 col-span-full">Nenhuma portaria nesta categoria</p>'; } else {
      div.innerHTML = arr.map(p => {
        const isRevogada = p.status === 'revogada';
        const s = isRevogada ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Revogada' } : getStatus(p.data_validade); 
        const srvCount = Object.keys(JSON.parse(p.servidores || '{}')).length;
        const msgVence = isRevogada ? 'Desativada' : s.key === 'expired' ? `Vencida há ${Math.abs(s.days)}d` : `Vence: ${formatDate(p.data_validade)}`;
        
        return `
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm cursor-pointer hover:bg-slate-100 transition-colors ${isRevogada ? 'opacity-70 grayscale' : ''}" onclick="openDetailPortaria('${p.__backendId}')">
            <div class="flex items-start justify-between gap-2">
              <div><p class="font-bold text-slate-800 text-sm">Nº ${p.numero}</p><p class="text-slate-500 text-xs mt-0.5 line-clamp-1">${p.descricao}</p></div>
              <span class="status-pill ${s.class} shrink-0 scale-90 origin-top-right">${s.label}</span>
            </div>
            <div class="flex gap-3 mt-3 text-xs text-slate-500 font-semibold">
              <span class="bg-white px-2 py-0.5 rounded border border-slate-100">${msgVence}</span>
              <span class="bg-white px-2 py-0.5 rounded border border-slate-100">${srvCount} serv.</span>
            </div>
          </div>
        `;
      }).join('');
    }
  };

  renderPortariaList(vigentes, 'relatorio-vigentes'); 
  renderPortariaList(aVencer, 'relatorio-vencer'); 
  renderPortariaList(vencidas, 'relatorio-vencidas');
  renderPortariaList(revogadas, 'relatorio-revogadas'); // Renderiza as revogadas na nova aba!
  if(window.lucide) lucide.createIcons();
}

// Chamar função principal ao carregar os dados
const originalRenderPortarias = renderPortarias;
renderPortarias = function() {
  originalRenderPortarias();
  renderRelatorios(); // Garante que relatórios sempre atualizam com as portarias
}

// ==========================================
// NAVEGAÇÃO E EVENTOS
// ==========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active', 'bg-blue-50', 'text-accent'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    
    // Estilo especial do menu lateral ativo
    btn.classList.add('active', 'bg-blue-50', 'text-accent'); 
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    
    if (tab.startsWith('rel-')) renderRelatorios(); // Recarrega se for uma aba de relatório
    if(window.lucide) lucide.createIcons();
  });
});

document.querySelectorAll('.tab-rel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tabRel;
    document.querySelectorAll('.tab-rel-btn').forEach(b => {
      b.classList.remove('active', 'bg-blue-50', 'text-accent');
      b.classList.add('bg-transparent', 'text-slate-500');
    });
    document.querySelectorAll('[id^="rel-"][id$="-content"]').forEach(c => c.classList.add('hidden'));
    
    btn.classList.add('active', 'bg-blue-50', 'text-accent');
    btn.classList.remove('bg-transparent', 'text-slate-500');
    document.getElementById(`rel-${tab}-content`).classList.remove('hidden');
  });
});

// Botões Ativos
document.getElementById('btn-new-portaria').addEventListener('click', (e) => { e.preventDefault(); window.openModalPortaria(); });
document.getElementById('btn-new-servidor').addEventListener('click', (e) => { e.preventDefault(); window.openModalServidor(); });
document.getElementById('btn-import-csv').addEventListener('click', (e) => { e.preventDefault(); window.openModalImportCSV(); });
document.getElementById('btn-process-csv').addEventListener('click', (e) => { e.preventDefault(); processCSVImport(); });

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.className = b.dataset.filter === 'revogada' 
        ? 'filter-btn px-5 py-2 rounded-lg text-xs font-bold transition-all bg-transparent text-slate-500 hover:text-red-600 hover:bg-red-50 whitespace-nowrap'
        : 'filter-btn px-5 py-2 rounded-lg text-xs font-bold transition-all bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 whitespace-nowrap';
    });
    btn.className = btn.dataset.filter === 'revogada'
      ? 'filter-btn px-5 py-2 rounded-lg text-xs font-bold transition-all bg-red-100 text-red-700 shadow-sm whitespace-nowrap'
      : 'filter-btn px-5 py-2 rounded-lg text-xs font-bold transition-all bg-accent text-white shadow-sm whitespace-nowrap';
    renderPortarias();
  });
});

document.getElementById('search-input').addEventListener('input', (e) => { searchQuery = e.target.value; renderPortarias(); });

// ==========================================
// EXPORTAÇÃO CSV
// ==========================================
function downloadCSV(filename, data) { 
  const blob = new Blob([data.join('\n')], { type: 'text/csv;charset=utf-8;' }); 
  const link = document.createElement('a'); 
  link.href = URL.createObjectURL(blob); 
  link.download = filename; 
  document.body.appendChild(link); 
  link.click(); 
  document.body.removeChild(link); 
}

document.getElementById('btn-export-servidores').addEventListener('click', (e) => {
  e.preventDefault();
  if (servidores.length === 0) return showToast('Não há servidores para exportar', 'warn');
  
  const srvHoras = {}; const srvPortarias = {};
  servidores.forEach(s => { srvHoras[s.__backendId] = 0; srvPortarias[s.__backendId] = 0; });
  
  portarias.forEach(p => {
    if (p.status === 'revogada') return;
    const binding = JSON.parse(p.servidores || '{}');
    Object.keys(binding).forEach(srvId => { 
      srvHoras[srvId] = (srvHoras[srvId] || 0) + binding[srvId]; 
      srvPortarias[srvId] = (srvPortarias[srvId] || 0) + 1; 
    });
  });
  
  const csv = ['"Nome","Segmento","Setor","Total de Horas","Quantidade de Portarias Ativas"'];
  servidores.forEach(s => {
    csv.push(`"${s.nome}","${s.segmento}","${s.setor}",${srvHoras[s.__backendId] || 0},${srvPortarias[s.__backendId] || 0}`);
  });
  
  downloadCSV(`relatorio_servidores_${new Date().toISOString().split('T')[0]}.csv`, csv);
  showToast('Download iniciado!', 'success');
});

document.getElementById('btn-export-portarias').addEventListener('click', (e) => {
  e.preventDefault();
  if (portarias.length === 0) return showToast('Não há portarias para exportar', 'warn');
  
  const csv = ['"Número","Descrição","Data Publicação","Data Validade","Status","Total Horas Vinculadas"'];
  portarias.forEach(p => {
    const binding = JSON.parse(p.servidores || '{}');
    const totalHoras = Object.values(binding).reduce((a, b) => a + b, 0);
    
    let statusText = 'Revogada';
    if (p.status !== 'revogada') {
      const s = getStatus(p.data_validade);
      statusText = s.key === 'ok' ? 'Vigente' : s.key === 'warn' ? 'A Vencer' : 'Vencida';
    }
    
    // Tratamento para evitar quebras no CSV caso tenha aspas na descrição
    const descTratada = (p.descricao || '').replace(/"/g, '""');
    
    csv.push(`"${p.numero}","${descTratada}","${p.data_publicacao}","${p.data_validade}","${statusText}",${totalHoras}`);
  });
  
  downloadCSV(`relatorio_portarias_${new Date().toISOString().split('T')[0]}.csv`, csv);
  showToast('Download iniciado!', 'success');
});

// Renderização inicial da interface do usuário
updateAdminUI();
if(window.lucide) lucide.createIcons();
