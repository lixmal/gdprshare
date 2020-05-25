FROM golang:alpine AS build

WORKDIR /workspace

COPY . .

RUN apk add --no-cache \
        npm \
        # cgo: sqlite3
        gcc \
        musl-dev \
    # build go binary
    && go build -ldflags '-w -extldflags "-static"' \
    # install js dependencies
    && npm install \
    # build bundle.js
    && npm run build \
    # adjust config
    && sed -i 's/gdprshare.db/\/data\/gdprshare.db/' config.yml \
    && sed -i 's/files'\''/\/data\/files'\'/ config.yml


FROM alpine

COPY --from=build /workspace/gdprshare /gdprshare/
COPY --from=build /workspace/public /gdprshare/public
COPY --from=build /workspace/config.yml /conf/

USER nobody:nogroup

VOLUME /conf /data

EXPOSE 8080

STOPSIGNAL SIGTERM

ENV GIN_MODE release

WORKDIR /gdprshare

CMD ["./gdprshare", "--config", "/conf/config.yml"]
