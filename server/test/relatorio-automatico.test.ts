import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atividades, criarUsuario, entrar, hoje, indicadores, novoAssistido, owner } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { chamarGemini, definirClienteGemini } from '../src/ai/provedor-gemini.js';

type Cliente = Awaited<ReturnType<typeof entrar>>;
let prof: Cliente;
let assistidoId: string;

beforeAll(async () => {
  prof = await entrar((await criarUsuario('profissional')).email);
  assistidoId = (await prof.post('/api/assistidos', novoAssistido({ nome_completo: 'Josefa Compilada Teixeira' }))).body.id;
  const at = await atividades(prof);
  const ind = await indicadores(prof);
  const valores = [2, 2, 4, 5];
  for (const [i, v] of valores.entries()) {
    const r = await prof.post('/api/evolucoes', {
      assistido_id: assistidoId, data: hoje(), turno: i % 2 ? 'tarde' : 'manha', finalizar: true, nivel_apoio: 'apoio_frequente',
      atividades: [{ atividade_id: at['Musicoterapia'], realizacao: 'integral' }],
      avaliacoes: [{ indicador_id: ind.atencao.id, valor: v }, { indicador_id: ind.agressividade.id, valor: i === 3 ? 4 : 0 }],
      texto_evolucao: `Registro número ${i + 1}: acompanhou o ritmo com apoio verbal.`,
      apoios_estrategias: i === 0 ? 'Antecipação visual da rotina' : null,
      ocorrencias: i === 3 ? 'Empurrou um colega durante a troca de sala' : null,
    });
    expect(r.status).toBe(201);
  }
});

afterAll(async () => { await owner.end(); await pool.end(); });

