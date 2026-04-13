import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, doc, updateDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
// IMPORTAÇÃO DA AUTENTICAÇÃO
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ==========================================
// 1. CONFIGURAÇÃO DO FIREBASE
// ==========================================
// LEMBRE-SE DE COLOCAR SUAS CHAVES AQUI
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
const auth = getAuth(app); // INICIALIZA A AUTENTICAÇÃO

// ==========================================
// 2. ESTADO GLOBAL
// ==========================================
let isLoggedIn = false;
let portarias = [];
let servidores = [];
let editingPortaria = null;
let viewingPortaria = null;
let currentFilter = 'all';
let searchQuery = '';

let unsubPortarias = null;
let unsubServidores = null;

// ==========================================
// 3. FUNÇÕES DE INTERFACE
// ==========================================
window.closeModalLogin = function() {
  document.getElementById('modal-login').classList.add('hidden');
  document.getElementById('modal-login').classList.remove('flex');
}

window.closeModalPortaria = function() {
  document.getElementById('modal-portaria').classList.add('hidden');
  document.getElementById('modal-portaria').classList.remove('flex');
  editingPortaria = null;
}

window.closeModalServidor = function() {
  document.getElementById('modal-servidor').classList.add('hidden');
  document.getElementById('modal-servidor').classList.remove('flex');
}

window.closeModalImportCSV = function() {
  document.getElementById('modal-import-csv').classList.add('hidden');
  document.getElementById('modal-import-csv').classList.remove('flex');
}

window.closeDetailPortaria = function() {
  document.getElementById('modal-detail-portaria').classList.add('hidden');
  document.getElementById('modal-detail-portaria').classList.remove('flex');
  viewingPortaria = null;
}

function openModalLogin() {
  document.getElementById('form-login').reset();
  document.getElementById('modal-login').classList.remove('hidden');
  document.getElementById('modal-login').classList.add('flex');
}

function updateAdminUI() {
  const loginBtn = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');
  const newPortariaBtn = document.getElementById('btn-new-portaria');
  const newServidorBtn = document.getElementById('btn-new-servidor');
  const importCsvBtn = document.getElementById('btn-import-csv');
  
  if (isLoggedIn) {
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    newPortariaBtn.classList.remove('hidden'); // Exibe os botões apenas logado
    newServidorBtn.classList.remove('hidden');
    importCsvBtn.classList.remove('hidden');
  } else {
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    newPortariaBtn.classList.add('hidden');
    newServidorBtn.classList.add('hidden');
    importCsvBtn.classList.add('hidden');
  }
}

function formatDate(d) { 
  if (!d) return '—'; 
  const [y, m, day] = d.split('-'); 
  return `${day}/${m}/${y}`;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  // Cor do toast baseada no sucesso ou erro
  t.style.borderLeft = type === 'success' ? '4px solid #10b981' : type === 'warn' ? '4px solid #f59e0b' : '4px solid #ef4444';
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function getStatus(dateStr) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const val = new Date(dateStr + 'T00:00:00');
  const diff = Math.ceil((val - today) / (1000*60*60*24));
  if (diff < 0) return { label: 'Vencida', class: 'status-expired', days: diff, key: 'expired' };
  if (diff <= 30) return { label: `Vence em ${diff}d`, class: 'status-warn', days: diff, key: 'warn' };
  return { label: `${diff} dias`, class: 'status-ok', days: diff, key: 'ok' };
}

// ==========================================
// 4. SISTEMA DE LOGIN REAL (FIREBASE AUTH)
// ==========================================

// Escuta em tempo real se o usuário está logado ou não
onAuthStateChanged(auth, (user) => {
  if (user) {
    isLoggedIn = true;
    updateAdminUI();
    
    // Conecta no Firestore APENAS se estiver logado
    unsubPortarias = onSnapshot(collection(db, "portarias"), (snapshot) => {
      portarias = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
      renderPortarias();
      renderRelatorio();
    }, (error) => console.error("Erro ao ler portarias:", error));

    unsubServidores = onSnapshot(collection(db, "servidores"), (snapshot) => {
      servidores = snapshot.docs.map(doc => ({ __backendId: doc.id, ...doc.data() }));
      renderServidores();
      renderRelatorio();
    }, (error) => console.error("Erro ao ler servidores:", error));

  } else {
    // Se deslogar, limpa tudo
    isLoggedIn = false;
    updateAdminUI();
    
    // Desconecta do banco de dados
    if (unsubPortarias) unsubPortarias();
    if (unsubServidores) unsubServidores();
    
    portarias = [];
    servidores = [];
    renderPortarias();
    renderServidores();
    renderRelatorio();
  }
});

