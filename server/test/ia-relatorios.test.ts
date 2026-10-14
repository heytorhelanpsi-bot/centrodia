import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atividades, criarUsuario, entrar, hoje, indicadores, novoAssistido, owner } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { substituirChamadorIA } from '../src/ai/cliente.js';

type Cliente = Awaited<ReturnType<typeof entrar>>;
let admin: Cliente, prof: Cliente, consulta: Cliente;
let consultaId: string;
let assistidoId: string;
const enviados: { system: string; prompt: string }[] = [];

const ANALISE = {
  resumo: '[ASSISTIDO] participou da musicoterapia.', comportamentos_observados: ['Acompanhou o ritmo'], indicadores_registrados: ['Atenção 4: Bom'],
  potencialidades: ['Ritmo'], dificuldades: [], necessidades_apoio: ['Apoio verbal'], pontos_acompanhamento: ['Observar transições'],
  sugestoes: ['Manter rotina visual'], lacunas_informacao: ['Duração não informada'],
};

beforeAll(async () => {
  const a = await criarUsuario('admin');
  const p = await criarUsuario('profissional');
  const c = await criarUsuario('consulta');
  consultaId = c.id;
  admin = await entrar(a.email); prof = await entrar(p.email); consulta = await entrar(c.email);
  substituirChamadorIA(async (args) => {
    enviados.push({ system: args.system, prompt: args.prompt });
    if (args.esquemaJSON) {
      const longitudinal = 'variacoes_indicadores' in (args.esquemaJSON as any).properties;
      return { texto: JSON.stringify(longitudinal ? { sintese: 'Síntese', frequencia_atividades: [], participacao_engajamento: [],
        variacoes_indicadores: [], comportamentos_recorrentes: [], avancos: [], dificuldades: [], contextos_individual_coletivo: [],
        estrategias_e_respostas: [], associacoes_observadas: [], informacoes_ausentes: [], limitacoes: ['Poucos registros'] } : ANALISE),
      modelo: 'modelo-teste', tokensEntrada: 10, tokensSaida: 10 };
    }
    return { texto: '## Objetivo do relatório\n[ASSISTIDO] — minuta de teste.\n## Síntese evolutiva\nTexto.', modelo: 'modelo-teste', tokensEntrada: 10, tokensSaida: 10 };
  }, true);

  assistidoId = (await prof.post('/api/assistidos', novoAssistido({
    nome_completo: 'Raimunda Sigilosa Quintanilha',
    diagnosticos: [{ descricao: 'Epilepsia', cid_codigo: 'G40.9', situacao: 'documentado_prontuario' }],
  }))).body.id;
  await admin.put(`/api/usuarios/${consultaId}/assistidos`, { assistidos: [assistidoId] });
});

afterAll(async () => {
  substituirChamadorIA(null);
  await owner.end();
  await pool.end();
});

