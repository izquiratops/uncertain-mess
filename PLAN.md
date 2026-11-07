# PLAN.md — Issue-to-PR Agent Workflow

## Objetivo

Construir un orquestador de workflows en TypeScript que transforme una issue de Linear en una draft Pull Request mediante agentes Pi supervisados desde Herdr.

El sistema debe ser predecible, recuperable tras fallos, fácilmente extensible y mantener una arquitectura hexagonal ligera.

## Principios de diseño

1. **Deterministic outside, agentic inside.** Las transiciones, las verificaciones y las aprobaciones las determina código; las decisiones de implementación corresponden a los agentes.
2. **TypeScript first.** El dominio, la aplicación y los adaptadores se implementan en TypeScript. Solo se permite JavaScript de compatibilidad cuando el runtime lo requiera.
3. **Minimal abstractions.** Introducir interfaces únicamente para separar responsabilidades reales o permitir pruebas.
4. **No framework dependency in the domain.** El dominio no debe importar SDKs de Pi, Linear, Slack, GitHub ni librerías de persistencia.
5. **Explicit state.** Ninguna decisión importante debe depender exclusivamente del historial de una conversación.
6. **Recoverable operations.** Las acciones externas deben poder reconciliarse tras un reinicio, evitando duplicaciones.
7. **Tests before expansion.** Cada fase debe quedar validada antes de añadir funcionalidades.

## Requisitos funcionales

### Inicio

- El usuario inicia manualmente un workflow desde Pi indicando una issue de Linear.
- Se obtiene la descripción, los criterios de aceptación, attachments y referencias.
- Se recupera el contexto de Figma cuando existan enlaces relevantes.
- La ausencia de contexto obligatorio bloquea la implementación.

### Planificación

- Un agente genera un plan técnico estructurado.
- El usuario debe aprobar el plan siempre, antes de modificar el código.
- Un plan rechazado puede revisarse y presentarse de nuevo.
- Una modificación sustancial del alcance invalida la aprobación.

### Worktrees

- El directorio principal del repositorio permanece en la rama `main`.
- Cada issue trabaja en una rama y un worktree independientes.
- Se permite recuperar worktrees existentes asociados a una issue.
- Los worktrees no se eliminan automáticamente al terminar el workflow.
- Nunca se modifica la rama `main` desde una ejecución agéntica.
- Las operaciones concurrentes sobre el mismo worktree se bloquean.

### Implementación

- Un solo agente developer conserva su contexto a través de las iteraciones.
- El developer implementa el plan aprobado, modifica tests y corrige findings.
- No puede publicar directamente la PR.
- El workflow limita los ciclos de corrección y permite intervención humana.

### Verificación y review

- Los comandos de verificación se definen en el repositorio.
- Lint, tests, typecheck y build deben pasar cuando sean aplicables.
- Tres reviewers independientes evalúan:
  - Correctness y regresiones.
  - Cobertura y calidad de tests.
  - Complejidad innecesaria, YAGNI y simplicidad.
- Cada reviewer devuelve un resultado estructurado validado con Zod.
- Las reviews deben referirse al mismo snapshot del código.
- Cualquier cambio posterior invalida las aprobaciones anteriores.

### Publicación

- El sistema verifica nuevamente el snapshot aprobado.
- Publica los cambios mediante un commit y una rama de feature.
- Crea o reutiliza una draft PR.
- Registra la URL de la PR y la relaciona con la issue.
- La publicación debe ser recuperable e idempotente.

### Slack (opcional)

- Publicar eventos importantes en un thread por workflow.
- Mostrar planificación, aprobaciones pendientes, fallos y PR publicada.
- Almacenar el identificador del thread para reanudar notificaciones.
- La ausencia de Slack nunca debe bloquear el workflow.
- No implementar aprobaciones interactivas desde Slack en la primera versión.

## Arquitectura

### Domain

Contiene:

- `WorkflowState`
- `WorkflowEvent`
- `TaskContext`
- `ImplementationPlan`
- `ReviewResult`
- `VerificationResult`
- Reglas de transición y aprobación
- Políticas de reintentos y complejidad

El dominio debe ser puro y testeable sin servicios externos.

### Application

Implementa el caso de uso `IssueToPR` y coordina las etapas mediante puertos.

Puertos iniciales:

- `IssueProvider`
- `DesignProvider`
- `AgentRunner`
- `WorktreeManager`
- `VerificationRunner`
- `PullRequestPublisher`
- `RunRepository`
- `EventPublisher`

Evitar crear un puerto para cada función individual.

### Adapters

Implementar adaptadores específicos:

- Linear GraphQL
- Figma MCP
- Pi / pi-extensible-workflows
- Git worktrees
- GitHub CLI
- SQLite
- Slack Web API

