import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import type { PedidoIA, RespostaIA } from './cliente.js';

let cliente: Anthropic | null = null;

export async function chamarAnthropic({ system, prompt, esquemaJSON, esforco = 'medium' }: PedidoIA): Promise<RespostaIA> {
  cliente ??= new Anthropic({ timeout: 5 * 60_000, maxRetries: 2 });
  try {
    const msg = await cliente.beta.messages.stream({
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
}
