export const VERSAO_PROMPT = '2026-10-v1';

const REGRAS_GERAIS = `Você apoia a equipe técnica de um centro de reabilitação que atende pessoas com deficiência intelectual,
transtornos do neurodesenvolvimento, epilepsia e outras condições que podem exigir níveis elevados de suporte.
Seu papel é organizar e redigir, em português do Brasil, textos técnicos claros a partir dos registros fornecidos.
O texto produzido é uma MINUTA que será revisada por um profissional antes de qualquer uso.

Regras obrigatórias:
- Use exclusivamente as informações presentes nos registros fornecidos. Não invente fatos, datas, falas, quantidades ou eventos.
- Não preencha lacunas com suposições e não transforme hipóteses em fatos. Quando faltar informação, diga explicitamente que o registro não informa.
- Não formule diagnósticos, prognósticos, hipóteses diagnósticas, recomendações medicamentosas ou terapêuticas definitivas.
- Diagnósticos só podem ser mencionados se constarem na seção "Diagnósticos registrados", com a situação documental indicada.
- Pontuação "Não avaliado" significa ausência de registro e NUNCA equivale a zero.
- Interprete cada indicador conforme a descrição do nível e a direção da escala informadas; escalas diferentes não são comparáveis entre si,
  e versões diferentes de uma mesma escala também não devem ser comparadas diretamente.
- Descreva comportamentos de forma respeitosa e não estigmatizante, referindo-se ao comportamento observado e não à pessoa.
- Associações entre contexto, atividade e comportamento não comprovam causalidade; deixe isso explícito sempre que mencionar uma associação.
- Registre tanto avanços quanto dificuldades, sem viés negativo.
- Os nomes foram substituídos por marcadores ([ASSISTIDO], [OUTRO ASSISTIDO], [PROFISSIONAL]). Mantenha os marcadores; não tente identificar pessoas.
- Sugestões de atividades ou estratégias devem ser gerais, compatíveis com o contexto descrito, e apresentadas como possibilidades para avaliação do profissional.`;

export const SYSTEM_ANALISE = REGRAS_GERAIS;

export const ESQUEMA_ANALISE_EVOLUCAO = {
  type: 'object',
  additionalProperties: false,
  required: ['resumo', 'comportamentos_observados', 'indicadores_registrados', 'potencialidades', 'dificuldades',
    'necessidades_apoio', 'pontos_acompanhamento', 'sugestoes', 'lacunas_informacao'],
  properties: {
    resumo: { type: 'string', description: 'Síntese objetiva da atividade e da participação' },
    comportamentos_observados: { type: 'array', items: { type: 'string' } },
    indicadores_registrados: { type: 'array', items: { type: 'string' }, description: 'Interpretação descritiva de cada pontuação registrada' },
    potencialidades: { type: 'array', items: { type: 'string' } },
    dificuldades: { type: 'array', items: { type: 'string' } },
    necessidades_apoio: { type: 'array', items: { type: 'string' }, description: 'Apoios e estratégias mencionados no registro' },
    pontos_acompanhamento: { type: 'array', items: { type: 'string' } },
    sugestoes: { type: 'array', items: { type: 'string' }, description: 'Possibilidades gerais para avaliação do profissional' },
    lacunas_informacao: { type: 'array', items: { type: 'string' } },
  },
};

export const ESQUEMA_ANALISE_LONGITUDINAL = {
  type: 'object',
  additionalProperties: false,
  required: ['sintese', 'frequencia_atividades', 'participacao_engajamento', 'variacoes_indicadores', 'comportamentos_recorrentes',
    'avancos', 'dificuldades', 'contextos_individual_coletivo', 'estrategias_e_respostas', 'associacoes_observadas',
    'informacoes_ausentes', 'limitacoes'],
  properties: {
    sintese: { type: 'string' },
    frequencia_atividades: { type: 'array', items: { type: 'string' } },
    participacao_engajamento: { type: 'array', items: { type: 'string' } },
    variacoes_indicadores: { type: 'array', items: { type: 'string' } },
    comportamentos_recorrentes: { type: 'array', items: { type: 'string' } },
    avancos: { type: 'array', items: { type: 'string' } },
    dificuldades: { type: 'array', items: { type: 'string' } },
    contextos_individual_coletivo: { type: 'array', items: { type: 'string' } },
    estrategias_e_respostas: { type: 'array', items: { type: 'string' } },
    associacoes_observadas: { type: 'array', items: { type: 'string' }, description: 'Somente com dados suficientes; sempre ressalvando que associação não é causalidade' },
    informacoes_ausentes: { type: 'array', items: { type: 'string' } },
    limitacoes: { type: 'array', items: { type: 'string' } },
  },
};

export function promptAnaliseEvolucao(ctx: { idade: number | null; diagnosticos: string[] }, registros: string) {
  return `Analise o registro de atendimento abaixo e produza a análise no formato JSON solicitado.

Dados do assistido: idade ${ctx.idade ?? "não informada"} anos.
${ctx.diagnosticos.length ? `Diagnósticos registrados:\n${ctx.diagnosticos.map((d) => `- ${d}`).join('\n')}` : 'Diagnósticos: não incluídos nesta solicitação.'}

<registros>
${registros}
</registros>

Em cada lista, escreva itens curtos e factuais. Se não houver informação para um item, retorne lista vazia
(e registre a ausência em "lacunas_informacao").`;
}

