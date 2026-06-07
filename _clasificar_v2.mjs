import { createInterface } from "readline";

const ZONAS = {
  "apizaco": { zona: "Apizaco Centro", precio: 50 },
  "tzompantepec": { zona: "Cercana", precio: 80 },
  "santa cruz tlaxcala": { zona: "Cercana", precio: 80 },
  "cuapiaxtla": { zona: "Cercana", precio: 80 },
  "xaloztoc": { zona: "Cercana", precio: 80 },
  "tocatlán": { zona: "Cercana", precio: 80 },
  "tetla de la solidaridad": { zona: "Cercana", precio: 80 },
  "tlaxco": { zona: "Intermedia", precio: 100 },
  "atlangatepec": { zona: "Intermedia", precio: 100 },
  "muñoz de domingo arenas": { zona: "Intermedia", precio: 100 },
  "huamantla": { zona: "Intermedia", precio: 100 },
  "ixtacuixtla de mariano matamoros": { zona: "Intermedia", precio: 100 },
  "panotla": { zona: "Intermedia", precio: 100 },
  "totolac": { zona: "Intermedia", precio: 100 },
  "tepeyanco": { zona: "Intermedia", precio: 100 },
  "tetlatlahuca": { zona: "Intermedia", precio: 100 },
  "zacatelco": { zona: "Intermedia", precio: 100 },
  "nativitas": { zona: "Intermedia", precio: 100 },
  "san pablo del monte": { zona: "Intermedia", precio: 100 },
  "santa ana nopalucan": { zona: "Intermedia", precio: 100 },
  "xicohtzinco": { zona: "Intermedia", precio: 100 },
  "papalotla de xicohténcatl": { zona: "Intermedia", precio: 100 },
  "tenancingo": { zona: "Intermedia", precio: 100 },
  "mazatecochco de josé maría morelos": { zona: "Intermedia", precio: 100 },
  "contla de juan cuamatzi": { zona: "Intermedia", precio: 100 },
  "chiautempan": { zona: "Intermedia", precio: 100 },
  "yauhquemehcan": { zona: "Intermedia", precio: 100 },
  "apetatitlán de antonio carvajal": { zona: "Intermedia", precio: 100 },
  "amaxac de guerrero": { zona: "Intermedia", precio: 100 },
  "san damián texóloc": { zona: "Intermedia", precio: 100 },
  "san francisco tetlanohcan": { zona: "Intermedia", precio: 100 },
  "san jerónimo zacualpan": { zona: "Intermedia", precio: 100 },
  "san josé teacalco": { zona: "Intermedia", precio: 100 },
  "san juan huactzinco": { zona: "Intermedia", precio: 100 },
  "san lorenzo axocomanitla": { zona: "Intermedia", precio: 100 },
  "tlaxcala": { zona: "Intermedia", precio: 100 },
  "santa isabel xiloxoxtla": { zona: "Intermedia", precio: 100 },
  "calpulalpan": { zona: "Lejana", precio: 150 },
  "nanacamilpa de mariano arista": { zona: "Lejana", precio: 150 },
  "españita": { zona: "Lejana", precio: 150 },
  "sanctórum de lázaro cárdenas": { zona: "Lejana", precio: 150 },
  "benito juárez": { zona: "Lejana", precio: 150 },
  "el carmen tequexquitla": { zona: "Lejana", precio: 150 },
  "ziltlaltépec de trinidad sánchez santos": { zona: "Lejana", precio: 150 },
  "lázaro cárdenas": { zona: "Lejana", precio: 150 },
  "emiliano zapata": { zona: "Lejana", precio: 150 },
  "hueyotlipan": { zona: "Lejana", precio: 150 },
  "xaltocan": { zona: "Intermedia", precio: 100 },
  "san lucas tecopilco": { zona: "Intermedia", precio: 100 },
  "atltzayanca": { zona: "Intermedia", precio: 100 },
  "terrenate": { zona: "Intermedia", precio: 100 },
  "ixtenco": { zona: "Intermedia", precio: 100 },
  "cuaxomulco": { zona: "Intermedia", precio: 100 },
  "tepetitla de lardizábal": { zona: "Intermedia", precio: 100 },
  "san damián texoloc": { zona: "Intermedia", precio: 100 },
  "san lorenzo axocomanitla": { zona: "Intermedia", precio: 100 },
  "santa catarina ayometla": { zona: "Intermedia", precio: 100 },
  "la magdalena tlaltelulco": { zona: "Intermedia", precio: 100 },
  "acuamanala de miguel hidalgo": { zona: "Intermedia", precio: 100 },
  "santa cruz quilehtla": { zona: "Intermedia", precio: 100 },
  "teolocholco": { zona: "Intermedia", precio: 100 },
  "santa apolonia teacalco": { zona: "Intermedia", precio: 100 },
}

function norm(s) {
  return s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function buscar(municipio) {
  const n = norm(municipio)
  if (ZONAS[n]) return ZONAS[n]
  for (const [clave, zona] of Object.entries(ZONAS)) {
    if (n.includes(clave) || clave.includes(n)) return zona
  }
  return { zona: "Intermedia", precio: 100 }
}

const rl = createInterface({ input: process.stdin })
let lineas = []
rl.on("line", (l) => lineas.push(l))
rl.on("close", () => {
  if (lineas.length < 2) { console.error("No data"); process.exit(1) }
  console.log("cp,asentamiento,municipio,zona,precio_envio")
  let stats = {}
  for (let i = 1; i < lineas.length; i++) {
    const cols = lineas[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""))
    if (cols.length < 3) continue
    const [cp, asentamiento, municipio] = cols
    const match = buscar(municipio)
    const esc = (s) => s.includes(",") || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s
    console.log(`${esc(cp)},${esc(asentamiento)},${esc(municipio)},${match.zona},${match.precio}`)
    stats[match.zona] = (stats[match.zona] || 0) + 1
  }
  console.error("\n✅ Clasificación completada:")
  for (const [z, c] of Object.entries(stats)) console.error(`   ${z}: ${c}`)
})
