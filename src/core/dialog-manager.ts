import {
  ActionHandler,
  EsquemaSlots,
  IntencionDef,
  MensajesPorDefecto,
  ResultadoInferencia
} from '../types.js';
import { clasificarTexto, obtenerDistribucionProbabilidades, PipelineEntrenado } from './classifier.js';
import { SesionUsuario } from './session.js';
import { extraerTodosLosSlots, extraerVariable, resolverTipoSlot } from './slot-extractor.js';
import { VectorDatabaseIndex } from './vector-db.js';

export const MENSAJES_DEFAULT: Required<MensajesPorDefecto> = {
  noEntendido: 'Disculpa, no logré comprender tu mensaje. ¿Podrías reformularlo de otra manera?',
  solicitarSlot: 'Por favor, indícame el valor para {slot}.',
  intencionProcesada: 'He procesado tu solicitud de **{intencion}**.'
};

export function formatearRespuesta(plantilla: string, contexto: Record<string, any>): string {
  if (!plantilla || !contexto) return String(plantilla || '');

  let resultado = String(plantilla);

  // 1. Reemplazo directo de claves de primer nivel escalares
  for (const [clave, valor] of Object.entries(contexto)) {
    if (!clave.startsWith('_') && valor !== null && valor !== undefined && typeof valor !== 'object') {
      const valStr = String(valor);
      resultado = resultado.replaceAll(`{${clave}}`, valStr);
      resultado = resultado.replaceAll(`{slot.${clave}}`, valStr);
      resultado = resultado.replaceAll(`{slots.${clave}}`, valStr);

      if (clave.startsWith('slot.')) {
        resultado = resultado.replaceAll(`{${clave.substring(5)}}`, valStr);
      } else if (clave.startsWith('slots.')) {
        resultado = resultado.replaceAll(`{${clave.substring(6)}}`, valStr);
      }
    }
  }

  // 2. Navegación genérica por notación de punto para estructuras JSON (ej: {db.precio}, {db.0.nombre})
  const tags = resultado.match(/\{([a-zA-Z0-9_.]+)\}/g) || [];
  for (const rawTag of tags) {
    const tag = rawTag.slice(1, -1);
    const partes = tag.split('.');
    let curr: any = contexto;
    let val: any = null;

    for (let i = 0; i < partes.length; i++) {
      const p = partes[i];
      if (curr && typeof curr === 'object' && p in curr) {
        curr = curr[p];
        val = curr;
      } else if (Array.isArray(curr) && !isNaN(Number(p)) && Number(p) < curr.length) {
        curr = curr[Number(p)];
        val = curr;
      } else {
        val = null;
        break;
      }
    }

    if (val !== null && val !== undefined && typeof val !== 'object') {
      resultado = resultado.replaceAll(`{${tag}}`, String(val));
    }
  }

  return resultado;
}

export function inyectarItemDbEnContexto(item: any, contexto: Record<string, any>): void {
  if (!item || !contexto) return;
  const dataItem = item && typeof item === 'object' && item.data ? item.data : item;
  contexto.db = typeof dataItem === 'object' ? { ...dataItem } : dataItem;
}

export function limpiarSlotsContexto(contexto: Record<string, any>): Record<string, any> {
  const slotsLimpios: Record<string, any> = {};
  for (const [k, v] of Object.entries(contexto || {})) {
    if (!k.startsWith('_') && !k.startsWith('slot.') && !k.startsWith('slots.')) {
      slotsLimpios[k] = v;
    }
  }
  return slotsLimpios;
}

