import defaultModel from './presets/default-model.json' with { type: 'json' };
import {
  entrenarClasificador,
  clasificarTexto,
  obtenerDistribucionProbabilidades,
  PipelineEntrenado
} from './core/classifier.js';
import { resolverTurnoDialogo } from './core/dialog-manager.js';
import { SesionUsuario } from './core/session.js';
import { extraerTodosLosSlots } from './core/slot-extractor.js';
import { VectorDatabaseIndex } from './core/vector-db.js';
import {
  ActionHandler,
  BaseConocimiento,
  EsquemaSlot,
  EsquemaSlots,
  IaConiaConfig,
  IntencionDef,
  MensajesPorDefecto,
  ProbabilidadIntencion,
  ResultadoInferencia
} from './types.js';

export * from './types.js';
export { SesionUsuario } from './core/session.js';
export { VectorDatabaseIndex } from './core/vector-db.js';

/**
 * Motor de Inteligencia Artificial Conversacional (NLU) ultraligero y en memoria.
 * Ejecuta inferencia en el frontend en < 1ms y gestiona sesiones, slots y acciones.
 */
export class IaConia {
  public nombre: string;
  public baseConocimiento: BaseConocimiento;
  public esquemaSlots: EsquemaSlots;
  public baseDatos: any[];
  public umbralClasificacion: number;
  public umbralFuzzy: number;
  public mensajesPorDefecto: MensajesPorDefecto;
  public camposIgnoradosDb: string[];
  public conectoresTexto: string[];

  private pipeline: PipelineEntrenado | null = null;
  private indiceVectorial: VectorDatabaseIndex;
  private sesiones: Map<string, SesionUsuario> = new Map();
  private actionHandlers: Map<string, ActionHandler> = new Map();

  constructor(config?: IaConiaConfig) {
    this.nombre = config?.nombre || defaultModel.nombre || 'IaConia Assistant';
    this.baseConocimiento =
      config?.baseConocimiento ||
      ([...((defaultModel.baseConocimiento || (defaultModel as any).base_conocimiento) as BaseConocimiento)]);
    this.esquemaSlots =
      config?.esquemaSlots ||
      { ...((defaultModel.esquemaSlots || (defaultModel as any).esquema_slots) as EsquemaSlots) };
    this.baseDatos =
      config?.baseDatos ||
      [...((defaultModel.baseDatos || (defaultModel as any).base_datos) || [])];
    this.umbralClasificacion = config?.umbralClasificacion ?? 0.45;
    this.umbralFuzzy = config?.umbralFuzzy ?? 76;
    this.mensajesPorDefecto = config?.mensajesPorDefecto || (defaultModel as any).mensajesPorDefecto || {
      noEntendido: 'Disculpa, no logré comprender tu mensaje. ¿Podrías reformularlo de otra manera?',
      solicitarSlot: 'Por favor, indícame el valor para {slot}.',
      intencionProcesada: 'He procesado tu solicitud de **{intencion}**.'
    };
    this.camposIgnoradosDb = config?.camposIgnoradosDb || (defaultModel as any).camposIgnoradosDb || [
      'id', '_id', 'fecha_creacion', 'created_at'
    ];
    this.conectoresTexto = config?.conectoresTexto || (defaultModel as any).conectoresTexto || [
      'y', 'e', 'o', 'u', 'de', 'del', 'en', 'con', 'para', 'por', 'a'
    ];

    this.indiceVectorial = new VectorDatabaseIndex(this.baseDatos, this.camposIgnoradosDb);
    this.entrenar();
  }

  /**
   * Entrena o reentrena el modelo en memoria RAM con las frases actuales.
   * Tarda menos de 10ms en JavaScript.
   */
  public entrenar(): this {
    if (this.baseConocimiento && this.baseConocimiento.length > 0) {
      this.pipeline = entrenarClasificador(this.baseConocimiento, this.esquemaSlots);
    } else {
      this.pipeline = null;
    }
    return this;
  }

  /**
   * Registra un manejador para una acción específica disparada por el bot.
   * Permite consultar APIs externas, bases de datos remotas o ejecutar tareas en el cliente.
   */
  public onAction(action: string, handler: ActionHandler): this {
    this.actionHandlers.set(action, handler);
    return this;
  }

