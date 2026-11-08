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

**Estado actual:** `src/application/context.ts` define los puertos genéricos y recoge un snapshot validado con el resultado de cada referencia. Los adaptadores Linear y Figma tienen pruebas simuladas, pero no se han validado con servicios reales. `src/application/prepare-context.ts` conecta la recuperación con un puerto de repositorio y persiste el snapshot y la transición de forma atómica. `docs/context-providers.md` y `docs/figma-context-source.md` documentan la configuración y las limitaciones conocidas.

**Trabajo realizado y pendiente:**

1. [ ] Completar y verificar la normalización de Linear:
   - [ ] Validar la consulta GraphQL, autenticación y paginación con una issue real y credenciales proporcionadas por el usuario; no guardar credenciales ni datos privados en el repositorio. Documentar cómo ejecutar la prueba y qué hacer si no hay acceso.
   - [x] Revisar la representación actual: se conserva la descripción completa y las URL de attachments; solo se extraen listas bajo encabezados concretos, sin inferir criterios. Se aplaza recuperar metadatos adicionales de attachments hasta que exista un consumidor que los necesite.
   - [x] Documentar las reglas actuales de extracción, deduplicación, selección de fuente y directivas `required-context`, así como las limitaciones de Markdown. Se aplaza un parser Markdown completo y la clasificación adicional hasta tener casos de uso concretos.
2. [x] Implementar una fuente de contexto para Figma usando `ContextSource`, sin acoplar el dominio ni el caso de uso a Figma. Definir configuración, permisos y representación normalizada de la información recuperada; probar respuestas y errores simulados. Mantener extensible la integración para otras fuentes. La validación con Figma real sigue pendiente.
3. [ ] Completar el contexto normalizado y reproducible:
   - [x] Conservar en `ContextSnapshot` la issue, el contenido resuelto, la obligatoriedad y el resultado de cada referencia, incluidos los fallos opcionales. `TaskContext` mantiene su representación anterior.
   - [x] Persistir un snapshot validado y versionado como artefacto; reutilizarlo en `planning` y crear una nueva versión al reintentar una recuperación fallida.
   - [ ] Definir e implementar cómo solicitar una actualización explícita del contexto ya aceptado y cómo invalidar el trabajo posterior que dependa de la versión anterior.
4. [ ] Integrar la recuperación de contexto con el workflow y la persistencia:
   - [x] Definir el puerto de repositorio necesario para el caso de uso sin depender directamente de SQLite; usar las operaciones atómicas y el control de versión existentes.
   - [x] Registrar el inicio de los intentos, sus resultados y los reintentos; conservar los fallos opcionales en el snapshot. Los mensajes de error de los proveedores no se persisten.
   - [x] Excluir del alcance el filtrado de credenciales y datos sensibles del contenido y los enlaces: se asume que Linear, Figma y el chat no contienen secretos ni tokens. El contenido se persiste sin filtrar.
   - [x] Ante un fallo obligatorio, registrar un motivo genérico y pasar a `needs_attention` sin emitir `context_ready`; conservar los fallos opcionales sin bloquear el workflow.
   - [x] Permitir y probar el reintento explícito desde `needs_attention` cuando el fallo ocurrió durante la recuperación inicial de contexto.
   - [x] Probar la recuperación tras una interrupción previa al resultado y los conflictos entre intentos concurrentes, sin perder snapshots ni duplicar resultados.
   - [x] Registrar por referencia los errores al seleccionar una fuente, igual que los errores al resolverla; una referencia opcional no bloquea y una obligatoria sí.
   - [x] Validar el contexto y guardar el artefacto, el evento `context_ready` y el estado en una misma operación atómica.
5. [x] Ampliar las pruebas sin red ni secretos: proveedores, directivas, Figma, snapshots, fallos opcionales integrados, reintento, conflicto concurrente y reanudación tras interrupción.
   - [x] Preparar pruebas de integración optativas con Linear y Figma reales y SQLite temporal, incluidas la paginación y la reutilización del snapshot tras reiniciar. Los casos sin configuración se omiten; no constituyen una validación real.
6. [x] Documentar reglas y limitaciones actuales y cómo realizar la validación manual; ejecutar Prettier y `npm run check`.

**Aplazamientos para continuar:** la actualización explícita de contexto se diseñará con planificación y aprobación en M3, de forma que invalide el trabajo dependiente. La validación con Linear y Figma reales requiere acceso y datos de prueba facilitados por el usuario; hasta entonces no se cumple plenamente la aceptación de M2. No se implementará detección ni filtrado de secretos en el contexto: el usuario es responsable de no incluirlos en Linear, Figma o el chat y de restringir severamente las credenciales de desarrollo.

**Aceptación:** una issue real genera un contexto validado, persistido y reproducible; las referencias obligatorias inaccesibles bloquean el avance y sus fallos quedan registrados. La reanudación y los fallos opcionales están cubiertos por pruebas.

### M3 — Planificación y aprobación

- [ ] Implementar el adaptador Pi.
- [ ] Ejecutar el orquestador y los agentes en entornos separados; no poner automáticamente las credenciales del orquestador a disposición de los agentes. Definir y probar esta separación al integrar el runner.
- [ ] Generar planes estructurados.
- [ ] Guardar el plan como artefacto versionado.
- [ ] Mostrar aprobación obligatoria desde Pi.
- [ ] Manejar rechazos y revisiones.
- [ ] Registrar explícitamente el plan aprobado.

**Aceptación:** ningún agente modifica código sin aprobación válida.

### M4 — Developer y verificaciones

- [ ] Ejecutar el developer en un entorno separado del orquestador, con el espacio de trabajo y las credenciales de desarrollo necesarios para el proyecto. Evaluar Docker Sandboxes o una VM sin asumir que Git worktrees proporciona aislamiento.
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
