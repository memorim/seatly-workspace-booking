FROM node:24.18.0-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.7.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV NODE_ENV=production
USER node
EXPOSE 4200
CMD ["node","--import","tsx","server/hosted-index.ts"]