  /**
   * Obtiene o inicializa la sesión conversacional para un usuario o pestaña.
   */
  public obtenerSesion(sessionId: string = 'default'): SesionUsuario {
    let sesion = this.sesiones.get(sessionId);
    if (!sesion) {
      sesion = new SesionUsuario(sessionId);
      // Inyectar slots constantes al inicio
      for (const [k, v] of Object.entries(this.esquemaSlots)) {
        if (v.tipo === 'constante' && v.valor) {
          sesion.contexto[k] = v.valor;
          sesion.contexto[`slot.${k}`] = v.valor;
        }
      }
      this.sesiones.set(sessionId, sesion);
    }
    return sesion;
  }

  /**
   * Envía un mensaje al bot y resuelve el turno conversacional completo.
   */
  public async ask(mensaje: string, sessionId: string = 'default'): Promise<ResultadoInferencia> {
    if (!this.pipeline) {
      this.entrenar();
    }

    if (!this.pipeline) {
      throw new Error('[IaConia] El modelo no tiene intenciones ni frases para clasificar.');
    }

    const sesion = this.obtenerSesion(sessionId);

    // Orquestador de handlers de acción
    const combinedActionHandler: ActionHandler = async ctx => {
      const handler = this.actionHandlers.get(ctx.action);
      if (handler) {
        return await handler(ctx);
      }
    };

    return await resolverTurnoDialogo(
      mensaje,
      this.pipeline,
      this.esquemaSlots,
      sesion,
      this.baseDatos,
      this.indiceVectorial,
      combinedActionHandler,
      this.umbralClasificacion,
      this.umbralFuzzy,
      this.mensajesPorDefecto,
      this.conectoresTexto
    );
  }

  /**
   * Alias de conveniencia para compatibilidad con código existente.
   */
  public async conversar(mensaje: string, sessionId: string = 'default'): Promise<ResultadoInferencia> {
    return this.ask(mensaje, sessionId);
  }

  /**
   * Clasifica un texto y retorna la intención más probable y su confianza.
   */
  public clasificar(texto: string): { intencion: string | null; confianza: number; metodo: string } {
    if (!this.pipeline) this.entrenar();
    if (!this.pipeline) return { intencion: null, confianza: 0, metodo: 'ninguno' };
    return clasificarTexto(texto, this.pipeline, this.umbralClasificacion, this.umbralFuzzy);
  }

  /**
   * Retorna el ranking de probabilidades para todas las intenciones conocidas.
   */
  public obtenerProbabilidades(texto: string, limite: number = 5): ProbabilidadIntencion[] {
    if (!this.pipeline) this.entrenar();
    if (!this.pipeline) return [];
    return obtenerDistribucionProbabilidades(texto, this.pipeline, limite);
  }

  /**
   * Extrae todas las variables y slots según el esquema configurado.
   */
  public extraerSlots(texto: string): Record<string, string> {
    return extraerTodosLosSlots(texto, this.esquemaSlots);
  }

  /**
   * Búsqueda semántica sobre la base de datos interna con TF-IDF y similitud coseno.
   */
  public buscarBaseDatos(query: string, limite: number = 5): any[] {
    return this.indiceVectorial.buscar(query, limite);
  }

  /**
   * Carga o reemplaza la base de datos documental/factual y re-indexa los vectores.
   */
  public cargarBaseDatos(registros: any[]): this {
    this.baseDatos = Array.isArray(registros) ? [...registros] : [];
    this.indiceVectorial.indexar(this.baseDatos);
    return this;
  }
  public loadDatabase(registros: any[]): this {
    return this.cargarBaseDatos(registros);
  }

  /**
   * Agrega un nuevo registro o documento a la base de datos vectorial en memoria.
   */
  public agregarRegistro(registro: any): this {
    this.baseDatos.push(registro);
    this.indiceVectorial.indexar(this.baseDatos);
    return this;
  }
  public addRecord(registro: any): this {
    return this.agregarRegistro(registro);
  }

  /**
   * Retorna todos los documentos o registros cargados en la base de datos.
   */
  public getBaseDatos(): any[] {
    return [...this.baseDatos];
  }
  public getDatabase(): any[] {
    return this.getBaseDatos();
  }

  /**
   * Vacía la base de datos documental.
   */
  public limpiarBaseDatos(): this {
    this.baseDatos = [];
    this.indiceVectorial.indexar([]);
    return this;
  }
  public clearDatabase(): this {
    return this.limpiarBaseDatos();
  }

