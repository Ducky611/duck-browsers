FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7860
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY *.mjs ./
COPY public ./public
COPY data ./data
USER node
EXPOSE 7860
CMD ["node", "server.mjs"]
