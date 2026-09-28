# Intermediario de webhooks Kommo -> n8n.
#
# A diferencia del panel, este si tiene una dependencia: el cliente de
# Postgres. Todo lo demas son modulos de Node.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./

ENV PORT=3000

# El estado vive en Postgres, no en disco: este contenedor no necesita volumen
# y se puede reemplazar entero sin perder la cola ni el historial.
EXPOSE 3000
CMD ["node", "server.mjs"]