document.getElementById('btn-login').addEventListener('click', (e) => {
  e.preventDefault(); openModalLogin();
});

// AQUI ESTÁ A MÁGICA DO LOGIN SEGURO
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('f-login-user').value;
  const pass = document.getElementById('f-login-pass').value;
  
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    window.closeModalLogin();
    showToast('Autenticado com sucesso!');
  } catch (error) {
    showToast('E-mail ou senha incorretos!', 'error');
    console.error(error);
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    await signOut(auth);
    showToast('Desconectado com sucesso!');
  } catch (error) {
    showToast('Erro ao sair', 'error');
  }
});

// Navegação do Menu
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    if (tab === 'relatorio') renderRelatorio();
    if(window.lucide) lucide.createIcons();
  });
});

document.querySelectorAll('.tab-rel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tabRel;
    document.querySelectorAll('.tab-rel-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="rel-"][id$="-content"]').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`rel-${tab}-content`).classList.remove('hidden');
  });
});

// ==========================================
// 5. GESTÃO DE PORTARIAS
// ==========================================
function openModalPortaria(portaria = null) {
  editingPortaria = portaria;
  document.getElementById('modal-title-portaria').textContent = portaria ? 'Editar Portaria' : 'Nova Portaria';
  if (portaria) {
    document.getElementById('f-portaria-numero').value = portaria.numero || '';
    document.getElementById('f-portaria-pub').value = portaria.data_publicacao || '';
    document.getElementById('f-portaria-desc').value = portaria.descricao || '';
    document.getElementById('f-portaria-validade').value = portaria.data_validade || '';
  } else {
    document.getElementById('form-portaria').reset();
  }
  renderServidorBindingList(portaria);
  document.getElementById('modal-portaria').classList.remove('hidden');
  document.getElementById('modal-portaria').classList.add('flex');
}

function renderServidorBindingList(portaria) {
  const list = document.getElementById('servidor-binding-list');
  if (servidores.length === 0) {
    list.innerHTML = '<p class="text-slate-500 text-xs">Nenhum servidor cadastrado</p>';
    return;
  }
  const bindingMap = portaria ? JSON.parse(portaria.servidores || '{}') : {};
  list.innerHTML = servidores.map(srv => `
    <div class="flex items-center gap-3 bg-white p-2 rounded border border-slate-100">
      <input type="checkbox" data-srv-id="${srv.__backendId}" ${bindingMap[srv.__backendId] ? 'checked' : ''} style="cursor:pointer; accent-color: #2563eb;">
      <span class="flex-1 text-sm font-medium text-slate-700">${srv.nome}</span>
      <input type="number" data-srv-hours="${srv.__backendId}" value="${bindingMap[srv.__backendId] || 0}" placeholder="horas" min="0" style="width:70px;padding:4px 8px;font-size:0.75rem;">
    </div>
  `).join('');
}

document.getElementById('form-portaria').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isLoggedIn) return showToast('Sem permissão!', 'error');

  const numero = document.getElementById('f-portaria-numero').value.trim();
  const pub = document.getElementById('f-portaria-pub').value;
  const desc = document.getElementById('f-portaria-desc').value.trim();
  const val = document.getElementById('f-portaria-validade').value;

  const servidorBinding = {};
  document.querySelectorAll('#servidor-binding-list input[type="checkbox"]').forEach(cb => {
    if (cb.checked) {
      const srvId = cb.dataset.srvId;
      const hours = document.querySelector(`input[data-srv-hours="${srvId}"]`).value || 0;
      servidorBinding[srvId] = parseInt(hours);
    }
  });

  const data = {
    numero, descricao: desc, data_publicacao: pub, data_validade: val,
    servidores: JSON.stringify(servidorBinding),
    status: 'ativo'
  };

  try {
    if (editingPortaria) {
      const portariaRef = doc(db, "portarias", editingPortaria.__backendId);
      await updateDoc(portariaRef, data);
      showToast('Portaria atualizada!');
    } else {
      await addDoc(collection(db, "portarias"), data);
      showToast('Portaria cadastrada!');
    }
    window.closeModalPortaria(); 
  } catch (error) {
    console.error("Erro ao salvar:", error);
    showToast('Erro ao salvar no banco (Verifique as regras!)', 'error');
  }
});

