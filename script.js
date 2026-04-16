import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot 
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
const db = getFirestore(app);
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
// FUNÇÕES DE INTERFACE (Globais)
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
onAuthStateChanged(auth, (user) => { isLoggedIn = !!user; updateAdminUI(); renderServidores(); renderPortarias(); });

onSnapshot(collection(db, "portarias"), (snapshot) => {
  portarias = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  renderPortarias(); renderRelatorios();
}, (error) => console.error("Erro portarias:", error));

onSnapshot(collection(db, "servidores"), (snapshot) => {
  servidores = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
  servidores.sort((a,b) => a.nome.localeCompare(b.nome));
  renderServidores(); renderRelatorios();
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
  
  const selectRevoga = document.getElementById('f-portaria-revoga');
  if (selectRevoga) {
    selectRevoga.innerHTML = '<option value="">-- Nenhuma --</option>';
    portarias.filter(p => p.status !== 'revogada' && (!portaria || p.__backendId !== portaria.__backendId)).forEach(p => {
      selectRevoga.innerHTML += `<option value="${p.__backendId}">Nº ${p.numero} - ${p.descricao.substring(0,30)}...</option>`;
    });
  }

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

// Funções de Ação Direta nos Cards Analíticos
window.editPortariaDirect = function(id) {
  const p = portarias.find(r => r.__backendId === id);
  if(p) window.openModalPortaria(p);
}

window.revokePortariaDirect = async function(id) {
  if (!isLoggedIn) return;
  if(confirm("Deseja revogar permanentemente esta portaria?")) {
    try { await updateDoc(doc(db, "portarias", id), { status: 'revogada' }); showToast('Portaria revogada!'); } 
    catch (error) { showToast('Erro ao revogar', 'error'); }
  }
}

function renderServidorBindingList(portaria) {
  const list = document.getElementById('servidor-binding-list');
  if (servidores.length === 0) { list.innerHTML = '<p class="text-slate-500 text-xs">Nenhum servidor cadastrado</p>'; return; }
  const bindingMap = portaria ? JSON.parse(portaria.servidores || '{}') : {};
  list.innerHTML = servidores.map(srv => `
    <div class="bind-row flex items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-slate-200" data-name="${srv.nome.toLowerCase()} ${srv.segmento.toLowerCase()} ${srv.setor.toLowerCase()}">
      <div class="flex items-center gap-3 overflow-hidden">
        <input type="checkbox" data-srv-id="${srv.__backendId}" ${bindingMap[srv.__backendId] ? 'checked' : ''} class="w-4 h-4 shrink-0 text-accent rounded border-slate-300">
        <div class="flex flex-col min-w-0"><span class="text-sm font-bold text-slate-800 truncate">${srv.nome}</span><span class="text-xs text-slate-500 truncate">${srv.segmento} - ${srv.setor}</span></div>
      </div>
      <input type="number" data-srv-hours="${srv.__backendId}" value="${bindingMap[srv.__backendId] || ''}" placeholder="0" min="0" class="w-16 p-1.5 text-sm border border-slate-300 rounded bg-slate-50 text-center shrink-0">
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
// ABA PRINCIPAL (VISÃO ANALÍTICA EXPANDIDA)
// ==========================================
window.renderPortarias = function() {
  const list = document.getElementById('portaria-list');
  let filtered = portarias.filter(p => {
    if (currentFilter === 'revogada') return p.status === 'revogada';
    if (p.status === 'revogada') return false; 
    const s = getStatus(p.data_validade);
    if (currentFilter !== 'all' && s.key !== currentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.numero||'').toLowerCase().includes(q) || (p.descricao||'').toLowerCase().includes(q);
    }
    return true;
  });
  
  filtered.sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  let ok = 0, warn = 0, exp = 0;
  portarias.forEach(p => {
    if (p.status === 'revogada') return;
    const s = getStatus(p.data_validade);
    if (s.key === 'ok') ok++; else if (s.key === 'warn') warn++; else exp++;
  });
  
  document.getElementById('stat-total').textContent = ok + warn + exp; document.getElementById('stat-ok').textContent = ok; document.getElementById('stat-warn').textContent = warn; document.getElementById('stat-expired').textContent = exp;
  if (filtered.length === 0) { list.innerHTML = ''; document.getElementById('empty-state').classList.remove('hidden'); return; }
  document.getElementById('empty-state').classList.add('hidden');

  list.innerHTML = filtered.map(p => {
    const isRevogada = p.status === 'revogada';
    const s = isRevogada ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Revogada' } : getStatus(p.data_validade); 
    const tipoTag = p.tipo ? `<span class="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">${p.tipo}</span>` : '';
    const linkBtn = p.link ? `<a href="${p.link}" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-accent hover:bg-blue-100 border border-blue-100 rounded-lg text-sm font-bold transition-colors w-full md:w-auto justify-center"><i data-lucide="external-link" style="width:16px;height:16px;"></i> Acessar Documento</a>` : '';

    const binding = JSON.parse(p.servidores || '{}');
    const srvList = Object.keys(binding).length > 0 
      ? Object.keys(binding).map(srvId => { 
          const srv = servidores.find(serv => serv.__backendId === srvId); 
          return `<span class="inline-block px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-sm">${srv ? srv.nome : 'Removido'} <strong class="text-slate-400 ml-1 font-bold">(${binding[srvId]}h)</strong></span>`; 
        }).join('')
      : '<span class="text-slate-400 text-xs italic">Nenhum servidor vinculado</span>';
    
    const adminBtns = (isLoggedIn && !isRevogada) ? `
      <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-white/80 backdrop-blur-sm p-1 rounded-xl absolute bottom-6 right-6">
        <button onclick="editPortariaDirect('${p.__backendId}')" title="Editar Portaria" class="p-2 text-slate-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors"><i data-lucide="edit" style="width:18px;height:18px;"></i></button>
        <button onclick="revokePortariaDirect('${p.__backendId}')" title="Revogar Portaria" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i data-lucide="power-off" style="width:18px;height:18px;"></i></button>
      </div>
    ` : '';

    // Layout Analítico Completo
    return `
      <div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow relative group ${isRevogada ? 'opacity-70 grayscale' : ''}">
        ${adminBtns}
        <div class="flex flex-col md:flex-row md:items-start justify-between gap-6 pr-16 md:pr-0">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <h4 class="font-bold text-slate-800 text-lg">Nº ${p.numero}</h4>
              ${tipoTag}
              <span class="status-pill ${s.class} scale-90 origin-left m-0">${s.label}</span>
            </div>
            <p class="text-slate-600 text-sm mb-5">${p.descricao}</p>
            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Servidores Vinculados na Portaria</p>
              <div class="flex flex-wrap gap-2">${srvList}</div>
            </div>
          </div>
          <div class="shrink-0 flex flex-col md:items-end gap-3 border-t md:border-t-0 border-slate-200 pt-4 md:pt-0 min-w-[180px]">
            <div class="flex flex-row md:flex-col gap-4 md:gap-1 w-full md:text-right bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <p class="text-xs text-slate-500 uppercase font-bold tracking-wide">Pub: <strong class="text-slate-800 font-black ml-1">${formatDate(p.data_publicacao)}</strong></p>
              <div class="w-full h-px bg-slate-200 hidden md:block my-1.5"></div>
              <p class="text-xs text-slate-500 uppercase font-bold tracking-wide">Val: <strong class="text-slate-800 font-black ml-1">${formatDate(p.data_validade)}</strong></p>
            </div>
            ${linkBtn}
          </div>
        </div>
      </div>
    `;
  }).join('');
  if(window.lucide) lucide.createIcons();
}

window.renderServidores = function() {
  const list = document.getElementById('servidor-list');
  const empty = document.getElementById('servidor-empty');
  if (!list) return; 
  if (servidores.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  
  list.innerHTML = servidores.map(s => `
    <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative group flex justify-between items-center transition-all hover:border-slate-300">
      <div class="flex flex-col gap-1 pr-4 min-w-0">
        <p class="font-bold text-slate-800 text-lg truncate" title="${s.nome}">${s.nome}</p>
        <div class="flex flex-wrap gap-2 mt-2">
          <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-semibold">${s.segmento}</span>
          <span class="bg-blue-50 text-accent px-2 py-1 rounded text-xs font-semibold">${s.setor}</span>
        </div>
      </div>
      ${isLoggedIn ? `
        <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-white/80 backdrop-blur-sm p-1 rounded-xl">
          <button onclick="openModalServidor('${s.__backendId}')" title="Editar Servidor" class="p-2 text-slate-400 hover:text-accent hover:bg-blue-50 rounded-lg transition-colors"><i data-lucide="pencil" style="width:18px;height:18px;"></i></button>
          <button onclick="deleteServidor('${s.__backendId}')" title="Excluir Servidor" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i data-lucide="trash-2" style="width:18px;height:18px;"></i></button>
        </div>
      ` : ''}
    </div>
  `).join('');
  if(window.lucide) lucide.createIcons();
}

// ==========================================
// JANELA DE DETALHES (USADA AGORA APENAS NO RELATÓRIO)
// ==========================================
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
    
  const tipoHtml = p.tipo ? `<p class="text-slate-500 text-xs font-bold uppercase mb-1">Tipo</p><p class="text-slate-800 font-medium">${p.tipo}</p>` : '';
  const linkHtml = p.link ? `<a href="${p.link}" target="_blank" class="inline-flex items-center gap-1.5 mt-3 text-sm font-bold text-accent hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors w-fit"><i data-lucide="external-link" style="width:16px;height:16px;"></i> Ver documento oficial</a>` : '';

  document.getElementById('detail-body-portaria').innerHTML = `
    <div><span class="status-pill ${s.class}">${s.label}</span></div>
    <p class="text-slate-800 font-medium mt-2 text-lg">${p.descricao}</p>
    ${linkHtml}
    <div class="grid grid-cols-3 gap-3 text-sm mt-5">
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-3 col-span-1">${tipoHtml}</div>
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-3"><p class="text-slate-500 text-xs font-bold uppercase mb-1">Publicação</p><p class="text-slate-800 font-medium">${formatDate(p.data_publicacao)}</p></div>
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-3"><p class="text-slate-500 text-xs font-bold uppercase mb-1">Validade</p><p class="text-slate-800 font-medium">${formatDate(p.data_validade)}</p></div>
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
// RELATÓRIOS (COM EXPANSÃO E FILTROS)
// ==========================================

// Função para abrir/fechar a lista de portarias de um servidor
window.toggleServidorPorts = function(id) {
  const el = document.getElementById('expand-srv-' + id);
  const icon = document.getElementById('icon-srv-' + id);
  if(el) {
    el.classList.toggle('hidden');
    if(el.classList.contains('hidden')) { icon.style.transform = 'rotate(0deg)'; } 
    else { icon.style.transform = 'rotate(180deg)'; }
  }
}

// NOVA Função para abrir/fechar os detalhes de uma portaria no relatório
window.togglePortariaDetails = function(id) {
  const el = document.getElementById('expand-port-' + id);
  const iconDesk = document.getElementById('icon-port-desk-' + id);
  const iconMob = document.getElementById('icon-port-mob-' + id);
  
  if(el) {
    el.classList.toggle('hidden');
    const rotate = el.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    if(iconDesk) iconDesk.style.transform = rotate;
    if(iconMob) iconMob.style.transform = rotate;
  }
}

window.renderRelatorios = function() {
  // 1. Relatório de Servidores (Mantido igual, perfeito)
  const srvHoras = {}; const srvPortarias = {}; let totalHoras = 0;
  servidores.forEach(s => { srvHoras[s.__backendId] = 0; srvPortarias[s.__backendId] = 0; });
  portarias.forEach(p => {
    if (p.status === 'revogada') return; 
    const binding = JSON.parse(p.servidores || '{}');
    Object.keys(binding).forEach(srvId => { srvHoras[srvId] = (srvHoras[srvId] || 0) + binding[srvId]; srvPortarias[srvId] = (srvPortarias[srvId] || 0) + 1; totalHoras += binding[srvId]; });
  });
  
  document.getElementById('stat-srv-total').textContent = servidores.length; 
  document.getElementById('stat-srv-horas').textContent = totalHoras;

  const srvDiv = document.getElementById('relatorio-servidores'); 
  const srvEmpty = document.getElementById('relatorio-servidores-empty');
  
  if (srvDiv) {
    let srvFiltrados = servidores;
    if (searchRelSrvQuery) {
      const q = searchRelSrvQuery.toLowerCase();
      srvFiltrados = servidores.filter(s => s.nome.toLowerCase().includes(q));
    }

    if (srvFiltrados.length === 0) { 
      srvDiv.innerHTML = ''; srvEmpty.classList.remove('hidden'); 
    } else {
      srvEmpty.classList.add('hidden');
      srvDiv.innerHTML = srvFiltrados.map(s => {
        const linkedPorts = portarias.filter(p => {
          if (p.status === 'revogada') return false;
          const binding = JSON.parse(p.servidores || '{}');
          return binding[s.__backendId] !== undefined;
        });
        
        const portsHtml = linkedPorts.length > 0 
          ? linkedPorts.map(p => `<div class="text-xs text-slate-600 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors px-2 rounded"><strong class="text-slate-800">Nº ${p.numero}</strong> - ${p.descricao}</div>`).join('')
          : '<div class="text-xs text-slate-400 py-2 italic px-2">Nenhuma portaria ativa</div>';
          
        return `
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-colors cursor-pointer group" onclick="toggleServidorPorts('${s.__backendId}')">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="font-bold text-slate-800 text-base truncate">${s.nome}</p>
                  <i id="icon-srv-${s.__backendId}" data-lucide="chevron-down" style="width:16px;height:16px;" class="text-slate-400 transition-transform"></i>
                </div>
                <p class="text-slate-500 text-xs mt-1 font-medium">${s.segmento} • ${s.setor}</p>
              </div>
              <div class="flex gap-3 shrink-0">
                <div class="flex items-center gap-1.5 text-slate-700 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg border border-amber-100 font-bold text-sm"><i data-lucide="clock" style="width:16px;height:16px;"></i> ${srvHoras[s.__backendId] || 0}h</div>
                <div class="flex items-center gap-1.5 text-slate-700 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-100 font-bold text-sm"><i data-lucide="file-text" style="width:16px;height:16px;"></i> ${srvPortarias[s.__backendId] || 0} port.</div>
              </div>
            </div>
            <div id="expand-srv-${s.__backendId}" class="hidden mt-4 pt-2 border-t border-slate-100 w-full">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-2">Portarias Vigentes Vinculadas</p>
              ${portsHtml}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Relatório de Portarias (Agora expansível e sem modal)
  const filterTipo = document.getElementById('filter-tipo-rel-portaria')?.value || 'Todas';
  let portariasFiltradas = portarias;
  if (filterTipo !== 'Todas') { portariasFiltradas = portariasFiltradas.filter(p => p.tipo === filterTipo); }

  const vigentes = portariasFiltradas.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'ok').sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  const aVencer = portariasFiltradas.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'warn').sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  const vencidas = portariasFiltradas.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'expired').sort((a, b) => getStatus(b.data_validade).days - getStatus(a.data_validade).days);
  const revogadas = portariasFiltradas.filter(p => p.status === 'revogada'); 

  document.getElementById('stat-port-vigentes').textContent = vigentes.length; 
  document.getElementById('stat-port-vencer').textContent = aVencer.length; 
  document.getElementById('stat-port-vencidas').textContent = vencidas.length;
  document.getElementById('stat-port-revogadas').textContent = revogadas.length;

  const renderPortariaListSmall = (arr, divId) => {
    const div = document.getElementById(divId);
    if (!div) return;
    if (arr.length === 0) { 
      div.innerHTML = '<p class="text-slate-500 text-sm font-medium p-4 bg-white rounded-xl border border-slate-200 text-center shadow-sm">Nenhuma portaria encontrada</p>'; 
    } else {
      div.innerHTML = arr.map(p => {
        const isRevogada = p.status === 'revogada';
        const s = isRevogada ? { class: 'bg-slate-200 text-slate-600 border-slate-300', label: 'Revogada' } : getStatus(p.data_validade); 
        const tipoTag = p.tipo ? `<span class="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ml-1">${p.tipo}</span>` : '';
        
        // Mapeia servidores para exibir na parte expandida
        const binding = JSON.parse(p.servidores || '{}');
        const srvList = Object.keys(binding).length > 0 
          ? Object.keys(binding).map(srvId => { 
              const srv = servidores.find(serv => serv.__backendId === srvId); 
              return `<span class="inline-block px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-700">${srv ? srv.nome : 'Removido'} <strong class="text-slate-400 ml-1 font-bold">(${binding[srvId]}h)</strong></span>`; 
            }).join('')
          : '<span class="text-slate-400 text-xs italic">Nenhum servidor vinculado</span>';

        const linkBtn = p.link ? `<a href="${p.link}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-accent hover:bg-blue-100 border border-blue-100 rounded-lg text-xs font-bold transition-colors w-fit"><i data-lucide="external-link" style="width:14px;height:14px;"></i> Documento Oficial</a>` : '';

        // Novo Card Expansível
        return `
          <div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-slate-300 transition-colors cursor-pointer group ${isRevogada ? 'opacity-70 grayscale' : ''}" onclick="togglePortariaDetails('${p.__backendId}')">
            
            <div class="flex items-center justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex gap-2 items-center flex-wrap">
                  <span class="font-bold text-slate-800 text-lg truncate">Portaria nº ${p.numero}</span>
                  ${tipoTag}
                  <span class="status-pill ${s.class}">${s.label}</span>
                  <i id="icon-port-mob-${p.__backendId}" data-lucide="chevron-down" style="width:18px;height:18px;" class="text-slate-400 transition-transform ml-auto md:hidden"></i>
                </div>
                <p class="text-slate-600 text-sm mt-2 line-clamp-1">${p.descricao}</p>
              </div>
              <i id="icon-port-desk-${p.__backendId}" data-lucide="chevron-down" style="width:20px;height:20px;" class="text-slate-400 transition-transform hidden md:block shrink-0"></i>
            </div>

            <div id="expand-port-${p.__backendId}" class="hidden mt-4 pt-4 border-t border-slate-100 w-full cursor-default" onclick="event.stopPropagation()">
              <div class="flex flex-col md:flex-row justify-between gap-5">
                <div class="flex-1">
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Servidores Vinculados</p>
                  <div class="flex flex-wrap gap-2">${srvList}</div>
                </div>
                <div class="flex flex-col gap-3 md:items-end shrink-0">
                  <div class="flex gap-3 text-sm bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span><strong class="text-slate-500 text-[10px] uppercase block mb-0.5">Publicação</strong> ${formatDate(p.data_publicacao)}</span>
                    <div class="w-px bg-slate-200"></div>
                    <span><strong class="text-slate-500 text-[10px] uppercase block mb-0.5">Validade</strong> ${formatDate(p.data_validade)}</span>
                  </div>
                  ${linkBtn}
                </div>
              </div>
            </div>

          </div>
        `;
      }).join('');
    }
  };

  renderPortariaListSmall(vigentes, 'relatorio-vigentes'); 
  renderPortariaListSmall(aVencer, 'relatorio-vencer'); 
  renderPortariaListSmall(vencidas, 'relatorio-vencidas');
  renderPortariaListSmall(revogadas, 'relatorio-revogadas'); 
  if(window.lucide) lucide.createIcons();
}

