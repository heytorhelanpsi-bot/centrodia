import type { Db } from '../db/pool.js';
import { calcularIdade } from '../lib/util.js';

/**
 * Salvaguardas antes de enviar dados ao serviço externo de IA:
 * - o nome do assistido é substituído por [ASSISTIDO]; nomes de outros assistidos por [OUTRO ASSISTIDO];
 *   nomes de profissionais por [PROFISSIONAL];
 * - data de nascimento não é enviada (apenas idade em anos);
 * - padrões de CPF, telefone e e-mail são removidos;
 * - diagnósticos só são enviados quando o profissional marcar explicitamente.
 */
export class Pseudonimizador {
  private regras: { re: RegExp; sub: string }[] = [];

  static async criar(db: Db, assistidoNome: string) {
    const p = new Pseudonimizador();
    const outros = (await db.query('SELECT nome_completo FROM assistidos WHERE anonimizado_em IS NULL')).rows.map((r) => r.nome_completo as string);
    const profs = (await db.query('SELECT nome FROM usuarios')).rows.map((r) => r.nome as string);
    p.adicionarNome(assistidoNome, '[ASSISTIDO]', true);
    for (const n of outros) if (n !== assistidoNome) p.adicionarNome(n, '[OUTRO ASSISTIDO]', false);
    for (const n of profs) p.adicionarNome(n, '[PROFISSIONAL]', false);
    return p;
  }

  private adicionarNome(nome: string, sub: string, todosTokens: boolean) {
    const partes = nome.trim().split(/\s+/).filter((t) => t.length >= 3 && !/^(da|de|do|das|dos|e)$/i.test(t));
    const variantes = new Set<string>([nome.trim()]);
    if (partes.length >= 2) variantes.add(`${partes[0]} ${partes[partes.length - 1]}`);
    if (partes[0] && (todosTokens || partes[0].length >= 4)) variantes.add(partes[0]);
    if (todosTokens) for (const t of partes.slice(1)) if (t.length >= 4) variantes.add(t);
    // Variantes mais longas primeiro para não fragmentar o nome completo.
    for (const v of [...variantes].sort((a, b) => b.length - a.length)) {
      this.regras.push({ re: new RegExp(`(?<![\\p{L}])${escapar(v)}(?![\\p{L}])`, 'giu'), sub });
    }
    this.regras.sort((a, b) => b.re.source.length - a.re.source.length);
  }

  limpar(texto: string | null | undefined): string | null {
    if (!texto) return null;
    let t = texto;
    for (const { re, sub } of this.regras) t = t.replace(re, sub);
    t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF REMOVIDO]');
    t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[E-MAIL REMOVIDO]');
    t = t.replace(/(\(?\d{2}\)?\s?)?9?\d{4}-?\d{4}\b/g, '[TELEFONE REMOVIDO]');
    return t;
  }
}

