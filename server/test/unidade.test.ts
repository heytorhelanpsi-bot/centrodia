import { describe, expect, it } from 'vitest';
import { calcularIdade, cifrar, decifrar, normalizarNome } from '../src/lib/util.js';
import { estatisticas, MIN_OBS_TENDENCIA } from '../src/ai/dados.js';

describe('cálculo de idade', () => {
  it('considera se o aniversário já ocorreu no ano', () => {
    expect(calcularIdade('2000-06-15', new Date(2026, 5, 14))).toBe(25);
    expect(calcularIdade('2000-06-15', new Date(2026, 5, 15))).toBe(26);
    expect(calcularIdade('2000-06-15', new Date(2026, 11, 31))).toBe(26);
  });
  it('trata nascidos em 29 de fevereiro', () => {
    expect(calcularIdade('2004-02-29', new Date(2025, 1, 28))).toBe(20);
    expect(calcularIdade('2004-02-29', new Date(2025, 2, 1))).toBe(21);
  });
  it('recém-nascido tem idade zero', () => {
    expect(calcularIdade('2026-01-10', new Date(2026, 5, 1))).toBe(0);
  });
});

describe('normalização de nomes', () => {
  it('remove acentos, espaços extras e caixa', () => {
    expect(normalizarNome('  José   da  CONCEIÇÃO ')).toBe('jose da conceicao');
  });
});

describe('cifragem de observações restritas', () => {
  it('cifra e decifra; o texto cifrado não contém o original', () => {
    const c = cifrar('Observação sigilosa')!;
    expect(c).not.toContain('sigilosa');
    expect(decifrar(c)).toBe('Observação sigilosa');
    expect(cifrar('')).toBeNull();
  });
});

describe('estatísticas de indicadores', () => {
  const base = (n: number, versao = 1) => Array.from({ length: n }, (_, i) => ({
    evolucao_id: `e${i}`, indicador_id: 'ind', nome: 'Atenção', valor: i % 2 ? 3 : 4, versao, minimo: 0, maximo: 5, direcao: 'maior_melhor',
  }));
  const evol = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, data: `2026-01-${String(i + 1).padStart(2, '0')}`, tipo: 'individual' }));

  it('não calcula mediana nem tendência com poucos registros', () => {
    const s = estatisticas({ evolucoes: evol(2), atividades: [], avaliacoes: base(2), coletivas: [] } as any);
    const v = s.indicadores[0].versoes_de_escala[0];
    expect(v.observacoes).toBe(2);
    expect(v.mediana).toBeNull();
    expect(v.dados_suficientes_para_tendencia).toBe(false);
  });

  it('calcula com dados suficientes e separa versões de escala', () => {
    const av = [...base(MIN_OBS_TENDENCIA), ...base(1, 2).map((a) => ({ ...a, evolucao_id: 'e0' }))];
    const s = estatisticas({ evolucoes: evol(MIN_OBS_TENDENCIA), atividades: [], avaliacoes: av, coletivas: [] } as any);
    const versoes = s.indicadores[0].versoes_de_escala;
    expect(versoes).toHaveLength(2);
    expect(versoes.find((v) => v.versao === 1)!.dados_suficientes_para_tendencia).toBe(true);
    expect(versoes.find((v) => v.versao === 2)!.dados_suficientes_para_tendencia).toBe(false);
  });

  it('"não avaliado" nunca entra como zero', () => {
    const av = [{ ...base(1)[0], valor: null }, ...base(4).slice(1)];
    const s = estatisticas({ evolucoes: evol(4), atividades: [], avaliacoes: av, coletivas: [] } as any);
    const v = s.indicadores[0].versoes_de_escala[0];
    expect(v.observacoes).toBe(3);
    expect(v.minimo_observado).toBe(3);
    expect(s.indicadores[0].registros_sem_avaliacao).toBe(1);
  });
});
