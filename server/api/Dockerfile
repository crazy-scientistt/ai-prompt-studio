# Billing / accounts service. No dependencies to install, so the image is tiny
# and there is no lockfile to keep in sync.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
# The ledger lives here — attach a Railway volume at /data or it resets on deploy.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "src/server.js"]
