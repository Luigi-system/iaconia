import { VectorizadorTfidf, fuzzRatio } from './classifier.js';

export function removerTildes(texto: string): string {
  if (!texto) return '';
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizarRaizEs(palabra: string): string {
  const w = removerTildes(palabra).toLowerCase().trim();
  if (w.length <= 3) return w;
  if (w.endsWith('es') && w.length > 4) {
    return w.slice(0, -2);
  }
  if (w.endsWith('s') && w.length > 3) {
    return w.slice(0, -1);
  }
  return w;
}

export function esTokenCompatible(t1: string, t2: string): boolean {
  const n1 = removerTildes(t1).toLowerCase().trim();
  const n2 = removerTildes(t2).toLowerCase().trim();
  if (n1 === n2) return true;

  if (n1.length >= 3 && n2.length >= 3) {
    const r1 = normalizarRaizEs(n1);
    const r2 = normalizarRaizEs(n2);
    if (r1 === r2) return true;

    const minL = Math.min(r1.length, r2.length);
    const maxL = Math.max(r1.length, r2.length);
    if (minL >= 4 && minL / maxL >= 0.72 && (r1.startsWith(r2) || r2.startsWith(r1))) {
      return true;
    }
    if (fuzzRatio(n1, n2) >= 78) {
      return true;
    }
  }
  return false;
}

export const CAMPOS_IGNORADOS_DB_DEFAULT = ['id', '_id', 'fecha_creacion', 'created_at'];

function extraerTextoRecursivo(obj: any, camposIgnorados?: string[]): string[] {
  const textos: string[] = [];
  if (!obj) return textos;

  const ignorados = (camposIgnorados && camposIgnorados.length > 0)
    ? camposIgnorados
    : CAMPOS_IGNORADOS_DB_DEFAULT;

  if (Array.isArray(obj)) {
    for (const elem of obj) {
      textos.push(...extraerTextoRecursivo(elem, ignorados));
    }
  } else if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const kLower = k.toLowerCase();
      if (!ignorados.includes(kLower)) {
        textos.push(kLower);
      }
      textos.push(...extraerTextoRecursivo(v, ignorados));
    }
  } else if (typeof obj !== 'boolean') {
    const val = String(obj).trim().toLowerCase();
    if (val) textos.push(val);
  }

  return textos;
}

function extraerTextoJson(registro: any, camposIgnorados?: string[]): string {
  const textos = extraerTextoRecursivo(registro, camposIgnorados);
  const raices: string[] = [];

  for (const txt of textos) {
    const matches = txt.match(/[a-záéíóúñü0-9]+/gi) || [];
    for (const m of matches) {
      const r = normalizarRaizEs(m);
      if (r !== m.toLowerCase()) {
        raices.push(r);
      }
    }
  }

  const todo = [...textos, ...raices].join(' ');
  const palabras = todo.match(/[a-záéíóúñü0-9]+/gi) || [];
  return palabras.join(' ').trim();
}

export class VectorDatabaseIndex {
  public vectorizador: VectorizadorTfidf | null = null;
  public registros: any[] = [];
  public documentosTexto: string[] = [];
  public vectores: Array<{ indices: number[]; valores: Float32Array; nnz: number }> = [];
  public camposIgnorados: string[];

  constructor(registros?: any[], camposIgnorados?: string[]) {
    this.camposIgnorados = (camposIgnorados && camposIgnorados.length > 0)
      ? camposIgnorados.map(c => c.toLowerCase())
      : [...CAMPOS_IGNORADOS_DB_DEFAULT];

    if (registros && registros.length > 0) {
      this.indexar(registros);
    }
  }

  public indexar(registros: any[]): void {
    this.registros = Array.isArray(registros) ? [...registros] : [];
    if (this.registros.length === 0) {
      this.vectorizador = null;
      this.documentosTexto = [];
      this.vectores = [];
      return;
    }

    this.documentosTexto = this.registros.map(r => extraerTextoJson(r, this.camposIgnorados));
    this.vectorizador = new VectorizadorTfidf().fit(this.documentosTexto);
    this.vectores = this.documentosTexto.map(doc => this.vectorizador!.transform(doc));
  }

  public buscarConScores(
    query: string,
    limite: number = 5,
    umbralMinimo: number = 0.18,
    tokensIgnorar?: Set<string> | string[]
  ): Array<{ item: any; score: number }> {
    if (!query || !this.vectorizador || this.registros.length === 0) {
      return [];
    }

    const qClean = query.trim().toLowerCase();
    const qTokens = (qClean.match(/[a-záéíóúñü0-9]+/gi) || []).filter(t => {
      if (!tokensIgnorar) return true;
      if (tokensIgnorar instanceof Set) return !tokensIgnorar.has(t);
      return !tokensIgnorar.includes(t);
    });

    if (qTokens.length === 0) return [];

    const vQuery = this.vectorizador.transform(qTokens.join(' '));
    if (vQuery.nnz === 0) {
      // Fallback difuso
      const resultadosDifusos: Array<{ item: any; score: number }> = [];
      for (let i = 0; i < this.registros.length; i++) {
        const docText = this.documentosTexto[i];
        let matchCount = 0;
        for (const qt of qTokens) {
          if (docText.includes(qt) || esTokenCompatible(qt, docText)) {
            matchCount++;
          }
        }
        if (matchCount > 0) {
          const score = matchCount / qTokens.length;
          if (score >= umbralMinimo) {
            resultadosDifusos.push({ item: this.registros[i], score });
          }
        }
      }
      resultadosDifusos.sort((a, b) => b.score - a.score);
      return resultadosDifusos.slice(0, limite);
    }

    // Similitud Coseno con matriz dispersa
    const resultados: Array<{ item: any; score: number }> = [];
    const queryMap = new Map<number, number>();
    for (let i = 0; i < vQuery.indices.length; i++) {
      queryMap.set(vQuery.indices[i], vQuery.valores[i]);
    }

    for (let i = 0; i < this.vectores.length; i++) {
      const vDoc = this.vectores[i];
      let dot = 0;
      for (let j = 0; j < vDoc.indices.length; j++) {
        const qVal = queryMap.get(vDoc.indices[j]);
        if (qVal !== undefined) {
          dot += qVal * vDoc.valores[j];
        }
      }

      // Bonus morfológico si tokens de la consulta coinciden exactamente
      let bonus = 0;
      const docText = this.documentosTexto[i];
      for (const qt of qTokens) {
        if (qt.length >= 3 && docText.includes(qt)) {
          bonus += 0.05;
        }
      }

      const finalScore = Math.min(1.0, dot + bonus);
      if (finalScore >= umbralMinimo) {
        resultados.push({ item: this.registros[i], score: finalScore });
      }
    }

    resultados.sort((a, b) => b.score - a.score);
    return resultados.slice(0, limite);
  }

  public buscar(
    query: string,
    limite: number = 5,
    umbralMinimo: number = 0.18,
    tokensIgnorar?: Set<string> | string[]
  ): any[] {
    return this.buscarConScores(query, limite, umbralMinimo, tokensIgnorar).map(r => r.item);
  }
}
