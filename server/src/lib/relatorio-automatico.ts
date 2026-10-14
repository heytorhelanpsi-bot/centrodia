import type { DadosRegistros } from '../ai/dados.js';
import { estatisticas, MIN_OBS_TENDENCIA } from '../ai/dados.js';

/**
 * Relatório compilado automaticamente a partir dos registros salvos — sem IA.
 * Regras: usa apenas o que foi registrado; cita os textos dos profissionais literalmente (com data);
 * números vêm de contagens; tendências só com dados suficientes e na mesma versão de escala;
 * nenhuma conclusão clínica ou causal é gerada.
 */

const fmt = (d: string) => d.split('-').reverse().join('/');
const pct = (n: number, t: number) => (t ? `${Math.round((n / t) * 100)}%` : '0%');
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

const REALIZACAO: Record<string, string> = { integral: 'integral', parcial: 'parcial', nao_realizada: 'não realizada' };
const PARTICIPACAO: Record<string, string> = { integral: 'participou integralmente', parcial: 'participou parcialmente', nao_realizada: 'não participou' };
const APOIO: Record<string, string> = {
  sem_apoio: 'sem apoio', apoio_pontual: 'apoio pontual', apoio_frequente: 'apoio frequente', apoio_intenso: 'apoio intenso', apoio_integral: 'apoio integral',
};
const ORDEM_APOIO = Object.keys(APOIO);

const OBJETIVO_PADRAO: Record<string, string> = {
  individual_evolucao: 'Descrever a evolução do assistido no período, a partir dos registros de atendimento.',
  mensal: 'Apresentar a síntese mensal dos atendimentos, da participação e dos indicadores registrados.',
  trimestral: 'Apresentar a evolução registrada ao longo do trimestre.',
  semestral: 'Apresentar o panorama dos registros do semestre.',
  participacao_atividades: 'Descrever a frequência e a participação nas atividades realizadas.',
  indicadores_comportamentais: 'Descrever os indicadores comportamentais registrados, respeitando as escalas utilizadas.',
  discussao_multidisciplinar: 'Reunir de forma descritiva os registros do período para subsidiar a discussão da equipe multidisciplinar.',
};

interface Opcoes {
  tipo: string;
  objetivo: string | null;
  profissionais: Map<string, string>;
}

type Serie = ReturnType<typeof estatisticas>['indicadores'][number]['versoes_de_escala'][number];

function niveis(d: DadosRegistros, indicador: string, versao: number): Map<number, string> {
  const a = d.avaliacoes.find((x) => x.nome === indicador && x.versao === versao);
  return new Map(((a?.niveis ?? []) as { valor: number; descricao: string }[]).map((n) => [n.valor, n.descricao]));
}

