# Proveedores de contexto

`IssueProvider` normaliza tickets y `ContextSource` resuelve referencias externas. `createTaskContext` conserva las URL aunque una referencia opcional no se pueda resolver; una referencia obligatoria sin fuente o con error impide crear el contexto. Las fuentes se prueban en el orden configurado y la primera compatible es la responsable de resolverla.

`LinearIssueProvider` usa la API GraphQL con una API key y permite inyectar `fetch` para pruebas. Recupera todas las páginas de attachments, extrae URL HTTP(S) de la descripción y deduplica referencias. Reconoce listas bajo los encabezados Markdown `Acceptance criteria` o `Criterios de aceptación`; no infiere criterios desde texto libre. Se requiere una descripción no vacía.

Por ahora todas las referencias procedentes de Linear se consideran **opcionales**: Linear no proporciona aquí una señal inequívoca de obligatoriedad. Antes de ejecutar workflows reales debe definirse cómo marcar referencias obligatorias; de otro modo, un enlace de Figma inaccesible no bloqueará el contexto. La extracción de URL es básica y no sustituye un parser Markdown. El adaptador aún no se ha verificado con una issue real y no existe todavía una fuente Figma.
