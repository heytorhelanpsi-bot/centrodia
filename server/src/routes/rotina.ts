import { Router } from 'express';
import { z } from 'zod';
import { exigir, tx } from '../lib/auth.js';
import { diaSemana, hojeISO, idadeDe } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import type { Db } from '../db/pool.js';

/**
 * Rotina do centro: turno (manhã/tarde) → dia de funcionamento → assistidos previstos.
 * É a porta de entrada do registro diário na tela inicial.
 */
export const rotinaRouter = Router();

const DIAS_PADRAO = [1, 3, 5];

async function diasFuncionamento(db: Db): Promise<number[]> {
  const r = await db.query(`SELECT valor FROM configuracoes WHERE chave = 'rotina'`);
  const dias = r.rows[0]?.valor?.dias;
  return Array.isArray(dias) && dias.length ? dias : DIAS_PADRAO;
}

/** Data mais recente (até a data de referência) que cai no dia da semana pedido. */
export function ultimaOcorrencia(dia: number, referencia: string = hojeISO()): string {
  const [a, m, d] = referencia.split('-').map(Number);
  const data = new Date(a, m - 1, d);
  data.setDate(data.getDate() - ((data.getDay() - dia + 7) % 7));
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

/** Resumo para os cartões: dias de funcionamento e, por turno e dia, previstos e registrados na última ocorrência. */
rotinaRouter.get('/resumo', exigir('assistidos.ver'), async (req, res) => {
  const hoje = hojeISO();
  const r = await tx(req, async (db) => {
    const dias = await diasFuncionamento(db);
    const turnos: Record<string, Record<number, { data: string; previstos: number; registrados: number }>> = { manha: {}, tarde: {} };
    for (const turno of ['manha', 'tarde'] as const) {
      for (const dia of dias) {
        const data = ultimaOcorrencia(dia, hoje);
        const c = await db.query(
          `SELECT count(*)::int AS previstos,
                  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM evolucoes e WHERE e.assistido_id = a.id AND e.data = $1
                                                  AND e.turno::text = $3 AND e.status = 'finalizada'))::int AS registrados
             FROM assistidos a JOIN assistido_agenda g ON g.assistido_id = a.id AND g.dia_semana = $2
            WHERE a.status = 'ativo' AND a.turno_habitual::text IN ($3, 'ambos')`, [data, dia, turno]);
        turnos[turno][dia] = { data, ...c.rows[0] };
      }
    }
    return { hoje, dia_hoje: diaSemana(hoje), dias, turnos };
  });
  res.json(r);
});

/** Assistidos previstos para o turno e o dia, com a situação do registro na data. */
rotinaRouter.get('/', exigir('assistidos.ver'), async (req, res) => {
  const q = validar(z.object({
    turno: z.enum(['manha', 'tarde']),
    dia: z.coerce.number().int().min(1).max(6),
    data: dataISO.optional(),
  }), req.query);
  const data = q.data ?? ultimaOcorrencia(q.dia);
  const r = await tx(req, async (db) => {
    const lista = await db.query(
      `SELECT a.id, a.codigo, a.nome_completo, a.data_nascimento, a.idade_informada, a.idade_informada_em, a.turno_habitual,
              coalesce((SELECT array_agg(d.cid_codigo ORDER BY d.criado_em) FROM assistido_diagnosticos d
                         WHERE d.assistido_id = a.id AND d.cid_codigo IS NOT NULL), '{}') AS cids,
              (SELECT e.id FROM evolucoes e WHERE e.assistido_id = a.id AND e.data = $1 AND e.turno::text = $3 AND e.status = 'finalizada'
                ORDER BY e.finalizada_em DESC LIMIT 1) AS evolucao_id,
              (SELECT e.participacao = 'nao_realizada' FROM evolucoes e WHERE e.assistido_id = a.id AND e.data = $1 AND e.turno::text = $3
                  AND e.status = 'finalizada' ORDER BY e.finalizada_em DESC LIMIT 1) AS faltou,
              (SELECT e.id FROM evolucoes e WHERE e.assistido_id = a.id AND e.data = $1 AND e.turno::text = $3 AND e.status = 'rascunho'
                  AND e.profissional_id = $4 ORDER BY e.atualizado_em DESC LIMIT 1) AS rascunho_id
         FROM assistidos a JOIN assistido_agenda g ON g.assistido_id = a.id AND g.dia_semana = $2
        WHERE a.status = 'ativo' AND a.turno_habitual::text IN ($3, 'ambos')
        ORDER BY a.nome_busca`, [data, q.dia, q.turno, req.usuario!.id]);
    return lista.rows;
  });
  res.json({
    turno: q.turno, dia: q.dia, data,
    assistidos: r.map((a) => ({
      id: a.id, codigo: a.codigo, nome_completo: a.nome_completo, idade: idadeDe(a), cids: a.cids,
      situacao: a.evolucao_id ? (a.faltou ? 'falta' : 'registrado') : a.rascunho_id ? 'rascunho' : 'pendente',
      evolucao_id: a.evolucao_id, rascunho_id: a.rascunho_id,
    })),
  });
});
