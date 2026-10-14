export const TURNOS: Record<string, string> = { manha: 'Manhã', tarde: 'Tarde', ambos: 'Manhã e tarde' };
export const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DIAS_CURTOS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const REALIZACAO: Record<string, string> = { integral: 'Integral', parcial: 'Parcial', nao_realizada: 'Não realizada' };
export const PARTICIPACAO: Record<string, string> = { integral: 'Participou integralmente', parcial: 'Participou parcialmente', nao_realizada: 'Não participou' };
export const APOIO: Record<string, string> = {
  sem_apoio: 'Sem apoio', apoio_pontual: 'Apoio pontual', apoio_frequente: 'Apoio frequente',
  apoio_intenso: 'Apoio intenso', apoio_integral: 'Apoio integral',
};
export const PERFIS: Record<string, string> = { admin: 'Administração', profissional: 'Profissional', consulta: 'Consulta autorizada' };
export const TIPOS_RELATORIO: Record<string, string> = {
  individual_evolucao: 'Relatório individual de evolução',
  mensal: 'Relatório mensal',
  trimestral: 'Relatório trimestral',
  semestral: 'Relatório semestral',
  participacao_atividades: 'Relatório de participação em atividades',
  indicadores_comportamentais: 'Relatório de indicadores comportamentais',
  atividade_grupo: 'Relatório de atividade em grupo',
  discussao_multidisciplinar: 'Relatório descritivo para discussão multidisciplinar',
};
export const DIRECAO: Record<string, string> = {
  maior_melhor: 'Valores maiores indicam maior habilidade/participação',
  menor_melhor: 'Valores maiores indicam maior intensidade do comportamento monitorado',
  neutra: 'Sem direção de interpretação definida',
};
export const TIPO_INDICADOR: Record<string, string> = { positivo: 'Habilidade/participação', monitoramento: 'Comportamento em monitoramento', autonomia: 'Autonomia/apoio', outro: 'Outro' };

export function data(iso?: string | null) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
export function dataHora(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function diasAtras(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function turnoAtual(): 'manha' | 'tarde' {
  return new Date().getHours() < 12 ? 'manha' : 'tarde';
}
