import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, atividades, criarUsuario, entrar, hoje, indicadores, novoAssistido, owner } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { hashSenha } from '../src/lib/auth.js';

type Cliente = Awaited<ReturnType<typeof entrar>>;
let admin: Cliente, prof: Cliente, prof2: Cliente, consulta: Cliente;
let profId: string, prof2Id: string, consultaId: string;

beforeAll(async () => {
  const a = await criarUsuario('admin');
  const p = await criarUsuario('profissional');
  const p2 = await criarUsuario('profissional');
  const c = await criarUsuario('consulta');
  profId = p.id; prof2Id = p2.id; consultaId = c.id;
  admin = await entrar(a.email); prof = await entrar(p.email); prof2 = await entrar(p2.email); consulta = await entrar(c.email);
});

afterAll(async () => {
  await owner.end();
  await pool.end();
});

describe('autenticação e sessão', () => {
  it('recusa credenciais inválidas e bloqueia após tentativas repetidas', async () => {
    const u = await criarUsuario('profissional');
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'psidia').send({ email: u.email, senha: 'errada' });
      expect(r.status).toBe(401);
    }
    const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'psidia').send({ email: u.email, senha: 'SenhaForte123' });
    expect(r.status).toBe(423);
  });

  it('exige troca de senha provisória antes de usar o sistema', async () => {
    const r0 = await owner.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ('Novo', 'novo@teste.org', $1, 'profissional') RETURNING id`,
      [await hashSenha('Provisoria123')]);
    expect(r0.rowCount).toBe(1);
    const c = await entrar('novo@teste.org', 'Provisoria123');
    expect((await c.get('/api/assistidos')).status).toBe(403);
    expect((await c.post('/api/auth/trocar-senha', { atual: 'Provisoria123', nova: 'curta' })).status).toBe(400);
    expect((await c.post('/api/auth/trocar-senha', { atual: 'Provisoria123', nova: 'NovaSenhaSegura9' })).status).toBe(200);
    expect((await c.get('/api/assistidos')).status).toBe(200);
  });

  it('rejeita escrita sem cabeçalho anti-CSRF e acesso sem sessão', async () => {
    expect((await request(app).get('/api/assistidos')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'x', senha: 'y' })).status).toBe(403);
  });

  it('logout encerra a sessão', async () => {
    const u = await criarUsuario('consulta');
    const c = await entrar(u.email);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('não permite indexação', async () => {
    const r = await request(app).get('/robots.txt');
    expect(r.text).toContain('Disallow: /');
    expect(r.headers['x-robots-tag']).toContain('noindex');
  });
});

describe('cadastro de assistidos', () => {
  it('cria com código automático, idade calculada e impede duplicidade', async () => {
    const dados = novoAssistido({ nome_completo: 'Maria Duplicada Souza', observacoes_restritas: 'Usa aparelho auditivo' });
    const r = await prof.post('/api/assistidos', dados);
    expect(r.status).toBe(201);
    expect(r.body.codigo).toMatch(/^PD-\d{5}$/);
    const det = await prof.get(`/api/assistidos/${r.body.id}`);
    expect(det.body.idade).toBeGreaterThan(10);
    expect(det.body.observacoes_restritas).toBe('Usa aparelho auditivo');
    expect(det.body.dias_atendimento).toEqual([1, 3]);
    // Mesmo nome (com acento/caixa diferentes) + mesma data = duplicidade.
    const dup = await prof.post('/api/assistidos', { ...dados, nome_completo: 'MARIA duplicada  Souza' });
    expect(dup.status).toBe(409);
    // Observações restritas ficam cifradas no banco.
    const raw = await owner.query('SELECT observacoes_restritas_cifradas FROM assistidos WHERE id = $1', [r.body.id]);
    expect(raw.rows[0].observacoes_restritas_cifradas).not.toContain('auditivo');
  });

  it('rejeita CID fora do catálogo e aceita após inserção autorizada', async () => {
    const d = novoAssistido({ diagnosticos: [{ descricao: 'Teste', cid_codigo: 'F99.9', situacao: 'documentado_prontuario' }] });
    expect((await prof.post('/api/assistidos', d)).status).toBe(400);
    expect((await prof.post('/api/cid', { codigo: 'F99.9', descricao: 'Teste' })).status).toBe(403);
    expect((await admin.post('/api/cid', { codigo: 'F99.9', descricao: 'Código de teste' })).status).toBe(201);
    expect((await prof.post('/api/assistidos', d)).status).toBe(201);
  });

  it('arquiva sem apagar e bloqueia novos registros para arquivados', async () => {
    const r = await prof.post('/api/assistidos', novoAssistido());
    expect((await prof.post(`/api/assistidos/${r.body.id}/arquivar`, { arquivar: true })).status).toBe(403); // sem permissão
    expect((await admin.post(`/api/assistidos/${r.body.id}/arquivar`, { arquivar: true })).status).toBe(200);
    const lista = await prof.get('/api/assistidos?status=arquivado');
    expect(lista.body.some((a: any) => a.id === r.body.id)).toBe(true);
    const ev = await prof.post('/api/evolucoes', { assistido_id: r.body.id, data: hoje(), turno: 'manha' });
    expect(ev.status).toBe(409);
  });

  it('pesquisa por nome sem acento e por código', async () => {
    const r = await prof.post('/api/assistidos', novoAssistido({ nome_completo: 'Joaquim Pesquisável Lima' }));
    expect((await prof.get('/api/assistidos?busca=pesquisavel')).body.map((a: any) => a.id)).toContain(r.body.id);
    expect((await prof.get(`/api/assistidos?busca=${r.body.codigo}`)).body).toHaveLength(1);
  });
});

describe('controle de acesso (backend e banco)', () => {
  it('profissional sem atribuição não vê assistido de outro; atribuição libera', async () => {
    const r = await prof.post('/api/assistidos', novoAssistido());
    expect((await prof2.get(`/api/assistidos/${r.body.id}`)).status).toBe(404);
    expect((await prof2.get('/api/assistidos')).body.some((a: any) => a.id === r.body.id)).toBe(false);
    expect((await admin.put(`/api/usuarios/${prof2Id}/assistidos`, { assistidos: [r.body.id] })).status).toBe(200);
    expect((await prof2.get(`/api/assistidos/${r.body.id}`)).status).toBe(200);
  });

  it('perfil de consulta não altera dados clínicos', async () => {
    const r = await prof.post('/api/assistidos', novoAssistido());
    await admin.put(`/api/usuarios/${consultaId}/assistidos`, { assistidos: [r.body.id] });
    expect((await consulta.get(`/api/assistidos/${r.body.id}`)).status).toBe(200);
    expect((await consulta.get(`/api/assistidos/${r.body.id}`)).body.observacoes_restritas).toBeUndefined();
    expect((await consulta.post('/api/assistidos', novoAssistido())).status).toBe(403);
    expect((await consulta.post('/api/evolucoes', { assistido_id: r.body.id, data: hoje(), turno: 'manha' })).status).toBe(403);
    expect((await consulta.get('/api/usuarios')).status).toBe(403);
  });

  it('o banco bloqueia acesso mesmo se a API for contornada (RLS)', async () => {
    const r = await prof.post('/api/assistidos', novoAssistido());
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.usuario_id', $1, true)`, [prof2Id]);
      expect((await c.query('SELECT * FROM assistidos WHERE id = $1', [r.body.id])).rowCount).toBe(0);
      await c.query(`SELECT set_config('app.usuario_id', $1, true)`, [consultaId]);
      await expect(c.query(`INSERT INTO assistidos (nome_completo, nome_busca, data_nascimento, turno_habitual, criado_por)
        VALUES ('X Y Z', 'x y z', '2000-01-01', 'manha', $1)`, [consultaId])).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');
      // Sem contexto de usuário: nada é visível.
      expect((await c.query('SELECT count(*)::int AS n FROM assistidos')).rows[0].n).toBe(0);
      // A aplicação não pode apagar auditoria.
      await expect(c.query('DELETE FROM auditoria')).rejects.toThrow();
    } finally { c.release(); }
  });
});