  /**
   * Agrega o reemplaza una intención/neurona en tiempo de ejecución y reentrena en memoria.
   */
  public addIntent(intencion: IntencionDef): this {
    const idx = this.baseConocimiento.findIndex(i => i.intension.toLowerCase() === intencion.intension.toLowerCase());
    if (idx >= 0) {
      this.baseConocimiento[idx] = intencion;
    } else {
      this.baseConocimiento.push(intencion);
    }
    return this.entrenar();
  }
  public agregarNeurona(intencion: IntencionDef): this { return this.addIntent(intencion); }
  public addNeuron(intencion: IntencionDef): this { return this.addIntent(intencion); }

  /**
   * Retorna todas las neuronas (intenciones) registradas en la red neuronal.
   */
  public getNeuronas(): IntencionDef[] {
    return [...this.baseConocimiento];
  }
  public getIntents(): IntencionDef[] {
    return this.getNeuronas();
  }

  /**
   * Retorna una neurona específica por su nombre.
   */
  public getNeurona(nombre: string): IntencionDef | null {
    const encontrada = this.baseConocimiento.find(
      i => i.intension.toLowerCase() === nombre.toLowerCase()
    );
    return encontrada ? { ...encontrada } : null;
  }
  public getIntent(nombre: string): IntencionDef | null {
    return this.getNeurona(nombre);
  }

  /**
   * Elimina una neurona por su nombre y reentrena el modelo en memoria en < 5ms.
   */
  public eliminarNeurona(nombre: string): boolean {
    const idx = this.baseConocimiento.findIndex(
      i => i.intension.toLowerCase() === nombre.toLowerCase()
    );
    if (idx >= 0) {
      this.baseConocimiento.splice(idx, 1);
      this.entrenar();
      return true;
    }
    return false;
  }
  public removeIntent(nombre: string): boolean {
    return this.eliminarNeurona(nombre);
  }
  public removeNeuron(nombre: string): boolean {
    return this.eliminarNeurona(nombre);
  }

  /**
   * Actualiza los datos de una neurona existente y reentrena en caliente.
   */
  public actualizarNeurona(nombre: string, cambios: Partial<IntencionDef>): boolean {
    const idx = this.baseConocimiento.findIndex(
      i => i.intension.toLowerCase() === nombre.toLowerCase()
    );
    if (idx >= 0) {
      this.baseConocimiento[idx] = { ...this.baseConocimiento[idx], ...cambios };
      this.entrenar();
      return true;
    }
    return false;
  }
  public updateIntent(nombre: string, cambios: Partial<IntencionDef>): boolean {
    return this.actualizarNeurona(nombre, cambios);
  }

  /**
   * Agrega una frase de entrenamiento a una neurona existente.
   */
  public agregarFrase(nombreNeurona: string, frase: string): boolean {
    const neurona = this.baseConocimiento.find(
      i => i.intension.toLowerCase() === nombreNeurona.toLowerCase()
    );
    if (neurona) {
      if (!neurona.expresiones) neurona.expresiones = [];
      const fraseLimpia = frase.trim();
      if (!neurona.expresiones.includes(fraseLimpia)) {
        neurona.expresiones.push(fraseLimpia);
        this.entrenar();
        return true;
      }
    }
    return false;
  }
  public addPhrase(nombreNeurona: string, frase: string): boolean {
    return this.agregarFrase(nombreNeurona, frase);
  }

  /**
   * Elimina una frase de entrenamiento de una neurona.
   */
  public eliminarFrase(nombreNeurona: string, frase: string): boolean {
    const neurona = this.baseConocimiento.find(
      i => i.intension.toLowerCase() === nombreNeurona.toLowerCase()
    );
    if (neurona && neurona.expresiones) {
      const idx = neurona.expresiones.findIndex(f => f.toLowerCase() === frase.trim().toLowerCase());
      if (idx >= 0) {
        neurona.expresiones.splice(idx, 1);
        this.entrenar();
        return true;
      }
    }
    return false;
  }
  public removePhrase(nombreNeurona: string, frase: string): boolean {
    return this.eliminarFrase(nombreNeurona, frase);
  }

  // ==========================================
  // GESTIÓN DE SLOTS / VARIABLES
  // ==========================================