// Filtro do Relatório (Ouvinte de Mudança)
document.getElementById('filter-tipo-rel-portaria')?.addEventListener('change', window.renderRelatorios);

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

document.getElementById('btn-new-portaria').addEventListener('click', (e) => { e.preventDefault(); window.openModalPortaria(); });
document.getElementById('btn-new-servidor').addEventListener('click', (e) => { e.preventDefault(); window.openModalServidor(); });
document.getElementById('btn-import-csv').addEventListener('click', (e) => { e.preventDefault(); window.openModalImportCSV(); });

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
document.getElementById('search-rel-srv')?.addEventListener('input', (e) => { searchRelSrvQuery = e.target.value; window.renderRelatorios(); });

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
    Object.keys(binding).forEach(srvId => { srvHoras[srvId] = (srvHoras[srvId] || 0) + binding[srvId]; srvPortarias[srvId] = (srvPortarias[srvId] || 0) + 1; });
  });
  const csv = ['"Nome","Segmento","Setor","Total de Horas","Quantidade de Portarias Ativas"'];
  servidores.forEach(s => { csv.push(`"${s.nome}","${s.segmento}","${s.setor}",${srvHoras[s.__backendId] || 0},${srvPortarias[s.__backendId] || 0}`); });
  downloadCSV(`relatorio_servidores_${new Date().toISOString().split('T')[0]}.csv`, csv); showToast('Download iniciado!', 'success');
});

