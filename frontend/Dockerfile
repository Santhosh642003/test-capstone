FROM node:18-alpine
RUN npm install -g serve
WORKDIR /usr/app
COPY package*.json ./
# RUN npm install --production
COPY . .

CMD ["serve", "-s", "build"]
# CMD ["npm", "start"]