export interface MensajeHistorial {
  emisor: 'usuario' | 'bot';
  texto: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class SesionUsuario {
  public sessionId: string;
  public contexto: Record<string, any>;
  public historial: MensajeHistorial[];
  public slotPendiente: string | null;
  public intencionPendiente: string | null;
  public turno: number;

  constructor(sessionId: string = 'default') {
    this.sessionId = sessionId;
    this.contexto = {};
    this.historial = [];
    this.slotPendiente = null;
    this.intencionPendiente = null;
    this.turno = 0;
  }

  public registrarMensajeUsuario(texto: string): void {
    this.historial.push({
      emisor: 'usuario',
      texto,
      timestamp: Date.now()
    });
    this.turno++;
  }

  public registrarMensajeBot(texto: string, metadata?: Record<string, any>): void {
    this.historial.push({
      emisor: 'bot',
      texto,
      timestamp: Date.now(),
      metadata
    });
  }

  public reiniciar(): void {
    this.contexto = {};
    this.historial = [];
    this.slotPendiente = null;
    this.intencionPendiente = null;
    this.turno = 0;
  }

  public obtenerResumen(): {
    sessionId: string;
    contexto: Record<string, any>;
    slotPendiente: string | null;
    intencionPendiente: string | null;
    totalTurnos: number;
  } {
    return {
      sessionId: this.sessionId,
      contexto: { ...this.contexto },
      slotPendiente: this.slotPendiente,
      intencionPendiente: this.intencionPendiente,
      totalTurnos: this.turno
    };
  }
}
