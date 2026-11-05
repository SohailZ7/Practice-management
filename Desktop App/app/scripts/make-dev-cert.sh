#!/bin/bash
# One-time: creates a self-signed code-signing certificate "BBC Practice Recorder Dev" in your login keychain, so every
# rebuild is signed with the SAME identity and macOS "Always Allow" for the Keychain sticks. Free; local only.
# macOS will ask for your login password once (to trust the certificate for code signing).
set -euo pipefail
NAME="BBC Practice Recorder Dev"
if security find-identity -p codesigning | grep -q "$NAME"; then echo "Already installed."; exit 0; fi
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT; cd "$D"
cat > c.cnf <<EOF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$NAME
[ext]
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
basicConstraints=critical,CA:false
EOF
openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 3650 -config c.cnf
PW=$(openssl rand -hex 8)
openssl pkcs12 -export -inkey k.pem -in c.pem -out c.p12 -passout "pass:$PW" -legacy 2>/dev/null \
  || openssl pkcs12 -export -inkey k.pem -in c.pem -out c.p12 -passout "pass:$PW"
security import c.p12 -k "$HOME/Library/Keychains/login.keychain-db" -P "$PW" -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -p codeSign -k "$HOME/Library/Keychains/login.keychain-db" c.pem
security find-identity -p codesigning | grep "$NAME"
echo "Done. Now run scripts/build-signed.sh"