La aplicación recibe sus dependencias mediante construcción explícita.

### Persistence

Utilizar SQLite inicialmente.

Persistir:

- Workflow ID e issue ID.
- Estado actual, versión y timestamp.
- Branch, worktree y commit base.
- Plan aprobado y su versión.
- Referencias a artefactos.
- Intentos de ejecución y review.
- Snapshot de código revisado.
- URL y estado de publicación de la PR.
- Identificador de thread de Slack.
- Historial de eventos y errores relevantes.

Utilizar un `RunRepository` que exponga operaciones atómicas de carga, creación y actualización con control de versión.

No usar el historial de Pi como fuente de verdad de las transiciones del negocio.

## Milestones

### M0 — Inicialización y contratos

- [x] Inicializar proyecto Node.js + TypeScript en strict mode.
- [x] Configurar esbuild, el runner de tests de Node, ESLint y scripts de build y typecheck (sin Vitest).
- [x] Definir contratos iniciales con Zod e inferir tipos.
- [x] Implementar la máquina de estados pura.
- [x] Crear tests de transiciones válidas e inválidas.

**Aceptación:** todas las transiciones se pueden probar sin Pi ni APIs externas.

### M1 — Persistencia y worktrees

- [x] Implementar repositorio SQLite.
- [x] Guardar estado, versiones, eventos y artefactos.
- [ ] Implementar `WorktreeManager`.
  - [ ] Probar interrupciones durante la creación y definir cómo recuperar ramas o worktrees parcialmente creados.
  - [ ] Devolver el commit base para que el workflow pueda persistirlo.
  - [ ] Conectar el manager con la persistencia para guardar y restaurar los datos del worktree.
  - [ ] Probar la interrupción y reanudación de un workflow persistido sin perder estado ni sobrescribir trabajo.
  - [ ] Definir el puerto `WorktreeManager` para que la aplicación no dependa directamente de Git.
- [x] Detectar worktrees existentes por issue y configuración.
- [x] Mantener intacto el checkout principal en `main` durante las operaciones del manager.
- [x] Añadir bloqueo por issue/worktree.
- [x] Probar recuperación del manager tras reinicio.

El adaptador Git cubre la creación, reutilización y bloqueo básicos. Aplazar el resto de esta integración hasta que exista un consumidor del workflow: entonces definir el puerto según sus necesidades y probar la persistencia y recuperación de extremo a extremo. No asumir todavía que Git worktrees será el único mecanismo de aislamiento; una VM podría reemplazarlo o complementarlo. La recuperación de interrupciones parciales y el commit base siguen pendientes y deben resolverse antes de usar el adaptador en un workflow real.

**Aceptación:** el workflow puede interrumpirse y reanudarse sin perder el estado ni sobrescribir un worktree.

### M2 — Linear y contexto

**Punto de partida:** `src/application/context.ts` define los puertos genéricos `IssueProvider` y `ContextSource` y compone el contexto; `src/adapters/linear-issue-provider.ts` consulta Linear mediante GraphQL y pagina attachments. `src/domain/contracts.ts` contiene los schemas Zod. `docs/context-providers.md` documenta las limitaciones actuales y la convención `required-context: URL`. Hay pruebas simuladas en `test/context.test.js` y `test/linear-issue-provider.test.js`. El proveedor no se ha validado con Linear real, no existe una fuente Figma y todavía no hay un caso de uso conectado a persistencia.

**Trabajo pendiente, en orden orientativo:**

1. [ ] Completar y verificar la normalización de Linear:
   - [ ] Validar la consulta GraphQL, autenticación y paginación con una issue real y credenciales proporcionadas por el usuario; no guardar credenciales ni datos privados en el repositorio. Documentar cómo ejecutar la prueba y qué hacer si no hay acceso.
   - [ ] Revisar cómo representar attachments y sus metadatos, descripción y criterios de aceptación sin perder información necesaria. Actualmente se conservan URL de attachments y solo se extraen listas bajo encabezados concretos; no inferir criterios silenciosamente cuando no existan.
   - [ ] Revisar extracción y clasificación de enlaces a Figma y otros recursos visuales, incluidos formatos Markdown relevantes, deduplicación y directivas `required-context`; documentar las limitaciones o reglas adoptadas.
2. [ ] Implementar una fuente de contexto para Figma usando `ContextSource`, sin acoplar el dominio ni el caso de uso a Figma. Definir configuración, permisos y representación normalizada de la información recuperada; probar respuestas y errores simulados. Mantener extensible la integración para otras fuentes.
3. [ ] Completar el contexto normalizado y reproducible:
   - [ ] Conservar los datos y el contenido externo necesarios para planificación, así como la obligatoriedad y el resultado de resolución de cada referencia. Actualmente `TaskContext` solo conserva URL y contenido resuelto, y los fallos opcionales se descartan.
   - [ ] Persistir un snapshot validado y versionado del contexto como artefacto; definir cuándo se reutiliza tras reiniciar y cuándo una actualización exige obtener una nueva versión. No depender de que los servicios externos sigan devolviendo los mismos datos.
