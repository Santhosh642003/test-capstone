FROM node:20-alpine
WORKDIR /usr/app

# Install Chromium and dependencies
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      git

RUN npm install -g npm@10.9.0

# Tell Puppeteer/Playwright to use the installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Add user so we don't need --no-sandbox
RUN addgroup -S pptruser && adduser -S -G pptruser pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /usr/app

COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci

COPY --chown=pptruser:pptruser . .

# Run as non-privileged user
USER pptruser

RUN git config --global user.email "info@analytiq.us" && git config --global user.name "fw-auth-service"

CMD ["npm", "run" ,"prod"]