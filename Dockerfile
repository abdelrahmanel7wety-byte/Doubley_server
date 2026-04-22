
FROM node:18



RUN apt-get update && apt-get install -y \

    ffmpeg \

    python3 \

    curl \

    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \

    && chmod a+rx /usr/local/bin/yt-dlp \

    && apt-get clean



WORKDIR /app



COPY package.json ./

RUN npm install --production



COPY server.js ./



EXPOSE 3000

CMD ["node", "server.js"]
