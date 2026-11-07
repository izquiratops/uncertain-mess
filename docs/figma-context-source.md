# Fuente de contexto Figma

`FigmaContextSource` recibe `accessToken` (un token personal con permiso de lectura de archivos y acceso al archivo) y, opcionalmente, `fetch` para pruebas. No guardar tokens en el repositorio. Las referencias HTTPS a `figma.com` o `www.figma.com` con rutas `/file/CLAVE` o `/design/CLAVE` se resuelven mediante la API REST de Figma. Un parámetro `node-id` numérico selecciona ese nodo; sin él se recupera el archivo completo. Otros tipos de enlace no se admiten.

El contenido es JSON serializado con la respuesta validada de archivo o nodos, incluidos sus metadatos y árbol de documentos. No se descargan imágenes, comentarios ni recursos enlazados; el contenido puede ser grande y contener información privada. Los errores HTTP, los nodos ausentes y las respuestas inválidas rechazan la resolución. Los permisos, límites y disponibilidad dependen de Figma. La integración aún no se ha validado con un archivo real.