  /**
   * Agrega o actualiza un slot declarativo en la configuración.
   * Soporta sintaxis de objeto completo, o atajos de 1 línea:
   * - bot.addSlot("telefono", { regex: /\d{10}/, pregunta: "¿Cuál es tu teléfono?" })
   * - bot.addSlot("nombre", "¿Cómo te llamas?") -> Auto-preset
   * - bot.addSlot("pizza", ["pepperoni", "hawaiana"], "¿Qué sabor deseas?") -> Catálogo
   * - bot.addSlot("empresa", "Wimprove AI") -> Constante
   */
  public addSlot(
    nombreSlot: string,
    configOrPreguntaOrOpciones: EsquemaSlot | string | string[],
    pregunta?: string
  ): this {
    if (typeof configOrPreguntaOrOpciones === 'string') {
      const str = configOrPreguntaOrOpciones.trim();
      const parecePregunta =
        str.includes('?') ||
        str.includes('¿') ||
        str.toLowerCase().startsWith('cual') ||
        str.toLowerCase().startsWith('cuál') ||
        str.toLowerCase().startsWith('como') ||
        str.toLowerCase().startsWith('cómo') ||
        str.toLowerCase().startsWith('indica') ||
        str.toLowerCase().startsWith('dime') ||
        str.toLowerCase().startsWith('ingresa');

      if (parecePregunta) {
        this.esquemaSlots[nombreSlot] = { pregunta: str };
      } else {
        this.esquemaSlots[nombreSlot] = { tipo: 'constante', valor: str };
      }
    } else if (Array.isArray(configOrPreguntaOrOpciones)) {
      this.esquemaSlots[nombreSlot] = {
        tipo: 'catalogo',
        opciones: configOrPreguntaOrOpciones,
        pregunta: pregunta || `¿Qué opción de ${nombreSlot} deseas?`
      };
    } else {
      this.esquemaSlots[nombreSlot] = { ...configOrPreguntaOrOpciones };
    }
    return this;
  }
  public agregarSlot(
    nombreSlot: string,
    configOrPreguntaOrOpciones: EsquemaSlot | string | string[],
    pregunta?: string
  ): this {
    return this.addSlot(nombreSlot, configOrPreguntaOrOpciones, pregunta);
  }

  /**
   * Retorna todos los slots configurados en el sistema.
   */
  public getSlots(): EsquemaSlots {
    return { ...this.esquemaSlots };
  }
  public obtenerSlots(): EsquemaSlots {
    return this.getSlots();
  }

  /**
   * Retorna un slot específico por su nombre.
   */
  public getSlot(nombre: string): EsquemaSlot | null {
    return this.esquemaSlots[nombre] ? { ...this.esquemaSlots[nombre] } : null;
  }

  /**
   * Elimina un slot de la configuración.
   */
  public eliminarSlot(nombre: string): boolean {
    if (nombre in this.esquemaSlots) {
      delete this.esquemaSlots[nombre];
      return true;
    }
    return false;
  }
  public removeSlot(nombre: string): boolean {
    return this.eliminarSlot(nombre);
  }

  /**
   * Actualiza la configuración de un slot existente.
   */
  public actualizarSlot(nombre: string, cambios: Partial<EsquemaSlot>): boolean {
    if (this.esquemaSlots && this.esquemaSlots[nombre]) {
      this.esquemaSlots[nombre] = { ...this.esquemaSlots[nombre], ...cambios };
      return true;
    }
    return false;
  }
  public updateSlot(nombre: string, cambios: Partial<EsquemaSlot>): boolean {
    return this.actualizarSlot(nombre, cambios);
  }

  // ==========================================
  // ESTADÍSTICAS Y TELEMETRÍA DE LA RED
  // ==========================================

  /**
   * Retorna métricas cuantitativas del estado de la red neuronal en memoria.
   */
  public getStats(): {
    totalNeuronas: number;
    totalFrases: number;
    tamanoVocabulario: number;
    totalSlots: number;
    nombresNeuronas: string[];
  } {
    const totalFrases = this.baseConocimiento.reduce(
      (acc, n) => acc + (n.expresiones?.length || 0),
      0
    );
    return {
      totalNeuronas: this.baseConocimiento.length,
      totalFrases,
      tamanoVocabulario: this.pipeline?.vectorizador.vocabulario.size || 0,
      totalSlots: Object.keys(this.esquemaSlots).length,
      nombresNeuronas: this.baseConocimiento.map(n => n.intension)
    };
  }
  public obtenerEstadisticas() {
    return this.getStats();
  }