// ==========================================
// 6. GESTÃO DE SERVIDORES
// ==========================================
function openModalServidor() {
  document.getElementById('form-servidor').reset();
  document.getElementById('modal-servidor').classList.remove('hidden');
  document.getElementById('modal-servidor').classList.add('flex');
}

function openModalImportCSV() {
  document.getElementById('csv-input').value = '';
  document.getElementById('modal-import-csv').classList.remove('hidden');
  document.getElementById('modal-import-csv').classList.add('flex');
}

async function processCSVImport() {
  const text = document.getElementById('csv-input').value.trim();
  if (!text) return showToast('Digite os dados no formato correto', 'warn');

  const lines = text.split('\n').filter(l => l.trim());
  let imported = 0;
  let errors = 0;
  
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length !== 3) { errors++; continue; }

    const data = { nome: parts[0], segmento: parts[1], setor: parts[2] };
    
    try {
      await addDoc(collection(db, "servidores"), data);
      imported++;
    } catch (e) {
      errors++;
    }
  }

  window.closeModalImportCSV();
  showToast(`Importados ${imported} servidores${errors > 0 ? ` (${errors} erro(s))` : ''}`);
}

document.getElementById('btn-process-csv').addEventListener('click', (e) => {
  e.preventDefault(); e.stopPropagation(); processCSVImport();
});

document.getElementById('form-servidor').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isLoggedIn) return showToast('Faça login primeiro', 'error');
  
  const data = {
    nome: document.getElementById('f-servidor-nome').value.trim(),
    segmento: document.getElementById('f-servidor-segmento').value.trim(),
    setor: document.getElementById('f-servidor-setor').value.trim()
  };

  try {
    await addDoc(collection(db, "servidores"), data);
    window.closeModalServidor();
    showToast('Servidor cadastrado!');
  } catch (error) {
    console.error("Erro ao salvar servidor:", error);
    showToast('Erro ao salvar no banco', 'error');
  }
});

// ==========================================
// 7. DETALHES E REVOGAÇÃO
// ==========================================
window.openDetailPortaria = function(id) {
  const p = portarias.find(r => r.__backendId === id);
  if (!p) return;
  viewingPortaria = p;
  const s = getStatus(p.data_validade);
  document.getElementById('detail-title-portaria').textContent = `Portaria nº ${p.numero}`;
  
  const binding = JSON.parse(p.servidores || '{}');
  const srvList = Object.keys(binding).length > 0 
    ? Object.keys(binding).map(srvId => {
        const srv = servidores.find(s => s.__backendId === srvId);
        return `<span class="inline-block px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium text-xs mr-1 mb-1 border border-slate-200">${srv ? srv.nome : 'Removido'} (${binding[srvId]}h)</span>`;
      }).join('')
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
  document.getElementById('modal-detail-portaria').classList.remove('hidden');
  document.getElementById('modal-detail-portaria').classList.add('flex');
  
  // Só exibe botões de edição se for admin logado
  document.getElementById('btn-edit-portaria').style.display = isLoggedIn ? 'flex' : 'none';
  document.getElementById('btn-revoke-portaria').style.display = isLoggedIn ? 'flex' : 'none';
}

document.getElementById('btn-edit-portaria').addEventListener('click', () => {
  if (viewingPortaria) { window.closeDetailPortaria(); openModalPortaria(viewingPortaria); }
});

document.getElementById('btn-revoke-portaria').addEventListener('click', async () => {
  if (!viewingPortaria || !isLoggedIn) return;
  
  try {
    const portariaRef = doc(db, "portarias", viewingPortaria.__backendId);
    await updateDoc(portariaRef, { status: 'revogada' });
    window.closeDetailPortaria(); 
    showToast('Portaria revogada!');
  } catch (error) {
    console.error("Erro ao revogar:", error);
    showToast('Erro ao revogar', 'error');
  }
});

