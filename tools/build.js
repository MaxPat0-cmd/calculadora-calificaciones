'use strict';
// Empaqueta la app en un solo archivo HTML (estilos y scripts incluidos).
//   node tools/build.js                       → dist/Calculadora de calificaciones.html
//   node tools/build.js --fragment            → dist/calificaciones-fragmento.html (sin <html>/<head>/<body>)
//   node tools/build.js --catalogo grupos.zip → incluye los grupos de las actas (.zip o .xlsx);
//                                               el archivo resultante contiene nombres y matrículas.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const catIdx = args.indexOf('--catalogo');
const catalogFiles = catIdx >= 0 ? args.slice(catIdx + 1).filter((a) => !a.startsWith('--')) : [];

async function buildCatalog() {
  if (!catalogFiles.length) return null;
  const Importar = require('../js/importar.js');
  const Catalogo = require('../js/catalogo.js');
  const files = catalogFiles.map((f) => ({ name: path.basename(f), data: new Uint8Array(fs.readFileSync(f)) }));
  const { catalog, ignorados } = await Catalogo.importFiles(files, Importar);
  const s = Catalogo.summary(catalog);
  console.error(`Catálogo: ${s.grupos} grupos, ${s.maestros} maestros, ${s.alumnos} alumnos (${s.archivos} archivos)`);
  ignorados.forEach((i) => console.error(`  ignorado: ${i.archivo} (${i.motivo})`));
  return catalog;
}

(async () => {
  const catalog = await buildCatalog();
  let html = read('index.html');
  html = html.replace(/<link rel="stylesheet" href="styles\.css">/, () => '<style>\n' + read('styles.css') + '</style>');
  html = html.replace(/<script src="(js\/[\w.]+)"><\/script>/g, (_, file) =>
    '<script>\n' + read(file).replace(/<\/script/gi, '<\\/script') + '</script>');
  if (catalog) {
    const json = JSON.stringify(catalog).replace(/</g, '\\u003c');
    html = html.replace('<script>', () => '<script>window.CATALOGO_INCLUIDO = ' + json + ';</script>\n  <script>');
  }

  if (fragment) {
    const title = /<title>[\s\S]*?<\/title>/.exec(html)[0];
    const style = /<style>[\s\S]*?<\/style>/.exec(html)[0];
    const body = /<body>([\s\S]*)<\/body>/.exec(html)[1];
    html = title + '\n' + style + '\n' + body.trim() + '\n';
  }

  const outDir = path.join(root, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const base = fragment ? 'calificaciones-fragmento' : 'Calculadora de calificaciones';
  const out = path.join(outDir, base + (catalog ? ' (con grupos)' : '') + '.html');
  fs.writeFileSync(out, html);
  console.log(out);
})();
