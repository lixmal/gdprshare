# gdprshare

## DESCRIPTION
GDPRShare is a web application that was developed to aid in avoiding of sending sensitive data via email. Some issues with email are:

* email transport encryption is known to have [issues](https://www.digicert.com/blog/striptls-attacks-and-email-security/), especially before MTA-STS was introduced. Unfortuantely MTA-STS is not very widespread yet and all involved MTAs need to be configured correctly for email transport to be secure.
* email end-to-end encryption is hard, especially between parties that previously didn't have any contact
* emails are usually stored in some unencrypted mailbox, which might become contaminated at some point in the future
* deletion of emails is mostly reversible, as shredding is rare
* some laws require businesses to archive emails (with sensitive data) for a very long time (up to 10 years), which might not be desirable for individuals

GDPRShare tries to provide file sharing capabilities that help with above problems and to comply with the GDPR law.
It does so by:

* encrypting files on the client side (AES-GCM), so files don't need to be shredded on the server side after deletion (NOTE: Usage of the web client won't protect from contaminated servers or malicious server operators)
* shredding files nevertheless (not yet implemented)
* providing records of used encryption in the transmission from sender to server to receiver. Implemented by sending an email to the sender upon successful download, including TLS version and ciphers used for both sender and receiver
* automatically deleting files after a period of time
* automatically deleting files after file was downloaded a specified amount of times
* conviently notifies sender on each download

See also [GDPR Art. 5 (2.)](https://gdpr-info.eu/art-5-gdpr/) and [GDPR Art. 24 (1.)](https://gdpr-info.eu/art-24-gdpr/) for the accountability aspects.

To maximize security, the file URL and the password should be distributed by the sender via two different channels (for example email + phone or email + messenger).
Using a dedicated (non-web) client would also make file transmission end-to-end encrypted (work in progress).

It is recommended to allow TLS1.2 and above only. As the config options are not yet available, it is advisable to use a reverse proxy in front of the application.

## REQUIREMENTS

### Client
* a modern web browser (not Internet Explorer/Edge)

### Server
* nothing if build statically
* some container engine if run as container image

### Building
* go compiler
* c compiler
* npm


## BUILDING
Build the binary:

    go build \
      -o gdprshare github.com/lixmal/gdprshare/cmd/gdprshare

or

    go build -ldflags="-extldflags=-static" \
      -o gdprshare github.com/lixmal/gdprshare/cmd/gdprshare



Afterwards build the js bundle:

`npm install`

`npm run build`

## RUN
Run locally:
`GIN_MODE=release ./gdprshare`

gdprshare will look for a `config.yml` in it's working directory, but you can specify `gdprshare -config <config file>` to change this.

Take a look at `misc/gdprshare.service` for an example systemd unit and `misc/crontab` for the cronjob to delete expired files.

Alternatively run the [docker image](https://ghcr.io/lixmal/gdprshare):

`sudo docker run -p 8080:8080 -v conf/path:/conf -v data/path:/data ghcr.io/lixmal/gdprshare`

The `/data` volume needs to be writable by the `nobody` user, and it requires a `files` directory inside (automatically created).
