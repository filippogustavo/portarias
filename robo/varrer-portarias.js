// ==========================================
// ROBÔ: VARRE O SITE DO CAMPUS EM BUSCA DE PORTARIAS NOVAS
// ==========================================
// Lê a página de portarias do ano em pep.ifsp.edu.br, baixa os PDFs que
// ainda não estão no sistema, extrai os campos (mesmo leitor do site) e grava
// em "portarias_pendentes" para o admin revisar. Nada é publicado direto.
//
// Uso:
//   node robo/varrer-portarias.js            -> grava as pendentes (precisa de ROBO_EMAIL e ROBO_SENHA)
//   node robo/varrer-portarias.js --simular  -> só mostra o que faria, sem login e sem gravar

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, addDoc } from 'firebase/firestore';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { analisarPortaria, extrairTextoPdf, extrairRevoga, chaveNumero, classificarTipo, dataPorExtenso } from '../leitor-portarias.js';

const firebaseConfig = {
  apiKey: "AIzaSyD47CBTe09nbstXgtJZn5OfZiTRlIcqjII",
  authDomain: "portarias-9be36.firebaseapp.com",
  projectId: "portarias-9be36",
  storageBucket: "portarias-9be36.firebasestorage.app",
  messagingSenderId: "895034691886",
  appId: "1:895034691886:web:ae9107225da49703f2aabf"
};

const SITE = 'https://pep.ifsp.edu.br';
const paginaDoAno = ano => `${SITE}/index.php/documentos-institucionais/portarias/${ano}`;
const MAX_POR_EXECUCAO = 40;  // limita a primeira execução, que pode encontrar muitas de uma vez
const SIMULAR = process.argv.includes('--simular');

function limparHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\s+/g, ' ').trim();
}

// Cada portaria na página é um <a href="...pdf">TÍTULO</a> seguido de um <p> com o resumo
function extrairEntradas(html) {
  const entradas = [];
  const re = /<a\s[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const titulo = limparHtml(m[2]);
    const chave = chaveNumero((titulo.match(/PORTARIA\s+N\S*\s*(\d+\s*[\/\-]\s*\d{4})/i) || [])[1]);
    if (!chave) continue;

    const depois = html.slice(re.lastIndex).replace(/^\s*<\/p>/i, '');
    const prox = depois.match(/^\s*<p[^>]*>([\s\S]*?)<\/p>/i);
    const resumo = prox && !/href=/i.test(prox[1]) ? limparHtml(prox[1]) : '';

    const mData = titulo.match(/\bDE\s+(\d{1,2})\s*º?\s+DE\s+([A-Za-zÀ-ÿ]+)\s+DE\s+(\d{4})/i);
    entradas.push({
      chave, titulo, resumo,
      link: new URL(m[1], SITE).href,
      dataTitulo: mData ? dataPorExtenso(mData[1], mData[2], mData[3]) : ''
    });
  }
  return entradas;
}

async function buscar(url, tipo = 'text') {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Robo-Portarias-IFSP-PEP (controle interno de portarias)' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
  return tipo === 'bytes' ? new Uint8Array(await resp.arrayBuffer()) : resp.text();
}

