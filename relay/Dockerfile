FROM node:20-alpine

WORKDIR /app

# Copy package.json from parent directory (contains all dependencies)
COPY ../package.json ./
COPY relay.js ./

# Install dependencies
RUN npm install --production

# Expose ports
EXPOSE 4001 4002

# Run the relay server
CMD ["node", "relay.js"]
