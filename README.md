# gdprshare

## BUILDING
`go build` or `go build -ldflags="-extldflags=-static"`

`npm install`

`npm run build`

## RUN
Run locally:
`GIN_MODE=release ./gdprshare`

Take a look at `misc/gdprshare.server` for an example systemd unit.

Alternatively run the [docker image](https://hub.docker.com/r/lixmal/gdprshare)

