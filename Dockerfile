FROM docker.io/golang:alpine AS build

WORKDIR /workspace

COPY . .

RUN apk add --no-cache \
        npm \
        # cgo: sqlite3
        gcc \
        musl-dev \
        ca-certificates \
    # build go binary
    && go build -ldflags '-w -extldflags "-static"' \
        -o gdprshare github.com/lixmal/gdprshare/cmd/gdprshare \
    # install js dependencies
    && npm install \
    # build bundle.js
    && npm run build \
    # adjust config
    && sed -i 's/gdprshare.db/\/data\/gdprshare.db/' config.yml \
    && sed -i 's/files'\''/\/data\/files'\'/ config.yml


FROM scratch

COPY --from=build /workspace/gdprshare /gdprshare/
COPY --from=build /workspace/public /gdprshare/public
COPY --from=build /workspace/config.yml /conf/
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

WORKDIR /gdprshare

EXPOSE 8080

STOPSIGNAL SIGTERM

ENV GIN_MODE release

VOLUME /conf

USER 1000:1000

VOLUME /data


CMD ["./gdprshare", "--config", "/conf/config.yml"]