describe('evolução individual', () => {
  let assistidoId: string;
  beforeAll(async () => {
    assistidoId = (await prof.post('/api/assistidos', novoAssistido())).body.id;
  });

  it('salva rascunho, valida campos obrigatórios e finaliza', async () => {
    const ind = await indicadores(prof);
    const at = await atividades(prof);
    const base = {
      assistido_id: assistidoId, data: hoje(), turno: 'manha',
      atividades: [{ atividade_id: at['Musicoterapia'], realizacao: 'integral' }, { atividade_id: at['Dança'], realizacao: 'parcial' }],
      avaliacoes: [
        { indicador_id: ind.atencao.id, valor: 0, observacao: null },   // zero é uma pontuação válida
        { indicador_id: ind.engajamento.id, valor: null, observacao: null }, // não avaliado
        { indicador_id: ind.foco.id, valor: 4, observacao: 'Ficou 20 min na tarefa' },
      ],
    };
    const rasc = await prof.post('/api/evolucoes', base);
    expect(rasc.status).toBe(201);
    expect(rasc.body.status).toBe('rascunho');
    // Finalizar sem texto de evolução falha com mensagem clara.
    const f1 = await prof.put(`/api/evolucoes/${rasc.body.id}`, { ...base, finalizar: true });
    expect(f1.status).toBe(400);
    expect(f1.body.detalhes[0].campo).toBe('texto_evolucao');
    const f2 = await prof.put(`/api/evolucoes/${rasc.body.id}`, { ...base, texto_evolucao: 'Participou da musicoterapia acompanhando o ritmo com apoio.', finalizar: true });
    expect(f2.status).toBe(200);
    const det = (await prof.get(`/api/evolucoes/${rasc.body.id}`)).body;
    expect(det.status).toBe('finalizada');
    expect(det.atividades).toHaveLength(2);
    const porNome = Object.fromEntries(det.avaliacoes.map((a: any) => [a.nome, a.valor]));
    expect(porNome['Atenção']).toBe(0);
    expect('Engajamento' in porNome).toBe(false); // "Não avaliado" não vira zero
    expect(porNome['Foco na atividade']).toBe(4);
  });

  it('impede alteração silenciosa e registra correções com histórico', async () => {
    const at = await atividades(prof);
    const payload = { assistido_id: assistidoId, data: hoje(), turno: 'tarde', atividades: [{ atividade_id: at['Capoeira'] }],
      texto_evolucao: 'Realizou a ginga com apoio físico leve durante a roda.' };
    const r = await prof.post('/api/evolucoes', { ...payload, finalizar: true });
    expect(r.status).toBe(201);
    expect((await prof.put(`/api/evolucoes/${r.body.id}`, payload)).status).toBe(409);
    // Tentativa direta no banco (contornando a API) também é bloqueada.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.usuario_id', $1, true)`, [profId]);
      await expect(c.query(`UPDATE evolucoes SET texto_evolucao = 'alterado' WHERE id = $1`, [r.body.id])).rejects.toThrow(/correção registrada/);
      await c.query('ROLLBACK');
    } finally { c.release(); }
    expect((await prof.post(`/api/evolucoes/${r.body.id}/correcoes`, { ...payload, motivo: '' })).status).toBe(400);
    const corr = await prof.post(`/api/evolucoes/${r.body.id}/correcoes`, {
      ...payload, texto_evolucao: 'Realizou a ginga com apoio físico leve e verbal durante a roda.', motivo: 'Complemento do apoio utilizado',
    });
    expect(corr.status).toBe(200);
    expect(corr.body.versao).toBe(2);
    const det = (await prof.get(`/api/evolucoes/${r.body.id}`)).body;
    expect(det.correcoes).toHaveLength(1);
    expect(det.correcoes[0].dados_anteriores.texto_evolucao).toContain('apoio físico leve durante');
    expect(det.correcoes[0].dados_novos.texto_evolucao).toContain('leve e verbal');
    // Outro profissional (mesmo com acesso) não corrige registro alheio.
    await admin.put(`/api/usuarios/${prof2Id}/assistidos`, { assistidos: [assistidoId] });
    expect((await prof2.post(`/api/evolucoes/${r.body.id}/correcoes`, { ...payload, motivo: 'tentativa indevida' })).status).toBe(403);
  });

  it('rascunhos são visíveis apenas ao autor', async () => {
    const r = await prof.post('/api/evolucoes', { assistido_id: assistidoId, data: hoje(), turno: 'manha' });
    expect((await prof2.get(`/api/evolucoes/${r.body.id}`)).status).toBe(404);
    expect((await prof.del(`/api/evolucoes/${r.body.id}`)).status).toBe(200);
  });

  it('restringe datas futuras e rejeita pontuação fora da escala', async () => {
    const ind = await indicadores(prof);
    expect((await prof.post('/api/evolucoes', { assistido_id: assistidoId, data: '2999-01-01', turno: 'manha' })).status).toBe(400);
    const r = await prof.post('/api/evolucoes', { assistido_id: assistidoId, data: hoje(), turno: 'manha',
      avaliacoes: [{ indicador_id: ind.atencao.id, valor: 7 }] });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/fora da escala/);
  });

  it('nova versão de escala não altera avaliações antigas', async () => {
    const ind = await indicadores(prof);
    const at = await atividades(prof);
    const ev = await prof.post('/api/evolucoes', { assistido_id: assistidoId, data: hoje(), turno: 'manha', finalizar: true,
      atividades: [{ atividade_id: at['Educação física'] }], texto_evolucao: 'Correu no circuito completando três voltas.',
      avaliacoes: [{ indicador_id: ind.higiene.id, valor: 3 }] });
    const niveis = Array.from({ length: 4 }, (_, i) => ({ valor: i, descricao: `Nível ${i}` }));
    expect((await prof.post(`/api/indicadores/${ind.higiene.id}/versoes`, { minimo: 0, maximo: 3, direcao: 'maior_melhor', niveis })).status).toBe(403);
    const v = await admin.post(`/api/indicadores/${ind.higiene.id}/versoes`, { minimo: 0, maximo: 3, direcao: 'maior_melhor', niveis });
    expect(v.body.versao).toBe(2);
    const det = (await prof.get(`/api/evolucoes/${ev.body.id}`)).body;
    const h = det.avaliacoes.find((a: any) => a.indicador_id === ind.higiene.id);
    expect(h.escala_versao).toBe(1);
    expect(h.maximo).toBe(5);
    // Escala sem descrição de todos os níveis é recusada.
    expect((await admin.post(`/api/indicadores/${ind.higiene.id}/versoes`, { minimo: 0, maximo: 5, direcao: 'maior_melhor', niveis })).status).toBe(400);
  });

  it('atividade personalizada fica disponível nos próximos registros', async () => {
    const r = await prof.post('/api/atividades', { nome: `Horta ${Date.now()}`, categoria: 'Ao ar livre' });
    expect(r.status).toBe(201);
    expect((await prof.get('/api/atividades')).body.some((a: any) => a.id === r.body.id)).toBe(true);
  });
});