function escapar(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ROTULO_APOIO: Record<string, string> = {
  sem_apoio: 'sem apoio', apoio_pontual: 'apoio pontual', apoio_frequente: 'apoio frequente',
  apoio_intenso: 'apoio intenso', apoio_integral: 'apoio integral',
};
const ROTULO_REALIZACAO: Record<string, string> = { integral: 'integral', parcial: 'parcial', nao_realizada: 'não realizada/não participou' };

export interface RegistroParaIA {
  id: string;
  data: string;
  turno: string;
  tipo: string;
  profissional_id: string;
  texto: string;
}

/** Monta a representação textual (pseudonimizada) das evoluções selecionadas. */
export async function carregarRegistros(db: Db, assistidoId: string, ids: string[] | null, inicio?: string, fim?: string) {
  const r = await db.query(
    `SELECT e.* FROM evolucoes e
      WHERE e.assistido_id = $1 AND e.status = 'finalizada'
        AND ($2::uuid[] IS NULL OR e.id = ANY($2)) AND ($3::date IS NULL OR e.data >= $3) AND ($4::date IS NULL OR e.data <= $4)
      ORDER BY e.data, e.criado_em`, [assistidoId, ids, inicio ?? null, fim ?? null]);
  const evolucoes = r.rows;
  const idsE = evolucoes.map((e) => e.id);
  const at = await db.query(
    `SELECT ea.evolucao_id, a.nome, ea.realizacao FROM evolucao_atividades ea JOIN atividades a ON a.id = ea.atividade_id
      WHERE ea.evolucao_id = ANY($1)`, [idsE]);
  const av = await db.query(
    `SELECT av.evolucao_id, av.indicador_id, i.nome, i.tipo, av.valor, av.observacao, v.versao, v.minimo, v.maximo, v.direcao, v.niveis
       FROM avaliacoes_indicadores av JOIN indicadores i ON i.id = av.indicador_id
       JOIN indicador_escala_versoes v ON v.id = av.escala_versao_id WHERE av.evolucao_id = ANY($1) ORDER BY i.ordem`, [idsE]);
  const col = await db.query(
    `SELECT id, nome_atividade, objetivo, descricao_proposta FROM atividades_coletivas
      WHERE id = ANY($1)`, [evolucoes.map((e) => e.atividade_coletiva_id).filter(Boolean)]);
  return { evolucoes, atividades: at.rows, avaliacoes: av.rows, coletivas: col.rows };
}

export type DadosRegistros = Awaited<ReturnType<typeof carregarRegistros>>;

export function descreverRegistros(d: DadosRegistros, ps: Pseudonimizador): string {
  const DIRECAO: Record<string, string> = { maior_melhor: 'valores maiores = desempenho/participação maior', menor_melhor: 'valores maiores = maior intensidade do comportamento monitorado', neutra: 'sem direção definida' };
  return d.evolucoes.map((e, idx) => {
    const ats = d.atividades.filter((a) => a.evolucao_id === e.id)
      .map((a) => `${a.nome}${a.realizacao ? ` (${ROTULO_REALIZACAO[a.realizacao]})` : ''}`);
    const avs = d.avaliacoes.filter((a) => a.evolucao_id === e.id).map((a) => {
      const nivel = a.valor === null ? null : (a.niveis as { valor: number; descricao: string }[]).find((n) => n.valor === a.valor);
      const valor = a.valor === null ? 'Não avaliado' : `${a.valor} de ${a.minimo}–${a.maximo} ("${nivel?.descricao ?? ''}")`;
      return `  - ${a.nome} [escala v${a.versao}; ${DIRECAO[a.direcao]}]: ${valor}${a.observacao ? ` — obs.: ${ps.limpar(a.observacao)}` : ''}`;
    });
    const col = d.coletivas.find((c) => c.id === e.atividade_coletiva_id);
    const campos: [string, string | null][] = [
      ['Evolução', e.texto_evolucao], ['Comportamentos relevantes', e.comportamentos], ['Interação', e.interacao],
      ['Resposta às orientações/estímulos', e.resposta_orientacoes], ['Apoios/estratégias utilizados', e.apoios_estrategias],
      ['Ocorrências', e.ocorrencias], ['Observações complementares', e.observacoes_complementares],
    ];
    return [
      `### Registro ${idx + 1} — ${e.data} (${e.turno === 'manha' ? 'manhã' : 'tarde'}) — ref. ${String(e.id).slice(0, 8)}`,
      `Contexto: ${e.tipo === 'individual' ? 'atendimento individual' : `participação em atividade coletiva${col ? ` "${col.nome_atividade}"` : ''}`}` +
        `${e.participacao ? `; participação: ${ROTULO_REALIZACAO[e.participacao]}` : ''}` +
        `${e.nivel_apoio ? `; nível de apoio: ${ROTULO_APOIO[e.nivel_apoio]}` : ''}` +
        `${e.duracao_minutos ? `; duração: ${e.duracao_minutos} min` : ''}${e.local ? `; local: ${ps.limpar(e.local)}` : ''}`,
      col?.objetivo ? `Objetivo da atividade coletiva: ${ps.limpar(col.objetivo)}` : '',
      `Atividades: ${ats.length ? ats.join('; ') : 'não informadas'}`,
      `Indicadores:${avs.length ? '\n' + avs.join('\n') : ' nenhum avaliado neste registro'}`,
      ...campos.filter(([, v]) => v).map(([k, v]) => `${k}: ${ps.limpar(v)}`),
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export const MIN_OBS_TENDENCIA = 4;

/** Estatísticas descritivas calculadas pelo sistema (a IA não faz contas). */
export function estatisticas(d: DadosRegistros) {
  const porAtividade = new Map<string, number>();
  for (const a of d.atividades) porAtividade.set(a.nome, (porAtividade.get(a.nome) ?? 0) + 1);
  const porContexto = { individual: 0, participacao_coletiva: 0 };
  for (const e of d.evolucoes) porContexto[e.tipo as keyof typeof porContexto]++;
  const dataDe = new Map(d.evolucoes.map((e) => [e.id, e.data as string]));
  const indicadores = new Map<string, { nome: string; versoes: Map<number, { valores: { data: string; valor: number }[]; minimo: number; maximo: number; direcao: string }>; nao_avaliado: number }>();
  for (const a of d.avaliacoes) {
    const ind = indicadores.get(a.indicador_id) ?? { nome: a.nome, versoes: new Map(), nao_avaliado: 0 };
    if (a.valor === null) ind.nao_avaliado++;
    else {
      const v = ind.versoes.get(a.versao) ?? { valores: [], minimo: a.minimo, maximo: a.maximo, direcao: a.direcao };
      v.valores.push({ data: dataDe.get(a.evolucao_id)!, valor: a.valor });
      ind.versoes.set(a.versao, v);
    }
    indicadores.set(a.indicador_id, ind);
  }
  const total = d.evolucoes.length;
  return {
    total_registros: total,
    por_contexto: porContexto,
    frequencia_atividades: Object.fromEntries([...porAtividade].sort((a, b) => b[1] - a[1])),
    indicadores: [...indicadores.values()].map((i) => ({
      indicador: i.nome,
      registros_sem_avaliacao: total - [...i.versoes.values()].reduce((s, v) => s + v.valores.length, 0),
      versoes_de_escala: [...i.versoes].map(([versao, v]) => {
        v.valores.sort((x, y) => x.data.localeCompare(y.data)); // ordem cronológica
        const vals = v.valores.map((x) => x.valor);
        const suficiente = vals.length >= MIN_OBS_TENDENCIA;
        return {
          versao, escala: `${v.minimo}–${v.maximo}`, direcao: v.direcao, observacoes: vals.length,
          serie: v.valores,
          minimo_observado: vals.length ? Math.min(...vals) : null,
          maximo_observado: vals.length ? Math.max(...vals) : null,
          mediana: suficiente ? mediana(vals) : null,
          dados_suficientes_para_tendencia: suficiente,
        };
      }),
    })),
  };
}

function mediana(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function contextoAssistido(db: Db, assistidoId: string, incluirDiagnosticos: boolean) {
  const a = (await db.query('SELECT id, codigo, nome_completo, data_nascimento FROM assistidos WHERE id = $1', [assistidoId])).rows[0];
  if (!a) return null;
  let diagnosticos: string[] = [];
  if (incluirDiagnosticos) {
    diagnosticos = (await db.query(
      `SELECT descricao, cid_codigo, situacao FROM assistido_diagnosticos WHERE assistido_id = $1`, [assistidoId])).rows
      .map((d) => `${d.descricao}${d.cid_codigo ? ` (CID ${d.cid_codigo})` : ''} — ${d.situacao === 'documentado_prontuario' ? 'documentado no prontuário' : 'informado, pendente de documentação'}`);
  }
  return { a, idade: calcularIdade(a.data_nascimento), diagnosticos };
}
