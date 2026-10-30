export type SlotTipo = 'constante' | 'catalogo' | 'regex' | 'texto' | 'patron';
export type FormatoTexto = 'title' | 'upper' | 'lower';

export interface EsquemaSlot {
  tipo?: SlotTipo;
  valor?: string;
  opciones?: string[];
  umbral?: number;
  regex?: string | RegExp | Array<string | RegExp>;
  patron?: string;
  grupo?: number;
  ignorar?: string[];
  bloqueados?: string[] | Set<string>;
  formato?: FormatoTexto;
  pregunta?: string;
  error?: string;
  conectores?: string[];
  [key: string]: any;
}

export type EsquemaSlots = Record<string, EsquemaSlot>;

export interface IntencionDef {
  intension: string;
  expresiones: string[];
  respuestas?: string[];
  slots?: string[];
  action?: string;
  sugerencias?: string[];
  [key: string]: any;
}

export type BaseConocimiento = IntencionDef[];

export interface ProbabilidadIntencion {
  intent: string;
  probability: number;
}

export interface ResultadoInferencia {
  reply: string;
  messages: string[];
  intent: string;
  confidencePct: number;
  confidence: number;
  method: 'ml' | 'ml-ngram' | 'fuzzy' | 'direct-slot' | 'ninguno';
  slots: Record<string, any>;
  slotsRequeridos: string[];
  action?: string | null;
  latencyMs: number;
  sessionId: string;
  data?: any;
  sugerencias?: string[];
  probabilities: ProbabilidadIntencion[];
}

export type ActionHandler = (context: {
  action: string;
  intent: string;
  mensaje: string;
  slots: Record<string, any>;
  sessionId: string;
  session: any;
  buscarBaseDatos: (query: string, limite?: number) => any[];
  baseDatos: any[];
}) => Promise<{ datos?: any; api?: any; data?: any; db?: any; reply?: string } | void> | { datos?: any; api?: any; data?: any; db?: any; reply?: string } | void;

export interface MensajesPorDefecto {
  noEntendido?: string;
  solicitarSlot?: string;
  intencionProcesada?: string;
}

export interface IaConiaConfig {
  nombre?: string;
  baseConocimiento?: BaseConocimiento;
  esquemaSlots?: EsquemaSlots;
  baseDatos?: any[];
  umbralClasificacion?: number;
  umbralFuzzy?: number;
  mensajesPorDefecto?: MensajesPorDefecto;
  camposIgnoradosDb?: string[];
  conectoresTexto?: string[];
  [key: string]: any;
}

