# Primer lote: acceso y privacidad

Cambios: política de acceso REST/Socket.IO, aislamiento de directos y reacciones,
validación de recursos, autenticación contra usuario actual y bloqueo,
secretos obligatorios, confirmación y deduplicación por clientMessageId.

Preparación:
1. Configurar JWT_SECRET y JWT_REFRESH_SECRET con valores aleatorios distintos,
   de al menos 32 caracteres. No usar los antiguos secretos alternativos.
2. Generar cada valor con: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
3. Al cambiar secretos se invalidan las sesiones existentes: iniciar sesión de nuevo.
4. Revisar/crear los índices de Message antes de habilitar clientes con reintento.
   Índices nuevos: (userId,clientMessageId) único parcial solo para strings;
   (roomId,_id) para historial. Los documentos antiguos sin ID no colisionan.
   En producción, gestionar creación de índices como migración supervisada.

Ejecutar npm ci, npm run build y npm test.
Las pruebas usan servidor HTTP y sockets reales en puerto local efímero y dobles
para los modelos de persistencia. No sustituyen una prueba con MongoDB real.

Compatibilidad: eventos y respuestas del historial conservan los nombres y formas
actuales. El historial devuelve los 500 más recientes en orden ascendente y acepta
?before=<ObjectId>. Las sub-salas requieren acceso tanto a raíz como a sub-sala.
No se puede crear una sub-sala bajo una sala ajena ni crear niveles adicionales.
El listado de salas deja de incluir el correo del propietario y la presencia no
publica correos. La UI debe usar nombre/avatar público.

Pendientes antes de beta pública: protección y validación completa de adjuntos,
renovación/revocación de sesiones, límites de abuso, paginación de directorio,
limpieza de datos y migración servidor/canal. Los medios y pagos no están habilitados.
La comprobación por destinatario prioriza privacidad sobre rendimiento; debe medirse
y sustituirse por invalidación de permisos distribuida al escalar a varias instancias.
