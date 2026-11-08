# Guía para agentes

## Proyecto

Issue-to-PR es un orquestador de workflows en TypeScript cuyo objetivo es transformar tareas de herramientas de gestión en draft Pull Requests mediante procesos iniciados desde un chat. El diseño y las fases previstas están en `PLAN.md`; no presupongas que todo lo descrito allí ya está implementado.

## Estructura

- `src/domain/`: contratos y lógica del workflow, independientes de SDKs y persistencia.
- `src/application/`: preparación y tratamiento del contexto.
- `src/adapters/`: integraciones con Linear, Figma, SQLite y Git worktrees.
- `src/index.ts`: exportaciones públicas.
- `test/`: pruebas con el test runner de Node.js.
- `docs/`: documentación específica de proveedores de contexto, migraciones y worktrees.
- `dist/`: salida generada de la compilación; modifica las fuentes en `src/`.

## Entorno y comandos

Se requiere Node.js >= 22.13.0. Instala las dependencias con `npm ci` cuando sea necesario.

- `npm run build`: genera `dist/index.js` con esbuild.
- `npm run typecheck`: comprueba los tipos sin emitir archivos.
- `npm run lint`: ejecuta ESLint.
- `npm run format`: aplica Prettier al proyecto.
- `npm test`: compila y ejecuta las pruebas.
- `npm run check`: ejecuta typecheck, lint y pruebas.

## Convenciones de código

- Separa con líneas en blanco las etapas y responsabilidades distintas; no es necesario separar cada sentencia.
- Da nombre a expresiones intermedias cuando ayude a explicar su propósito, especialmente si combinan varias operaciones.
- Extrae funciones para operaciones con una responsabilidad reconocible, no solo para reducir el número de líneas.
- Ajusta el detalle de los nombres a su alcance: en callbacks o usos inmediatos se admiten nombres breves si son inequívocos; cuanto mayor sea el alcance o la distancia entre declaración y uso, más descriptivo debe ser el nombre. Evita abreviaturas ambiguas incluso en ámbitos pequeños.
- En consultas GraphQL, escribe cada campo en su propia línea para facilitar su lectura y revisión.

## Validación de cambios

Al terminar cambios, ejecuta `npm run format` y después `npm run check`.
