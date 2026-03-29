FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY rules/ ./rules/
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/rules ./rules
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

ENV DESLOPIFY_TRANSPORT=sse
ENV DESLOPIFY_PORT=3000
EXPOSE 3000

CMD ["node", "build/index.js"]
