export interface BusinessRuleWarning {
  ruleId: string
  field: string
  severity: 'error' | 'warning'
  message: string
  expected: string
  actual: string
}

interface ValidatorInput {
  nombre: string | null
  sucursal: string | null
  fecha: string | null
  hora: string | null
  precio: number | null
  producto: string | null
  estado: string | null
  metodoPago: string | null
  telefono: string
  requiereRevision: boolean
  tipoEnvio: 'domicilio' | 'sucursal' | null
}

const SUCURSALES_VALIDAS = ['centro', 'norte']

const PRECIO_MINIMO = 60
const PRECIO_MAXIMO = 50_000

const NOMBRE_CONECTORES = [
  ',', ';', 'cree', 'creo', 'quisiera', 'quiere', 'podria', 'puede',
  'gracias', 'porfa', 'please', 'ok', 'si', 'sí',
]

export function validateBusinessRules(input: ValidatorInput): BusinessRuleWarning[] {
  const warnings: BusinessRuleWarning[] = []

  const r = addWarning.bind(null, warnings)

  r001_horario(input, r)
  r002_sucursal(input, r)
  r003_precioMinimo(input, r)
  r004_precioMaximo(input, r)
  r005_nombre(input, r)
  r006_fechaHoraObligatorias(input, r)
  r007_envioSoloTransferencia(input, r)
  r008_noInventar(input, r)
  r009_pagoSucursal(input, r)

  return warnings
}

type AddWarning = (ruleId: string, field: string, severity: 'error' | 'warning', message: string, expected: string, actual: string) => void

function addWarning(
  warnings: BusinessRuleWarning[],
  ruleId: string,
  field: string,
  severity: 'error' | 'warning',
  message: string,
  expected: string,
  actual: string
): void {
  warnings.push({ ruleId, field, severity, message, expected, actual })
}

function r001_horario(input: ValidatorInput, w: AddWarning): void {
  if (!input.hora || !input.fecha) return
  const match = input.hora.match(/(\d{1,2}):(\d{2})/)
  if (!match) return
  const h = parseInt(match[1], 10)
  const dia = diaSemanaDeFecha(input.fecha)
  if (dia === null) return
  const esFinDeSemana = dia === 0 || dia === 6
  const cierre = esFinDeSemana ? 17 : 19
  if (h < 10) {
    w('R001', 'hora', 'error',
      `Hora ${input.hora} antes de apertura (10:00)`,
      '10:00 o después', input.hora)
  }
  if (h >= cierre) {
    w('R001', 'hora', 'error',
      `Hora ${input.hora} después de cierre (${cierre}:00)`,
      `antes de ${cierre}:00`, input.hora)
  }
}

function r002_sucursal(input: ValidatorInput, w: AddWarning): void {
  if (!input.sucursal) return
  const s = input.sucursal.toLowerCase().trim()
  const valida = SUCURSALES_VALIDAS.some(v => s.includes(v) || v.includes(s))
  if (!valida) {
    w('R002', 'sucursal', 'error',
      `Sucursal "${input.sucursal}" no es válida`,
      'Centro o Norte', input.sucursal)
  }
}

function r003_precioMinimo(input: ValidatorInput, w: AddWarning): void {
  if (input.precio === null || input.precio === undefined) return
  if (input.precio < PRECIO_MINIMO) {
    w('R003', 'precio', 'warning',
      `Precio $${input.precio} menor al mínimo ($${PRECIO_MINIMO})`,
      `$${PRECIO_MINIMO} o más`, `$${input.precio}`)
  }
}

function r004_precioMaximo(input: ValidatorInput, w: AddWarning): void {
  if (input.precio === null || input.precio === undefined) return
  if (input.precio > PRECIO_MAXIMO) {
    w('R004', 'precio', 'warning',
      `Precio $${input.precio} excede el máximo ($${PRECIO_MAXIMO}) — posible error`,
      `$${PRECIO_MAXIMO} o menos`, `$${input.precio}`)
  }
}

function r005_nombre(input: ValidatorInput, w: AddWarning): void {
  if (!input.nombre) return
  const n = input.nombre.toLowerCase()
  for (const conector of NOMBRE_CONECTORES) {
    if (n.includes(conector)) {
      if (conector === ',') {
        const partes = n.split(',')
        const resto = partes.slice(1).join(',').trim()
        if (resto.length > 3) {
          w('R005', 'nombre', 'error',
            `Nombre contiene coma seguido de "${resto}"`,
            'solo el nombre, sin texto extra', input.nombre)
        }
      } else {
        w('R005', 'nombre', 'error',
          `Nombre contiene conector "${conector}"`,
          'solo el nombre, sin conectores', input.nombre)
      }
    }
  }
}

function r006_fechaHoraObligatorias(input: ValidatorInput, w: AddWarning): void {
  const estadosQueRequierenFecha: string[] = ['apartado', 'pagado', 'entregado', 'en_produccion', 'listo']
  if (!input.estado || !estadosQueRequierenFecha.includes(input.estado)) return
  if (!input.fecha) {
    w('R006', 'fecha', 'error',
      `Estado "${input.estado}" requiere fecha`,
      'fecha presente', 'sin fecha')
  }
  if (!input.hora) {
    w('R006', 'hora', 'error',
      `Estado "${input.estado}" requiere hora`,
      'hora presente', 'sin hora')
  }
}

function r007_envioSoloTransferencia(input: ValidatorInput, w: AddWarning): void {
  if (input.tipoEnvio !== 'domicilio') return
  if (!input.metodoPago) return
  const mp = input.metodoPago.toLowerCase()
  const esEfectivo = mp.includes('efectivo') || mp.includes('cash') || mp.includes('contra entrega')
  if (esEfectivo) {
    w('R007', 'metodoPago', 'error',
      'Envío a domicilio no acepta efectivo — solo transferencia',
      'transferencia', input.metodoPago)
  }
}

function r008_noInventar(input: ValidatorInput, w: AddWarning): void {
  if (!input.producto && !input.precio) return
  if (input.requiereRevision && !input.producto) {
    w('R008', 'producto', 'warning',
      'Producto no verificado — posible invento del LLM',
      'producto verificado por sistema', 'sin producto')
  }
  if (input.requiereRevision && input.precio === null) {
    w('R008', 'precio', 'warning',
      'Precio no verificado — posible invento del LLM',
      'precio verificado por sistema', 'sin precio')
  }
}

function r009_pagoSucursal(input: ValidatorInput, w: AddWarning): void {
  if (input.tipoEnvio !== 'sucursal') return
  if (!input.metodoPago) {
    w('R009', 'metodoPago', 'warning',
      'Recoge en sucursal pero no hay método de pago — preguntar efectivo/tarjeta o transferencia',
      'efectivo, tarjeta o transferencia', 'sin método de pago')
  }
}

function diaSemanaDeFecha(fecha: string): number | null {
  const match = fecha.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
  if (isNaN(d.getTime())) {
    const partes = fecha.split(/[-\/]/)
    if (partes.length === 3) {
      const d2 = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]))
      if (!isNaN(d2.getTime())) return d2.getDay()
    }
    return null
  }
  return d.getDay()
}