4. [ ] Integrar la recuperación de contexto con el workflow y la persistencia:
   - [ ] Definir el puerto de repositorio que necesite el caso de uso, sin depender directamente de SQLite; utilizar las operaciones atómicas y el control de versión existentes en `SqliteRunRepository` o ampliarlos con migraciones cuando sea necesario.
   - [ ] Registrar intentos y resultados relevantes, incluidos fallos, advertencias y reintentos; filtrar credenciales y datos sensibles antes de persistirlos.
   - [ ] Ante un fallo obligatorio, registrar el motivo y pasar a `needs_attention` sin emitir `context_ready`; conservar los fallos opcionales como advertencias sin bloquear el workflow.
   - [ ] Definir y probar cómo reanudar tras `needs_attention` y cómo recuperar interrupciones sin perder el snapshot ni duplicar resultados. La máquina de estados actual no ofrece una transición de reanudación desde `needs_attention`.
   - [ ] Emitir `context_ready` solo después de validar y guardar el contexto; asegurar la coherencia entre evento, estado y artefacto ante fallos y conflictos de versión.
5. [ ] Ampliar las pruebas: proveedores genéricos intercambiables; criterios y attachments paginados; enlaces y directivas válidas e inválidas; fuentes externas exitosas, inaccesibles y con datos inválidos; fallos obligatorios y opcionales; persistencia, conflictos, interrupción y reanudación. Mantener pruebas simuladas sin red ni secretos.
6. [ ] Ejecutar Prettier sobre los archivos modificados y `npm run check`; actualizar `docs/context-providers.md` con configuración, reglas y limitaciones definitivas.

**Aceptación:** una issue real genera un contexto validado, persistido y reproducible; las referencias obligatorias inaccesibles bloquean el avance y sus fallos quedan registrados. La reanudación y los fallos opcionales están cubiertos por pruebas.

### M3 — Planificación y aprobación

- [ ] Implementar el adaptador Pi.
- [ ] Generar planes estructurados.
- [ ] Guardar el plan como artefacto versionado.
- [ ] Mostrar aprobación obligatoria desde Pi.
- [ ] Manejar rechazos y revisiones.
- [ ] Registrar explícitamente el plan aprobado.

**Aceptación:** ningún agente modifica código sin aprobación válida.

### M4 — Developer y verificaciones

- [ ] Ejecutar el developer dentro del worktree.
- [ ] Conservar la sesión entre correcciones.
- [ ] Ejecutar verificaciones deterministas.
- [ ] Guardar resultados y evidencias.
- [ ] Limitar reintentos.
- [ ] Añadir tests de fallos y reanudación.

**Aceptación:** una verificación fallida impide avanzar.

### M5 — Reviews independientes

- [ ] Implementar correctness reviewer.
- [ ] Implementar test coverage reviewer.
- [ ] Implementar unnecessary complexity reviewer.
- [ ] Ejecutarlos en paralelo sobre el mismo snapshot.
- [ ] Validar resultados con Zod.
- [ ] Devolver findings al developer.
- [ ] Invalidar reviews cuando cambie el código.
- [ ] Repetir verification y review después de las correcciones.

**Aceptación:** solo se obtiene `ready_for_pr` si los tres reviewers aprueban el mismo snapshot verificado.

### M6 — Publicación GitHub

- [ ] Verificar identidad del snapshot aprobado.
- [ ] Preparar commit y push.
- [ ] Detectar PR existente.
- [ ] Crear draft PR cuando no exista.
- [ ] Registrar operación de publicación y resultado.
- [ ] Recuperar fallos parciales sin duplicar PRs.
- [ ] Enlazar la PR con Linear cuando las credenciales lo permitan.

**Aceptación:** reintentar publicación no duplica commits innecesarios ni crea dos PRs para la misma ejecución.

### M7 — Slack

- [ ] Crear `SlackEventPublisher`.
- [ ] Generar un thread por workflow.
- [ ] Notificar: started, awaiting_approval, review_failed, needs_attention, completed.
- [ ] Persistir `channel` y `thread_ts`.
- [ ] Implementar reintentos y detección de mensajes ya enviados.
- [ ] Asegurar que los errores de Slack no bloquean publicación.

**Aceptación:** un workflow puede progresar sin Slack; si está configurado, sus eventos aparecen agrupados en una conversación.

### M8 — Evaluación de Pi Durable

- [ ] Crear un prototipo independiente de `DurableAgentRunner`.
- [ ] Pro
