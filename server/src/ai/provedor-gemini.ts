import { ApiError, GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import type { PedidoIA, RespostaIA } from './cliente.js';

/** Subconjunto do cliente usado aqui (permite testes com um cliente simulado). */
export interface ClienteGemini {
  models: { generateContent: GoogleGenAI['models']['generateContent'] };
}

let cliente: ClienteGemini | null = null;

export function definirClienteGemini(c: ClienteGemini | null) {
  cliente = c;
}

export async function chamarGemini({ system, prompt, esquemaJSON }: PedidoIA): Promise<RespostaIA> {
  cliente ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY });
  try {
    const r = await cliente.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        systemInstruction: system,
        maxOutputTokens: 32000,
        ...(esquemaJSON ? { responseMimeType: 'application/json', responseJsonSchema: esquemaJSON } : {}),
      },
    });
    if (r.promptFeedback?.blockReason) {
      throw new HttpError(422, 'O serviço de IA bloqueou a solicitação. Revise o conteúdo ou elabore o texto manualmente.');
    }
    const motivo = r.candidates?.[0]?.finishReason;
    if (motivo === 'MAX_TOKENS') {
      throw new HttpError(422, 'A resposta da IA ficou incompleta (limite de tamanho). Reduza o período ou os registros selecionados.');
    }
    if (motivo && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(motivo)) {
      throw new HttpError(422, `O serviço de IA interrompeu a resposta (${motivo}). Revise o conteúdo ou elabore o texto manualmente.`);
    }
    const texto = (r.text ?? '').trim();
    if (!texto) throw new HttpError(502, 'A IA não retornou conteúdo. Tente novamente.');
    const u = r.usageMetadata;
    return {
      texto,
      modelo: r.modelVersion ?? config.geminiModel,
      tokensEntrada: u?.promptTokenCount ?? 0,
      tokensSaida: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof ApiError) {
      if (e.status === 429) throw new HttpError(429, 'Limite de uso do serviço de IA atingido. Aguarde alguns minutos.');
      if (e.status === 401 || e.status === 403) throw new HttpError(503, 'Credencial do serviço de IA inválida. Avise a administração.');
      throw new HttpError(502, `Falha no serviço de IA (${e.status}). Tente novamente.`);
    }
    throw new HttpError(503, 'Não foi possível conectar ao serviço de IA. Tente novamente.');
  }
}
