import { EsquemaSlot, EsquemaSlots, FormatoTexto, SlotTipo } from '../types.js';
import { fuzzRatio, fuzzTokenSetRatio } from './classifier.js';

export function limpiarPuntuacion(t: string): string {
  return (t || '').replace(/^[¡¿\s,.:;!?"']+|[¡¿\s,.:;!?"']+$/g, '').trim();
}

export function darFormato(valor: any, fmt?: FormatoTexto): string {
  if (valor === undefined || valor === null) return '';
  const str = String(valor).trim();
  if (!fmt) return str;

  if (fmt === 'title') {
    return str.replace(/\b\w+/g, txt => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
  } else if (fmt === 'upper') {
    return str.toUpperCase();
  } else if (fmt === 'lower') {
    return str.toLowerCase();
  }
  return str;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =====================================================================
// DEDUCCIÓN AGNOSTA DEL TIPO DE SLOT (POR ESTRUCTURA DE CONFIGURACIÓN)
// =====================================================================

export function resolverTipoSlot(config: EsquemaSlot): SlotTipo {
  if (config.tipo) return config.tipo;
  if (config.regex) return 'regex';
  if (config.opciones && Array.isArray(config.opciones)) return 'catalogo';
  if (config.valor !== undefined) return 'constante';
  return 'texto';
}

// =====================================================================
// ESTRATEGIAS MATEMÁTICAS / ALGORÍTMICAS PURAS
// =====================================================================

/**
 * 1. Constante: Retorna el valor estático provisto en la configuración.
 */
export function estrategiaConstante(_texto: string, config: EsquemaSlot): string | undefined {
  return config.valor;
}

/**
 * 2. Catálogo: Coincidencia exacta de palabras y fuzzy matching sobre las opciones dadas.
 */
export function estrategiaCatalogo(
  texto: string,
  config: EsquemaSlot,
  _esRespuestaDirecta: boolean = false
): string | null {
  const opciones = config.opciones || [];
  if (opciones.length === 0) return null;

  const tClean = texto.trim().toLowerCase();

  // 1. Coincidencia exacta por límite de palabra
  for (const item of opciones) {
    const itemStr = String(item).trim();
    if (!itemStr) continue;
    const regex = new RegExp(`\\b${escapeRegex(itemStr.toLowerCase())}\\b`, 'i');
    if (regex.test(tClean)) {
      return itemStr;
    }
  }

  // 2. Coincidencia difusa ponderada (Fuzzy token_set_ratio)
  const umbral = config.umbral ?? 65;
  let mejorItem: string | null = null;
  let maxScore = 0;

  for (const item of opciones) {
    const itemStr = String(item).trim();
    if (!itemStr) continue;
    const score = fuzzTokenSetRatio(tClean, itemStr.toLowerCase());
    if (score > maxScore) {
      maxScore = score;
      mejorItem = itemStr;
    }
  }

  return maxScore >= umbral ? mejorItem : null;
}

/**
 * 3. Regex: Extracción por expresión regular declarada por el modelo o usuario.
 */
export function estrategiaRegex(
  texto: string,
  config: EsquemaSlot,
  esRespuestaDirecta: boolean = false
): string | null {
  const t = (texto || '').trim();
  if (!t) return null;

  // Procesar regex
  const regexList: RegExp[] = [];
  const rawRegex = config.regex;
  if (rawRegex) {
    const arr = Array.isArray(rawRegex) ? rawRegex : [rawRegex];
    for (const r of arr) {
      if (!r) continue;
      if (r instanceof RegExp) {
        regexList.push(r);
      } else {
        try {
          regexList.push(new RegExp(String(r), 'gi'));
        } catch {
          // Ignorar regex con sintaxis inválida
        }
      }
    }
  }

  // Soporte legacy de disparadores si no hay regex
  const disparadores = config.disparadores || [];
  if (disparadores.length > 0 && regexList.length === 0) {
    const palabras = texto.split(/\s+/).filter(Boolean);
    let mejorScore = 0;
    let posFinDisparador = -1;

    for (const disp of disparadores) {
      const dispPalabras = disp.split(/\s+/).filter(Boolean);
      const n = dispPalabras.length;
      const windowLens = n > 1 ? [n, n + 1] : [1];

      for (const wLen of windowLens) {
        for (let i = 0; i <= palabras.length - wLen; i++) {
          const ventana = palabras.slice(i, i + wLen).join(' ');
          const score = fuzzRatio(ventana.toLowerCase(), disp.toLowerCase());
          if (score >= 75 && score > mejorScore) {
            mejorScore = score;
            posFinDisparador = i + wLen;
          }
        }
      }
    }

    if (posFinDisparador !== -1 && posFinDisparador < palabras.length) {
      const resultado = palabras.slice(posFinDisparador).join(' ');
      if (resultado.trim().length > 0) {
        return darFormato(resultado, config.formato);
      }
    }
  }

  // Lista de palabras/frases a ignorar según la configuración
  const rawIgnorar = config.ignorar || config.bloqueados || [];
  const ignorarSet = new Set(
    (Array.isArray(rawIgnorar) ? rawIgnorar : Array.from(rawIgnorar))
      .map(b => String(b || '').toLowerCase().trim())
      .filter(Boolean)
  );

  const fmt = config.formato;

  // Evaluar cada regex
  for (const rx of regexList) {
    const flags = rx.flags.includes('g') ? rx.flags : rx.flags + 'g';
    const regex = new RegExp(rx.source, flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(t)) !== null) {
      let candidato: string | undefined;

      if (config.grupo !== undefined && match[config.grupo] !== undefined) {
        candidato = match[config.grupo];
      } else if (match[1] !== undefined) {
        candidato = match[1];
      } else {
        candidato = match[0];
      }

      if (candidato !== undefined && candidato !== null) {
        const valLimpio = String(candidato).trim();
        if (ignorarSet.has(valLimpio.toLowerCase())) {
          continue;
        }
        if (valLimpio.length > 0) {
          return darFormato(valLimpio, fmt);
        }
      }
    }
  }

  // Fallback para respuesta directa si el regex espera dígitos
  if (esRespuestaDirecta && regexList.some(r => r.source.includes('\\d'))) {
    const soloDigitos = t.replace(/\D/g, '');
    for (const rx of regexList) {
      try {
        const fullRegex = new RegExp(`^${rx.source}$`, rx.flags.replace('g', ''));
        if (fullRegex.test(soloDigitos)) {
          return darFormato(soloDigitos, fmt);
        }
      } catch {}
    }
  }

  return null;
}
export const estrategiaPatron = estrategiaRegex;

export const CONECTORES_DEFAULT: string[] = ['y', 'e', 'o', 'u', 'de', 'del', 'en', 'con', 'para', 'por', 'a'];

/**
 * 4. Texto: Extracción de texto libre aplicando las reglas de limpieza (ignorar) provistas.
 */
export function estrategiaTexto(
  texto: string,
  config: EsquemaSlot,
  esRespuestaDirecta: boolean = false,
  conectoresGlobales?: string[]
): string | null {
  const t = (texto || '').trim();
  if (!t) return null;

  // Consolidar palabras y frases a ignorar desde la configuración
  const rawIgnorar = config.ignorar || [];
  const rawBloq = config.bloqueados || [];
  const listaIgnorar = [
    ...(Array.isArray(rawIgnorar) ? rawIgnorar : []),
    ...(Array.isArray(rawBloq) ? rawBloq : Array.from(rawBloq))
  ];

  const bloqSet = new Set<string>();
  for (const item of listaIgnorar) {
    const s = String(item || '').toLowerCase().trim();
    if (!s) continue;
    bloqSet.add(s);
    // Si la frase ignorada tiene varias palabras (ej: "me llamo"),
    // agregar también cada palabra individual para cortar bloques contiguos
    const subPalabras = s.split(/\s+/).filter(Boolean);
    for (const sp of subPalabras) {
      if (sp.length > 1) {
        bloqSet.add(sp);
      }
    }
  }

  // Descartar si el texto completo coincide exactamente con un elemento ignorado
  const tLimpioRaw = limpiarPuntuacion(t).toLowerCase();
  if (bloqSet.has(tLimpioRaw)) return null;

  let tProcesado = t;

  // 1. Remover prefijos al inicio
  const prefijos = [...(config.prefijos || []), ...(config.ignorar || [])];
  for (const pref of prefijos) {
    if (!pref || pref.length < 2) continue;
    const regexPref = new RegExp(`^(?:${escapeRegex(String(pref))})\\s*`, 'i');
    tProcesado = tProcesado.replace(regexPref, '').trim();
  }

  // 2. Remover sufijos al final
  const sufijos = [...(config.sufijos || []), ...(config.ignorar || [])];
  for (const suf of sufijos) {
    if (!suf || suf.length < 2) continue;
    const regexSuf = new RegExp(`\\s*(?:${escapeRegex(String(suf))})$`, 'i');
    tProcesado = tProcesado.replace(regexSuf, '').trim();
  }

  let tLimpio = limpiarPuntuacion(tProcesado);

  // 3. Remover frases ignoradas multipalabra en cualquier parte
  if (bloqSet.size > 0) {
    const frases = Array.from(bloqSet).filter(b => b.includes(' ')).sort((a, b) => b.length - a.length);
    for (const frase of frases) {
      const rx = new RegExp(`\\b${escapeRegex(frase)}\\b`, 'gi');
      tLimpio = tLimpio.replace(rx, ' ');
    }
    tLimpio = limpiarPuntuacion(tLimpio);
  }

  // 4. Agrupar en islas / bloques contiguos de palabras válidas
  const tokens = tLimpio.split(/\s+/).filter(Boolean);
  const bloques: string[][] = [];
  let bloqueActual: string[] = [];

  for (const token of tokens) {
    const pLimpia = limpiarPuntuacion(token).toLowerCase();
    if (!pLimpia) continue;

    // Si la palabra está en ignorados, corta el bloque contiguo
    if (bloqSet.has(pLimpia) || bloqSet.has(token.toLowerCase())) {
      if (bloqueActual.length > 0) {
        bloques.push(bloqueActual);
        bloqueActual = [];
      }
    } else {
      bloqueActual.push(token);
    }
  }
  if (bloqueActual.length > 0) {
    bloques.push(bloqueActual);
  }

  // 5. Tomar el primer bloque contiguo válido (isla primaria)
  if (bloques.length > 0) {
    let primerBloque = bloques[0];

    // Limpiar conectores y conjunciones sueltas al final del bloque (configurable)
    const listaConectores = config.conectores || conectoresGlobales || CONECTORES_DEFAULT;
    const conectoresFinales = new Set(listaConectores.map(c => c.toLowerCase().trim()));
    while (
      primerBloque.length > 1 &&
      conectoresFinales.has(limpiarPuntuacion(primerBloque[primerBloque.length - 1]).toLowerCase())
    ) {
      primerBloque.pop();
    }

    const maxWords = esRespuestaDirecta ? 4 : 8;
    const res = primerBloque.slice(0, maxWords).join(' ').trim();
    if (res.length > 0) {
      return darFormato(res, config.formato);
    }
  }

  return null;
}

// =====================================================================
// EXTRACCIÓN GENERAL
// =====================================================================

export function extraerVariable(
  texto: string,
  _nombreSlot: string,
  config: EsquemaSlot,
  esRespuestaDirecta: boolean = false,
  conectoresGlobales?: string[]
): string | null {
  if (!texto || !config) return null;
  const tipo = resolverTipoSlot(config);

  switch (tipo) {
    case 'constante':
      return estrategiaConstante(texto, config) ?? null;
    case 'catalogo':
      return estrategiaCatalogo(texto, config, esRespuestaDirecta);
    case 'regex':
    case 'patron':
      return estrategiaRegex(texto, config, esRespuestaDirecta);
    case 'texto':
    default:
      return estrategiaTexto(texto, config, esRespuestaDirecta, conectoresGlobales);
  }
}

export function extraerTodosLosSlots(
  texto: string,
  esquema: EsquemaSlots,
  conectoresGlobales?: string[],
  omitirTexto: boolean = false
): Record<string, string> {
  const extraidos: Record<string, string> = {};
  if (!texto || !esquema) return extraidos;

  for (const [slotName, config] of Object.entries(esquema)) {
    const tipo = resolverTipoSlot(config);

    if (tipo === 'constante') {
      if (config.valor !== undefined && String(config.valor).trim() !== '') {
        extraidos[slotName] = String(config.valor).trim();
      }
      continue;
    }

    // El texto libre acepta casi cualquier frase: solo es confiable cuando se pidió ese dato
    if (omitirTexto && tipo === 'texto') continue;

    const valor = extraerVariable(texto, slotName, config, false, conectoresGlobales);
    if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
      extraidos[slotName] = String(valor).trim();
    }
  }

  return extraidos;
}
