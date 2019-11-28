FROM alpine:edge

WORKDIR /opt/gdprshare/
RUN apk add --update --no-cache --virtual .build-deps \
    # install build tools
        npm \
        go \
        git \
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
    && rm -rf src *.go go.* *.json misc \
    # create dir
    && mkdir /conf \
    # move config to volume
    && mv config.yml /conf/

EXPOSE 8080

VOLUME ["/conf"]

STOPSIGNAL SIGTERM

USER nobody:nogroup

ENV GIN_MODE release

CMD ["./gdprshare", "--config", "/conf/config.yml"]
