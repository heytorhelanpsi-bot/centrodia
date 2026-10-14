import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { exigir, tx } from '../lib/auth.js';
import { auditar } from '../lib/auditoria.js';
import { HttpError, diaSemana, hojeISO } from '../lib/util.js';
import { dataISO, validar } from '../lib/validacao.js';
import { filtrosHistoricoSchema, montarFiltros } from './evolucoes.js';
import { carregarRegistros, estatisticas, MIN_OBS_TENDENCIA } from '../ai/dados.js';

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export const dashboardRouter = Router();

dashboardRouter.get('/', exigir('assistidos.ver'), async (req, res) => {
  const q = validar(z.object({
    data: dataISO.default(hojeISO()), turno: z.enum(['manha', 'tarde']).optional(), profissional_id: z.string().uuid().optional(),
  }), req.query);
  const dia = diaSemana(q.data);
  const r = await tx(req, async (db) => {
    const filtroEv = `e.data = $1 AND ($2::turno IS NULL OR e.turno = $2) AND ($3::uuid IS NULL OR e.profissional_id = $3)`;
    const p = [q.data, q.turno ?? null, q.profissional_id ?? null];
    const total = await db.query(`SELECT count(*)::int AS n FROM assistidos WHERE status = 'ativo'`);
    const previstos = await db.query(
      `SELECT a.id, a.codigo, a.nome_completo, a.turno_habitual,
              EXISTS (SELECT 1 FROM evolucoes e WHERE e.assistido_id = a.id AND e.data = $1 AND e.status = 'finalizada') AS registrado
         FROM assistidos a JOIN assistido_agenda g ON g.assistido_id = a.id AND g.dia_semana = $2
        WHERE a.status = 'ativo' AND ($3::text IS NULL OR a.turno_habitual::text IN ($3, 'ambos'))
        ORDER BY a.nome_busca`, [q.data, dia, q.turno ?? null]);
    const contagens = await db.query(
      `SELECT count(*) FILTER (WHERE e.status = 'finalizada')::int AS registrados,
              count(*) FILTER (WHERE e.status = 'finalizada' AND e.tipo = 'individual')::int AS individuais,
              count(*) FILTER (WHERE e.status = 'finalizada' AND e.tipo = 'participacao_coletiva')::int AS em_grupo,
              count(*) FILTER (WHERE e.status = 'finalizada' AND e.turno = 'manha')::int AS manha,
              count(*) FILTER (WHERE e.status = 'finalizada' AND e.turno = 'tarde')::int AS tarde
         FROM evolucoes e WHERE ${filtroEv}`, p);
    const grupos = await db.query(
      `SELECT count(*)::int AS n FROM atividades_coletivas c WHERE c.data = $1 AND ($2::turno IS NULL OR c.turno = $2)
         AND ($3::uuid IS NULL OR c.profissional_id = $3) AND c.status = 'finalizada'`, p);
    const recentes = await db.query(
      `SELECT e.id, e.data, e.turno, e.tipo, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, u.nome AS profissional_nome,
              coalesce((SELECT array_agg(t.nome ORDER BY t.nome) FROM evolucao_atividades ea JOIN atividades t ON t.id = ea.atividade_id WHERE ea.evolucao_id = e.id), '{}') AS atividades
         FROM evolucoes e JOIN assistidos a ON a.id = e.assistido_id JOIN usuarios u ON u.id = e.profissional_id
        WHERE e.status = 'finalizada' AND ($2::turno IS NULL OR e.turno = $2) AND ($3::uuid IS NULL OR e.profissional_id = $3) AND e.data <= $1
        ORDER BY e.finalizada_em DESC LIMIT 8`, p);
    const rascunhos = await db.query(
      `SELECT e.id, e.data, e.turno, a.nome_completo AS assistido_nome, a.codigo AS assistido_codigo, e.atividade_coletiva_id, e.atualizado_em
         FROM evolucoes e JOIN assistidos a ON a.id = e.assistido_id
        WHERE e.status = 'rascunho' AND e.profissional_id = $1 ORDER BY e.atualizado_em DESC LIMIT 20`, [req.usuario!.id]);
    const gruposRascunho = await db.query(
      `SELECT id, data, turno, nome_atividade FROM atividades_coletivas WHERE status = 'rascunho' AND profissional_id = $1 ORDER BY data DESC LIMIT 10`,
      [req.usuario!.id]);
    const relatoriosPendentes = await db.query(
      `SELECT count(*)::int AS n FROM relatorios WHERE status = 'minuta' AND criado_por = $1`, [req.usuario!.id]);
    return {
      data: q.data, dia_semana: dia,
      total_assistidos: total.rows[0].n,
      previstos: previstos.rows,
      pendentes_hoje: previstos.rows.filter((x) => !x.registrado).length,
      ...contagens.rows[0],
      atividades_grupo_realizadas: grupos.rows[0].n,
      recentes: recentes.rows,
      rascunhos: rascunhos.rows.filter((x) => !x.atividade_coletiva_id),
      grupos_rascunho: gruposRascunho.rows,
      relatorios_em_minuta: relatoriosPendentes.rows[0].n,
    };
  });
  res.json(r);
});

