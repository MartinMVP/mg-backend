// scripts/copy-swagger.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'docs');
const dst = path.join(__dirname, '..', 'dist', 'docs');

try {
  fs.mkdirSync(dst, { recursive: true });         // crea dist/docs si no existe
  fs.cpSync(src, dst, { recursive: true });       // copia todo el folder docs
  console.log('✅ Swagger docs copiados a dist/docs');
} catch (e) {
  console.error('⚠️ No se pudieron copiar los docs:', e);
  process.exit(1);
}
