FROM node:20-bullseye

# Install Python and pip for the Python scripts
RUN apt-get update && apt-get install -y python3 python3-pip

WORKDIR /app

# Copy package manifests and install Node dependencies
COPY package*.json ./
RUN npm install

# Install Python dependencies required by the generators.
# Pinned to a major: all four generators depend on specific SDK surface
# (types.VideoGenerationReferenceImage, types.Image.from_file, types.ImageConfig,
# types.Part.from_bytes, GenerateContentConfig.response_modalities). Unpinned, a
# major release breaks generation on the next rebuild with no code change here.
RUN pip3 install "google-genai>=2.11,<3" requests

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
