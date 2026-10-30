import { BaseConocimiento, EsquemaSlots, PesosSerializados, ProbabilidadIntencion } from '../types.js';

// =====================================================================
// UTILIDADES DIFUSAS (CORRECTOR DE ERRORES ORTOGRÁFICOS Y LETRAS)
// =====================================================================

/**
 * 🔤 Corrector de Letras (Distancia de Levenshtein):
 * Cuenta cuántas letras hay que cambiar, agregar o quitar para transformar una palabra en otra.
 * Ejemplo: De "ola" a "hola" hay solo 1 letra de diferencia.
 */
export function calcularLevenshtein(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  let v0 = new Int32Array(s2.length + 1);
  let v1 = new Int32Array(s2.length + 1);

  for (let i = 0; i <= s2.length; i++) {
    v0[i] = i;
  }

  for (let i = 0; i < s1.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= s2.length; j++) {
      v0[j] = v1[j];
    }
  }

  return v0[s2.length];
}

/**
 * 🎯 Medidor de Parecido (0% a 100%):
 * Convierte la diferencia de letras en un porcentaje claro.
 * Ejemplo: "canselasion" y "cancelacion" tienen un parecido muy alto (~90%).
 */
export function fuzzRatio(s1: string, s2: string): number {
  const str1 = String(s1 || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const str2 = String(s2 || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!str1 && !str2) return 100;
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 100;

  const maxLen = Math.max(str1.length, str2.length);
  const dist = calcularLevenshtein(str1, str2);
  return Math.round((1 - dist / maxLen) * 100);
}

/**
 * 🔄 Comparador sin importar el orden:
 * Ordena las palabras alfabéticamente antes de comparar.
 * Ejemplo: Entiende que "pizza pepperoni" y "pepperoni pizza" significan exactamente lo mismo (100%).
 */
export function fuzzTokenSortRatio(s1: string, s2: string): number {
  const t1 = String(s1 || '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
  const t2 = String(s2 || '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
  return fuzzRatio(t1, t2);
}

/**
 * 🧩 Detector de ideas clave:
 * Compara las palabras principales ignorando palabras de relleno o repetidas.
 * Permite que una frase corta de entrenamiento como "hola amigo" coincida con "hola amigo como estas".
 */
export function fuzzTokenSetRatio(s1: string, s2: string): number {
  const set1 = new Set(String(s1 || '').toLowerCase().split(/\s+/).filter(Boolean));
  const set2 = new Set(String(s2 || '').toLowerCase().split(/\s+/).filter(Boolean));

  const intersection = Array.from(set1).filter(x => set2.has(x)).sort().join(' ');
  const diff1 = Array.from(set1).filter(x => !set2.has(x)).sort().join(' ');
  const diff2 = Array.from(set2).filter(x => !set1.has(x)).sort().join(' ');

  const sInter = intersection.trim();
  const sCombined1 = [sInter, diff1].filter(Boolean).join(' ').trim();
  const sCombined2 = [sInter, diff2].filter(Boolean).join(' ').trim();

  let maxScore = fuzzRatio(s1, s2);
  if (sInter) {
    maxScore = Math.max(maxScore, fuzzRatio(sInter, sCombined1), fuzzRatio(sInter, sCombined2));
  }
  return maxScore;
}

// =====================================================================
// VECTORIZADOR TF-IDF (EL TRADUCTOR DE PALABRAS A NÚMEROS)
// =====================================================================

/**
 * 📖 El Traductor de Texto a Números:
 * Las computadoras no leen palabras, leen números.
 * Esta clase analiza todas las frases de entrenamiento y arma un vocabulario
 * donde a cada palabra le asigna un "peso" numérico según qué tan importante y única es.
 */
export class VectorizadorTfidf {
  public vocabulario: Map<string, number> = new Map();
  public idf: Float32Array = new Float32Array(0);
  public totalDocs: number = 0;

  /**
   * Corta una frase en pedacitos: palabras individuales y parejas de palabras.
   * También limpia acentos para que "cuánto" coincida con "cuanto".
   * Ejemplo: "¿Cuánto cuesta?" -> ["cuanto", "cuesta", "cuanto cuesta"]
   */
  private extraerTokens(texto: string): string[] {
    const sinTildes = (texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const palabras = sinTildes.match(/[a-z0-9]+/g) || [];
    const ngrams: string[] = [];

    for (let i = 0; i < palabras.length; i++) {
      ngrams.push(palabras[i]);
      if (i + 1 < palabras.length) {
        ngrams.push(`${palabras[i]} ${palabras[i + 1]}`);
      }
    }
    return ngrams;
  }

  /**
   * Proceso de Aprendizaje del Vocabulario:
   * Lee todas las frases de la base de conocimiento y calcula qué palabras
   * son muy valiosas (ej: "factura", "pedido") y cuáles son poco útiles porque
   * se repiten en todos lados (ej: "el", "de", "un").
   */
  public fit(documentos: string[]): this {
    this.totalDocs = documentos.length;
    this.vocabulario.clear();

    const dfMap: Map<string, number> = new Map();

    for (const doc of documentos) {
      const tokens = this.extraerTokens(doc);
      const vistos = new Set(tokens);
      for (const t of vistos) {
        dfMap.set(t, (dfMap.get(t) || 0) + 1);
      }
    }

    let indice = 0;
    for (const [token] of dfMap) {
      this.vocabulario.set(token, indice++);
    }

    const vocabSize = this.vocabulario.size;
    this.idf = new Float32Array(vocabSize);

    for (const [token, idx] of this.vocabulario) {
      const df = dfMap.get(token) || 1;
      // Fórmula estándar scikit-learn: ln((1 + N) / (1 + df)) + 1
      this.idf[idx] = Math.log((1 + this.totalDocs) / (1 + df)) + 1.0;
    }

    return this;
  }

  /**
   * Traducir mensaje a Números:
   * Toma el mensaje nuevo del usuario y lo transforma en un "código de barras numérico"
   * según las palabras del vocabulario que contiene.
   */
  public transform(texto: string): { indices: number[]; valores: Float32Array; nnz: number } {
    const tokens = this.extraerTokens(texto);
    const tfMap: Map<number, number> = new Map();

    for (const t of tokens) {
      const idx = this.vocabulario.get(t);
      if (idx !== undefined) {
        tfMap.set(idx, (tfMap.get(idx) || 0) + 1);
      }
    }

    const nnz = tfMap.size;
    if (nnz === 0) {
      return { indices: [], valores: new Float32Array(0), nnz: 0 };
    }

    const indices = Array.from(tfMap.keys());
    const valores = new Float32Array(nnz);
    let sumaCuadrados = 0;

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const count = tfMap.get(idx)!;
      // Sublinear tf: 1 + ln(count)
      const tf = 1 + Math.log(count);
      const tfidf = tf * this.idf[idx];
      valores[i] = tfidf;
      sumaCuadrados += tfidf * tfidf;
    }

    // Normalización L2
    const norma = Math.sqrt(sumaCuadrados) || 1.0;
    for (let i = 0; i < nnz; i++) {
      valores[i] /= norma;
    }

    return { indices, valores, nnz };
  }
}

// =====================================================================
// REGRESIÓN LOGÍSTICA (LA RED NEURONAL MATEMÁTICA / MACHINE LEARNING)
// =====================================================================

/**
 * 🧠 La Red Neuronal Matemática:
 * Es el modelo de Machine Learning en sí.
 * Aprende qué palabras pertenecen a cada intención y calcula con qué porcentaje
 * de seguridad el usuario está pidiendo cada cosa.
 */
export class RegresionLogistica {
  public clases: string[] = [];
  public pesos: Float32Array[] = []; // [numClases][vocabSize]
  public sesgos: Float32Array = new Float32Array(0);

  /**
   * Proceso de Aprendizaje (Entrenamiento):
   * Ajusta miles de "perillas" matemáticas (pesos) en memoria RAM para que cuando
   * vea palabras de saludo apunte hacia "saludo", y cuando vea palabras de dinero apunte a "precios".
   * Tarda menos de 3 milisegundos en completarse.
   */
  public fit(
    muestras: Array<{ indices: number[]; valores: Float32Array }>,
    etiquetas: string[],
    vocabSize: number,
    clasesUnicas: string[]
  ): void {
    this.clases = clasesUnicas;
    const K = this.clases.length;
    const N = muestras.length;

    this.pesos = Array.from({ length: K }, () => new Float32Array(vocabSize));
    this.sesgos = new Float32Array(K);

    if (K <= 1 || N === 0) return;

    const labelIndices = etiquetas.map(l => this.clases.indexOf(l));
    const learningRate = 0.25;
    const epochs = 250;
    const lambda = 0.0005; // Regularización L2

    const scores = new Float32Array(K);
    const probs = new Float32Array(K);

    // Entrenamiento mediante Gradient Descent
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = 0; i < N; i++) {
        const { indices, valores } = muestras[i];
        const target = labelIndices[i];

        // Calcular z = Wx + b
        let maxScore = -Infinity;
        for (let k = 0; k < K; k++) {
          let dot = this.sesgos[k];
          const wK = this.pesos[k];
          for (let m = 0; m < indices.length; m++) {
            dot += wK[indices[m]] * valores[m];
          }
          scores[k] = dot;
          if (dot > maxScore) maxScore = dot;
        }

        // Softmax estable
        let sumExp = 0;
        for (let k = 0; k < K; k++) {
          probs[k] = Math.exp(scores[k] - maxScore);
          sumExp += probs[k];
        }
        for (let k = 0; k < K; k++) {
          probs[k] /= sumExp;
        }

        // Actualización de gradientes
        for (let k = 0; k < K; k++) {
          const error = probs[k] - (k === target ? 1.0 : 0.0);
          this.sesgos[k] -= learningRate * error;
          const wK = this.pesos[k];
          for (let m = 0; m < indices.length; m++) {
            const idx = indices[m];
            const grad = error * valores[m] + lambda * wK[idx];
            wK[idx] -= learningRate * grad;
          }
        }
      }
    }
  }

  /**
   * Predecir porcentajes de probabilidad:
   * Evalúa el código numérico del mensaje y reparte probabilidades entre todas las intenciones.
   * Ejemplo: 98% Saludo, 1.5% Ayuda, 0.5% Despedida.
   */
  public predictProba(indices: number[], valores: Float32Array): Float32Array {
    const K = this.clases.length;
    const probs = new Float32Array(K);
    if (K === 0) return probs;

    let maxScore = -Infinity;
    for (let k = 0; k < K; k++) {
      let dot = this.sesgos[k];
      const wK = this.pesos[k];
      for (let m = 0; m < indices.length; m++) {
        dot += wK[indices[m]] * valores[m];
      }
      probs[k] = dot;
      if (dot > maxScore) maxScore = dot;
    }

    let sumExp = 0;
    for (let k = 0; k < K; k++) {
      probs[k] = Math.exp(probs[k] - maxScore);
      sumExp += probs[k];
    }
    for (let k = 0; k < K; k++) {
      probs[k] /= sumExp;
    }

    return probs;
  }
}

// =====================================================================
// ORQUESTADOR Y MOTOR DE INFERENCIA
// =====================================================================

export interface PipelineEntrenado {
  vectorizador: VectorizadorTfidf;
  clasificador: RegresionLogistica;
  catalogoIntenciones: Record<string, any>;
  frasesReferencia: Array<{ frase: string; intencion: string }>;
  palabrasVacias: Set<string>;
  unigramasLargos: string[];
  tieneFueraDominio: boolean;
  huella: string;
}

export interface OpcionesEntrenamiento {
  ejemplosFueraDominio?: string[];
  palabrasVacias?: string[];
  pesosGuardados?: PesosSerializados;
}

export const COBERTURA_MINIMA_DEFAULT = 0.34;

export const PALABRAS_VACIAS_DEFAULT: string[] = [
  'a', 'al', 'ante', 'con', 'como', 'de', 'del', 'e', 'el', 'en', 'es', 'esa', 'ese', 'eso', 'esta', 'este', 'esto',
  'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'muy', 'nos', 'o', 'para', 'por', 'que', 'se',
  'su', 'sus', 'te', 'tu', 'tus', 'u', 'un', 'una', 'unas', 'unos', 'y', 'ya'
];

function calcularHuella(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function floatABase64(valores: Float32Array): string {
  const bytes = new Uint8Array(valores.buffer, valores.byteOffset, valores.byteLength);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

function base64AFloat(texto: string): Float32Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

/**
 * 💾 Serializa el vocabulario y los pesos para restaurarlos sin volver a entrenar.
 */
export function serializarPesos(pipeline: PipelineEntrenado): PesosSerializados {
  const { vectorizador, clasificador, huella } = pipeline;
  return {
    huella,
    vocabulario: Array.from(vectorizador.vocabulario.keys()),
    idf: floatABase64(vectorizador.idf),
    totalDocs: vectorizador.totalDocs,
    clases: clasificador.clases,
    pesos: clasificador.pesos.map(floatABase64),
    sesgos: floatABase64(clasificador.sesgos)
  };
}

/**
 * 🎓 El Entrenador General:
 * Toma todas las neuronas (intenciones), sus frases de ejemplo y variables fijas,
 * construye el vocabulario numérico y entrena la red neuronal en memoria RAM en milisegundos.
 */
export function entrenarClasificador(
  baseConocimiento: BaseConocimiento,
  esquemaSlots?: EsquemaSlots,
  opciones?: OpcionesEntrenamiento
): PipelineEntrenado {
  const textos: string[] = [];
  const etiquetas: string[] = [];
  const catalogoIntenciones: Record<string, any> = {};
  const frasesReferencia: Array<{ frase: string; intencion: string }> = [];

  // Mapeo de constantes
  const constantes: Record<string, string> = {};
  if (esquemaSlots) {
    for (const [k, v] of Object.entries(esquemaSlots)) {
      if (v.tipo === 'constante' && v.valor && String(v.valor).trim()) {
        constantes[k] = String(v.valor).trim();
      }
    }
  }

  for (const item of baseConocimiento) {
    const intension = item.intension;
    if (!intension) continue;
    catalogoIntenciones[intension] = item;

    for (const frase of item.expresiones || []) {
      textos.push(frase);
      etiquetas.push(intension);
      frasesReferencia.push({ frase, intencion: intension });

      // Expansión de variables constantes
      if (frase.includes('{') && frase.includes('}') && Object.keys(constantes).length > 0) {
        let fraseExpandida = frase;
        for (const [cK, cV] of Object.entries(constantes)) {
          fraseExpandida = fraseExpandida
            .replaceAll(`{slot.${cK}}`, cV)
            .replaceAll(`{slots.${cK}}`, cV)
            .replaceAll(`{${cK}}`, cV);
        }
        if (fraseExpandida !== frase) {
          textos.push(fraseExpandida);
          etiquetas.push(intension);
          frasesReferencia.push({ frase: fraseExpandida, intencion: intension });
        }
      }
    }
  }

  if (textos.length === 0) {
    throw new Error('La base de conocimiento no contiene frases de entrenamiento.');
  }

  // Los ejemplos negativos entrenan el rechazo, pero no participan como referencia difusa
  const ejemplosFueraDominio = (opciones?.ejemplosFueraDominio || []).map(e => e.trim()).filter(Boolean);
  for (const ejemplo of ejemplosFueraDominio) {
    textos.push(ejemplo);
    etiquetas.push('__desconocido__');
  }

  // Clase sintética si solo hay 1 intención registrada
  const clasesUnicas = Array.from(new Set(etiquetas));
  if (clasesUnicas.length === 1) {
    textos.push('_background_noise_synthetic_');
    etiquetas.push('__desconocido__');
    clasesUnicas.push('__desconocido__');
  }

  const huella = calcularHuella(JSON.stringify([textos, etiquetas]));
  const vectorizador = new VectorizadorTfidf();
  const clasificador = new RegresionLogistica();
  const guardados = opciones?.pesosGuardados;

  // Solo se reutilizan pesos entrenados con exactamente las mismas frases
  if (guardados && guardados.huella === huella) {
    guardados.vocabulario.forEach((token, i) => vectorizador.vocabulario.set(token, i));
    vectorizador.idf = base64AFloat(guardados.idf);
    vectorizador.totalDocs = guardados.totalDocs;
    clasificador.clases = guardados.clases;
    clasificador.pesos = guardados.pesos.map(base64AFloat);
    clasificador.sesgos = base64AFloat(guardados.sesgos);
  } else {
    vectorizador.fit(textos);
    const muestras = textos.map(t => vectorizador.transform(t));
    clasificador.fit(muestras, etiquetas, vectorizador.vocabulario.size, clasesUnicas);
  }

  return {
    vectorizador,
    clasificador,
    catalogoIntenciones,
    frasesReferencia,
    palabrasVacias: new Set(opciones?.palabrasVacias || PALABRAS_VACIAS_DEFAULT),
    unigramasLargos: Array.from(vectorizador.vocabulario.keys()).filter(t => !t.includes(' ') && t.length >= 5),
    tieneFueraDominio: ejemplosFueraDominio.length > 0,
    huella
  };
}

/**
 * 📏 Cobertura de vocabulario:
 * Cuenta cuántas palabras con contenido del mensaje conoce el modelo.
 * En modo tolerante también acepta palabras parecidas, para no castigar errores ortográficos.
 */
function medirCobertura(
  texto: string,
  pipeline: PipelineEntrenado,
  tolerante: boolean = false
): { conocidas: number; total: number } {
  const palabras = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
  const contenido = palabras.filter(p => !pipeline.palabrasVacias.has(p));
  const parecidas: Map<string, boolean> = new Map();

  let conocidas = 0;
  for (const palabra of contenido) {
    if (pipeline.vectorizador.vocabulario.has(palabra)) {
      conocidas++;
    } else if (tolerante && palabra.length >= 5) {
      let parecida = parecidas.get(palabra);
      if (parecida === undefined) {
        parecida = pipeline.unigramasLargos.some(u => fuzzRatio(palabra, u) >= 82);
        parecidas.set(palabra, parecida);
      }
      if (parecida) conocidas++;
    }
  }
  return { conocidas, total: contenido.length };
}

function superaCobertura(cobertura: { conocidas: number; total: number }, minima: number): boolean {
  return minima <= 0 || cobertura.total === 0 || cobertura.conocidas / cobertura.total >= minima;
}

/**
 * 🕵️‍♂️ El Juez y Detective de Intenciones:
 * Decide qué quiso decir el usuario pasando el mensaje por 3 filtros de seguridad:
 * 1. Red Neuronal: Si la IA está muy segura (>48%), gana directamente.
 * 2. Ventanas de texto: Si el usuario mandó un párrafo largo, busca la orden escondida en él.
 * 3. Red de seguridad difusa: Si el usuario escribió con muchas faltas de ortografía,
 *    busca la frase más parecida usando el corrector ortográfico de Levenshtein.
 */
export function clasificarTexto(
  mensajeUsuario: string,
  pipeline: PipelineEntrenado,
  umbralMl: number = 0.48,
  umbralFuzzy: number = 78,
  coberturaMinima: number = 0
): { intencion: string | null; confianza: number; metodo: 'ml' | 'ml-ngram' | 'fuzzy' | 'ninguno' } {
  if (!mensajeUsuario || !mensajeUsuario.trim()) {
    return { intencion: null, confianza: 0, metodo: 'ninguno' };
  }

  const textoLimpio = mensajeUsuario.trim();
  const { vectorizador, clasificador, frasesReferencia } = pipeline;

  // Fase 1: Inferencia directa ML completa
  try {
    const v = vectorizador.transform(textoLimpio);
    if (v.nnz > 0 && clasificador.clases.length > 0 && superaCobertura(medirCobertura(textoLimpio, pipeline), coberturaMinima)) {
      const probabilidades = clasificador.predictProba(v.indices, v.valores);
      let maxIdx = 0;
      let maxProb = 0;
      for (let i = 0; i < probabilidades.length; i++) {
        if (probabilidades[i] > maxProb) {
          maxProb = probabilidades[i];
          maxIdx = i;
        }
      }

      const mejorClase = clasificador.clases[maxIdx];
      const umbralDinamico = clasificador.clases.length > 1
        ? Math.max(umbralMl, 1.0 / clasificador.clases.length + 0.15)
        : umbralMl;

      if (mejorClase !== '__desconocido__' && maxProb >= umbralDinamico) {
        return { intencion: mejorClase, confianza: maxProb, metodo: 'ml' };
      }

      // Se parece más a un ejemplo negativo que a cualquier intención
      if (pipeline.tieneFueraDominio && mejorClase === '__desconocido__' && maxProb >= umbralDinamico) {
        return { intencion: null, confianza: 0, metodo: 'ninguno' };
      }
    }
  } catch {
    // Continuar a sub-ventanas
  }

  // Fase 1.1: Evaluación de sub-ventanas n-gramas para oraciones compuestas
  const palabras = textoLimpio.split(/\s+/).filter(Boolean);
  if (palabras.length > 3) {
    let mejorSubClase: string | null = null;
    let mejorSubConf = 0;

    for (let i = 0; i < palabras.length; i++) {
      for (let j = i + 2; j <= Math.min(i + 6, palabras.length); j++) {
        const subFragmento = palabras.slice(i, j).join(' ');
        const vSub = vectorizador.transform(subFragmento);
        if (vSub.nnz === 0) continue;

        // Una sola palabra conocida dentro de un párrafo no basta para decidir la intención
        if (coberturaMinima > 0) {
          const cSub = medirCobertura(subFragmento, pipeline);
          if (cSub.conocidas < 2 || cSub.conocidas / cSub.total < coberturaMinima) continue;
        }

        const probs = clasificador.predictProba(vSub.indices, vSub.valores);
        let localMax = 0;
        let localIdx = 0;
        for (let k = 0; k < probs.length; k++) {
          if (probs[k] > localMax) {
            localMax = probs[k];
            localIdx = k;
          }
        }
        const candClase = clasificador.clases[localIdx];
        if (candClase !== '__desconocido__' && localMax > mejorSubConf && localMax >= umbralMl) {
          mejorSubConf = localMax;
          mejorSubClase = candClase;
        }
      }
    }

    if (mejorSubClase) {
      return { intencion: mejorSubClase, confianza: mejorSubConf, metodo: 'ml-ngram' };
    }
  }

  // Fase 2: Respaldo Fuzzy con Levenshtein y sub-tokens
  if (!superaCobertura(medirCobertura(textoLimpio, pipeline, true), coberturaMinima)) {
    return { intencion: null, confianza: 0, metodo: 'ninguno' };
  }

  let maxSimilitud = 0;
  let mejorMatch: string | null = null;
  const msgClean = textoLimpio.toLowerCase();
  const tokensMsg = msgClean.match(/[a-záéíóúñü0-9]+/g) || [];

  for (const { frase: fraseRef, intencion: etiquetaRef } of frasesReferencia) {
    if (etiquetaRef === '__desconocido__') continue;

    const refClean = fraseRef.toLowerCase().trim();
    const tokensRef = refClean.match(/[a-záéíóúñü0-9]+/g) || [];

    const rSet = fuzzTokenSetRatio(msgClean, refClean);
    const rSort = fuzzTokenSortRatio(msgClean, refClean);
    let similitud = rSet * 0.45 + rSort * 0.55;

    // Coincidencia de palabra clave única
    if (tokensRef.length === 1 && tokensMsg.length > 0) {
      const tokSim = Math.max(...tokensMsg.map(t => fuzzRatio(t, refClean)));
      if (tokSim >= 88 && tokSim > similitud) {
        similitud = tokSim;
      }
    }

    // Coincidencia de sub-ventanas
    if (tokensRef.length > 1 && tokensMsg.length >= tokensRef.length) {
      const k = tokensRef.length;
      for (let i = 0; i <= tokensMsg.length - k; i++) {
        const chunk = tokensMsg.slice(i, i + k).join(' ');
        const chunkSim = fuzzRatio(chunk, refClean);
        if (chunkSim > similitud) {
          similitud = chunkSim;
        }
      }
    }

    // Coincidencia difusa de palabras clave (rescate de errores tipográficos en palabras significativas >= 5 letras)
    if (tokensMsg.length > 0 && tokensRef.length > 0) {
      for (const tMsg of tokensMsg) {
        if (tMsg.length >= 5) {
          for (const tRef of tokensRef) {
            // Una palabra idéntica no es un error tipográfico: no debe valer 100% por sí sola
            if (tRef.length >= 5 && tMsg !== tRef) {
              const tokSim = fuzzRatio(tMsg, tRef);
              if (tokSim > similitud) {
                similitud = tokSim;
              }
            }
          }
        }
      }
    }

    if (similitud > maxSimilitud) {
      maxSimilitud = similitud;
      mejorMatch = etiquetaRef;
    }
  }

  if (maxSimilitud >= umbralFuzzy && mejorMatch) {
    return { intencion: mejorMatch, confianza: maxSimilitud / 100.0, metodo: 'fuzzy' };
  }

  return { intencion: null, confianza: 0, metodo: 'ninguno' };
}

/**
 * 📊 Ranking de Probabilidades:
 * Devuelve la lista ordenada con los porcentajes de certeza de cada neurona
 * (ideal para mostrar barras de progreso o telemetría en pantalla).
 */
export function obtenerDistribucionProbabilidades(
  texto: string,
  pipeline: PipelineEntrenado,
  limite: number = 5
): ProbabilidadIntencion[] {
  try {
    const v = pipeline.vectorizador.transform(texto);
    if (v.nnz === 0) return [];
    const probs = pipeline.clasificador.predictProba(v.indices, v.valores);
    const ranking: ProbabilidadIntencion[] = pipeline.clasificador.clases.map((intent, i) => ({
      intent,
      probability: Math.round(probs[i] * 10000) / 10000
    }));

    ranking.sort((a, b) => b.probability - a.probability);
    return ranking.slice(0, limite);
  } catch {
    return [];
  }
}