// ---------------------------------------------------------------------------
// Histórico individual e séries de indicadores
// ---------------------------------------------------------------------------
export const historicoRouter = Router();

historicoRouter.get('/:id/historico', exigir('assistidos.ver'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const q = validar(filtrosHistoricoSchema.omit({ assistido_id: true }), req.query);
  const { where, params } = montarFiltros({ ...q, assistido_id: id, status: 'todos' });
  const r = await tx(req, async (db) => {
    const ev = await db.query(
      `SELECT e.id, e.data, e.horario, e.turno, e.tipo, e.status, e.versao, e.participacao, e.nivel_apoio, e.atividade_coletiva_id,
              e.texto_evolucao, e.comportamentos, e.interacao, e.resposta_orientacoes, e.apoios_estrategias, e.ocorrencias,
              e.observacoes_complementares, e.duracao_minutos, e.local, e.criado_em, e.finalizada_em,
              u.id AS profissional_id, u.nome AS profissional_nome, ac.nome_atividade AS coletiva_nome,
              coalesce((SELECT json_agg(json_build_object('nome', t.nome, 'realizacao', ea.realizacao) ORDER BY t.nome)
                          FROM evolucao_atividades ea JOIN atividades t ON t.id = ea.atividade_id WHERE ea.evolucao_id = e.id), '[]') AS atividades,
              coalesce((SELECT json_agg(json_build_object('nome', i.nome, 'valor', av.valor, 'observacao', av.observacao, 'versao', v.versao,
                          'maximo', v.maximo, 'minimo', v.minimo, 'nivel', (SELECT n->>'descricao' FROM jsonb_array_elements(v.niveis) n WHERE (n->>'valor')::int = av.valor)) ORDER BY i.ordem)
                          FROM avaliacoes_indicadores av JOIN indicadores i ON i.id = av.indicador_id JOIN indicador_escala_versoes v ON v.id = av.escala_versao_id
                         WHERE av.evolucao_id = e.id), '[]') AS avaliacoes,
              (SELECT count(*) FROM evolucao_correcoes c WHERE c.evolucao_id = e.id)::int AS correcoes
         FROM evolucoes e JOIN usuarios u ON u.id = e.profissional_id LEFT JOIN atividades_coletivas ac ON ac.id = e.atividade_coletiva_id
        ${where} ORDER BY e.data DESC, e.criado_em DESC LIMIT 500`, params);
    const analises = await db.query(
      `SELECT x.id, x.tipo, x.status, x.gerado_em, x.periodo_inicio, x.periodo_fim, u.nome AS gerado_por_nome
         FROM analises_ia x JOIN usuarios u ON u.id = x.gerado_por WHERE x.assistido_id = $1 ORDER BY x.gerado_em DESC`, [id]);
    const relatorios = await db.query(
      `SELECT r.id, r.titulo, r.status, r.periodo_inicio, r.periodo_fim, r.criado_em, r.aprovado_em
         FROM relatorios r WHERE r.assistido_id = $1 ORDER BY r.criado_em DESC`, [id]);
    const correcoes = await db.query(
      `SELECT c.id, c.evolucao_id, c.alterado_em, c.motivo, u.nome AS alterado_por_nome, e.data AS evolucao_data
         FROM evolucao_correcoes c JOIN usuarios u ON u.id = c.alterado_por JOIN evolucoes e ON e.id = c.evolucao_id
        WHERE e.assistido_id = $1 ORDER BY c.alterado_em DESC`, [id]);
    await auditar(db, req, 'acesso_historico', 'assistido', id, { registros: ev.rowCount });
    return { evolucoes: ev.rows, analises: analises.rows, relatorios: relatorios.rows, correcoes: correcoes.rows };
  });
  res.json(r);
});

