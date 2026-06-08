// Script para actualizar el system prompt vía API
// Ejecutar: node _actualizar_prompt.mjs
// O copiar el contenido de prompt_actualizado.txt al panel /admin/prompt

import fs from 'fs'

const promptActualizado = fs.readFileSync(new URL('./_prompt_actualizado.txt', import.meta.url), 'utf-8')

console.log('=== PROMPT ACTUALIZADO ===')
console.log(`Longitud: ${promptActualizado.length} caracteres`)
console.log('')
console.log('Copia este contenido y pégalo en el panel de administración:')
console.log('👉 /admin/prompt')
console.log('')
console.log('O ejecuta:')
console.log('curl -X PUT http://localhost:3000/api/prompt \\')
console.log('  -H "Content-Type: application/json" \\')
console.log(`  -d '{"prompt": "..."}'`)
