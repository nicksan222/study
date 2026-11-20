#!/bin/sh
set -eu

# TLS trust is confined to the cloud integration test process.
umask 077
tls="$1"
shift
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -days 1 \
  -subj /CN=Study-cloud-test-CA -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$tls/ca.key" -out "$tls/ca.pem" >/dev/null 2>&1
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc \
  -subj /CN=Study-cloud-integration -addext subjectAltName=IP:127.0.0.1,DNS:localhost \
  -addext 'basicConstraints=critical,CA:FALSE' -addext extendedKeyUsage=serverAuth \
  -keyout "$tls/rustfs_key.pem" -out "$tls/rustfs.csr" >/dev/null 2>&1
openssl x509 -req -days 1 -copy_extensions copy -in "$tls/rustfs.csr" \
  -CA "$tls/ca.pem" -CAkey "$tls/ca.key" -out "$tls/rustfs_cert.pem" >/dev/null 2>&1
rm "$tls/ca.key" "$tls/rustfs.csr"
export STUDY_CLOUD_TLS_DIR="$tls"
export NODE_EXTRA_CA_CERTS="$tls/ca.pem"

exec "$@"
