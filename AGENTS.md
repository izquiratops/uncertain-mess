# Convenciones de código

- Separa con líneas en blanco las etapas y responsabilidades distintas; no es necesario separar cada sentencia.
- Da nombre a expresiones intermedias cuando ayude a explicar su propósito, especialmente si combinan varias operaciones.
- Extrae funciones para operaciones con una responsabilidad reconocible, no solo para reducir el número de líneas.
- Ajusta el detalle de los nombres a su alcance: en callbacks o usos inmediatos se admiten nombres breves si son inequívocos; cuanto mayor sea el alcance o la distancia entre declaración y uso, más descriptivo debe ser el nombre. Evita abreviaturas ambiguas incluso en ámbitos pequeños.
- En consultas GraphQL, escribe cada campo en su propia línea para facilitar su lectura y revisión.
- Al terminar cambios, ejecuta Prettier sobre los archivos modificados y después `npm run check`.