historicoRouter.get('/:id/indicadores', exigir('assistidos.ver'), async (req, res) => {
  const id = validar(z.string().uuid(), req.params.id);
  const q = validar(z.object({ inicio: dataISO.optional(), fim: dataISO.optional() }), req.query);
  const r = await tx(req, async (db) => {
    const a = await db.query('SELECT id FROM assistidos WHERE id = $1', [id]);
    if (!a.rowCount) throw new HttpError(404, 'Assistido não encontrado.');
    const dados = await carregarRegistros(db, id, null, q.inicio, q.fim);
    const niveis = await db.query(
      `SELECT v.indicador_id, i.nome, v.versao, v.niveis, v.direcao FROM indicador_escala_versoes v JOIN indicadores i ON i.id = v.indicador_id`);
    return {
      minimo_para_tendencia: MIN_OBS_TENDENCIA,
      datas_registros: dados.evolucoes.map((e) => ({ id: e.id, data: e.data, tipo: e.tipo })),
      ...estatisticas(dados),
      escalas: niveis.rows,
    };
  });
  res.json(r);
});

// ---------------------------------------------------------------------------
// Exportação de dados estruturados (CSV/XLSX)
// ---------------------------------------------------------------------------
export const exportacaoRouter = Router();

exportacaoRouter.get('/evolucoes', exigir('exportar'), async (req, res) => {
  const q = validar(filtrosHistoricoSchema.extend({ formato: z.enum(['csv', 'xlsx']).default('csv'), limite: z.coerce.number().int().max(20000).default(20000) }), req.query);
  const { where, params } = montarFiltros({ ...q, status: 'finalizada' });
  const dados = await tx(req, async (db) => {
    const ev = await db.query(
      `SELECT e.id, e.data, e.turno, e.tipo, e.participacao, e.nivel_apoio, e.duracao_minutos, a.codigo, a.nome_completo, u.nome AS profissional,
              coalesce((SELECT string_agg(t.nome, '; ' ORDER BY t.nome) FROM evolucao_atividades ea JOIN atividades t ON t.id = ea.atividade_id WHERE ea.evolucao_id = e.id), '') AS atividades,
              e.texto_evolucao
         FROM evolucoes e JOIN assistidos a ON a.id = e.assistido_id JOIN usuarios u ON u.id = e.profissional_id
        ${where} ORDER BY e.data, a.codigo LIMIT ${q.limite}`, params);
    const av = await db.query(
      `SELECT av.evolucao_id, i.nome || ' (v' || v.versao || ', ' || v.minimo || '-' || v.maximo || ')' AS coluna, av.valor
         FROM avaliacoes_indicadores av JOIN indicadores i ON i.id = av.indicador_id JOIN indicador_escala_versoes v ON v.id = av.escala_versao_id
        WHERE av.evolucao_id = ANY($1)`, [ev.rows.map((e) => e.id)]);
    await auditar(db, req, 'exportacao_dados', 'evolucao', null, { formato: q.formato, registros: ev.rowCount, filtros: { ...q, formato: undefined } });
    return { ev: ev.rows, av: av.rows };
  });
  const colunasInd = [...new Set(dados.av.map((a) => a.coluna as string))].sort();
  const linhas = dados.ev.map((e) => {
    const base: Record<string, unknown> = {
      Data: e.data, Turno: e.turno === 'manha' ? 'Manhã' : 'Tarde', 'Código': e.codigo, Assistido: e.nome_completo,
      Tipo: e.tipo === 'individual' ? 'Individual' : 'Grupo', 'Participação': e.participacao ?? '', 'Nível de apoio': e.nivel_apoio ?? '',
      'Duração (min)': e.duracao_minutos ?? '', Profissional: e.profissional, Atividades: e.atividades, 'Evolução': e.texto_evolucao ?? '',
    };
    for (const c of colunasInd) {
      const v = dados.av.find((a) => a.evolucao_id === e.id && a.coluna === c);
      base[c] = v ? (v.valor ?? 'Não avaliado') : 'Não avaliado';
    }
    return base;
  });
  const cab = linhas[0] ? Object.keys(linhas[0]) : ['Data', 'Turno', 'Código', 'Assistido'];
  if (q.formato === 'csv') {
    // Prefixo evita que planilhas interpretem o conteúdo como fórmula (injeção CSV).
    const esc = (v: unknown) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
    const csv = '﻿' + [cab.map(esc).join(';'), ...linhas.map((l) => cab.map((c) => esc(l[c])).join(';'))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="evolucoes.csv"');
    return res.send(csv);
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Evoluções');
  ws.columns = cab.map((c) => ({ header: c, key: c, width: c === 'Evolução' ? 60 : 18 }));
  linhas.forEach((l) => ws.addRow(l));
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="evolucoes.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});