  /**
   * Reinicia la memoria de una sesión concreta o de todas.
   */
  public reiniciarSesion(sessionId?: string): void {
    if (sessionId) {
      this.sesiones.delete(sessionId);
    } else {
      this.sesiones.clear();
    }
  }

  /**
   * Exporta toda la configuración y conocimiento del bot a un objeto JSON serializable.
   * Serializa RegExp a strings para garantizar 100% de compatibilidad con JSON.stringify().
   */
  public exportModel(): IaConiaConfig {
    const slotsSerializados: EsquemaSlots = {};
    for (const [k, v] of Object.entries(this.esquemaSlots)) {
      const slotCopia = { ...v };
      if (slotCopia.regex) {
        if (slotCopia.regex instanceof RegExp) {
          slotCopia.regex = slotCopia.regex.source;
        } else if (Array.isArray(slotCopia.regex)) {
          slotCopia.regex = slotCopia.regex.map(r => (r instanceof RegExp ? r.source : String(r)));
        }
      }
      slotsSerializados[k] = slotCopia;
    }

    return {
      nombre: this.nombre,
      baseConocimiento: this.baseConocimiento,
      esquemaSlots: slotsSerializados,
      baseDatos: this.baseDatos,
      umbralClasificacion: this.umbralClasificacion,
      umbralFuzzy: this.umbralFuzzy,
      mensajesPorDefecto: this.mensajesPorDefecto,
      camposIgnoradosDb: this.camposIgnoradosDb,
      conectoresTexto: this.conectoresTexto
    };
  }

  /**
   * Carga un modelo desde un objeto de configuración serializable y reentrena en caliente.
   * Reconstruye automáticamente las instancias de RegExp y reindexa la base de datos vectorial.
   */
  public loadModel(modelJson: IaConiaConfig): this {
    if (modelJson.nombre) this.nombre = modelJson.nombre;
    const bc = modelJson.baseConocimiento || (modelJson as any).base_conocimiento;
    if (bc) this.baseConocimiento = bc;

    const es = modelJson.esquemaSlots || (modelJson as any).esquema_slots;
    if (es && typeof es === 'object') {
      const slotsReconstruidos: EsquemaSlots = {};
      for (const [k, v] of Object.entries(es as Record<string, EsquemaSlot>)) {
        if (!v || typeof v !== 'object') continue;
        const slotCopia: EsquemaSlot = { ...v };
        if (slotCopia.regex) {
          if (typeof slotCopia.regex === 'string') {
            slotCopia.regex = new RegExp(slotCopia.regex);
          } else if (Array.isArray(slotCopia.regex)) {
            slotCopia.regex = slotCopia.regex.map((r: any) => (typeof r === 'string' ? new RegExp(r) : r));
          }
        }
        slotsReconstruidos[k] = slotCopia;
      }
      this.esquemaSlots = slotsReconstruidos;
    }

    const mpd = modelJson.mensajesPorDefecto || (modelJson as any).mensajes_por_defecto;
    if (mpd) this.mensajesPorDefecto = { ...mpd };

    const cid = modelJson.camposIgnoradosDb || (modelJson as any).campos_ignorados_db;
    if (cid && Array.isArray(cid)) this.camposIgnoradosDb = [...cid];

    const ct = modelJson.conectoresTexto || (modelJson as any).conectores_texto;
    if (ct && Array.isArray(ct)) this.conectoresTexto = [...ct];

    const bd = modelJson.baseDatos || (modelJson as any).base_datos;
    if (bd) {
      this.baseDatos = bd;
    }
    this.indiceVectorial = new VectorDatabaseIndex(this.baseDatos, this.camposIgnoradosDb);

    const uMl = modelJson.umbralClasificacion ?? (modelJson as any).umbral_clasificacion;
    if (uMl !== undefined) {
      this.umbralClasificacion = uMl;
    }

    const uFuzzy = modelJson.umbralFuzzy ?? (modelJson as any).umbral_fuzzy;
    if (uFuzzy !== undefined) {
      this.umbralFuzzy = uFuzzy;
    }

    return this.entrenar();
  }
}

// Alias de retrocompatibilidad con el backend de Python
export { IaConia as MotorConversacional };
export default IaConia;
