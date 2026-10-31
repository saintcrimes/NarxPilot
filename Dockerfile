FROM node:22.22.0-bookworm-slim AS app
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TZ=UTC
# The installer uses umask 077; copied files can be owner-readable only.
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build
RUN chown -R node:node /app/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm","run","start"]