document.getElementById('btn-export-portarias').addEventListener('click', (e) => {
  e.preventDefault();
  if (portarias.length === 0) return showToast('Não há portarias para exportar', 'warn');
  const csv = ['"Número","Descrição","Tipo","Link","Data Publicação","Data Validade","Status","Total Horas Vinculadas"'];
  portarias.forEach(p => {
    const binding = JSON.parse(p.servidores || '{}');
    const totalHoras = Object.values(binding).reduce((a, b) => a + b, 0);
    let statusText = 'Revogada';
    if (p.status !== 'revogada') { const s = getStatus(p.data_validade); statusText = s.key === 'ok' ? 'Vigente' : s.key === 'warn' ? 'A Vencer' : 'Vencida'; }
    const descTratada = (p.descricao || '').replace(/"/g, '""');
    const tipo = p.tipo || 'Não especificado';
    const link = p.link || '';
    csv.push(`"${p.numero}","${descTratada}","${tipo}","${link}","${p.data_publicacao}","${p.data_validade}","${statusText}",${totalHoras}`);
  });
  downloadCSV(`relatorio_portarias_${new Date().toISOString().split('T')[0]}.csv`, csv); showToast('Download iniciado!', 'success');
});

// Inicialização da interface do usuário
updateAdminUI();
if(window.lucide) lucide.createIcons();
