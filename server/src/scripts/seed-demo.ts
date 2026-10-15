// Cria dados de DEMONSTRAÇÃO, todos marcados como exemplo (exemplo = true) e com
// nomes claramente fictícios. Podem ser removidos em Configurações > LGPD.
// Uso: npm run seed:demo -- email-do-profissional-responsavel
import pg from 'pg';
import { config } from '../config.js';
import { normalizarNome } from '../lib/util.js';

const email = process.argv[2];
if (!email) { console.error('Uso: npm run seed:demo -- email@do.usuario'); process.exit(1); }
if (!config.migrationDatabaseUrl) { console.error('Defina MIGRATION_DATABASE_URL'); process.exit(1); }

const db = new pg.Client({ connectionString: config.migrationDatabaseUrl });
await db.connect();
const u = await db.query('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [email]);
if (!u.rowCount) { console.error('Usuário não encontrado'); process.exit(1); }
const uid = u.rows[0].id;

// Gerador pseudoaleatório determinístico.
let semente = 42;
const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
const escolha = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const pessoas = [
  { nome: 'Exemplo Ana Fictícia', nasc: '2008-03-14', turno: 'manha', dias: [1, 3, 5] },
  { nome: 'Exemplo Bruno Fictício', nasc: '1999-11-02', turno: 'manha', dias: [1, 2, 3, 4, 5] },
  { nome: 'Exemplo Carla Fictícia', nasc: '2012-07-21', turno: 'tarde', dias: [2, 4] },
  { nome: 'Exemplo Davi Fictício', nasc: '1987-01-30', turno: 'ambos', dias: [1, 3, 5, 6] },
  { nome: 'Exemplo Elisa Fictícia', nasc: '2015-09-09', turno: 'tarde', dias: [1, 2, 4] },
];

const ativ = Object.fromEntries((await db.query('SELECT id, nome FROM atividades')).rows.map((r) => [r.nome, r.id]));
const ind = (await db.query('SELECT id, chave, escala_versao_id FROM indicadores_vigentes')).rows;

const frases = {
  pos: ['Permaneceu na atividade durante a maior parte do tempo proposto.', 'Respondeu às orientações verbais com apoio gestual.',
    'Iniciou interação com colega durante a roda de música.', 'Concluiu a sequência proposta com apoio pontual.'],
  dif: ['Apresentou agitação no início, reduzida após pausa sensorial.', 'Necessitou de redirecionamento frequente para retomar a tarefa.',
    'Demonstrou recusa inicial à troca de ambiente.', 'Buscou alimentos fora do horário previsto, sendo redirecionado.'],
  apoio: ['Antecipação visual da rotina.', 'Pausa sensorial de 5 minutos.', 'Modelagem pelo profissional.', 'Reforço verbal positivo.'],
};

await db.query('BEGIN');
const ids: string[] = [];
for (const p of pessoas) {
  const r = await db.query(
    `INSERT INTO assistidos (nome_completo, nome_busca, data_nascimento, turno_habitual, anamnese, exemplo, criado_por)
     VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
    [p.nome, normalizarNome(p.nome), p.nasc, p.turno,
      '[EXEMPLO] Anamnese fictícia para demonstração: histórico de desenvolvimento, rotina familiar e objetivos de acompanhamento.', uid]);
  ids.push(r.rows[0].id);
  for (const d of p.dias) await db.query('INSERT INTO assistido_agenda VALUES ($1,$2)', [r.rows[0].id, d]);
  await db.query(
    `INSERT INTO assistido_diagnosticos (assistido_id, descricao, cid_codigo, situacao, criado_por)
     VALUES ($1, 'Exemplo — diagnóstico fictício para demonstração', $2, 'pendente_documentacao', $3)`,
    [r.rows[0].id, escolha(['F84.0', 'F71', 'G40.9', 'F72']), uid]);
}

const hoje = new Date();
for (let dias = 28; dias >= 1; dias--) {
  const d = new Date(hoje); d.setDate(d.getDate() - dias);
  const dow = d.getDay();
  if (dow === 0) continue;
  const data = d.toISOString().slice(0, 10);
  for (const [i, p] of pessoas.entries()) {
    if (!p.dias.includes(dow) || rnd() < 0.25) continue;
    const turno = p.turno === 'ambos' ? escolha(['manha', 'tarde']) : p.turno;
    const texto = `[EXEMPLO] ${escolha(frases.pos)} ${escolha(frases.dif)}`;
    const e = await db.query(
      `INSERT INTO evolucoes (assistido_id, profissional_id, data, turno, tipo, duracao_minutos, texto_evolucao, apoios_estrategias,
         nivel_apoio, exemplo) VALUES ($1,$2,$3,$4,'individual',$5,$6,$7,$8,true) RETURNING id`,
      [ids[i], uid, data, turno, escolha([30, 40, 50]), texto, escolha(frases.apoio),
        escolha(['apoio_pontual', 'apoio_frequente', 'apoio_intenso'])]);
    const eid = e.rows[0].id;
    for (const nome of new Set([escolha(Object.keys(ativ)), escolha(Object.keys(ativ))])) {
      await db.query('INSERT INTO evolucao_atividades VALUES ($1,$2,$3)', [eid, ativ[nome], escolha(['integral', 'parcial'])]);
    }
    for (const x of ind) {
      if (rnd() < 0.2) continue; // alguns indicadores ficam "Não avaliado"
      const base = x.chave === 'agressividade' || x.chave === 'busca_alimentar' ? 1 : 3;
      const valor = Math.max(0, Math.min(5, base + Math.round((rnd() - 0.5) * 3)));
      await db.query('INSERT INTO avaliacoes_indicadores (evolucao_id, indicador_id, escala_versao_id, valor) VALUES ($1,$2,$3,$4)',
        [eid, x.id, x.escala_versao_id, valor]);
    }
    await db.query(`UPDATE evolucoes SET status = 'finalizada', finalizada_em = now() WHERE id = $1`, [eid]);
  }
}
await db.query('COMMIT');
console.log(`Dados de exemplo criados: ${ids.length} assistidos fictícios com evoluções das últimas 4 semanas.`);
await db.end();