describe('atividade em grupo', () => {
  it('gera registros individuais vinculados e nunca aceita evolução copiada', async () => {
    const a1 = (await prof.post('/api/assistidos', novoAssistido())).body.id;
    const a2 = (await prof.post('/api/assistidos', novoAssistido())).body.id;
    const a3 = (await prof.post('/api/assistidos', novoAssistido())).body.id;
    const at = await atividades(prof);
    const ind = await indicadores(prof);
    const reg = (texto: string, valor: number) => ({ participacao: 'integral', texto_evolucao: texto,
      avaliacoes: [{ indicador_id: ind.engajamento.id, valor }] });
    const base = {
      data: hoje(), turno: 'manha', atividade_id: at['Musicoterapia'], nome_atividade: 'Roda de música', local: 'Sala 2',
      objetivo: 'Estimular a participação rítmica', descricao_proposta: 'Instrumentos de percussão em roda',
      participantes: [
        { assistido_id: a1, situacao: 'participante', revisado: true, registro: reg('Tocou o tambor seguindo o pulso por longos períodos.', 4) },
        { assistido_id: a2, situacao: 'participante', revisado: true, registro: reg('Tocou o tambor seguindo o pulso por longos períodos.', 4) },
        { assistido_id: a3, situacao: 'previsto_ausente', motivo_ausencia: 'Consulta médica' },
      ],
      finalizar: true,
    };
    const copia = await prof.post('/api/coletivas', base);
    expect(copia.status).toBe(400);
    expect(copia.body.detalhes.some((d: any) => /idêntica/.test(d.mensagem))).toBe(true);

    // Sem revisão individual confirmada não finaliza.
    const semRevisao = structuredClone(base);
    semRevisao.participantes[1] = { ...semRevisao.participantes[1], revisado: false, registro: reg('Explorou o chocalho e sorriu ao ouvir o som.', 3) };
    expect((await prof.post('/api/coletivas', semRevisao)).status).toBe(400);

    semRevisao.participantes[1].revisado = true;
    const ok = await prof.post('/api/coletivas', semRevisao);
    expect(ok.status).toBe(201);
    const det = (await prof.get(`/api/coletivas/${ok.body.id}`)).body;
    expect(det.status).toBe('finalizada');
    const presentes = det.participantes.filter((p: any) => p.situacao === 'participante');
    expect(presentes).toHaveLength(2);
    for (const p of presentes) {
      expect(p.registro.atividade_coletiva_id).toBe(ok.body.id);
      expect(p.registro.tipo).toBe('participacao_coletiva');
      expect(p.registro.status).toBe('finalizada');
      expect(p.registro.atividades.map((x: any) => x.nome)).toContain('Musicoterapia');
    }
    expect(new Set(presentes.map((p: any) => p.registro.texto_evolucao)).size).toBe(2);
    expect(det.participantes.find((p: any) => p.assistido_id === a3).registro).toBeNull();

    // Quem só tem acesso a um participante não vê os demais.
    await admin.put(`/api/usuarios/${prof2Id}/assistidos`, { assistidos: [a1] });
    const det2 = (await prof2.get(`/api/coletivas/${ok.body.id}`)).body;
    expect(det2.participantes.map((p: any) => p.assistido_id)).toEqual([a1]);
    // Histórico individual mostra a participação em grupo.
    const hist = (await prof.get(`/api/assistidos/${a2}/historico`)).body;
    expect(hist.evolucoes[0].coletiva_nome).toBe('Roda de música');
  });
});

