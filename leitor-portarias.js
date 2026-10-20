// ==========================================
// LEITOR DE PORTARIAS (PDF DO SUAP)
// ==========================================
// Extrai os campos de uma portaria a partir do texto do PDF, usando os
// padrões do modelo do SUAP. Usado pelo site (importação manual) e pelo
// robô que varre o site do campus (robo/varrer-portarias.js).

export const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

export function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
export function normalizarNome(s) { return semAcento(s).toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }

export function dataIso(ano, mes, dia) {
  const m = parseInt(mes), d = parseInt(dia);
  if (!m || !d || m > 12 || d > 31) return '';
  return `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function dataPorExtenso(dia, mesNome, ano) {
  return dataIso(ano, MESES[semAcento(mesNome).toLowerCase()], dia);
}

// "100/2026", "Nº 100/2026 - DRG/PEP/IFSP" e "100-2026" viram a mesma chave
export function chaveNumero(numero) {
  const m = String(numero || '').match(/(\d+)\s*[\/\-]\s*(\d{4})/);
  return m ? `${parseInt(m[1])}/${m[2]}` : '';
}

// O site do campus publica o mesmo arquivo do SUAP trocando "Nº" por "N", espaços por "_"
// e removendo os caracteres acentuados (ex: "MARÇO" vira "MARO")
export function linkPublicacao(nomeArquivo, ano) {
  const nome = nomeArquivo.replace(/\s*\(\d+\)(?=\.pdf$)/i, '').replace(/N\s*[º°]/g, 'N').replace(/\s+/g, '_').replace(/[^\x00-\x7F]/g, '');
  return `https://pep.ifsp.edu.br/images/PDF/Portarias/${ano}/${nome}`;
}

// Mesmo critério usado no cadastro manual: designações de membros/servidores contam como Comissão
export function classificarTipo(descricao) {
  const d = semAcento(descricao).toLowerCase();
  return /fiscal/.test(d) ? 'Fiscalização' : /\bdesign/.test(d) ? 'Comissão' : 'Diversas';
}

// Retorna { numero: '48/2026', referencia: 'PORTARIA Nº 48/2026 - DRG/PEP/IFSP DE ...' } ou null
export function extrairRevoga(texto) {
  const m = String(texto || '').replace(/\s+/g, ' ').match(/revoga\S*\s+(?:a|as|o)?\s*(portarias?\s+(?:n\s*[º°o.]*\s*)?(\d+)\s*[\/\-]\s*(\d{4})(?:\s*-\s*DRG[\-\/]PEP[\-\/]IFSP)?(?:,?\s+de\s+\d{1,2}\s*º?\s+de\s+[A-Za-zÀ-ÿ]+\s+de\s+\d{4})?)/i);
  return m ? { numero: `${parseInt(m[2])}/${m[3]}`, referencia: m[1] } : null;
}

// `pdfjsLib` é passado por quem chama: no navegador vem do CDN, no robô do pacote pdfjs-dist
export async function extrairTextoPdf(pdfjsLib, data) {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let texto = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    texto += content.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  return texto;
}

