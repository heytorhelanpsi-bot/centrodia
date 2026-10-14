# Imagem de produção do Reabilita+ (API + frontend compilado).
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm --prefix server ci && npm --prefix client ci
COPY server server
COPY client client
RUN npm --prefix client run build && npm --prefix server run build && npm --prefix server prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
