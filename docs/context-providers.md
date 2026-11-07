# Proveedores de contexto

`IssueProvider` normaliza tickets y `ContextSource` resuelve referencias externas. `createTaskContext` conserva las URL aunque una referencia opcional no se pueda resolver; una referencia obligatoria sin fuente o con error impide crear el contexto. Las fuentes se prueban en el orden configurado y la primera compatible es la responsable de resolverla.

`LinearIssueProvider` usa la API GraphQL con una API key y permite inyectar `fetch` para pruebas. Recupera todas las páginas de attachments, extrae URL HTTP(S) de la descripción y deduplica referencias. Reconoce listas bajo los encabezados Markdown `Acceptance criteria` o `Criterios de aceptación`; no infiere criterios desde texto libre. Se requiere una descripción no vacía.

Las referencias de Linear son opcionales salvo que se declaren explícitamente, en una línea independiente de la descripción, con `required-context: https://example.com/recurso`. La directiva acepta una URL HTTP(S) por línea; se pueden añadir varias líneas. Si también aparece como enlace o attachment, se deduplica y sigue siendo obligatoria. Una directiva con URL inválida bloquea la lectura de la issue. Un enlace sin esta marca no bloqueará el contexto si es inaccesible.

La extracción de URL es básica y no sustituye un parser Markdown. El adaptador aún no se ha verificado con una issue real y no existe todavía una fuente Figma.
