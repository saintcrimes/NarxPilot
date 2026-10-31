FROM node:22.22.0-bookworm-slim AS app
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TZ=UTC
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm","run","start"]
