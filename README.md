# Calculadora de calificaciones

**Pruébala en línea:** https://maxpat0-cmd.github.io/calculadora-calificaciones/

Herramienta web para capturar calificaciones rápidamente, calcular la calificación final y exportar todo a Excel (`Calificaciones.xlsx`).

**Uso:** abre `index.html` en el navegador. No necesita instalación, servidor, cuenta ni internet. La primera vez pide importar las actas de los grupos.

Para compartirla como un solo archivo: `npm run build` genera `dist/Calculadora de calificaciones.html` con estilos y scripts incluidos (`node tools/build.js --fragment` genera la versión para publicar en claude.ai).

## Flujo por grupo

1. **Configurar grupo**: Maestro → Grupo → Total de horas (selectores con búsqueda; no distinguen acentos). Se muestra un resumen (maestro, grupo, asignatura, licenciatura, horas, alumnos encontrados) y **Comenzar captura**.
2. **Captura**: los alumnos del acta ya están cargados con nombre y matrícula (no editables). Se ve "Alumno 3 de 32"; **Guardar y siguiente** (o Enter en el último campo) pasa al siguiente y deja el cursor en Parcial 1. ‹ › o Re Pág / Av Pág cambian de alumno conservando lo escrito.
3. **Tabla**: Matrícula, alumno y calificaciones; **Calificar/Editar** abre a ese alumno en la captura.
4. **Exportar Excel**: `Calificaciones_<grupo>_<asignatura>_<maestro>.xlsx` con las hojas Acta, Detalle e Información (maestro, grupo, licenciatura, horas, fecha de captura).
5. **Cambiar grupo** regresa a la pantalla inicial. Cada grupo guarda su propia sesión en el navegador; se avisa si hay cambios sin guardar o sin exportar.

**Capturar sin grupo** conserva la captura libre de antes (nombre y matrícula a mano).

### Importar las actas

En la pantalla inicial se elige el `.zip` o los `.xlsx` (también arrastrándolos). Se leen en el navegador, sin dependencias ni servidor, y el catálogo queda guardado en ese navegador; **Actualizar archivos** lo reemplaza sin tocar las calificaciones ya capturadas.

Estructura de los archivos (analizada en las actas reales): cada hoja apila muchas actas. Cada acta trae `CARRERA`, `PROFESOR(A)` y `N° EXPEDIENTE`, `ASIGNATURA`, `CLAVE`, `GRUPO`, `CICLO ESCOLAR`, `FECHA DE INICIO` y la tabla `N° | N° Cuenta | Nombre Alumno | meses (C/F)`. El maestro se relaciona con el grupo por medio de la asignatura: un maestro puede tener el mismo grupo en dos materias y el mismo número de grupo existe en varias licenciaturas, así que cada opción de "Grupo" es grupo + asignatura, con la licenciatura como dato secundario.

- Las matrículas se guardan como texto (no se pierden ceros iniciales; se aceptan letras).
- Se ignoran filas vacías, encabezados repetidos, filas sin matrícula o sin nombre y alumnos repetidos en la misma acta.
- Se ignoran hojas sin actas (p. ej. listas sin maestro ni grupo), archivos exportados por esta app y archivos que no son Excel. Los `.xls` antiguos se deben guardar como `.xlsx`.

Para entregar una versión con los grupos ya cargados: `node tools/build.js --catalogo Licenciaturas.zip`. **Ese archivo contiene nombres y matrículas**: no lo subas al repositorio ni lo publiques.

## Reglas

```
Promedio parcial = (Parcial 1 + Parcial 2) / 2

1. Promedio parcial ≥ 8 (Enfermería: ≥ 9) → Exento. Final = promedio parcial redondeado.
2. Si no: Resultado = (Promedio parcial + Primera Vuelta) / 2
   Resultado exacto ≥ 6 → Aprobado. Final = resultado redondeado.
3. Si no (o NP en Primera Vuelta): Resultado = (Promedio parcial + Segunda Vuelta) / 2
   ≥ 6 → Aprobado en 2ª vuelta, final redondeada.
   < 6 o NP → se registra 5.
```

- Se exenta con 8 en todas las licenciaturas (incluido CCH) y con 9 en Enfermería; se decide por la licenciatura del acta (en captura sin grupo, por el campo Carrera de Datos del acta).
- Redondeo: .5 o más sube. Las calificaciones se capturan con un decimal como máximo.
- El promedio parcial se muestra con un decimal cortando el resto, como en el acta (7.75 → **7.7**); los cálculos usan el valor exacto.
- Parciales y vueltas aceptan **NP** (no presentó): se escribe o se usa el botón NP.
  - NP en un parcial cuenta como 0 (ya no puede exentar) y el alumno sigue a vueltas.
  - NP en los dos parciales → el acta dice **NP**, sin derecho a Primera ni Segunda Vuelta.
  - Calificación en un parcial, NP en el otro y NP en Primera y Segunda Vuelta → final 5.
- Faltas por mes, en los meses del acta menos diciembre (no hay clases). Porcentaje = total de faltas ÷ horas totales de clase.
- Límite de faltas: 20% en todas las licenciaturas, 10% en Enfermería. Si se rebasa (más del límite; exactamente el límite está permitido) se bloquean Primera y Segunda Vuelta y la final es 5, aunque el promedio alcanzara para exentar. Excepción: con NP en ambos parciales el acta sigue diciendo NP. Sin horas totales no se puede calcular y no se aplica. Las faltas capturadas por parcial en versiones anteriores se pasan al mes de ese parcial.
- Se puede guardar a un alumno con una vuelta pendiente y capturarla después con **Capturar**.

## Excel (Acta Económica)

`Calificaciones.xlsx` tiene dos hojas:

- **Acta**: formato de Acta Económica (encabezado de la institución, N°, N° de cuenta, nombre, C y F por mes, Prom., 1° y 2° vuelta, total y % de faltas, calificación final, firmas y leyendas), horizontal y ajustada a una página de ancho.
- **Detalle**: todos los valores, incluidos promedio y resultado exactos y el estado.

Los datos del encabezado se capturan una vez en **Datos del acta**. Los meses del Parcial 1 y 2 (Febrero y Abril por omisión) definen las columnas de meses.

## Captura con teclado

`Enter` avanza al siguiente campo habilitado (N° de cuenta → Alumno → Parcial 1 → Parcial 2 → faltas de cada mes → Primera Vuelta → Segunda Vuelta); cuando ya no hay más, guarda y regresa al inicio. `Esc` cancela una edición. Si el nombre se deja vacío se usa el que aparece de ejemplo (`Alumno N`). Las calificaciones se registran con un decimal como máximo (5.6, 6, 8.5), incluidas Primera y Segunda Vuelta; se acepta punto o coma. Los resultados calculados (9.05, 8.925) conservan toda su precisión.

## Datos

Los registros se guardan en `localStorage` de este navegador, así que sobreviven a una recarga. Exporta a Excel para conservarlos fuera del navegador.

El archivo de Excel es un `.xlsx` real generado sin dependencias (`js/xlsx.js`): encabezados en negritas, primera fila fija, anchos ajustados y calificaciones como números.

## Pruebas

```bash
npm test   # node --test; la prueba de Excel usa python3 + openpyxl si están disponibles
```
