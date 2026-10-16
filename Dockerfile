# Cloud Run image. The Lovable build targets Cloudflare, so we build the Node server preset here.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-package-lock --no-audit --no-fund
COPY . .
ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/.output ./.output
# Cloud Run sets PORT; the server reads it.
CMD ["node", ".output/server/index.mjs"]
