FROM node:22-alpine

WORKDIR /app

# Copy package.json from context root (now project root)
COPY package.json ./
COPY relay/ ./

# Install dependencies
RUN npm install --omit=dev

# Expose ports
EXPOSE 4001 4002 4006 3000

# Run the relay server
CMD ["node", "relay-enhanced.js"]
