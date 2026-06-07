// Script para clasificar municipios de Tlaxcala en zonas de envío
// Basado en cercanía a Apizaco (donde está Jardín RoCe)
//
// Uso: node _clasificar.mjs < archivo.csv > salida.csv
// El CSV debe tener columnas: cp,asentamiento,municipio
//
// Zonas:
//   Zona 1 (Centro)  — $50  — Apizaco
//   Zona 2 (Cercana) — $80  — Municipios colindantes a Apizaco
//   Zona 3 (Media)   — $100 — Municipios cercanos al centro del estado
//   Zona 4 (Lejana)  — $150 — Municipios lejanos (sur, poniente, oriente extremo)

const ZONAS = {
  // Zona 1 — $50 — Apizaco puro
  'apizaco':              { zona: 'Apizaco Centro', precio: 50 },

  // Zona 2 — $80 — Colindantes a Apizaco
  'tzompantepec':         { zona: 'Cercana', precio: 80 },
  'santa cruz tlaxcala':  { zona: 'Cercana', precio: 80 },
  'cuapiaxtla':           { zona: 'Cercana', precio: 80 },
  'xaloztoc':             { zona: 'Cercana', precio: 80 },
  'tocatlán':             { zona: 'Cercana', precio: 80 },
  'tetla de la solidaridad': { zona: 'Cercana', precio: 80 },

  // Zona 3 — $100 — Municipios cercanos / centro del estado
  'tlaxco':               { zona: 'Intermedia', precio: 100 },
  'atlangatepec':         { zona: 'Intermedia', precio: 100 },
  'muñoz de domingo arenas': { zona: 'Intermedia', precio: 100 },
  'huamantla':            { zona: 'Intermedia', precio: 100 },
  'ixtacuixtla de mariano matamoros': { zona: 'Intermedia', precio: 100 },
  'panotla':              { zona: 'Intermedia', precio: 100 },
  'totolac':              { zona: 'Intermedia', precio: 100 },
  'tepeyanco':            { zona: 'Intermedia', precio: 100 },
  'tetlatlahuca':         { zona: 'Intermedia', precio: 100 },
  'zacatelco':            { zona: 'Intermedia', precio: 100 },
  'nativitas':            { zona: 'Intermedia', precio: 100 },
  'san pablo del monte':  { zona: 'Intermedia', precio: 100 },
  'santa ana nopalucan':  { zona: 'Intermedia', precio: 100 },
  'xicohtzinco':          { zona: 'Intermedia', precio: 100 },
  'papalotla':            { zona: 'Intermedia', precio: 100 },
  'tenancingo':           { zona: 'Intermedia', precio: 100 },
  'mazatecochco de josé maría morelos': { zona: 'Intermedia', precio: 100 },
  'contla de juan cuamatzi': { zona: 'Intermedia', precio: 100 },
  'chiautempan':          { zona: 'Intermedia', precio: 100 },
  'yauhquemehcan':        { zona: 'Intermedia', precio: 100 },
  'apetatitlán de antonio carvajal': { zona: 'Intermedia', precio: 100 },
  'amaxac de guerrero':   { zona: 'Intermedia', precio: 100 },
  'san damián texoloc':   { zona: 'Intermedia', precio: 100 },
  'san francisco tetlanohcan': { zona: 'Intermedia', precio: 100 },
  'san jerónimo zacualpan': { zona: 'Intermedia', precio: 100 },
  'san josé teacalco':    { zona: 'Intermedia', precio: 100 },
  'san juan huactzinco':  { zona: 'Intermedia', precio: 100 },
  'san lorenzo axocomanitla': { zona: 'Intermedia', precio: 100 },
  'san lucas tepeticpac': { zona: 'Intermedia', precio: 100 },
  'san miguel xoxtla':    { zona: 'Intermedia', precio: 100 },
  'tlaquillo':            { zona: 'Intermedia', precio: 100 },
  'tlaxcala':             { zona: 'Intermedia', precio: 100 },
  'santa isabel xiloxoxtla': { zona: 'Intermedia', precio: 100 },

  // Zona 4 — $150 — Municipios lejanos
  'calpulalpan':          { zona: 'Lejana', precio: 150 },
  'nanacamilpa de mariano arista': { zona: 'Lejana', precio: 150 },
  'españita':             { zona: 'Lejana', precio: 150 },
  'sanctórum de lázaro cárdenas': { zona: 'Lejana', precio: 150 },
  'benito juárez':        { zona: 'Lejana', precio: 150 },
  'el carmen tequexquitla': { zona: 'Lejana', precio: 150 },
  'ziltlaltépec de trinidad sánchez': { zona: 'Lejana', precio: 150 },
  'lázaro cárdenas':      { zona: 'Lejana', precio: 150 },
  'emiliano zapata':      { zona: 'Lejana', precio: 150 },
}

// Limpiar acentos y normalizar para matching
function norm(s) {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function buscarMunicipio(municipio) {
  const n = norm(municipio)
  // Exacto
  if (ZONAS[n]) return ZONAS[n]
  // Parcial: buscar si el municipio contiene o es contenido por alguna clave
  for (const [clave, zona] of Object.entries(ZONAS)) {
    if (n.includes(clave) || clave.includes(n)) return zona
  }
  // Fallback: todo lo no clasificado como Intermedia $100
  return { zona: 'Intermedia', precio: 100 }
}

// Leer CSV desde stdin
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin })
let lineas = []

rl.on('line', (linea) => lineas.push(linea))
rl.on('close', () => {
  if (lineas.length === 0) {
    console.error('No data received. Pipe a CSV file with columns: cp,asentamiento,municipio')
    process.exit(1)
  }

  // Validar cabecera
  const header = lineas[0].toLowerCase()
  if (!header.includes('cp') || !header.includes('asentamiento') || !header.includes('municipio')) {
    console.error('CSV must have columns: cp,asentamiento,municipio')
    process.exit(1)
  }

  // Output header
  console.log('cp,asentamiento,municipio,zona,precio_envio')

  let total = 0
  let clasificados = { 'Apizaco Centro': 0, Cercana: 0, Intermedia: 0, Lejana: 0 }

  for (let i = 1; i < lineas.length; i++) {
    const cols = lineas[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 3) continue

    const cp = cols[0]
    const asentamiento = cols[1]
    const municipio = cols[2]
    const match = buscarMunicipio(municipio)

    // Escape quotes in fields
    const esc = (s) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s

    console.log(`${esc(cp)},${esc(asentamiento)},${esc(municipio)},${match.zona},${match.precio}`)
    clasificados[match.zona]++
    total++
  }

  console.error(`\n✅ ${total} registros clasificados:`)
  for (const [zona, count] of Object.entries(clasificados)) {
    console.error(`   ${zona}: ${count} registros`)
  }
})