export async function resolverTurnoDialogo(
  mensajeUsuario: string,
  pipeline: PipelineEntrenado,
  esquemaSlots: EsquemaSlots,
  sesion: SesionUsuario,
  baseDatos: any[] = [],
  indiceVectorial: VectorDatabaseIndex | null = null,
  actionHandler?: ActionHandler,
  umbralMl: number = 0.48,
  umbralFuzzy: number = 78,
  mensajesPorDefecto?: MensajesPorDefecto,
  conectoresTexto?: string[],
  coberturaMinima: number = 0
): Promise<ResultadoInferencia> {
  const tInicio = performance.now();
  sesion.registrarMensajeUsuario(mensajeUsuario);

  let intencionDetectada: string | null = null;
  let confianza = 0;
  let metodo: 'ml' | 'ml-ngram' | 'fuzzy' | 'direct-slot' | 'ninguno' = 'ninguno';

  // 1. Manejo de Slot Pendiente (Pregunta de aclaración previa)
  if (sesion.slotPendiente) {
    const slotName = sesion.slotPendiente;
    const slotCfg = esquemaSlots[slotName];

    if (slotCfg) {
      // El texto libre captura casi todo, así que primero se descarta un cambio de tema
      let esCambioDeTema = false;
      if (resolverTipoSlot(slotCfg) === 'texto') {
        const clasifPrevia = clasificarTexto(mensajeUsuario, pipeline, umbralMl, umbralFuzzy, coberturaMinima);
        esCambioDeTema = !!clasifPrevia.intencion && clasifPrevia.intencion !== sesion.intencionPendiente;
      }
      const valorExtraido = esCambioDeTema
        ? null
        : extraerVariable(mensajeUsuario, slotName, slotCfg, true, conectoresTexto);
      if (valorExtraido !== null && valorExtraido !== undefined && String(valorExtraido).trim() !== '') {
        // [CAMINO A] Captura Exitosa: El usuario respondió el dato solicitado
        sesion.contexto[slotName] = String(valorExtraido).trim();
        sesion.contexto[`slot.${slotName}`] = String(valorExtraido).trim();
        sesion.contexto[`slots.${slotName}`] = String(valorExtraido).trim();

        intencionDetectada = sesion.intencionPendiente;
        confianza = 1.0;
        metodo = 'direct-slot';
        sesion.slotPendiente = null;
        sesion.intencionPendiente = null;
      } else {
        // [CAMINO B o C] El usuario no proporcionó el dato esperado.
        // Consultamos a la Red Neuronal para saber si hubo Cambio de Tema / Interrupción:
        const clasifCambio = clasificarTexto(mensajeUsuario, pipeline, umbralMl, umbralFuzzy, coberturaMinima);

        if (clasifCambio.intencion && clasifCambio.intencion !== sesion.intencionPendiente) {
          // [CAMINO B] INTERRUPCIÓN / CONTEXT SWITCH (Estrategia B: Memoria Retenida)
          // Liberamos el slot pendiente para no bloquear la conversación.
          // Conservamos sesion.contexto con los datos ya reunidos por si el usuario retoma el tema.
          sesion.slotPendiente = null;
          sesion.intencionPendiente = null;

          intencionDetectada = clasifCambio.intencion;
          confianza = clasifCambio.confianza;
          metodo = clasifCambio.metodo;
        } else {
          // [CAMINO C] ERROR REAL DE VALIDACIÓN:
          // El usuario no cambió de tema, pero el dato ingresado no cumple el formato esperado
          const msgError = slotCfg.error;
          if (msgError) {
            const latencyMs = Math.round((performance.now() - tInicio) * 100) / 100;
            sesion.registrarMensajeBot(msgError, { slotPendiente: slotName });
            return {
              reply: msgError,
              messages: [msgError],
              intent: sesion.intencionPendiente || 'UNKNOWN',
              confidencePct: 100,
              confidence: 1.0,
              method: 'direct-slot',
              slots: limpiarSlotsContexto(sesion.contexto),
              slotsRequeridos: [slotName],
              action: null,
              latencyMs,
              sessionId: sesion.sessionId || 'default',
              probabilities: []
            };
          }
        }
      }
    }
  }

  // 2. Si no se resolvió por slot pendiente (o si el usuario inició una nueva intención)
  if (!intencionDetectada) {
    const resClasif = clasificarTexto(mensajeUsuario, pipeline, umbralMl, umbralFuzzy, coberturaMinima);
    intencionDetectada = resClasif.intencion;
    confianza = resClasif.confianza;
    metodo = resClasif.metodo;
  }

  // Extraer todos los slots nuevos presentes en el mensaje
  const slotsNuevos = extraerTodosLosSlots(mensajeUsuario, esquemaSlots, conectoresTexto, true);
  for (const [k, v] of Object.entries(slotsNuevos)) {
    sesion.contexto[k] = v;
    sesion.contexto[`slot.${k}`] = v;
    sesion.contexto[`slots.${k}`] = v;
  }

  const defIntencion: IntencionDef = intencionDetectada
    ? pipeline.catalogoIntenciones[intencionDetectada] || { intension: intencionDetectada, expresiones: [] }
    : { intension: 'UNKNOWN', expresiones: [] };

  const slotsRequeridos = defIntencion.slots || [];
  let slotFaltante: string | null = null;

  for (const sReq of slotsRequeridos) {
    const val = sesion.contexto[sReq] || sesion.contexto[`slot.${sReq}`];
    if (val === undefined || val === null || String(val).trim() === '') {
      slotFaltante = sReq;
      break;
    }
  }

  // 3. Si falta un slot obligatorio, solicitar aclaración
  if (slotFaltante) {
    sesion.slotPendiente = slotFaltante;
    sesion.intencionPendiente = intencionDetectada;

    const slotCfg = esquemaSlots[slotFaltante];
    const plantillaPregunta =
      slotCfg?.pregunta ||
      mensajesPorDefecto?.solicitarSlot ||
      MENSAJES_DEFAULT.solicitarSlot;
    const preguntaAclaracion = plantillaPregunta.replaceAll('{slot}', slotFaltante);

    const latencyMs = Math.round((performance.now() - tInicio) * 100) / 100;
    sesion.registrarMensajeBot(preguntaAclaracion, { slotPendiente: slotFaltante });

    return {
      reply: preguntaAclaracion,
      messages: [preguntaAclaracion],
      intent: intencionDetectada || 'UNKNOWN',
      confidencePct: Math.round(confianza * 1000) / 10,
      confidence: confianza,
      method: metodo,
      slots: limpiarSlotsContexto(sesion.contexto),
      slotsRequeridos,
      action: null,
      latencyMs,
      sessionId: sesion.sessionId || 'default',
      probabilities: obtenerDistribucionProbabilidades(mensajeUsuario, pipeline)
    };
  }

  // 4. Slots completos: Ejecutar Action Handler si existe
  let datosAccion: any = null;
  let customReply: string | null = null;

  if (defIntencion.action && actionHandler) {
    try {
      const resAction = await actionHandler({
        action: defIntencion.action,
        intent: intencionDetectada || 'UNKNOWN',
        slots: { ...sesion.contexto },
        sessionId: sesion.sessionId || 'default',
        session: sesion,
        mensaje: mensajeUsuario,
        buscarBaseDatos: (query: string, limite: number = 5) =>
          indiceVectorial ? indiceVectorial.buscar(query, limite) : [],
        baseDatos: baseDatos
      });

      if (resAction) {
        if (resAction.data) datosAccion = resAction.data;
        if (resAction.datos) {
          datosAccion = resAction.datos;
          sesion.contexto.datos = resAction.datos;
          sesion.contexto.api = resAction.datos;
        }
        if (resAction.api) {
          datosAccion = resAction.api;
          sesion.contexto.api = resAction.api;
          sesion.contexto.datos = resAction.api;
        }
        if (resAction.db) inyectarItemDbEnContexto(resAction.db, sesion.contexto);
        if (resAction.reply) customReply = resAction.reply;
      }
    } catch (err) {
      console.error(`[IaConia] Error ejecutando action '${defIntencion.action}':`, err);
    }
  }

  // 6. Formatear respuesta final
  let respuestaFinal: string;
  if (customReply) {
    respuestaFinal = formatearRespuesta(customReply, sesion.contexto);
  } else if (defIntencion.respuestas && defIntencion.respuestas.length > 0) {
    const plantillaElegida =
      defIntencion.respuestas[Math.floor(Math.random() * defIntencion.respuestas.length)];
    respuestaFinal = formatearRespuesta(plantillaElegida, sesion.contexto);
  } else if (intencionDetectada) {
    const plantillaIntencion =
      mensajesPorDefecto?.intencionProcesada || MENSAJES_DEFAULT.intencionProcesada;
    respuestaFinal = plantillaIntencion.replaceAll('{intencion}', intencionDetectada);
  } else {
    respuestaFinal =
      mensajesPorDefecto?.noEntendido || MENSAJES_DEFAULT.noEntendido;
  }

  const latencyMs = Math.round((performance.now() - tInicio) * 100) / 100;
  sesion.registrarMensajeBot(respuestaFinal, { intent: intencionDetectada });

  // Limpiar slots temporales del contexto para serialización
  const slotsLimpios: Record<string, any> = {};
  for (const [k, v] of Object.entries(sesion.contexto)) {
    if (!k.startsWith('_') && !k.startsWith('slot.') && !k.startsWith('slots.')) {
      slotsLimpios[k] = v;
    }
  }

  return {
    reply: respuestaFinal,
    messages: [respuestaFinal],
    intent: intencionDetectada || 'UNKNOWN',
    confidencePct: Math.round(confianza * 1000) / 10,
    confidence: confianza,
    method: metodo,
    slots: slotsLimpios,
    slotsRequeridos,
    action: defIntencion.action || null,
    latencyMs,
    sessionId: sesion.sessionId || 'default',
    data: datosAccion,
    sugerencias: defIntencion.sugerencias || [],
    probabilities: obtenerDistribucionProbabilidades(mensajeUsuario, pipeline)
  };
}
