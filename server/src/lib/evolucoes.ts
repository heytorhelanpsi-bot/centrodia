import { z } from 'zod';
import type { Request } from 'express';
import type { Db } from '../db/pool.js';
import { HttpError, hojeISO } from './util.js';
import { dataISO, textoOpc, turno } from './validacao.js';
import { tem } from './auth.js';

export const NIVEIS_APOIO = ['sem_apoio', 'apoio_pontual', 'apoio_frequente', 'apoio_intenso', 'apoio_integral'] as const;

export const conteudoEvolucaoSchema = z.object({
  participacao: z.enum(['integral', 'parcial', 'nao_realizada']).nullish().transform((v) => v ?? null),
  nivel_apoio: z.enum(NIVEIS_APOIO).nullish().transform((v) => v ?? null),
  atividades: z.array(z.object({
    atividade_id: z.string().uuid(),
    realizacao: z.enum(['integral', 'parcial', 'nao_realizada']).nullish().transform((v) => v ?? null),
  })).max(30).default([]),
  avaliacoes: z.array(z.object({
    indicador_id: z.string().uuid(),
    valor: z.number().int().nullable(),          // null = Não avaliado
    observacao: textoOpc,
  })).max(50).default([]),
  texto_evolucao: textoOpc,
  comportamentos: textoOpc,
  interacao: textoOpc,
  resposta_orientacoes: textoOpc,
  apoios_estrategias: textoOpc,
  ocorrencias: textoOpc,
  observacoes_complementares: textoOpc,
});

export const evolucaoSchema = conteudoEvolucaoSchema.extend({
  assistido_id: z.string().uuid(),
  data: dataISO,
  horario: z.string().trim().max(40).nullish().transform((v) => v || null),
  turno,
  tipo: z.enum(['individual', 'participacao_coletiva']).default('individual'),
  duracao_minutos: z.number().int().min(1).max(720).nullish().transform((v) => v ?? null),
  local: z.string().trim().max(200).nullish().transform((v) => v || null),
});

export type EvolucaoPayload = z.infer<typeof evolucaoSchema>;

/** Regras de conclusão de um registro (aplicadas ao finalizar). */
export async function validarFinalizacao(db: Db, p: z.infer<typeof conteudoEvolucaoSchema> & { tipo?: string }) {
  const erros: { campo: string; mensagem: string }[] = [];
  const ausente = p.participacao === 'nao_realizada';
  // Registro simplificado: basta uma atividade, uma marcação de comportamento ou uma observação.
  const temConteudo = p.atividades.length > 0 || p.avaliacoes.some((a) => a.valor !== null)
    || (p.texto_evolucao?.trim().length ?? 0) >= 3 || p.tipo === 'participacao_coletiva';
  if (!ausente && !temConteudo) {
    erros.push({ campo: 'registro', mensagem: 'Marque ao menos uma atividade ou um comportamento, ou escreva uma observação.' });
  }
  if (p.avaliacoes.length) {
    const ids = p.avaliacoes.map((a) => a.indicador_id);
    const ind = await db.query('SELECT id, nome, observacao_obrigatoria FROM indicadores WHERE id = ANY($1)', [ids]);
    for (const a of p.avaliacoes) {
      const i = ind.rows.find((x) => x.id === a.indicador_id);
      if (i?.observacao_obrigatoria && a.valor !== null && !a.observacao) {
        erros.push({ campo: `avaliacoes.${a.indicador_id}`, mensagem: `O indicador "${i.nome}" exige observação.` });
      }
    }
  }
  if (erros.length) throw new HttpError(400, 'Complete os campos obrigatórios para finalizar o registro.', erros);
}

export function validarData(req: Request, data: string) {
  if (data > hojeISO()) throw new HttpError(400, 'A data do atendimento não pode estar no futuro.');
  if (data !== hojeISO() && !tem(req, 'evolucoes.editar_data')) {
    throw new HttpError(403, 'Você não tem permissão para registrar atendimentos em outra data.');
  }
}

/** Grava atividades e avaliações de uma evolução, resolvendo a versão de escala vigente. */
export async function gravarFilhos(db: Db, evolucaoId: string, p: z.infer<typeof conteudoEvolucaoSchema>, preservarVersoes = false) {
  const anteriores = preservarVersoes
    ? new Map((await db.query('SELECT indicador_id, escala_versao_id FROM avaliacoes_indicadores WHERE evolucao_id = $1', [evolucaoId]))
      .rows.map((r) => [r.indicador_id, r.escala_versao_id]))
    : new Map<string, string>();
  await db.query('DELETE FROM evolucao_atividades WHERE evolucao_id = $1', [evolucaoId]);
  await db.query('DELETE FROM avaliacoes_indicadores WHERE evolucao_id = $1', [evolucaoId]);
  const atividadesUnicas = new Map(p.atividades.map((a) => [a.atividade_id, a]));
  for (const a of atividadesUnicas.values()) {
    await db.query('INSERT INTO evolucao_atividades (evolucao_id, atividade_id, realizacao) VALUES ($1,$2,$3)',
      [evolucaoId, a.atividade_id, a.realizacao]);
  }
  for (const a of p.avaliacoes) {
    if (a.valor === null && !a.observacao) continue; // não avaliado e sem observação: nada a registrar
    let versaoId = anteriores.get(a.indicador_id);
    if (!versaoId) {
      const v = await db.query('SELECT escala_versao_id FROM indicadores_vigentes WHERE id = $1', [a.indicador_id]);
      if (!v.rowCount) throw new HttpError(400, 'Indicador inexistente.');
      versaoId = v.rows[0].escala_versao_id as string;
    }
    await db.query(
      `INSERT INTO avaliacoes_indicadores (evolucao_id, indicador_id, escala_versao_id, valor, observacao) VALUES ($1,$2,$3,$4,$5)`,
      [evolucaoId, a.indicador_id, versaoId, a.valor, a.observacao]);
  }
}

