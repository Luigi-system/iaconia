# 📚 Guía Definitiva y Documentación de `iaconia`

> **IaConia** es un motor de Inteligencia Artificial Conversacional (NLU) ultraligero (< 45 KB), autónomo y determinista diseñado para ejecutarse **100% en el cliente (navegador web o Node.js)** con latencia sub-milisegundo (< 2 ms) y cero costos de servidor.

---

## 📑 Tabla de Contenidos

1. [¿Por qué usar IaConia? (Arquitectura)](#1-por-qué-usar-iaconia)
2. [Instalación](#2-instalación)
3. [Inicio Rápido (3 líneas)](#3-inicio-rápido)
4. [Conceptos Fundamentales](#4-conceptos-fundamentales)
   - [Intenciones (Intents)](#41-intenciones-intents)
   - [Slots y Entidades (4 Primitivas Universales)](#42-slots-y-entidades)
   - [Gestión de Turnos y Aclaraciones](#43-gestión-de-turnos-y-aclaraciones)
   - [Manejador de Acciones (`onAction`)](#44-manejador-de-acciones-onaction)
   - [Base de Datos Vectorial en Memoria](#45-base-de-datos-vectorial)
5. [Referencia Completa de la API](#5-referencia-completa-de-la-api)
   - [Constructor: `new IaConia(config)`](#constructor-new-iaconiaconfig)
   - [Métodos de Diálogo y Chat](#métodos-de-diálogo-y-chat)
   - [Métodos de Clasificación y NLP](#métodos-de-clasificación-y-nlp)
   - [Métodos de Gestión y Entrenamiento en Caliente](#métodos-de-gestión-y-entrenamiento)
   - [Métodos de Sesión](#métodos-de-sesión)
   - [Tipos TypeScript y Estructura de Retorno](#tipos-typescript)
6. [Recetas y Casos de Uso Reales](#6-recetas-y-casos-de-uso-reales)
   - [Receta 1: Componente de Chat en React](#receta-1-componente-en-react)
   - [Receta 2: Agendamiento de Citas con Slots Obligatorios](#receta-2-agendamiento-de-citas)
   - [Receta 3: Conexión Segura con Backend Privado](#receta-3-conexión-con-backend-seguro)
   - [Receta 4: Búsqueda Semántica de Catálogo](#receta-4-búsqueda-semántica)
7. [Buenas Prácticas y Calibración](#7-buenas-prácticas-y-calibración)

---

## 1. ¿Por qué usar IaConia?

A diferencia de los LLMs tradicionales (como GPT o Llama) que requieren GPUs costosas, consumen tokens por palabra y tardan entre 500ms y 3000ms en responder a través de internet:

| Característica | LLMs en la Nube (OpenAI, Claude) | **IaConia (Client-Side NLU)** |
| :--- | :--- | :--- |
| **Latencia** | 500 ms – 3,000 ms (depende de internet) | **0.2 ms – 2.0 ms (en memoria RAM)** |
| **Costo por Mensaje** | Pago por tokens | **$0.00 (Totalmente Gratis e Ilimitado)** |
| **Modo Offline** | ❌ Requiere internet obligatorio | ✅ **100% Funcional sin conexión** |
| **Privacidad** | Los datos viajan a servidores externos | ✅ **Los datos nunca salen del dispositivo** |
| **Consumo de Memoria**| Modelos de 4 GB – 140 GB | **~44 KB en total (cero dependencias)** |
| **Determinismo** | Puede alucinar o variar respuestas | **100% Preciso y Controlado** |

---

## 2. Instalación

En tu proyecto ejecuta:

```bash
# Con NPM
npm install iaconia

# Con PNPM
pnpm add iaconia

# Con Yarn
yarn add iaconia
```

> **Compatibilidad Universal:** Funciona en React, Next.js, Vite, Vue, Svelte, Angular, React Native, Capacitor, Electron, Node.js (ESM y CommonJS) y Bun.

---

## 3. Inicio Rápido

IaConia viene **preentrenado de fábrica** con intenciones de saludo, despedida, agradecimiento, ayuda y soporte:

```javascript
import { IaConia } from 'iaconia';

// 1. Inicializa el bot (carga el modelo preentrenado en RAM)
const bot = new IaConia();

// 2. Haz una pregunta
const res = await bot.ask("¡Hola, buenas tardes!");

console.log(res.reply);        // "¡Hola! Estoy listo para ayudarte con lo que necesites."
console.log(res.intent);       // "saludo"
console.log(res.confidencePct);// 99.4
console.log(res.latencyMs);    // 1.2 ms
```

---

## 4. Conceptos Fundamentales

### 4.1. Intenciones (Intents)
Una intención representa **lo que el usuario quiere lograr**. Cada intención tiene frases de entrenamiento, respuestas plantilla y opcionalmente slots requeridos o acciones.

```javascript
bot.addIntent({
  intencion: "consultar_horario",
  frases_usuario: [
    "a que hora abren",
    "cual es su horario de atencion",
    "horarios",
    "estan abiertos hoy",
    "hasta que hora atienden"
  ],
  respuestas: [
    "Nuestro horario es de Lunes a Viernes de 9:00 AM a 7:00 PM. 🕒",
    "Atendemos de Lunes a Sábado de 9:00 a 19:00 hrs."
  ]
});
```

---

### 4.2. Slots y Entidades
Los slots son variables o parámetros que el bot extrae automáticamente del mensaje del usuario. IaConia incluye **4 primitivas universales**:

#### 1. Tipo `catalogo` (Coincidencia Difusa / Tolerante a Errores):
Compara contra una lista cerrada de opciones con tolerancia a errores ortográficos mediante distancia de Levenshtein.
```javascript
bot.addSlot("sabor_pizza", {
  tipo: "catalogo",
  opciones: ["pepperoni", "hawaiana", "cuatro quesos", "mexicana"],
  umbral: 65 // Si el usuario escribe "peperoni" o "jaguayana", lo detecta igual
});
```

#### 2. Tipo `patron` (Expresión Regular + Filtros):
Para extraer números, códigos, teléfonos o correos con Regex:
```javascript
bot.addSlot("email_usuario", {
  tipo: "patron",
  patron: "[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+",
  pregunta_aclaracion: "¿Podrías indicarme tu correo electrónico?"
});
```

#### 3. Tipo `constante` (Variables Inmutables):
Valores globales fijos que se inyectan siempre en la sesión (ej. nombre de tu empresa):
```javascript
bot.addSlot("empresa", {
  tipo: "constante",
  valor: "Acme Corp"
});
```

#### 4. Tipo `texto` (Texto libre con limpieza de prefijos):
Extrae texto abierto eliminando muletillas como *"me llamo"*, *"mi nombre es"*:
```javascript
bot.addSlot("nombre_cliente", {
  tipo: "texto",
  prefijos: ["me llamo", "mi nombre es", "soy"],
  max_palabras: 2,
  formato: "title" // Lo formatea con Mayúscula Inicial (ej: "Juan Pérez")
});
```

---

### 4.3. Gestión de Turnos y Aclaraciones
Si una intención tiene `slots_requeridos`, el bot **no responderá hasta que el usuario le dé todos los datos necesarios**:

```javascript
bot.addIntent({
  intencion: "agendar_cita",
  frases_usuario: ["quiero agendar una cita", "sacar turno", "cita medica"],
  slots_requeridos: ["especialidad", "telefono"],
  respuestas: ["Cita agendada para {slot.especialidad}. Te contactaremos al {slot.telefono}."]
});
```
* **Turno 1:** Usuario: *"Quiero una cita"*  
  👉 **Bot:** *"¿Para qué especialidad deseas tu cita?"* (Se queda esperando `especialidad`).
* **Turno 2:** Usuario: *"Dentista"*  
  👉 **Bot:** *"¿Cuál es tu número de teléfono?"* (Se queda esperando `telefono`).
* **Turno 3:** Usuario: *"5512345678"*  
  👉 **Bot:** *"Cita agendada para Dentista. Te contactaremos al 5512345678."*

---

### 4.4. Manejador de Acciones (`onAction`)
Cuando una intención requiere comunicarse con un servidor externo (guardar en MySQL, consultar un precio en tiempo real o procesar un pago), defines una `action` y registras un listener:

```javascript
// En la intención defines el disparador:
bot.addIntent({
  intencion: "consultar_saldo",
  frases_usuario: ["cual es mi saldo", "cuanto dinero tengo", "ver balance"],
  action: "CONSULTAR_SALDO_API",
  respuestas: ["Tu saldo disponible es de **{db.saldo}**."]
});

// En tu código registras qué debe hacer la acción:
bot.onAction("CONSULTAR_SALDO_API", async ({ slots, sessionId }) => {
  // Aquí haces tu llamada segura al backend
  const res = await fetch(`/api/cuentas/saldo?user=${sessionId}`);
  const data = await res.json();

  return {
    db: { saldo: data.montoFormateado } // Se inyecta automáticamente en {db.saldo}
  };
});
```

---

### 4.5. Base de Datos Vectorial
IaConia incluye una base de datos vectorial en memoria que indexa cualquier JSON arbitrario y realiza **búsqueda semántica** mediante TF-IDF, similitud coseno y lematización en español:

```javascript
bot.baseDatos = [
  { id: 101, producto: "Laptop Gamer Pro", specs: "RTX 4070, 32GB RAM", precio: "$1,899" },
  { id: 102, producto: "Mouse Ergonómico Inalámbrico", specs: "Bluetooth, 4000 DPI", precio: "$45" }
];
bot.indiceVectorial.indexar(bot.baseDatos);

// Búsqueda semántica instantánea
const resultados = bot.buscarBaseDatos("computadora para juegos potente");
console.log(resultados[0].producto); // "Laptop Gamer Pro"
```

---

## 5. Referencia Completa de la API

### Constructor: `new IaConia(config?)`
Crea una nueva instancia del motor conversacional.

```typescript
const bot = new IaConia({
  nombre?: string;                    // Nombre del bot (Default: "IaConia Assistant")
  baseConocimiento?: IntencionDef[];  // Intenciones iniciales (Default: modelo preentrenado)
  esquemaSlots?: EsquemaSlots;        // Configuración de slots iniciales
  tokensBloqueo?: string[];           // Palabras o insultos bloqueados
  baseDatos?: any[];                  // Registros JSON para búsqueda semántica
  umbralClasificacion?: number;       // Umbral mínimo ML (Default: 0.45)
  umbralFuzzy?: number;               // Umbral mínimo difuso (Default: 76)
});
```

---

### Métodos de Diálogo y Chat

#### `bot.ask(mensaje: string, sessionId?: string): Promise<ResultadoInferencia>`
Envía un mensaje al bot, ejecuta la inferencia, extrae slots, resuelve la máquina de estados y retorna la respuesta procesada.
* **Alias:** `bot.conversar(mensaje, sessionId?)`

#### `bot.obtenerSesion(sessionId?: string): SesionUsuario`
Obtiene la sesión del usuario en memoria RAM con su contexto y variables acumuladas.

#### `bot.reiniciarSesion(sessionId?: string): void`
Limpia el contexto y memoria de una sesión específica o de todas las sesiones.

---

### Métodos de Clasificación y NLP

#### `bot.clasificar(texto: string)`
Clasifica una frase sin avanzar el turno de diálogo ni responder.
```typescript
const res = bot.clasificar("Hola buenas");
// { intencion: "saludo", confianza: 0.994, metodo: "ml" }
```

#### `bot.obtenerProbabilidades(texto: string, limite?: number): ProbabilidadIntencion[]`
Retorna el ranking probabilístico de todas las intenciones conocidas.
```typescript
const probs = bot.obtenerProbabilidades("Hola");
// [
//   { intent: 'saludo', probability: 0.994 },
//   { intent: 'ayuda', probability: 0.003 },
//   ...
// ]
```

#### `bot.extraerSlots(texto: string): Record<string, string>`
Extrae todas las entidades y slots presentes en el texto según el esquema configurado.

#### `bot.buscarBaseDatos(query: string, limite?: number): any[]`
Ejecuta una búsqueda vectorial semántica con similitud coseno sobre la base de datos interna.

---

### Métodos de Gestión y Entrenamiento

#### `bot.addIntent(intencionDef: IntencionDef): this`
Agrega o actualiza una intención en caliente y reentrena el modelo en memoria en < 5ms. Permite encadenamiento de métodos (*chaining*).

#### `bot.addSlot(nombreSlot: string, config: EsquemaSlot): this`
Registra un nuevo slot en el esquema de extracción.

#### `bot.onAction(actionName: string, handler: ActionHandler): this`
Registra un callback asíncrono para ejecutar lógica de negocio cuando una intención dispara una acción.

#### `bot.entrenar(): this`
Fuerza un reentrenamiento completo del vocabulario TF-IDF y la regresión logística en memoria RAM.

#### `bot.exportModel(): Record<string, any>`
Exporta toda la base de conocimiento, slots, constantes y datos a un objeto JSON serializable.

#### `bot.loadModel(modelJson: Record<string, any>): this`
Carga un modelo completo desde un JSON arbitrario y lo entrena inmediatamente.

---

### Tipos TypeScript

#### Estructura de Retorno de `ResultadoInferencia`
```typescript
interface ResultadoInferencia {
  reply: string;               // Respuesta final formateada lista para mostrar al usuario
  messages: string[];          // Lista de mensajes generados en el turno
  intent: string;              // Nombre de la intención detectada (ej: "saludo")
  confidencePct: number;       // Porcentaje de confianza (0 - 100)
  confidence: number;          // Confianza matemática (0.0 - 1.0)
  method: 'ml' | 'ml-ngram' | 'fuzzy' | 'direct-slot' | 'ninguno'; // Algoritmo que ganó
  slots: Record<string, any>;  // Variables extraídas en el contexto
  slotsRequeridos: string[];   // Slots que la intención exige
  action?: string | null;      // Acción disparada (si aplica)
  latencyMs: number;           // Tiempo de cómputo en milisegundos (ej: 1.45 ms)
  sessionId: string;           // Identificador de la sesión
  data?: any;                  // Datos extra devueltos por el Action Handler
  sugerencias?: string[];      // Botones o chips sugeridos para el usuario
  probabilities: Array<{ intent: string; probability: number }>; // Ranking TF-IDF
}
```

---

## 6. Recetas y Casos de Uso Reales

### Receta 1: Componente en React
Cómo usar IaConia dentro de un componente de React en tu frontend:

```tsx
import React, { useState, useMemo } from 'react';
import { IaConia } from 'iaconia';

export function ChatBot() {
  // Instancia única en memoria
  const bot = useMemo(() => new IaConia(), []);
  
  const [mensajes, setMensajes] = useState<Array<{ sender: 'user' | 'bot'; text: string }>>([
    { sender: 'bot', text: '¡Hola! ¿Cómo te asisto hoy?' }
  ]);
  const [input, setInput] = useState('');
  const [latencia, setLatencia] = useState<number>(0);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const textoUsuario = input;
    setInput('');
    setMensajes(prev => [...prev, { sender: 'user', text: textoUsuario }]);

    // Inferencia local instantánea en el navegador
    const res = await bot.ask(textoUsuario);
    setLatencia(res.latencyMs);

    setMensajes(prev => [...prev, { sender: 'bot', text: res.reply }]);
  };

  return (
    <div style={{ maxWidth: 450, margin: 'auto', border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: 'green', marginBottom: 8 }}>
        ⚡ Inferencia Local: {latencia} ms
      </div>
      <div style={{ height: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mensajes.map((m, i) => (
          <div key={i} style={{ alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start', background: m.sender === 'user' ? '#0070f3' : '#eee', color: m.sender === 'user' ? '#fff' : '#000', padding: '8px 12px', borderRadius: 8 }}>
            {m.text}
          </div>
        ))}
      </div>
      <form onSubmit={enviar} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input style={{ flex: 1, padding: 8 }} value={input} onChange={e => setInput(e.target.value)} placeholder="Escribe algo..." />
        <button style={{ padding: '8px 16px' }} type="submit">Enviar</button>
      </form>
    </div>
  );
}
```

---

### Receta 2: Agendamiento de Citas
Configura un bot médico que solicite obligatoriamente nombre, especialidad y teléfono:

```javascript
import { IaConia } from 'iaconia';

const bot = new IaConia({ nombre: "Clínica Salud" });

bot.addSlot("especialidad", {
  tipo: "catalogo",
  opciones: ["cardiología", "pediatría", "odontología", "dermatología"],
  umbral: 65,
  pregunta_aclaracion: "¿Para qué especialidad médica necesitas tu cita?"
});

bot.addSlot("telefono", {
  tipo: "patron",
  patron: "\\b\\d{8,10}\\b",
  pregunta_aclaracion: "¿Podrías darme tu número telefónico a 10 dígitos?"
});

bot.addIntent({
  intencion: "agendar_consulta",
  frases_usuario: ["quiero agendar una consulta", "pedir cita", "necesito ver a un doctor", "turno medico"],
  slots_requeridos: ["especialidad", "telefono"],
  respuestas: [
    "✅ ¡Cita registrada con éxito para **{slot.especialidad}**! Nos comunicaremos al número **{slot.telefono}** para confirmar el horario."
  ]
});
```

---

### Receta 3: Conexión con Backend Seguro
Cómo hacer que el bot consulte tu API privada sin exponer claves de base de datos en el cliente:

```javascript
import { IaConia } from 'iaconia';

const bot = new IaConia();

bot.addIntent({
  intencion: "consultar_rastreo_pedido",
  frases_usuario: ["donde esta mi pedido", "rastrear paquete", "estado de mi envio"],
  slots_requeridos: ["numero_guia"],
  action: "CONSULTAR_API_PAQUETERIA",
  respuestas: ["El estado de tu paquete #{slot.numero_guia} es: **{db.estado}** (Ubicación: {db.ubicacion})."]
});

bot.addSlot("numero_guia", {
  tipo: "patron",
  patron: "\\b[A-Z]{2}\\d{6}[A-Z]{2}\\b", // Ej: MX123456DF
  pregunta_aclaracion: "Por favor escribe tu número de guía de envío (Ejemplo: MX123456DF):"
});

// El frontend solo hace un fetch hacia tu propio endpoint seguro:
bot.onAction("CONSULTAR_API_PAQUETERIA", async ({ slots }) => {
  const respuesta = await fetch(`/api/rastreo?guia=${slots.numero_guia}`);
  const datos = await respuesta.json();
  
  return {
    db: {
      estado: datos.status,       // Se inyecta en {db.estado}
      ubicacion: datos.city       // Se inyecta en {db.ubicacion}
    }
  };
});
```

---

## 7. Buenas Prácticas y Calibración

1. **Frases Variadas:** Al crear una intención, incluye entre 4 y 10 frases variadas con sinónimos (*"hola"*, *"buenas tardes"*, *"hey"*, *"qué tal"*).
2. **Coincidencia Difusa:** Para nombres propios, productos o marcas, usa siempre el tipo `catalogo` con un `umbral` entre `60` y `70`. Esto permitirá que si el usuario escribe con faltas de ortografía (*"mançana"*, *"cocacola"*), el bot lo entienda sin problema.
3. **Calibrar el Umbral de Inferencia:**
   - Si notas que el bot confunde intenciones parecidas, sube `umbralClasificacion` a `0.55` o `0.60`.
   - Si notas que el bot es muy estricto y dice mucho *"no entendí"*, baja el umbral a `0.40`.
4. **Exportar a LocalStorage:** Puedes guardar el estado del bot en el navegador del usuario fácilmente:
   ```javascript
   // Guardar
   localStorage.setItem('mi_modelo_iaconia', JSON.stringify(bot.exportModel()));
   
   // Cargar en la siguiente visita
   const guardado = localStorage.getItem('mi_modelo_iaconia');
   if (guardado) bot.loadModel(JSON.parse(guardado));
   ```

---

## 📄 Licencia

MIT © Wimprove AI Team. Desarrollado con Inteligencia Artificial.