describe('dashboard, indicadores e exportação', () => {
  it('dashboard retorna contagens e alertas', async () => {
    const r = await prof.get(`/api/dashboard?data=${hoje()}`);
    expect(r.status).toBe(200);
    expect(r.body.registrados).toBeGreaterThan(0);
    expect(r.body.individuais + r.body.em_grupo).toBe(r.body.registrados);
    expect(r.body.manha + r.body.tarde).toBe(r.body.registrados);
  });

  it('exporta CSV com "Não avaliado" explícito e registra auditoria', async () => {
    const r = await prof.get('/api/exportar/evolucoes?formato=csv');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Não avaliado');
    const a = await owner.query(`SELECT count(*)::int AS n FROM auditoria WHERE acao = 'exportacao_dados' AND usuario_id = $1`, [profId]);
    expect(a.rows[0].n).toBe(1);
    expect((await consulta.get('/api/exportar/evolucoes')).status).toBe(403);
  });

  it('auditoria é imutável e visível somente ao administrador', async () => {
    expect((await prof.get('/api/auditoria')).status).toBe(403);
    const r = await admin.get('/api/auditoria');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(5);
    await expect(owner.query(`UPDATE auditoria SET acao = 'x' WHERE id = $1`, [r.body[0].id])).rejects.toThrow(/imutável/);
  });
});