describe('relatório compilado automaticamente (sem IA)', () => {
  it('reúne todos os registros, com estatísticas, citações literais e anexo cronológico', async () => {
    const r = await prof.post('/api/relatorios', { tipo: 'mensal', assistido_id: assistidoId, periodo_inicio: '2020-01-01', periodo_fim: hoje(), modo: 'automatico' });
    expect(r.status).toBe(201);
    const rel = (await prof.get(`/api/relatorios/${r.body.id}`)).body;
    const v = rel.versoes[0];
    expect(v.origem).toBe('sistema');
    expect(v.modelo).toBeNull();
    const t: string = v.conteudo;
    for (const s of ['## Atividades realizadas', '## Participação e engajamento', '## Evolução dos indicadores', '## Comportamentos observados',
      '## Potencialidades e dificuldades', '## Necessidades de apoio identificadas nos registros', '## Síntese evolutiva', '## Pontos para acompanhamento']) {
      expect(t).toContain(s);
    }
    expect(t).toContain('Foram registrados 4 atendimentos');
    expect(t).toContain('**Musicoterapia** — 4 (integral: 4)');
    expect(t).toMatch(/Valores maiores na segunda metade do período \(direção favorável/);
    expect(t).toContain('“Antecipação visual da rotina”');
    expect(t).toContain('Ocorrências registradas (1)');
    expect(t).toContain('apoio frequente em 4');
    expect(t).toMatch(/Acompanhar “Comportamentos agressivos observados”/);
    expect(t).toContain('Registro número 4');
    expect(t).toContain('sem uso de IA');
    expect(rel.registros).toHaveLength(4);
  });

  it('com poucos registros não descreve tendência', async () => {
    const a = (await prof.post('/api/assistidos', novoAssistido())).body.id;
    const at = await atividades(prof);
    const ind = await indicadores(prof);
    await prof.post('/api/evolucoes', { assistido_id: a, data: hoje(), turno: 'manha', finalizar: true, atividades: [{ atividade_id: at['Dança'] }],
      texto_evolucao: 'Dançou acompanhando a música por dez minutos.', avaliacoes: [{ indicador_id: ind.foco.id, valor: 3 }] });
    const r = await prof.post('/api/relatorios', { tipo: 'individual_evolucao', assistido_id: a, periodo_inicio: '2020-01-01', periodo_fim: hoje(), modo: 'automatico' });
    const t: string = (await prof.get(`/api/relatorios/${r.body.id}`)).body.versoes[0].conteudo;
    expect(t).toContain('Dados insuficientes para descrever tendência.');
    expect(t).toContain('Número reduzido de registros');
  });

  it('recompila incluindo registros salvos depois da criação', async () => {
    const a = (await prof.post('/api/assistidos', novoAssistido())).body.id;
    const at = await atividades(prof);
    const base = { assistido_id: a, data: hoje(), turno: 'manha', finalizar: true, atividades: [{ atividade_id: at['Capoeira'] }] };
    await prof.post('/api/evolucoes', { ...base, texto_evolucao: 'Primeiro registro de capoeira com apoio.' });
    const r = await prof.post('/api/relatorios', { tipo: 'mensal', assistido_id: a, periodo_inicio: '2020-01-01', periodo_fim: hoje(), modo: 'automatico' });
    await prof.post('/api/evolucoes', { ...base, texto_evolucao: 'Segundo registro de capoeira, mais autônomo.' });
    const v = await prof.post(`/api/relatorios/${r.body.id}/regenerar`, { modo: 'automatico' });
    expect(v.status).toBe(201);
    const rel = (await prof.get(`/api/relatorios/${r.body.id}`)).body;
    expect(rel.versoes[0].conteudo).toContain('Segundo registro de capoeira');
    expect(rel.registros).toHaveLength(2);
  });

  it('não exige permissão de IA', async () => {
    await owner.query(`DELETE FROM permissoes_perfil WHERE perfil = 'profissional' AND permissao = 'ia.gerar'`);
    const c = await entrar((await criarUsuario('profissional', { todos: true })).email);
    const r = await c.post('/api/relatorios', { tipo: 'mensal', assistido_id: assistidoId, periodo_inicio: '2020-01-01', periodo_fim: hoje(), modo: 'automatico' });
    expect(r.status).toBe(201);
    expect((await c.post('/api/relatorios', { tipo: 'mensal', assistido_id: assistidoId, periodo_inicio: '2020-01-01', periodo_fim: hoje(), modo: 'ia' })).status).toBe(403);
    await owner.query(`INSERT INTO permissoes_perfil VALUES ('profissional', 'ia.gerar')`);
  });
});

describe('provedor Gemini', () => {
  it('envia instrução de sistema e esquema JSON e lê a resposta', async () => {
    let pedido: any;
    definirClienteGemini({ models: { generateContent: (async (p: any) => {
      pedido = p;
      return { text: '{"ok":true}', modelVersion: 'gemini-teste', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 } };
    }) as any } });
    const r = await chamarGemini({ system: 'regras', prompt: 'dados', esquemaJSON: { type: 'object' } });
    expect(r).toEqual({ texto: '{"ok":true}', modelo: 'gemini-teste', tokensEntrada: 10, tokensSaida: 7 });
    expect(pedido.config.systemInstruction).toBe('regras');
    expect(pedido.config.responseMimeType).toBe('application/json');
    expect(pedido.config.responseJsonSchema).toEqual({ type: 'object' });
  });

  it('trata bloqueio e resposta truncada com mensagens claras', async () => {
    definirClienteGemini({ models: { generateContent: (async () => ({ text: '', promptFeedback: { blockReason: 'SAFETY' } })) as any } });
    await expect(chamarGemini({ system: 's', prompt: 'p' })).rejects.toThrow(/bloqueou/);
    definirClienteGemini({ models: { generateContent: (async () => ({ text: 'abc', candidates: [{ finishReason: 'MAX_TOKENS' }] })) as any } });
    await expect(chamarGemini({ system: 's', prompt: 'p' })).rejects.toThrow(/incompleta/);
    definirClienteGemini(null);
  });
});
