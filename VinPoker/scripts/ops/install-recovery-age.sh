#!/usr/bin/env bash
# Existing recovery dependency, pinned to its official release artifact.
# Install before reading protected recovery credentials. Never curl | sh.
set -euo pipefail
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Recovery age installer requires Linux x86_64' >&2; exit 64
fi
readonly version=1.2.1
# SHA256 of the official v1.2.1 linux-amd64 release archive, reviewed locally.
readonly checksum=7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50
readonly url="https://github.com/FiloSottile/age/releases/download/v${version}/age-v${version}-linux-amd64.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
umask 077
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 2 --connect-timeout 15 --max-time 120 --output "$work/age.tar.gz" "$url"
printf '%s  %s\n' "$checksum" "$work/age.tar.gz" | sha256sum --check --status
tar --extract --gzip --file "$work/age.tar.gz" --directory "$work" --no-same-owner age/age age/age-keygen
sudo install -m 0755 "$work/age/age" "$work/age/age-keygen" /usr/local/bin/
test "$(age --version)" = "v${version}"
echo 'RECOVERY_AGE_PINNED_INSTALL_PASS'