async function evolucaoFinalizada(texto: string) {
  const at = await atividades(prof);
  const ind = await indicadores(prof);
  const r = await prof.post('/api/evolucoes', {
    assistido_id: assistidoId, data: hoje(), turno: 'manha', finalizar: true,
    atividades: [{ atividade_id: at['Musicoterapia'] }], texto_evolucao: texto,
    avaliacoes: [{ indicador_id: ind.atencao.id, valor: 4 }],
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe('análise com IA', () => {
  it('exige registro finalizado e não envia nome, CPF ou diagnóstico sem autorização', async () => {
    const rasc = await prof.post('/api/evolucoes', { assistido_id: assistidoId, data: hoje(), turno: 'manha' });
    expect((await prof.post('/api/ia/analises/evolucao', { evolucao_id: rasc.body.id })).status).toBe(409);
    await prof.del(`/api/evolucoes/${rasc.body.id}`);

    const id = await evolucaoFinalizada('Raimunda tocou o tambor; Raimunda Quintanilha sorriu. CPF 123.456.789-09 citado por engano.');
    const r = await prof.post('/api/ia/analises/evolucao', { evolucao_id: id });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('minuta');
    const ultimo = enviados.at(-1)!.prompt;
    expect(ultimo).not.toMatch(/Raimunda|Quintanilha|Sigilosa/);
    expect(ultimo).toContain('[ASSISTIDO] tocou o tambor');
    expect(ultimo).not.toContain('123.456.789-09');
    expect(ultimo).not.toContain('Epilepsia');
    expect(ultimo).not.toContain('2010-05-20');
    expect(enviados.at(-1)!.system).toMatch(/Não invente/);

    // Com autorização explícita, o diagnóstico registrado é incluído com sua situação documental.
    await prof.post('/api/ia/analises/evolucao', { evolucao_id: id, incluir_diagnosticos: true });
    expect(enviados.at(-1)!.prompt).toContain('Epilepsia (CID G40.9) — documentado no prontuário');
  });

  it('exige revisão humana e o perfil de consulta só vê análises revisadas', async () => {
    const id = await evolucaoFinalizada('Participou de toda a atividade de percussão com apoio verbal.');
    const an = (await prof.post('/api/ia/analises/evolucao', { evolucao_id: id })).body;
    expect((await consulta.get(`/api/ia/analises/${an.id}`)).status).toBe(404);
    expect((await prof.put(`/api/ia/analises/${an.id}`, { status: 'revisada', texto_revisado: '' })).status).toBe(400);
    expect((await prof.put(`/api/ia/analises/${an.id}`, { status: 'revisada', texto_revisado: 'Texto revisado pelo profissional.' })).status).toBe(200);
    expect((await prof.put(`/api/ia/analises/${an.id}`, { status: 'descartada' })).status).toBe(409);
    expect((await consulta.get(`/api/ia/analises/${an.id}`)).status).toBe(200);
  });

  it('análise longitudinal envia estatísticas calculadas pelo sistema', async () => {
    const r = await prof.post('/api/ia/analises/longitudinal', { assistido_id: assistidoId, inicio: '2020-01-01', fim: hoje() });
    expect(r.status).toBe(201);
    expect(r.body.conteudo_ia.estatisticas.total_registros).toBeGreaterThan(0);
    expect(enviados.at(-1)!.prompt).toContain('dados_suficientes_para_tendencia');
    expect((await prof.post('/api/ia/analises/longitudinal', { assistido_id: assistidoId, inicio: '2001-01-01', fim: '2001-02-01' })).status).toBe(400);
  });

  it('respeita a desativação institucional da IA', async () => {
    await admin.put('/api/config/ia', { habilitada: false });
    const id = await evolucaoFinalizada('Explorou instrumentos de sopro com interesse.');
    expect((await prof.post('/api/ia/analises/evolucao', { evolucao_id: id })).status).toBe(403);
    await admin.put('/api/config/ia', { habilitada: true });
  });
});

describe('relatórios', () => {
  it('minuta com IA → edição → aprovação com confirmação → PDF; consulta vê só aprovados', async () => {
    const r = await prof.post('/api/relatorios', { tipo: 'mensal', assistido_id: assistidoId, periodo_inicio: '2020-01-01', periodo_fim: hoje(), objetivo: 'Acompanhamento mensal' });
    expect(r.status).toBe(201);
    let rel = (await prof.get(`/api/relatorios/${r.body.id}`)).body;
    expect(rel.versoes[0].origem).toBe('ia');
    expect(rel.versoes[0].conteudo).toContain('Raimunda — minuta de teste'); // reidentificação local
    expect(rel.versoes[0].conteudo).toContain('## Identificação');
    expect(rel.registros.length).toBeGreaterThan(0);
    expect(enviados.at(-1)!.prompt).not.toMatch(/Raimunda/);

    expect((await consulta.get(`/api/relatorios/${r.body.id}`)).status).toBe(404);
    expect((await prof.get(`/api/relatorios/${r.body.id}/pdf`)).status).toBe(409);

    const v2 = await prof.post(`/api/relatorios/${r.body.id}/versoes`, { conteudo: rel.versoes[0].conteudo + '\n\nRevisado pelo profissional.' });
    expect(v2.status).toBe(201);
    expect((await prof.post(`/api/relatorios/${r.body.id}/regenerar`, { instrucoes: 'Mais conciso' })).status).toBe(201);
    rel = (await prof.get(`/api/relatorios/${r.body.id}`)).body;
    expect(rel.versoes.map((v: any) => v.origem)).toEqual(['ia', 'profissional', 'ia']);

    expect((await prof.post(`/api/relatorios/${r.body.id}/aprovar`, { versao_id: v2.body.id })).status).toBe(400);
    expect((await prof.post(`/api/relatorios/${r.body.id}/aprovar`, { versao_id: v2.body.id, confirmo_revisao: true })).status).toBe(200);
    // Após aprovação: sem novas versões.
    expect((await prof.post(`/api/relatorios/${r.body.id}/versoes`, { conteudo: 'Alteração posterior à aprovação do documento' })).status).toBe(409);

    const pdf = await prof.get(`/api/relatorios/${r.body.id}/pdf`).buffer(true).parse((res, cb) => {
      const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const vis = (await consulta.get(`/api/relatorios/${r.body.id}`)).body;
    expect(vis.versoes).toHaveLength(1);
    expect(vis.versoes[0].id).toBe(v2.body.id);
    expect((await consulta.get(`/api/relatorios/${r.body.id}/pdf`)).status).toBe(403);
  });

  it('relatório sem IA cria modelo para preenchimento manual', async () => {
    const r = await prof.post('/api/relatorios', { tipo: 'discussao_multidisciplinar', assistido_id: assistidoId, periodo_inicio: '2020-01-01', periodo_fim: hoje(), usar_ia: false, identificacao: 'codigo' });
    const rel = (await prof.get(`/api/relatorios/${r.body.id}`)).body;
    expect(rel.versoes[0].origem).toBe('profissional');
    expect(rel.versoes[0].conteudo).not.toContain('Raimunda');
    expect(rel.versoes[0].conteudo).toContain('## Síntese evolutiva');
  });
});

describe('LGPD', () => {
  it('exporta dados do titular e anonimiza o cadastro mantendo os registros', async () => {
    const a = (await prof.post('/api/assistidos', novoAssistido({ nome_completo: 'Titular Para Anonimizar', observacoes_restritas: 'nota' }))).body;
    const exp = await admin.get(`/api/lgpd/assistidos/${a.id}/exportar`);
    expect(exp.status).toBe(200);
    expect(exp.body.cadastro.observacoes_restritas).toBe('nota');
    expect((await prof.get(`/api/lgpd/assistidos/${a.id}/exportar`)).status).toBe(403);
    expect((await admin.post(`/api/lgpd/assistidos/${a.id}/anonimizar`, { confirmacao_codigo: 'errado', motivo: 'Solicitação do titular' })).status).toBe(400);
    expect((await admin.post(`/api/lgpd/assistidos/${a.id}/anonimizar`, { confirmacao_codigo: a.codigo, motivo: 'Solicitação do titular' })).status).toBe(200);
    const det = (await admin.get(`/api/assistidos/${a.id}`)).body;
    expect(det.nome_completo).toBe(`Titular anonimizado ${a.codigo}`);
    expect(det.data_nascimento.endsWith('-01-01')).toBe(true);
    expect(det.observacoes_restritas).toBeNull();
    expect(det.status).toBe('arquivado');
  });

  it('remove com segurança somente os dados de exemplo', async () => {
    const real = (await prof.post('/api/assistidos', novoAssistido())).body.id;
    const ex = await owner.query(
      `INSERT INTO assistidos (nome_completo, nome_busca, data_nascimento, turno_habitual, exemplo, criado_por)
       SELECT 'Exemplo Zeta', 'exemplo zeta', '2001-01-01', 'manha', true, id FROM usuarios WHERE perfil = 'admin' LIMIT 1 RETURNING id`);
    await owner.query(
      `INSERT INTO evolucoes (assistido_id, profissional_id, data, turno, status, finalizada_em, exemplo, texto_evolucao)
       SELECT $1, criado_por, current_date, 'manha', 'finalizada', now(), true, 'exemplo' FROM assistidos WHERE id = $1`, [ex.rows[0].id]);
    expect((await prof.post('/api/lgpd/remover-exemplos')).status).toBe(403);
    const r = await admin.post('/api/lgpd/remover-exemplos');
    expect(r.status).toBe(200);
    expect(r.body.assistidos).toBe(1);
    expect(r.body.evolucoes).toBe(1);
    expect((await owner.query('SELECT 1 FROM assistidos WHERE id = $1', [real])).rowCount).toBe(1);
    expect((await owner.query('SELECT 1 FROM assistidos WHERE exemplo')).rowCount).toBe(0);
    // O bloqueio de exclusão continua valendo fora da rotina de remoção.
    const ev = await owner.query(`SELECT id FROM evolucoes WHERE status = 'finalizada' LIMIT 1`);
    await expect(owner.query('DELETE FROM evolucoes WHERE id = $1', [ev.rows[0].id])).rejects.toThrow(/não podem ser apagadas/);
  });
});
