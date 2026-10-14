import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';

let cliente: Anthropic | null = null;

export function iaConfigurada(): boolean {
  return config.aiEnabled && !!process.env.ANTHROPIC_API_KEY;
}

function obterCliente(): Anthropic {
  if (!iaConfigurada()) {
    throw new HttpError(503, 'A integração com IA não está configurada neste servidor. Consulte a administração (variável ANTHROPIC_API_KEY).');
  }
  cliente ??= new Anthropic({ timeout: 5 * 60_000, maxRetries: 2 });
  return cliente;
}

export interface RespostaIA {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
}

/** Ponto único de chamada à IA (facilita testes e substituição de provedor). */
export type ChamadorIA = (args: {
  system: string;
  prompt: string;
  esquemaJSON?: Record<string, unknown>;
  esforco?: 'low' | 'medium' | 'high';
}) => Promise<RespostaIA>;

const chamadorPadrao: ChamadorIA = async ({ system, prompt, esquemaJSON, esforco = 'medium' }) => {
  const client = obterCliente();
  try {
    const msg = await client.beta.messages.stream({
      model: config.anthropicModel,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      output_config: {
        effort: esforco,
        ...(esquemaJSON ? { format: { type: 'json_schema' as const, schema: esquemaJSON } } : {}),
      },
      messages: [{ role: 'user', content: prompt }],
    }).finalMessage();

    if (msg.stop_reason === 'refusal') {
      throw new HttpError(422, 'O serviço de IA recusou a solicitação. Revise o conteúdo ou elabore o texto manualmente.');
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new HttpError(422, 'A resposta da IA ficou incompleta (limite de tamanho). Reduza o período ou os registros selecionados.');
    }
    const texto = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
    if (!texto) throw new HttpError(502, 'A IA não retornou conteúdo. Tente novamente.');
    return { texto, modelo: msg.model, tokensEntrada: msg.usage.input_tokens, tokensSaida: msg.usage.output_tokens };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Limite de uso do serviço de IA atingido. Aguarde alguns minutos.');
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'Credencial do serviço de IA inválida. Avise a administração.');
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(503, 'Não foi possível conectar ao serviço de IA. Tente novamente.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Falha no serviço de IA (${e.status ?? 'erro'}). Tente novamente.`);
    throw e;
  }
};

let chamadorAtual: ChamadorIA = chamadorPadrao;

export function chamarIA(...args: Parameters<ChamadorIA>) {
  return chamadorAtual(...args);
}

/** Usado apenas em testes automatizados. */
export function substituirChamadorIA(fn: ChamadorIA | null, forcarConfigurada = false) {
  chamadorAtual = fn ?? chamadorPadrao;
  configuradaForcada = forcarConfigurada;
}
let configuradaForcada = false;
export function iaDisponivel() {
  return configuradaForcada || iaConfigurada();
}
