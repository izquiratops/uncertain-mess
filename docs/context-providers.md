# Proveedores de contexto

`IssueProvider` normaliza tickets y `ContextSource` resuelve referencias externas. `createTaskContext` conserva las URL aunque una referencia opcional no se pueda resolver; una referencia obligatoria sin fuente o con error impide crear el contexto. Las fuentes se prueban en el orden configurado y la primera compatible es la responsable de resolverla.

`LinearIssueProvider` usa la API GraphQL con una API key y permite inyectar `fetch` para pruebas. Recupera todas las páginas de attachments, extrae URL HTTP(S) de la descripción y deduplica referencias. Reconoce listas bajo los encabezados Markdown `Acceptance criteria` o `Criterios de aceptación`; no infiere criterios desde texto libre. Se requiere una descripción no vacía.

Las referencias de Linear son opcionales salvo que se declaren explícitamente, en una línea independiente de la descripción, con `required-context: https://example.com/recurso`. La directiva acepta una URL HTTP(S) por línea; se pueden añadir varias líneas. Si también aparece como enlace o attachment, se deduplica y sigue siendo obligatoria. Una directiva con URL inválida bloquea la lectura de la issue. Un enlace sin esta marca no bloqueará el contexto si es inaccesible.

La extracción de URL es básica y no sustituye un parser Markdown: busca texto que comience por `http://` o `https://`, también en enlaces e imágenes Markdown, y elimina puntuación final. Puede interpretar incorrectamente paréntesis finales, títulos de enlaces, bloques de código y URL escapadas. La deduplicación compara cadenas exactas, sin normalizar equivalencias. No se clasifican enlaces por tipo: cada fuente decide si puede resolverlos. Los attachments solo conservan su URL; título, descripción y otros metadatos no se recuperan. La descripción completa se conserva y, si no hay una lista reconocida, los criterios quedan vacíos. La fuente Figma se describe en `docs/figma-context-source.md`.

### Comprobación manual de Linear

La consulta y la paginación todavía no se han validado con una issue real. Con una API key de acceso limitado y una issue de prueba sin datos privados, ejecutar `npm run build` y después, en un entorno local seguro:

```sh
LINEAR_API_KEY='...' LINEAR_ISSUE_ID='ABC-123' node --input-type=module -e '
import { LinearIssueProvider } from "./dist/index.js";
const issue = await new LinearIssueProvider({ apiKey: process.env.LINEAR_API_KEY }).getIssue(process.env.LINEAR_ISSUE_ID);
console.log({ id: issue.id, criteria: issue.acceptanceCriteria.length, references: issue.references.length });
'
```

Comparar los conteos con la issue, incluidos sus attachments; para validar paginación hace falta una issue con más de 100 attachments. No compartir la salida si el identificador es privado, ni guardar claves en archivos o historial de comandos; preferir un gestor de secretos para proporcionar las variables. Si no hay acceso, ejecutar las pruebas simuladas y dejar la validación real pendiente; no darla por superada.

`prepareContext` registra cada intento y guarda el snapshot junto con el evento de resultado en una transacción del repositorio. Un fallo obligatorio pasa a `needs_attention`; `retry: true` permite un nuevo intento. En `planning`, una llamada posterior reutiliza el snapshot guardado. Una interrupción antes del resultado deja registrado el intento y la siguiente llamada vuelve a consultar los proveedores. Los fallos opcionales quedan en el snapshot. Los intentos concurrentes compiten mediante control de versión: solo uno puede guardar el resultado; el perdedor recibe un conflicto y debe volver a cargar el estado, sin reintentar automáticamente una operación potencialmente obsoleta.

**Política de contenido:** los snapshots y eventos conservan texto y enlaces de los servicios externos sin filtrar secretos ni datos sensibles. No está prevista la detección o eliminación automática: el usuario es responsable de que Linear, Figma y el chat no incluyan secretos ni tokens, y de restringir severamente las credenciales de desarrollo. Los mensajes de error de los proveedores no se persisten.

El diseño previsto ejecutará el orquestador y los agentes en entornos separados: las credenciales del orquestador, como la API key de Linear, no se proporcionarán automáticamente a los agentes. Esta separación todavía no está implementada. El entorno del proyecto podrá recibir las credenciales de desarrollo que necesite; Git worktrees por sí solo no proporciona aislamiento.
