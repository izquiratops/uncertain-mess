# Proveedores de contexto

`IssueProvider` normaliza tickets y `ContextSource` resuelve referencias externas. `createTaskContext` conserva las URL aunque una referencia opcional no se pueda resolver; una referencia obligatoria sin fuente o con error impide crear el contexto. Las fuentes se prueban en el orden configurado y la primera compatible es la responsable de resolverla.

`LinearIssueProvider` usa la API GraphQL con una API key y permite inyectar `fetch` para pruebas. Recupera todas las páginas de attachments, extrae URL HTTP(S) de la descripción y deduplica referencias. Reconoce listas bajo los encabezados Markdown `Acceptance criteria` o `Criterios de aceptación`; no infiere criterios desde texto libre. Se requiere una descripción no vacía.

Las referencias de Linear son opcionales salvo que se declaren explícitamente, en una línea independiente de la descripción, con `required-context: https://example.com/recurso`. La directiva acepta una URL HTTP(S) por línea; se pueden añadir varias líneas. Si también aparece como enlace o attachment, se deduplica y sigue siendo obligatoria. Una directiva con URL inválida bloquea la lectura de la issue. Un enlace sin esta marca no bloqueará el contexto si es inaccesible.

La extracción de URL es básica y no sustituye un parser Markdown. El adaptador aún no se ha verificado con una issue real. La fuente Figma se describe en `docs/figma-context-source.md`.

`prepareContext` registra cada intento y guarda el snapshot junto con el evento de resultado en una transacción del repositorio. Un fallo obligatorio pasa a `needs_attention`; `retry: true` permite un nuevo intento. En `planning`, una llamada posterior reutiliza el snapshot guardado. Una interrupción antes del resultado deja registrado el intento y la siguiente llamada vuelve a consultar los proveedores. Los fallos opcionales quedan en el snapshot.

**Precaución:** los snapshots y eventos contienen texto y enlaces tal como los proporcionan los servicios externos. No existe todavía un filtro general de credenciales o datos sensibles en ese contenido; no usar esta integración con datos sensibles hasta implementar una política de filtrado y protección de la base de datos.
