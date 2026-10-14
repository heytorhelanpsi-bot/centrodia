import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import { chamarAnthropic } from './provedor-anthropic.js';
import { chamarGemini } from './provedor-gemini.js';

export interface RespostaIA {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
}

export interface PedidoIA {
  system: string;
  prompt: string;
  esquemaJSON?: Record<string, unknown>;
  esforco?: 'low' | 'medium' | 'high';
}

/** Ponto único de chamada à IA (facilita testes e substituição de provedor). */
export type ChamadorIA = (args: PedidoIA) => Promise<RespostaIA>;

export type Provedor = 'anthropic' | 'gemini';

/**
 * Provedor escolhido por AI_PROVIDER ('anthropic' | 'gemini').
 * Sem AI_PROVIDER: usa o provedor cuja chave estiver configurada (Anthropic tem prioridade se houver as duas).
 */
export function provedorAtivo(): Provedor | null {
  if (!config.aiEnabled) return null;
  const temAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const temGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (config.aiProvider === 'gemini') return temGemini ? 'gemini' : null;
  if (config.aiProvider === 'anthropic') return temAnthropic ? 'anthropic' : null;
  if (temAnthropic) return 'anthropic';
  if (temGemini) return 'gemini';
  return null;
}

export function iaConfigurada(): boolean {
  return provedorAtivo() !== null;
}

const chamadorPadrao: ChamadorIA = async (pedido) => {
  const p = provedorAtivo();
  if (p === 'anthropic') return chamarAnthropic(pedido);
  if (p === 'gemini') return chamarGemini(pedido);
  throw new HttpError(503, 'A integração com IA não está configurada neste servidor. Consulte a administração (ANTHROPIC_API_KEY ou GEMINI_API_KEY).');
};

let chamadorAtual: ChamadorIA = chamadorPadrao;
let configuradaForcada = false;

export function chamarIA(pedido: PedidoIA) {
  return chamadorAtual(pedido);
}

/** Usado apenas em testes automatizados. */
export function substituirChamadorIA(fn: ChamadorIA | null, forcarConfigurada = false) {
  chamadorAtual = fn ?? chamadorPadrao;
  configuradaForcada = forcarConfigurada;
}

export function iaDisponivel() {
  return configuradaForcada || iaConfigurada();
}

export function descricaoProvedor() {
  const p = provedorAtivo();
  if (p === 'anthropic') return { provedor: 'Anthropic (Claude)', modelo: config.anthropicModel };
  if (p === 'gemini') return { provedor: 'Google (Gemini)', modelo: config.geminiModel };
  return null;
}
