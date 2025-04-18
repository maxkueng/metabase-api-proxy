ARG ARCH=
FROM ${ARCH}alpine:3.14.0

RUN \
  apk add --no-cache \
    nodejs \
    npm

WORKDIR /opt

COPY package.json ./
COPY package-lock.json ./
COPY metabase-api-proxy.js ./

RUN \
  npm config set unsafe-perm \
  && npm install \
  && rm -f -r \
    /root/.node-gyp \
    /root/.npm \
    /tmp/.[!.]* \
    /tmp/* \
    /usr/lib/node_modules \
    /usr/local/share/.cache

CMD ["/usr/bin/node", "/opt/metabase-api-proxy.js", "-c", "/etc/metabase-api-proxy.conf"]
