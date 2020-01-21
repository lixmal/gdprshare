FROM alpine:edge

WORKDIR /opt/gdprshare/
RUN apk add --update --no-cache --virtual .build-deps \
    # install build tools
        npm \
        go \
        git \
        # cgo: sqlite3
        gcc \
        musl-dev \
    # get source
    && cd .. \
    && git clone https://github.com/lixmal/gdprshare \
    && cd gdprshare \
    # build go binary
    && go build \
    # install js dependencies
    && npm install \
    # build bundle.js
    && npm run build \
    && rm -rf node_modules \
    # remove build tools
    && apk del --purge .build-deps \
    && rm -rf src .git* *.go go.* *.json misc files \
    # create dirs
    && mkdir -p /conf /data/files \
    # adjust config
    && sed -i 's/gdprshare.db/\/data\/gdprshare.db/' config.yml \
    && sed -i 's/files'\''/\/data\/files'\'/ config.yml \
    # move config to volume
    && mv config.yml /conf/

EXPOSE 8080

USER nobody:nogroup

VOLUME /conf /data

STOPSIGNAL SIGTERM

ENV GIN_MODE release

CMD ["./gdprshare", "--config", "/conf/config.yml"]