// ==========================================
// 8. RENDERIZAÇÃO NA TELA
// ==========================================
function renderPortarias() {
  const list = document.getElementById('portaria-list');
  let filtered = portarias.filter(p => {
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
  
  document.getElementById('stat-total').textContent = ok + warn + exp;
  document.getElementById('stat-ok').textContent = ok;
  document.getElementById('stat-warn').textContent = warn;
  document.getElementById('stat-expired').textContent = exp;
  
  if (filtered.length === 0) {
    list.innerHTML = '';
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }
  document.getElementById('empty-state').classList.add('hidden');

  list.innerHTML = filtered.map(p => {
    const s = getStatus(p.data_validade);
    return `
      <div class="bg-card border border-slate-200 rounded-2xl p-5 card-hover cursor-pointer" onclick="openDetailPortaria('${p.__backendId}')">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <div class="flex gap-3 items-center flex-wrap">
              <span class="font-bold text-slate-800 text-lg">Portaria nº ${p.numero}</span>
              <span class="status-pill ${s.class}">${s.label}</span>
            </div>
            <p class="text-slate-600 text-sm mt-2">${p.descricao}</p>
            <div class="flex gap-4 mt-3 text-xs text-slate-500 font-medium">
              <span class="flex items-center gap-1"><i data-lucide="calendar" style="width:12px;height:12px;"></i> Pub: ${formatDate(p.data_publicacao)}</span>
              <span class="flex items-center gap-1"><i data-lucide="clock" style="width:12px;height:12px;"></i> Val: ${formatDate(p.data_validade)}</span>
            </div>
          </div>
          <i data-lucide="chevron-right" style="width:20px;height:20px;color:#cbd5e1;"></i>
        </div>
      </div>
    `;
  }).join('');
  if(window.lucide) lucide.createIcons();
}

function renderServidores() {
  const list = document.getElementById('servidor-list');
  const empty = document.getElementById('servidor-empty');
  if (servidores.length === 0) {
    list.innerHTML = ''; empty.classList.remove('hidden'); return;
  }
  empty.classList.add('hidden');
  list.innerHTML = servidores.map(s => `
    <div class="bg-card border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div class="flex flex-col gap-1">
        <p class="font-bold text-slate-800 text-lg">${s.nome}</p>
        <div class="flex flex-wrap gap-2 mt-2">
          <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-semibold">${s.segmento}</span>
          <span class="bg-blue-50 text-accent px-2 py-1 rounded text-xs font-semibold">${s.setor}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderRelatorio() {
  const srvHoras = {}; const srvPortarias = {}; let totalHoras = 0;
  servidores.forEach(s => { srvHoras[s.__backendId] = 0; srvPortarias[s.__backendId] = 0; });
  
  portarias.forEach(p => {
    if (p.status === 'revogada') return;
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
  
  if (servidores.length === 0) {
    srvDiv.innerHTML = ''; srvEmpty.classList.remove('hidden');
  } else {
    srvEmpty.classList.add('hidden');
    srvDiv.innerHTML = servidores.map(s => `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
        <p class="font-bold text-slate-800">${s.nome}</p>
        <p class="text-slate-500 text-xs mt-1 font-medium">${s.segmento} • ${s.setor}</p>
        <div class="flex gap-4 mt-3 text-xs font-bold">
          <div class="flex items-center gap-1.5 text-slate-700 bg-white px-2 py-1 rounded border border-slate-100">
            <i data-lucide="clock" style="width:14px;height:14px;color:#f59e0b;"></i> ${srvHoras[s.__backendId] || 0}h
          </div>
          <div class="flex items-center gap-1.5 text-slate-700 bg-white px-2 py-1 rounded border border-slate-100">
            <i data-lucide="file-text" style="width:14px;height:14px;color:#10b981;"></i> ${srvPortarias[s.__backendId] || 0}
          </div>
        </div>
      </div>
    `).join('');
  }

  const vigentes = portarias.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'ok').sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  const aVencer = portarias.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'warn').sort((a, b) => getStatus(a.data_validade).days - getStatus(b.data_validade).days);
  const vencidas = portarias.filter(p => p.status !== 'revogada' && getStatus(p.data_validade).key === 'expired').sort((a, b) => getStatus(b.data_validade).days - getStatus(a.data_validade).days);
  
  document.getElementById('stat-port-vigentes').textContent = vigentes.length;
  document.getElementById('stat-port-vencer').textContent = aVencer.length;
  document.getElementById('stat-port-vencidas').textContent = vencidas.length;

  const renderPortariaList = (arr, divId) => {
    const div = document.getElementById(divId);
    if (arr.length === 0) { div.innerHTML = '<p class="text-slate-500 text-sm font-medium p-4 bg-slate-50 rounded-xl border border-slate-200">Nenhuma portaria nesta categoria</p>'; }
    else {
      div.innerHTML = arr.map(p => {
        const s = getStatus(p.data_validade);
        const srvCount = Object.keys(JSON.parse(p.servidores || '{}')).length;
        const msgVence = s.key === 'expired' ? `Vencida há ${Math.abs(s.days)}d` : `Vence: ${formatDate(p.data_validade)}`;
        return `
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm cursor-pointer hover:bg-slate-100 transition-colors" onclick="openDetailPortaria('${p.__backendId}')">
            <div class="flex items-start justify-between gap-2">
              <div><p class="font-bold text-slate-800 text-sm">Nº ${p.numero}</p><p class="text-slate-500 text-xs mt-0.5 line-clamp-1">${p.descricao}</p></div>
              <span class="status-pill ${s.class} shrink-0 scale-90 origin-top-right">${s.key === 'expired' ? msgVence : s.label}</span>
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
  if(window.lucide) lucide.createIcons();
}

// ==========================================
// 9. EVENTOS DOS BOTÕES E FILTROS
// ==========================================
document.getElementById('btn-new-portaria').addEventListener('click', (e) => {
  if (!isLoggedIn) return showToast('Faça login para adicionar', 'warn');
  e.preventDefault(); openModalPortaria();
});

document.getElementById('btn-new-servidor').addEventListener('click', (e) => {
  if (!isLoggedIn) return showToast('Faça login para adicionar', 'warn');
  e.preventDefault(); openModalServidor();
});

document.getElementById('btn-import-csv').addEventListener('click', (e) => {
  if (!isLoggedIn) return showToast('Faça login para importar', 'warn');
  e.preventDefault(); openModalImportCSV();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.className = 'filter-btn px-5 py-2 rounded-lg text-xs font-bold transition-all bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50');
    btn.className = 'filter-btn px-5 py-2 rounded-lg text-xs font-bold transition-all bg-accent text-white shadow-sm';
    renderPortarias();
  });
});

