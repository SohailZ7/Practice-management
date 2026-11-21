FROM node:26-slim AS build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# next/font downloads Google Fonts during the build; that download fails at random from some networks, so retry the build.
RUN npx prisma generate && (npm run build || (sleep 10 && npm run build) || (sleep 30 && npm run build))

FROM node:26-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 8080
CMD ["sh", "-c", "npx next start -p ${PORT:-8080}"]
