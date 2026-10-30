import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IaConia } from '../dist/index.js';

const base = [
  { intension: 'estatus_asegurado', expresiones: ['quiero saber mi estatus del asegurado', 'estoy asegurado', 'consultar mi seguro esta activo', 'verificar si estoy afiliado', 'saber si tengo seguro vigente'] },
  { intension: 'coberturas', expresiones: ['cuales son las coberturas', 'que cubre el seguro', 'que beneficios tengo', 'me cubre una operacion'] },
  { intension: 'reembolsos', expresiones: ['como gestionar un reembolso', 'quiero que me devuelvan el dinero', 'requisitos para reembolso', 'cuanto demora el reembolso'] },
  { intension: 'transferir_asesor', expresiones: ['quiero hablar con un asesor', 'comunicame con una persona', 'pasame con un agente', 'necesito un humano'] }
];
const crear = extra => new IaConia({ nombre: 't', baseConocimiento: base, esquemaSlots: {}, ...extra });

test('rechaza mensajes fuera de dominio', () => {
  const bot = crear();
  for (const texto of ['el partido de ayer estuvo buenazo', 'mañana llueve en lima segun el noticiero', 'el dinero no alcanza para el alquiler', 'mi vecino trabaja de agente inmobiliario']) {
    assert.equal(bot.clasificar(texto).intencion, null, texto);
  }
});

test('sigue reconociendo frases del dominio, compuestas y con errores', () => {
  const bot = crear();
  assert.equal(bot.clasificar('quiero saber mi estatus del asegurado').intencion, 'estatus_asegurado');
  assert.equal(bot.clasificar('hola buen dia disculpe quiero hablar con un asesor gracias').intencion, 'transferir_asesor');
  assert.equal(bot.clasificar('como gestionar un reembolzo').intencion, 'reembolsos');
});

test('una palabra identica no da 100% de confianza', () => {
  const bot = crear({ coberturaMinima: 0, umbralClasificacion: 0.99 });
  assert.notEqual(bot.clasificar('zapatos dinero').confianza, 1);
});

test('los ejemplos negativos rechazan negaciones', () => {
  const bot = crear({ ejemplosFueraDominio: ['no quiero hablar con un asesor', 'no quiero ningun reembolso'] });
  assert.equal(bot.clasificar('no quiero hablar con un asesor').intencion, null);
  assert.equal(bot.clasificar('quiero hablar con un asesor').intencion, 'transferir_asesor');
});

test('el slot de texto no se sobrescribe y permite cambiar de tema', async () => {
  const bot = new IaConia({
    nombre: 't',
    baseConocimiento: [...base, { intension: 'registro', expresiones: ['quiero registrarme', 'hacer un registro'], slots: ['nombre', 'telefono'], respuestas: ['{slot.nombre} {slot.telefono}'] }],
    esquemaSlots: {
      nombre: { tipo: 'texto', ignorar: ['me llamo', 'mi nombre es', 'soy'], formato: 'title', pregunta: 'nombre?' },
      telefono: { tipo: 'regex', regex: /\b\d{9}\b/, pregunta: 'tel?' }
    }
  });
  assert.equal((await bot.ask('quiero registrarme', 's')).reply, 'nombre?');
  assert.equal((await bot.ask('cuales son las coberturas', 's')).intent, 'coberturas');
  assert.equal((await bot.ask('quiero registrarme', 's')).reply, 'nombre?');
  assert.equal((await bot.ask('me llamo carlos gomez', 's')).reply, 'tel?');
  assert.equal((await bot.ask('cuales son las coberturas', 's')).slots.nombre, 'Carlos Gomez');
  assert.equal((await bot.ask('quiero registrarme', 's')).reply, 'tel?');
  assert.equal((await bot.ask('987654321', 's')).reply, 'Carlos Gomez 987654321');
});

test('export y carga conservan flags de regex', () => {
  const bot = crear({ esquemaSlots: { cod: { tipo: 'regex', regex: /[a-z]{2}-?\d{6}/i } } });
  const copia = new IaConia().loadModel(JSON.parse(JSON.stringify(bot.exportModel())));
  assert.deepEqual(copia.extraerSlots('codigo MX-123456'), { cod: 'MX-123456' });
});

test('la carga restaura los pesos sin cambiar resultados', () => {
  const bot = crear();
  const modelo = JSON.parse(JSON.stringify(bot.exportModel()));
  assert.ok(modelo.pesosEntrenados);
  const copia = new IaConia().loadModel(modelo);
  const texto = 'quiero saber de mi reembolso';
  assert.deepEqual(copia.obtenerProbabilidades(texto), bot.obtenerProbabilidades(texto));
  assert.equal(crear().exportModel({ incluirPesos: false }).pesosEntrenados, undefined);
});

test('pesos de otras frases se ignoran y se reentrena', () => {
  const modelo = JSON.parse(JSON.stringify(crear().exportModel()));
  modelo.baseConocimiento = [...modelo.baseConocimiento, { intension: 'citas', expresiones: ['quiero una cita medica', 'agendar una cita'] }];
  const copia = new IaConia().loadModel(modelo);
  assert.equal(copia.clasificar('quiero una cita medica').intencion, 'citas');
});
