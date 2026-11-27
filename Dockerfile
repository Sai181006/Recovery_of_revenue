# Runs the app with Node's built-in type stripping, HTTP server and SQLite.
# There are no runtime npm dependencies, so no `npm install` happens in the image.
FROM node:24.13.1-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_PATH=/data/recovery.sqlite \
    PUBLIC_DIR=/app/public

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY fixtures ./fixtures
COPY public ./public
COPY tools/demo-server.ts ./tools/demo-server.ts

# SQLite lives on a volume so production data survives container restarts.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning"]
# Default: production mode (never seeds synthetic data).
# Seeded demo instead:  docker run ... revenue-recovery tools/demo-server.ts demo
CMD ["src/server.ts", "production"]
