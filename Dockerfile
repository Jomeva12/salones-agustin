# Panel de Salones Agustin Barron.
#
# Cero dependencias: no hay npm install. Node 22 trae SQLite y el servidor
# HTTP, asi que la imagen es el codigo y nada mas.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend

# Dentro del contenedor hay que escuchar en TODAS las interfaces. 127.0.0.1
# sirve cuando el proxy vive en la misma maquina, pero el de Easypanel esta
# en otro contenedor: ahi 127.0.0.1 lo dejaria inalcanzable.
ENV HOST=0.0.0.0
ENV PORT=4300

# La base vive en un VOLUMEN, no en la imagen. Un redespliegue reemplaza la
# imagen entera; si la base viajara dentro, cada despliegue borraria las
# tarifas, la agenda y los usuarios.
ENV DB_PATH=/datos/salones.db
VOLUME ["/datos"]

# Si el volumen esta vacio el servidor se detiene y dice que hay que subir la
# base. Es a proposito: arrancar con una base vacia se ve como que funciono,
# y el agente empezaria a cotizar sobre un negocio sin precios.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4300/api/salud || exit 1

EXPOSE 4300
CMD ["node", "backend/server.js"]