export function extrairValidade(texto, dataPub) {
  const t = semAcento(texto).toLowerCase().replace(/\s+/g, ' ');
  const trechos = [...t.matchAll(/(?:vigencia|vigorara|vigorar|validade|prazo de)[^.]{0,200}/g)].map(m => m[0]);
  for (const s of trechos) {
    let m = s.match(/ano (?:letivo )?de (\d{4})/);
    if (m) return `${m[1]}-12-31`;
    m = s.match(/ate (?:o dia )?(\d{1,2})\s*(?:º|o)?\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
    if (m && MESES[m[2]]) return dataIso(m[3], MESES[m[2]], m[1]);
    m = s.match(/ate (\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return dataIso(m[3], m[2], m[1]);
    m = s.match(/(\d+)\s*(?:\([^)]*\))?\s*(dias|meses|mes|anos|ano)\b/);
    if (m && dataPub) {
      const [y, mo, d] = dataPub.split('-').map(Number);
      const n = parseInt(m[1]);
      const dt = m[2] === 'dias' ? new Date(y, mo - 1, d + n)
               : m[2].startsWith('mes') ? new Date(y, mo - 1 + n, d)
               : new Date(y + n, mo - 1, d);
      return dataIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
  }
  return '';
}

// Retorna { estado: 'pronta' | 'incompleta' | 'ignorada', dados, avisos }.
// A verificação de duplicidade fica com quem chama (depende do que já está cadastrado).
export function analisarPortaria(texto, nomeArquivo, servidores) {
  const plano = texto.replace(/\s+/g, ' ');

  // Cabeçalho: o primeiro "XXX Nº" do documento precisa ser PORTARIA (ignora editais etc.)
  const mTitulo = plano.slice(0, 1000).match(/\b(PORTARIA|EDITAL|RESOLU[ÇC][ÃA]O|INSTRU[ÇC][ÃA]O NORMATIVA)\s+N\s*[º°o.]*\s*(\d+)\s*[\/\-]\s*(\d{4})/i);
  if (!mTitulo || !/^portaria$/i.test(mTitulo[1])) {
    return { estado: 'ignorada', avisos: ['Não parece ser uma portaria (cabeçalho "PORTARIA Nº" não encontrado).'] };
  }
  const ano = mTitulo[3];
  const numero = `${parseInt(mTitulo[2])}/${ano}`;

  // Publicação: carimbo "Publicado no sítio institucional em ..." ou data do cabeçalho
  let data_publicacao = '';
  const m = plano.match(/Publicad[oa] no s[íi]tio institucional em (\d{1,2})\s*º?\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})/i)
         || plano.slice(mTitulo.index, mTitulo.index + 160).match(/\bDE\s+(\d{1,2})\s*º?\s+DE\s+([A-Za-zÀ-ÿ]+)\s+DE\s+(\d{4})/i);
  if (m) data_publicacao = dataPorExtenso(m[1], m[2], m[3]);

  // Descrição: texto do Art. 1º (após o RESOLVE)
  const idxResolve = plano.search(/RESOLVE/i);
  const corpo = idxResolve >= 0 ? plano.slice(idxResolve + 7) : plano;
  const mArt1 = corpo.match(/Art\.?\s*1(?!\d)\s*[º°o]?\.?\s*[-–—]?\s*([\s\S]*?)(?=\s*Art\.?\s*2(?!\d)|\s*D[êe] ci[êe]ncia|\s*Publique-se|$)/i);
  let descricao = (mArt1 ? mArt1[1] : corpo.slice(0, 400))
    .replace(/,?\s*SIAPE\s*(?:n\s*[º°]\s*)?:?\s*[\d*.\-xX]+/gi, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^([A-ZÀ-Ý]{2,})\b/, w => w[0] + w.slice(1).toLowerCase());

  // Revogação de portaria anterior
  const rev = extrairRevoga(plano);
  if (rev && !/^revog/i.test(descricao)) descricao = `Revogar a ${rev.referencia.toUpperCase()} e ${descricao}`;

  // Servidores do cadastro cujo nome completo aparece no corpo (horas não constam no PDF).
  // O bloco de assinatura é removido para não vincular o diretor que assina.
  const corpoSemAssinatura = corpo
    .replace(/Publique-se[\s\S]*?Publicad[oa] no s[íi]tio institucional em \d{1,2}\s*º?\s+de\s+\S+\s+de\s+\d{4}/i, ' ')
    .replace(/assinado eletronicamente por:[\s\S]*?\d{2}:\d{2}:\d{2}/gi, ' ');
  const textoNorm = ' ' + normalizarNome(corpoSemAssinatura) + ' ';
  const servidoresMap = {};
  servidores.forEach(s => {
    const n = normalizarNome(s.nome);
    if (n.length > 5 && textoNorm.includes(' ' + n + ' ')) servidoresMap[s.__backendId] = 0;
  });

  const dados = {
    numero, data_publicacao, descricao,
    tipo: classificarTipo(descricao),
    revoga: rev ? rev.numero : null,
    data_validade: extrairValidade(corpo, data_publicacao),
    link: linkPublicacao(nomeArquivo, ano),
    servidores: servidoresMap
  };

  const avisos = [];
  if (!data_publicacao) avisos.push('Data de publicação não encontrada.');
  if (!dados.data_validade) avisos.push('Validade não identificada: ficará como Indeterminada.');
  if (Object.keys(servidoresMap).length === 0) avisos.push('Nenhum servidor do cadastro foi encontrado no texto.');

  return { estado: (numero && data_publicacao && descricao) ? 'pronta' : 'incompleta', dados, avisos };
}