function mediana(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Compara a primeira e a segunda metade da série (somente com dados suficientes). */
function variacao(v: Serie): 'maiores' | 'menores' | 'semelhantes' | null {
  if (!v.dados_suficientes_para_tendencia) return null;
  const vals = v.serie.map((p) => p.valor);
  const meio = Math.floor(vals.length / 2);
  const a = mediana(vals.slice(0, meio));
  const b = mediana(vals.slice(vals.length - meio));
  if (Math.abs(b - a) < 1) return 'semelhantes';
  return b > a ? 'maiores' : 'menores';
}

function leituraDirecao(direcao: string, sentido: 'maiores' | 'menores') {
  if (direcao === 'maior_melhor') return sentido === 'maiores' ? 'direção favorável segundo a escala' : 'direção desfavorável segundo a escala';
  if (direcao === 'menor_melhor') return sentido === 'menores' ? 'menor intensidade do comportamento monitorado' : 'maior intensidade do comportamento monitorado';
  return 'sem direção de interpretação definida';
}

export function compilarRelatorio(d: DadosRegistros, o: Opcoes): string {
  const est = estatisticas(d);
  const total = d.evolucoes.length;
  const L: string[] = [];
  const secao = (t: string) => L.push('', `## ${t}`);

  // --- Objetivo -----------------------------------------------------------
  secao('Objetivo do relatório');
  L.push(o.objetivo || OBJETIVO_PADRAO[o.tipo] || OBJETIVO_PADRAO.individual_evolucao);
  L.push('', `_Relatório compilado automaticamente pelo sistema a partir de ${plural(total, 'registro finalizado', 'registros finalizados')}. ` +
    'Os trechos entre aspas reproduzem literalmente o que foi registrado pelos profissionais._');

  if (!total) {
    secao('Registros do período');
    L.push('Não há evoluções finalizadas no período selecionado. Não é possível descrever atividades, participação ou indicadores.');
    return L.join('\n').trim();
  }

  // --- Atividades -----------------------------------------------------------
  secao('Atividades realizadas');
  const datas = d.evolucoes.map((e) => e.data as string).sort();
  L.push(`Foram registrados ${plural(total, 'atendimento', 'atendimentos')} entre ${fmt(datas[0])} e ${fmt(datas.at(-1)!)}: ` +
    `${plural(est.por_contexto.individual, 'individual', 'individuais')} e ${plural(est.por_contexto.participacao_coletiva, 'participação em atividade em grupo', 'participações em atividades em grupo')}.`);
  const turnos = { manha: 0, tarde: 0 };
  for (const e of d.evolucoes) turnos[e.turno as 'manha' | 'tarde']++;
  L.push(`Turnos: ${turnos.manha} pela manhã e ${turnos.tarde} à tarde.`);
  const porAtiv = new Map<string, Record<string, number>>();
  for (const a of d.atividades) {
    const r = porAtiv.get(a.nome) ?? { total: 0, integral: 0, parcial: 0, nao_realizada: 0, nao_informado: 0 };
    r.total++;
    r[a.realizacao ?? 'nao_informado']++;
    porAtiv.set(a.nome, r);
  }
  if (porAtiv.size) {
    L.push('', 'Frequência das atividades (número de registros em que a atividade aparece):');
    for (const [nome, r] of [...porAtiv].sort((a, b) => b[1].total - a[1].total)) {
      const det = (['integral', 'parcial', 'nao_realizada'] as const).filter((k) => r[k]).map((k) => `${REALIZACAO[k]}: ${r[k]}`);
      if (r.nao_informado) det.push(`realização não informada: ${r.nao_informado}`);
      L.push(`- **${nome}** — ${r.total} ${det.length ? `(${det.join('; ')})` : ''}`);
    }
  } else L.push('Os registros não informam as atividades realizadas.');
  if (d.coletivas.length) {
    L.push('', 'Atividades em grupo com participação registrada:');
    for (const c of d.coletivas) {
      const e = d.evolucoes.find((x) => x.atividade_coletiva_id === c.id);
      L.push(`- ${e ? fmt(e.data) : ''} — ${c.nome_atividade}${c.objetivo ? ` (objetivo: ${c.objetivo})` : ''}`);
    }
  }

  // --- Participação e engajamento --------------------------------------------
  secao('Participação e engajamento');
  const grupo = d.evolucoes.filter((e) => e.tipo === 'participacao_coletiva');
  if (grupo.length) {
    const cont: Record<string, number> = {};
    for (const e of grupo) if (e.participacao) cont[e.participacao] = (cont[e.participacao] ?? 0) + 1;
    L.push(`Nas ${plural(grupo.length, 'atividade em grupo', 'atividades em grupo')}: ` +
      Object.entries(cont).map(([k, n]) => `${PARTICIPACAO[k]} em ${n} (${pct(n, grupo.length)})`).join('; ') + '.');
  }
  const realizTot = d.atividades.filter((a) => a.realizacao);
  if (realizTot.length) {
    const integ = realizTot.filter((a) => a.realizacao === 'integral').length;
    L.push(`Considerando as atividades com realização informada, ${pct(integ, realizTot.length)} foram realizadas integralmente (${integ} de ${realizTot.length}).`);
  }
  for (const chave of ['Engajamento', 'Atenção', 'Foco na atividade', 'Interação social']) {
    const i = est.indicadores.find((x) => x.indicador === chave);
    const v = i?.versoes_de_escala.at(-1);
    if (!i || !v) continue;
    const nv = niveis(d, chave, v.versao);
    L.push(`- ${chave}: ${plural(v.observacoes, 'pontuação registrada', 'pontuações registradas')}, valores entre ${v.minimo_observado} (“${nv.get(v.minimo_observado!) ?? ''}”) e ${v.maximo_observado} (“${nv.get(v.maximo_observado!) ?? ''}”)` +
      `${v.dados_suficientes_para_tendencia ? `; mediana ${v.mediana}` : ''}; não avaliado em ${i.registros_sem_avaliacao} registro(s).`);
  }
  const interacoes = d.evolucoes.filter((e) => e.interacao);
  if (interacoes.length) {
    L.push('', 'Interações registradas:');
    for (const e of interacoes) L.push(`- ${fmt(e.data)}: “${e.interacao}”`);
  }

  // --- Indicadores ------------------------------------------------------------
  secao('Evolução dos indicadores');
  L.push(`Cada indicador é descrito conforme a escala usada no registro. Versões diferentes de uma escala não são comparadas. ` +
    `“Não avaliado” indica ausência de registro e não equivale a zero. Tendências só são descritas com pelo menos ${MIN_OBS_TENDENCIA} pontuações na mesma versão de escala.`);
  if (!est.indicadores.length) L.push('', 'Nenhum indicador foi avaliado nos registros do período.');
  for (const i of est.indicadores) {
    L.push('', `### ${i.indicador}`);
    if (!i.versoes_de_escala.length) { L.push(`Sem pontuações no período (não avaliado em ${i.registros_sem_avaliacao} registro(s)).`); continue; }
    for (const v of i.versoes_de_escala) {
      const nv = niveis(d, i.indicador, v.versao);
      const prim = v.serie[0];
      const ult = v.serie.at(-1)!;
      const cab = i.versoes_de_escala.length > 1 ? `Escala versão ${v.versao} (${v.escala}): ` : `Escala ${v.escala}: `;
      L.push(`- ${cab}${plural(v.observacoes, 'pontuação', 'pontuações')}; valores observados de ${v.minimo_observado} a ${v.maximo_observado}` +
        `${v.dados_suficientes_para_tendencia ? `; mediana ${v.mediana}` : ''}.`);
      L.push(`- Primeiro registro (${fmt(prim.data)}): ${prim.valor} — “${nv.get(prim.valor) ?? ''}”. Último registro (${fmt(ult.data)}): ${ult.valor} — “${nv.get(ult.valor) ?? ''}”.`);
      const s = variacao(v);
      if (s === null) L.push('- Dados insuficientes para descrever tendência.');
      else if (s === 'semelhantes') L.push('- Valores semelhantes entre a primeira e a segunda metade do período.');
      else L.push(`- Valores ${s} na segunda metade do período (${leituraDirecao(v.direcao, s)}). Variação descritiva, não indica causa.`);
    }
    if (i.registros_sem_avaliacao) L.push(`- Não avaliado em ${i.registros_sem_avaliacao} de ${total} registro(s).`);
    const obs = d.avaliacoes.filter((a) => a.nome === i.indicador && a.observacao);
    for (const a of obs) {
      const e = d.evolucoes.find((x) => x.id === a.evolucao_id);
      L.push(`- Observação de ${e ? fmt(e.data) : ''}: “${a.observacao}”`);
    }
  }

  // --- Comportamentos ---------------------------------------------------------
  secao('Comportamentos observados');
  const comp = d.evolucoes.filter((e) => e.comportamentos || e.resposta_orientacoes);
  if (!comp.length) L.push('Os campos específicos de comportamentos e de resposta às orientações não foram preenchidos no período (ver os textos de evolução no anexo).');
  for (const e of comp) {
    if (e.comportamentos) L.push(`- ${fmt(e.data)}: “${e.comportamentos}”`);
    if (e.resposta_orientacoes) L.push(`- ${fmt(e.data)} (resposta às orientações/estímulos): “${e.resposta_orientacoes}”`);
  }
  const ocorr = d.evolucoes.filter((e) => e.ocorrencias);
  if (ocorr.length) {
    L.push('', `Ocorrências registradas (${ocorr.length}):`);
    for (const e of ocorr) L.push(`- ${fmt(e.data)}: “${e.ocorrencias}”`);
  }

  // --- Potencialidades e dificuldades -------------------------------------------
  secao('Potencialidades e dificuldades');
  const pot: string[] = [];
  const dif: string[] = [];
  for (const i of est.indicadores) {
    const v = i.versoes_de_escala.at(-1);
    if (!v || v.observacoes < 2) continue;
    const vals = v.serie.map((p) => p.valor);
    const amplitude = v.escala.split('–').map(Number);
    const alto = amplitude[1] - 1;
    const baixo = amplitude[0] + 1;
    const nAlto = vals.filter((x) => x >= alto).length;
    const nBaixo = vals.filter((x) => x <= baixo).length;
    if (v.direcao === 'maior_melhor') {
      if (nAlto / vals.length >= 0.5) pot.push(`${i.indicador}: pontuações de ${alto} ou mais em ${nAlto} de ${vals.length} registros.`);
      if (nBaixo / vals.length >= 0.5) dif.push(`${i.indicador}: pontuações de ${baixo} ou menos em ${nBaixo} de ${vals.length} registros.`);
    } else if (v.direcao === 'menor_melhor') {
      if (nBaixo === vals.length) pot.push(`${i.indicador}: intensidade baixa ou não observada em todos os ${vals.length} registros pontuados.`);
      const nMod = vals.filter((x) => x >= 3).length;
      if (nMod) dif.push(`${i.indicador}: intensidade moderada ou acima (3 ou mais) em ${nMod} de ${vals.length} registros.`);
    }
  }
  for (const [nome, r] of porAtiv) {
    const inf = r.integral + r.parcial + r.nao_realizada;
    if (inf >= 2 && r.integral / inf >= 0.75) pot.push(`${nome}: realização integral em ${r.integral} de ${inf} registros com realização informada.`);
    if (inf >= 2 && (r.parcial + r.nao_realizada) / inf >= 0.5) dif.push(`${nome}: realização parcial ou não realizada em ${r.parcial + r.nao_realizada} de ${inf} registros.`);
  }
  L.push('**Aspectos favoráveis identificados nos registros:**');
  L.push(...(pot.length ? pot.map((x) => `- ${x}`) : ['- Nenhum padrão identificável automaticamente com os dados disponíveis.']));
  L.push('', '**Dificuldades identificadas nos registros:**');
  L.push(...(dif.length ? dif.map((x) => `- ${x}`) : ['- Nenhum padrão identificável automaticamente com os dados disponíveis.']));
  L.push('', '_Itens calculados por regras a partir das pontuações e da realização das atividades. A leitura qualitativa cabe ao profissional responsável._');

  // --- Apoios -------------------------------------------------------------------
  secao('Necessidades de apoio identificadas nos registros');
  const apoios: Record<string, number> = {};
  for (const e of d.evolucoes) if (e.nivel_apoio) apoios[e.nivel_apoio] = (apoios[e.nivel_apoio] ?? 0) + 1;
  const nApoio = Object.values(apoios).reduce((s, n) => s + n, 0);
  if (nApoio) {
    L.push(`Nível de apoio informado em ${nApoio} de ${total} registro(s): ` +
      ORDEM_APOIO.filter((k) => apoios[k]).map((k) => `${APOIO[k]} em ${apoios[k]}`).join('; ') + '.');
  } else L.push('O nível de apoio não foi informado nos registros do período.');
  const estr = d.evolucoes.filter((e) => e.apoios_estrategias);
  if (estr.length) {
    L.push('', 'Apoios e estratégias utilizados:');
    for (const e of estr) L.push(`- ${fmt(e.data)}: “${e.apoios_estrategias}”`);
  }

  // --- Síntese ----------------------------------------------------------------------
  secao('Síntese evolutiva');
  const maisFreq = [...porAtiv].sort((a, b) => b[1].total - a[1].total).slice(0, 3).map(([n]) => n);
  const comTend = est.indicadores.flatMap((i) => i.versoes_de_escala.filter((v) => v.dados_suficientes_para_tendencia).map((v) => ({ i: i.indicador, v })));
  const frases = [
    `No período, foram registrados ${plural(total, 'atendimento', 'atendimentos')}${maisFreq.length ? `, com maior frequência de ${maisFreq.join(', ')}` : ''}.`,
  ];
  if (comTend.length) {
    const desc = comTend.map(({ i, v }) => {
      const s = variacao(v);
      return s === 'semelhantes' ? `${i} com valores semelhantes ao longo do período` : `${i} com valores ${s} na segunda metade (${leituraDirecao(v.direcao, s!)})`;
    });
    frases.push(`Entre os indicadores com dados suficientes: ${desc.join('; ')}.`);
  }
  const insuf = est.indicadores.filter((i) => !i.versoes_de_escala.some((v) => v.dados_suficientes_para_tendencia)).map((i) => i.indicador);
  if (insuf.length) frases.push(`Os indicadores ${insuf.join(', ')} têm registros insuficientes para descrever tendências.`);
  if (ocorr.length) frases.push(`Houve ${plural(ocorr.length, 'ocorrência registrada', 'ocorrências registradas')} no período.`);
  frases.push('As variações descritas são observacionais e não estabelecem relação de causa com as atividades realizadas.');
  L.push(frases.join(' '));

  // --- Pontos para acompanhamento ------------------------------------------------------
  secao('Pontos para acompanhamento');
  const pontos: string[] = [];
  for (const i of est.indicadores) {
    if (i.registros_sem_avaliacao / total > 0.5) pontos.push(`Ampliar o registro de “${i.indicador}”: não avaliado em ${i.registros_sem_avaliacao} de ${total} atendimentos.`);
    for (const v of i.versoes_de_escala) {
      if (v.direcao === 'menor_melhor' && (v.maximo_observado ?? 0) >= 4) pontos.push(`Acompanhar “${i.indicador}”: houve registro(s) com intensidade elevada (valor máximo ${v.maximo_observado}).`);
      const s = variacao(v);
      if (s && s !== 'semelhantes' && leituraDirecao(v.direcao, s).includes('desfavorável')) pontos.push(`Observar “${i.indicador}”: valores ${s} na segunda metade do período.`);
      if (s && v.direcao === 'menor_melhor' && s === 'maiores') pontos.push(`Observar “${i.indicador}”: intensidade maior na segunda metade do período.`);
    }
  }
  if (ocorr.length) pontos.push(`Revisar as ${plural(ocorr.length, 'ocorrência registrada', 'ocorrências registradas')} com a equipe.`);
  if (total < MIN_OBS_TENDENCIA) pontos.push(`Número reduzido de registros no período (${total}); ampliar a documentação para permitir análises de evolução.`);
  const semTexto = d.evolucoes.filter((e) => !e.comportamentos && !e.apoios_estrategias).length;
  if (semTexto / total > 0.7) pontos.push('Preencher com mais frequência os campos de comportamentos e de apoios/estratégias, que enriquecem a análise.');
  L.push(...(pontos.length ? pontos.map((x) => `- ${x}`) : ['- Nenhum ponto identificado automaticamente. Complemente com a avaliação do profissional.']));

  // --- Anexo cronológico ----------------------------------------------------------------
  secao('Anexo — registros do período (ordem cronológica)');
  for (const e of d.evolucoes) {
    const ats = d.atividades.filter((a) => a.evolucao_id === e.id).map((a) => `${a.nome}${a.realizacao ? ` (${REALIZACAO[a.realizacao]})` : ''}`);
    const avs = d.avaliacoes.filter((a) => a.evolucao_id === e.id && a.valor !== null).map((a) => `${a.nome}: ${a.valor}`);
    const col = d.coletivas.find((c) => c.id === e.atividade_coletiva_id);
    L.push('', `### ${fmt(e.data)} — ${e.turno === 'manha' ? 'manhã' : 'tarde'} — ${e.tipo === 'individual' ? 'atendimento individual' : `grupo: ${col?.nome_atividade ?? ''}`}`);
    L.push(`- Profissional: ${o.profissionais.get(e.profissional_id) ?? '—'}`);
    if (ats.length) L.push(`- Atividades: ${ats.join('; ')}`);
    if (e.participacao) L.push(`- Participação: ${PARTICIPACAO[e.participacao]}`);
    if (e.nivel_apoio) L.push(`- Nível de apoio: ${APOIO[e.nivel_apoio]}`);
    if (avs.length) L.push(`- Indicadores: ${avs.join('; ')}`);
    if (e.texto_evolucao) L.push(`- Evolução: “${e.texto_evolucao}”`);
    if (e.observacoes_complementares) L.push(`- Observações complementares: “${e.observacoes_complementares}”`);
  }
  return L.join('\n').trim();
}

/** Relatório de grupo compilado: somente síntese geral, sem dados individuais. */
export function compilarRelatorioGrupo(c: any, agregado: { participacao: string | null; n: number }[], objetivo: string | null) {
  const total = agregado.reduce((s, a) => s + a.n, 0);
  const L = ['## Objetivo do relatório', objetivo || 'Registrar a síntese geral da atividade em grupo.', ''];
  L.push('## Descrição da atividade proposta');
  L.push(c.objetivo ? `Objetivo: ${c.objetivo}` : 'Objetivo não informado.');
  L.push(c.descricao_proposta ? `Proposta: ${c.descricao_proposta}` : 'Descrição da proposta não informada.', '');
  L.push('## Participação geral do grupo');
  L.push(total ? `${plural(total, 'registro individual', 'registros individuais')}: ` +
    agregado.map((a) => `${a.participacao ? PARTICIPACAO[a.participacao] : 'participação não informada'}: ${a.n}`).join('; ') + '.' : 'Sem registros individuais finalizados visíveis.');
  L.push('', '## Observações gerais', c.observacoes_gerais || 'Nenhuma observação geral registrada.', '');
  L.push('## Pontos para acompanhamento', '- Complementar com a avaliação do profissional responsável. Os registros individuais estão nos anexos de acesso controlado.');
  return L.join('\n');
}
