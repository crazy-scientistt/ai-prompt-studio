FROM node:20-alpine
WORKDIR /app
COPY gateway.js .
RUN mkdir -p /data
ENV PORT=8791 \
    DATA_DIR=/data \
    NODE_ENV=production
EXPOSE 8791
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8791/health || exit 1
CMD ["node", "gateway.js"]