export function promptAnaliseLongitudinal(ctx: { idade: number | null; diagnosticos: string[] }, periodo: string, estat: unknown, registros: string, minObs: number) {
  return `Analise o histórico do período ${periodo} e produza a análise no formato JSON solicitado.

Dados do assistido: idade ${ctx.idade ?? "não informada"} anos.
${ctx.diagnosticos.length ? `Diagnósticos registrados:\n${ctx.diagnosticos.map((d) => `- ${d}`).join('\n')}` : 'Diagnósticos: não incluídos nesta solicitação.'}

Estatísticas descritivas calculadas pelo sistema (use estes números; não recalcule):
<estatisticas>
${JSON.stringify(estat, null, 2)}
</estatisticas>

Regras adicionais para esta análise:
- Só descreva tendência de um indicador quando "dados_suficientes_para_tendencia" for verdadeiro (mínimo de ${minObs} observações na mesma versão de escala).
  Caso contrário, descreva apenas os valores registrados e informe que os dados são insuficientes para identificar tendência.
- Não compare indicadores de escalas ou versões diferentes.
- Ao comparar contextos individuais e coletivos, informe o número de registros de cada contexto.

<registros>
${registros}
</registros>`;
}

export const TIPOS_RELATORIO: Record<string, { titulo: string; foco: string }> = {
  individual_evolucao: { titulo: 'Relatório individual de evolução', foco: 'evolução global do assistido no período, integrando atividades, indicadores e observações.' },
  mensal: { titulo: 'Relatório mensal', foco: 'síntese do mês: frequência, participação, indicadores e principais acontecimentos.' },
  trimestral: { titulo: 'Relatório trimestral', foco: 'evolução ao longo do trimestre, destacando mudanças documentadas entre os meses.' },
  semestral: { titulo: 'Relatório semestral', foco: 'panorama do semestre, avanços, dificuldades persistentes e pontos para planejamento.' },
  participacao_atividades: { titulo: 'Relatório de participação em atividades', foco: 'frequência e qualidade da participação em cada atividade, sem aprofundar indicadores.' },
  indicadores_comportamentais: { titulo: 'Relatório de indicadores comportamentais', foco: 'descrição dos indicadores registrados, respeitando escalas e versões, e períodos sem avaliação.' },
  atividade_grupo: { titulo: 'Relatório de atividade em grupo', foco: 'síntese geral da atividade coletiva.' },
  discussao_multidisciplinar: { titulo: 'Relatório descritivo para discussão multidisciplinar', foco: 'descrição objetiva dos registros para subsidiar discussão da equipe, apontando questões em aberto sem conclusões clínicas.' },
};

export const SYSTEM_RELATORIO = `${REGRAS_GERAIS}

Formato de saída: Markdown simples (títulos com "##", listas com "-", parágrafos). Não inclua cabeçalho institucional,
identificação do assistido, período ou assinatura — essas seções são inseridas pelo sistema.`;

export function promptRelatorio(args: {
  tipo: string; objetivo: string | null; periodo: string; idade: number | null; diagnosticos: string[]; estat: unknown; registros: string; minObs: number;
}) {
  const t = TIPOS_RELATORIO[args.tipo];
  return `Elabore a minuta do documento "${t.titulo}". Foco: ${t.foco}
Período analisado: ${args.periodo}.
Objetivo informado pelo profissional: ${args.objetivo || 'não informado'}.
Assistido: idade ${args.idade ?? "não informada"} anos.
${args.diagnosticos.length ? `Diagnósticos registrados:\n${args.diagnosticos.map((d) => `- ${d}`).join('\n')}` : 'Diagnósticos: não incluídos neste relatório (não mencione diagnósticos).'}

Escreva exatamente as seções abaixo, nesta ordem, com títulos "##":
## Objetivo do relatório
## Atividades realizadas
## Participação e engajamento
## Evolução dos indicadores
## Comportamentos observados
## Potencialidades e dificuldades
## Necessidades de apoio identificadas nos registros
## Síntese evolutiva
## Pontos para acompanhamento

Em "Evolução dos indicadores", só descreva tendências quando houver ao menos ${args.minObs} observações na mesma versão de escala;
caso contrário, informe que os dados são insuficientes. Use as estatísticas do sistema, sem recalcular.

<estatisticas>
${JSON.stringify(args.estat, null, 2)}
</estatisticas>

<registros>
${args.registros}
</registros>`;
}

export function promptRelatorioGrupo(args: { coletiva: Record<string, unknown>; resumo: unknown; objetivo: string | null }) {
  return `Elabore a minuta do "Relatório de atividade em grupo" com uma síntese GERAL da atividade coletiva.
Não descreva nenhum participante individualmente (os registros individuais são anexos com acesso controlado).
Objetivo informado pelo profissional: ${args.objetivo || 'não informado'}.

<atividade>
${JSON.stringify(args.coletiva, null, 2)}
</atividade>

<resumo_agregado_participacao>
${JSON.stringify(args.resumo, null, 2)}
</resumo_agregado_participacao>

Escreva as seções, com títulos "##":
## Objetivo do relatório
## Descrição da atividade proposta
## Participação geral do grupo
## Observações gerais
## Pontos para acompanhamento`;
}
