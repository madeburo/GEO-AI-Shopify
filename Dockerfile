FROM node:18-alpine

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
RUN rm -rf ~/.npm

COPY . .

RUN npx prisma generate
RUN npm run build

CMD ["npm", "run", "docker-start"]
