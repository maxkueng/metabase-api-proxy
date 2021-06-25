#!/usr/bin/env bash

docker build --rm -t maxkueng/metabase-api-proxy:latest --build-arg ARCH=amd64/ .