const CAMPOS_TEXTO = ['texto_evolucao', 'comportamentos', 'interacao', 'resposta_orientacoes', 'apoios_estrategias',
  'ocorrencias', 'observacoes_complementares'] as const;

export async function inserirEvolucao(db: Db, req: Request, p: EvolucaoPayload & { atividade_coletiva_id?: string | null }, finalizar: boolean) {
  // Inserido como rascunho; atividades e avaliações são gravadas antes da finalização,
  // pois o banco bloqueia alterações em registros já finalizados.
  const r = await db.query(
    `INSERT INTO evolucoes (assistido_id, profissional_id, atividade_coletiva_id, data, horario, turno, tipo, duracao_minutos, local,
        participacao, nivel_apoio, ${CAMPOS_TEXTO.join(', ')})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [p.assistido_id, req.usuario!.id, p.atividade_coletiva_id ?? null, p.data, p.horario, p.turno, p.tipo, p.duracao_minutos, p.local,
      p.participacao, p.nivel_apoio, ...CAMPOS_TEXTO.map((c) => p[c])]);
  const id = r.rows[0].id as string;
  await gravarFilhos(db, id, p);
  if (finalizar) await finalizar_(db, id);
  return id;
}

async function finalizar_(db: Db, id: string) {
  await db.query(`UPDATE evolucoes SET status = 'finalizada', finalizada_em = now() WHERE id = $1 AND status = 'rascunho'`, [id]);
}

export async function atualizarEvolucao(db: Db, id: string, p: EvolucaoPayload, finalizar: boolean, emCorrecao = false) {
  const r = await db.query(
    `UPDATE evolucoes SET data=$2, horario=$3, turno=$4, duracao_minutos=$5, local=$6, participacao=$7, nivel_apoio=$8,
        texto_evolucao=$9, comportamentos=$10, interacao=$11, resposta_orientacoes=$12, apoios_estrategias=$13,
        ocorrencias=$14, observacoes_complementares=$15
      WHERE id = $1`,
    [id, p.data, p.horario, p.turno, p.duracao_minutos, p.local, p.participacao, p.nivel_apoio,
      ...CAMPOS_TEXTO.map((c) => p[c])]);
  if (!r.rowCount) throw new HttpError(403, 'Sem permissão para alterar este registro.');
  await gravarFilhos(db, id, p, emCorrecao);
  if (finalizar && !emCorrecao) await finalizar_(db, id);
}

/** Retrato completo de uma evolução (usado no histórico de correções). */
export async function retrato(db: Db, id: string) {
  const e = await db.query('SELECT * FROM evolucoes WHERE id = $1', [id]);
  if (!e.rowCount) return null;
  const at = await db.query(
    `SELECT ea.atividade_id, a.nome, ea.realizacao FROM evolucao_atividades ea JOIN atividades a ON a.id = ea.atividade_id
      WHERE ea.evolucao_id = $1 ORDER BY a.nome`, [id]);
  const av = await db.query(
    `SELECT av.indicador_id, i.nome, av.valor, av.observacao, v.versao AS escala_versao
       FROM avaliacoes_indicadores av JOIN indicadores i ON i.id = av.indicador_id JOIN indicador_escala_versoes v ON v.id = av.escala_versao_id
      WHERE av.evolucao_id = $1 ORDER BY i.ordem`, [id]);
  return { ...e.rows[0], atividades: at.rows, avaliacoes: av.rows };
}

/** Evolução completa para exibição, com a descrição de cada nível da escala usada. */
export async function detalharEvolucao(db: Db, id: string) {
  const e = await db.query(
    `SELECT e.*, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, u.nome AS profissional_nome,
            ac.nome_atividade AS coletiva_nome
       FROM evolucoes e JOIN assistidos a ON a.id = e.assistido_id JOIN usuarios u ON u.id = e.profissional_id
       LEFT JOIN atividades_coletivas ac ON ac.id = e.atividade_coletiva_id
      WHERE e.id = $1`, [id]);
  if (!e.rowCount) throw new HttpError(404, 'Registro não encontrado ou sem permissão de acesso.');
  const atividades = await db.query(
    `SELECT ea.atividade_id, a.nome, a.categoria, ea.realizacao FROM evolucao_atividades ea JOIN atividades a ON a.id = ea.atividade_id
      WHERE ea.evolucao_id = $1 ORDER BY a.nome`, [id]);
  const avaliacoes = await db.query(
    `SELECT av.indicador_id, i.nome, i.tipo, av.valor, av.observacao, v.id AS escala_versao_id, v.versao AS escala_versao,
            v.minimo, v.maximo, v.direcao, v.niveis
       FROM avaliacoes_indicadores av JOIN indicadores i ON i.id = av.indicador_id
       JOIN indicador_escala_versoes v ON v.id = av.escala_versao_id
      WHERE av.evolucao_id = $1 ORDER BY i.ordem, i.nome`, [id]);
  const correcoes = await db.query(
    `SELECT c.id, c.alterado_em, c.motivo, c.dados_anteriores, c.dados_novos, u.nome AS alterado_por_nome
       FROM evolucao_correcoes c JOIN usuarios u ON u.id = c.alterado_por WHERE c.evolucao_id = $1 ORDER BY c.alterado_em`, [id]);
  const analises = await db.query(
    `SELECT id, gerado_em, status, modelo FROM analises_ia WHERE evolucao_id = $1 ORDER BY gerado_em DESC`, [id]);
  return { ...e.rows[0], atividades: atividades.rows, avaliacoes: avaliacoes.rows, correcoes: correcoes.rows, analises: analises.rows };
}
