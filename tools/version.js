'use strict';
// Marca la versión de la app antes de publicar.
//   node tools/version.js            → versión con la fecha y hora actuales (p. ej. 2026.11.05-2010)
//   node tools/version.js 2026.11.05 → versión indicada
// Agrega ?v=<versión> a styles.css y a cada js/*.js de index.html, para que el navegador descargue
// los archivos nuevos en cuanto se publican (GitHub Pages permite guardarlos en caché), y actualiza
// la etiqueta "Versión …" que se ve al pie de la página.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const version = process.argv[2] ||
  `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

let html = fs.readFileSync(file, 'utf8');
html = html.replace(/href="styles\.css(\?v=[^"]*)?"/, `href="styles.css?v=${version}"`);
html = html.replace(/src="(js\/[\w.]+?\.js)(\?v=[^"]*)?"/g, (_, f) => `src="${f}?v=${version}"`);
html = html.replace(/(<p class="app-version" id="app-version">)[^<]*(<\/p>)/, `$1Versión ${version}$2`);
fs.writeFileSync(file, html);
console.log(version);