// Monta a pendente: campos lidos do PDF + link exato e resumo publicados no site
async function montarPendente(entrada, servidores) {
  const nomeArquivo = decodeURIComponent(entrada.link.split('/').pop());
  let estado, dados, avisos;
  try {
    const texto = await extrairTextoPdf(pdfjsLib, await buscar(entrada.link, 'bytes'));
    ({ estado, dados, avisos } = analisarPortaria(texto, nomeArquivo, servidores));
  } catch (e) {
    estado = 'incompleta'; avisos = [`Não foi possível ler o PDF (${e.message}). Dados vindos só da página do site.`];
  }
  if (estado === 'ignorada') return null;

  dados = dados || { numero: entrada.chave, data_publicacao: '', data_validade: '', revoga: null, servidores: {} };
  dados.link = entrada.link;
  if (!dados.data_publicacao) dados.data_publicacao = entrada.dataTitulo;
  if (entrada.resumo) {
    // O resumo do site é o texto que já era usado como descrição no cadastro manual
    dados.descricao = entrada.resumo;
    dados.tipo = classificarTipo(entrada.resumo);
    if (!dados.revoga) dados.revoga = extrairRevoga(entrada.resumo)?.numero || null;
  }
  dados.tipo = dados.tipo || classificarTipo(dados.descricao);

  return {
    numero: dados.numero, descricao: dados.descricao || '', tipo: dados.tipo,
    data_publicacao: dados.data_publicacao || '', data_validade: dados.data_validade || '',
    link: dados.link, revoga: dados.revoga || null,
    servidores: JSON.stringify(dados.servidores || {}),
    avisos: avisos || [], titulo: entrada.titulo,
    origem: 'site', encontrada_em: new Date().toISOString()
  };
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  if (!SIMULAR) {
    // trim(): espaços ou quebras de linha coladas sem querer nos secrets do GitHub invalidam o login
    const email = (process.env.ROBO_EMAIL || '').trim();
    const senha = (process.env.ROBO_SENHA || '').trim();
    if (!email || !senha) throw new Error('Defina os secrets ROBO_EMAIL e ROBO_SENHA no GitHub.');
    try {
      await signInWithEmailAndPassword(getAuth(app), email, senha);
    } catch (e) {
      throw new Error(`Login do robô falhou para "${email.replace(/^(.{3}).*(@.*)$/, '$1***$2')}" (${e.code}). Confira se o usuário existe em Firebase > Authentication > Users e se a senha do secret ROBO_SENHA é a mesma.`);
    }
  }

  const lerColecao = async nome => (await getDocs(collection(db, nome))).docs.map(d => ({ __backendId: d.id, ...d.data() }));
  const [portarias, pendentes, servidores] = await Promise.all([lerColecao('portarias'), lerColecao('portarias_pendentes'), lerColecao('servidores')]);
  // Conhecidas = já cadastradas + já pendentes (inclusive descartadas, para não voltarem)
  const conhecidas = new Set([...portarias, ...pendentes].map(p => chaveNumero(p.numero)).filter(Boolean));
  console.log(`No sistema: ${portarias.length} portarias, ${pendentes.length} pendentes/descartadas, ${servidores.length} servidores.`);

  // Em janeiro também olha o ano anterior, para pegar as publicadas no fim do ano
  const hoje = new Date();
  const anos = hoje.getMonth() === 0 ? [hoje.getFullYear(), hoje.getFullYear() - 1] : [hoje.getFullYear()];

  let novas = [];
  for (const ano of anos) {
    const entradas = extrairEntradas(await buscar(paginaDoAno(ano)));
    console.log(`Site ${ano}: ${entradas.length} portarias listadas.`);
    novas.push(...entradas.filter(e => !conhecidas.has(e.chave)));
  }
  novas = novas.filter((e, i) => novas.findIndex(o => o.chave === e.chave) === i);
  console.log(`Novas: ${novas.length}${novas.length > MAX_POR_EXECUCAO ? ` (processando ${MAX_POR_EXECUCAO} nesta execução)` : ''}.`);

  let gravadas = 0;
  for (const entrada of novas.slice(0, MAX_POR_EXECUCAO)) {
    try {
      const pendente = await montarPendente(entrada, servidores);
      if (!pendente) { console.log(`  - ${entrada.chave}: ignorada (não é portaria)`); continue; }
      const nServ = Object.keys(JSON.parse(pendente.servidores)).length;
      console.log(`  + ${pendente.numero} | ${pendente.tipo} | pub ${pendente.data_publicacao || '?'} | val ${pendente.data_validade || 'indet.'} | revoga ${pendente.revoga || '-'} | ${nServ} serv. | ${pendente.descricao.slice(0, 70)}`);
      if (!SIMULAR) { await addDoc(collection(db, 'portarias_pendentes'), pendente); gravadas++; }
    } catch (e) {
      console.error(`  ! ${entrada.chave}: ${e.message}`);
    }
  }
  console.log(SIMULAR ? 'Simulação: nada foi gravado.' : `Gravadas ${gravadas} pendente(s).`);
}

main().then(() => process.exit(0)).catch(e => { console.error('ERRO:', e.message); process.exit(1); });
