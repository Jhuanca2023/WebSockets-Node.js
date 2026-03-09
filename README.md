# WebSockets Node.js Backend

Backend profesional en Node.js y TypeScript para el sistema de chat premium WebRocket. Utiliza Socket.IO para comunicación en tiempo real y MongoDB/Mongoose para la persistencia de datos.

##  Tecnologías

- **Node.js**: Entorno de ejecución.
- **TypeScript**: Lenguaje de programación.
- **Express**: Framework web.
- **Socket.IO**: Comunicación bidireccional en tiempo real.
- **Mongoose**: Modelado de datos para MongoDB.
- **JWT**: Autenticación segura.
- **Bcryptjs**: Encriptación de contraseñas.

##  Instalación

1. Clona el repositorio:
   ```bash
   git clone https://github.com/Jhuanca2023/WebSockets-Node.js.git
   ```
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Configura las variables de entorno:
   Crea un archivo `.env` basado en el siguiente ejemplo:
   ```env
   PORT=3000
   MONGODB_URI=tu_uri_de_mongodb
   JWT_SECRET=tu_secreto_super_seguro
   ```
4. Inicia el servidor en modo desarrollo:
   ```bash
   npm run dev
   ```

##  Frontend Relacionado
Puedes encontrar el frontend de este proyecto aquí: [WebSocket-Angular](https://github.com/Jhuanca2023/WebSocket-Angular)

##  Estructura del Proyecto
- `src/index.ts`: Punto de entrada del servidor.
- `src/config/`: Configuraciones de base de datos y variables.
- `src/models/`: Definición de esquemas de Mongoose.
- `src/controllers/`: Lógica de negocio para las peticiones HTTP.
- `src/routes/`: Definición de rutas de la API.
- `src/sockets/`: Lógica para eventos de Socket.IO.

---
Diseñado por [Jhuanca2023](https://github.com/Jhuanca2023).