document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value; renderPortarias();
});

// ==========================================
// 10. FUNÇÕES DE EXPORTAÇÃO (CSV)
// ==========================================
function downloadCSV(filename, data) {
  const blob = new Blob([data.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

document.getElementById('btn-export-servidores').addEventListener('click', () => {
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
  const csv = ['"Nome","Segmento","Setor","Total de Horas","Quantidade de Portarias"', ...servidores.map(s => `"${s.nome}","${s.segmento}","${s.setor}",${srvHoras[s.__backendId] || 0},${srvPortarias[s.__backendId] || 0}`)];
  downloadCSV(`relatorio_servidores_${new Date().toISOString().split('T')[0]}.csv`, csv);
});

document.getElementById('btn-export-portarias').addEventListener('click', () => {
  if (portarias.length === 0) return showToast('Não há portarias para exportar', 'warn');
  const csv = ['"Número","Descrição","Data Publicação","Data Validade","Status","Total Horas Vinculadas"', ...portarias.filter(p => p.status !== 'revogada').map(p => {
    const binding = JSON.parse(p.servidores || '{}');
    const totalHoras = Object.values(binding).reduce((a, b) => a + b, 0);
    const s = getStatus(p.data_validade);
    return `"${p.numero}","${p.descricao}","${p.data_publicacao}","${p.data_validade}","${s.key === 'ok' ? 'Vigente' : s.key === 'warn' ? 'A Vencer' : 'Vencida'}",${totalHoras}`;
  })];
  downloadCSV(`relatorio_portarias_${new Date().toISOString().split('T')[0]}.csv`, csv);
});

// Renderização inicial
updateAdminUI();
if(window.lucide) lucide.createIcons();
