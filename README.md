# Metabase API Proxy

This is a proxy for [Metabase](https://www.metabase.com) that automatically
fetches a session key using the provided credentials and adds the necessary
authentication header to the requests, so that no authentication is required
when making requests to the API.

## Usage

```sh
metabase-api-proxy --config <PATH_TO_CONFIG_FILE>
```

### Use with Docker

```sh
docker run \
  -v $PWD/myconfig.conf:/etc/metabase-api-proxy.conf:ro \
  -v $PWD/selfsigned.key:/opt/privkey.pem:ro \
  -v $PWD/selfsigned.crt:/opt/fullchain.pem:ro \
  -p 8011:443 \
  ghcr.io/maxkueng/metabase-api-proxy:latest
```

## Configuration

The default location for the config file is `./.metabase-api-proxy.conf`

```yaml
---
proxy:
  # Public-facing host name of the proxy.
  # Default: localhost
  hostname: localhost

  # Address of the interface to listen on.
  # Default: 0.0.0.0
  address: 0.0.0.0

  # Post to listen on.
  # Default: 443 if SSL is enabled, 80 if disabled
  port: 8011

  # Enable SSL.
  # Note: Unless this proxy is running behind another proxy that uses SSL, SSL
  # must be turned on because Metabase's cookies require a secure connection.
  # Default: false
  ssl: true

  # Path to SSL key.
  # Default: privkey.pem
  keyfile: privkey.pem

  # Path to SSL certificate.
  # Default: fullchain.pem
  certfile: fullchain.pem

  # URL to your Metabase instance (must use https).
  # REQUIRED
  target: https://metabase.example.org

metabase:
  # Login email of the Metabase user
  # REQUIRED
  email: metabase.user@example.org

  # Password of the Metabase user
  # REQUIRED
  password: secret
```

## License

Copyright (c) 2021 Max Kueng

MIT License

