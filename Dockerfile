FROM node:20-bullseye

# Install Python and pip for the Python scripts
RUN apt-get update && apt-get install -y python3 python3-pip

WORKDIR /app

# Copy package manifests and install Node dependencies
COPY package*.json ./
RUN npm install

# Install Python dependencies required by veo_generator.py
RUN pip3 install google-genai requests

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
