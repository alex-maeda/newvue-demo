FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
COPY HL7_Simulation ./HL7_Simulation
COPY FHIR ./FHIR
COPY config ./config
ENV PORT=8000
EXPOSE 8000
CMD ["npx", "tsx", "src/index.ts"]
