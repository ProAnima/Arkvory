#!/usr/bin/env bash
# Download this script from a reviewed release. Never pipe an unreviewed network response into a root shell.
set -euo pipefail
umask 077
root=${ARKVORY_INSTALL_ROOT:-/opt/proanima-arkvory}
mkdir -p "$root"
work=$(mktemp -d "$root/bootstrap.XXXXXX")
command -v curl >/dev/null
command -v python3 >/dev/null
node=''
if [[ -z "$node" ]]; then
  case $(uname -m) in
    x86_64) arch=x64; checksum=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6 ;;
    aarch64) arch=arm64; checksum=6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2 ;;
    *) echo 'Supported Linux architectures: x64, arm64' >&2; exit 1 ;;
  esac
  file="node-v24.21.0-linux-$arch.tar.xz"
  curl --fail --silent --show-error --proto '=https' "https://nodejs.org/dist/v24.21.0/$file" -o "$work/$file"
  printf '%s  %s\n' "$checksum" "$work/$file" | sha256sum --check --status
  mkdir -p "$root/runtime"
  tar -xJf "$work/$file" -C "$root/runtime"
  node="$root/runtime/node-v24.21.0-linux-$arch/bin/node"
  chmod -R a+rX "$root/runtime"
fi
if [[ -n "${ARKVORY_ARTIFACT_DIR:-}" ]]; then
  python3 - "$ARKVORY_ARTIFACT_DIR" "$work" <<'PY'
import hashlib, json, pathlib, sys
artifact, work = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((artifact/'arkvory-release.json').read_text())
setup = (artifact/'arkvory-setup.mjs').read_bytes()
if hashlib.sha256(setup).hexdigest() != manifest['setupSha256']: raise RuntimeError('Installer checksum mismatch')
(work/'arkvory-setup.mjs').write_bytes(setup)
PY
else
# urllib deliberately removes Authorization when GitHub redirects a private asset to another origin.
python3 - "$root" "$work" "${ARKVORY_RELEASE_VERSION:-}" <<'PY'
import hashlib, json, pathlib, re, sys, urllib.request
root, work, version = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
if version and not re.fullmatch(r'(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})',version): raise RuntimeError('Invalid stable version')
token_file=root/'github-token.txt'
token=token_file.read_text().strip() if token_file.exists() else ''
if not re.fullmatch(r'[A-Za-z0-9_-]{0,512}',token): raise RuntimeError('Invalid GitHub token file')
class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith('https://'): raise RuntimeError('Unsafe redirect')
        redirected=super().redirect_request(req,fp,code,msg,headers,newurl)
        redirected.remove_header('Authorization')
        return redirected
opener=urllib.request.build_opener(Redirect())
base='https://api.github.com/repos/ProAnima/Arkvory/releases/'
def get(url, asset=False):
    if not url.startswith(base): raise RuntimeError('Invalid asset origin')
    headers={'User-Agent':'Arkvory-Installer','Accept':'application/octet-stream' if asset else 'application/vnd.github+json'}
    if token: headers['Authorization']='Bearer '+token
    with opener.open(urllib.request.Request(url,headers=headers),timeout=120) as response:
        data=response.read(8*1024*1024+1)
        if len(data)>8*1024*1024: raise RuntimeError('Bootstrap asset too large')
        return data
release=json.loads(get(base+('tags/v'+version if version else 'latest')))
if release['draft'] or release['prerelease']: raise RuntimeError('Stable release required')
assets={a['name']:a['url'] for a in release['assets']}
manifest=json.loads(get(assets['arkvory-release.json'],True))
if release['tag_name']!='v'+manifest['version']: raise RuntimeError('Tag mismatch')
setup=get(assets['arkvory-setup.mjs'],True)
if hashlib.sha256(setup).hexdigest()!=manifest['setupSha256']: raise RuntimeError('Installer checksum mismatch')
(work/'arkvory-setup.mjs').write_bytes(setup)
PY
fi
options=("$@")
[[ -n "${ARKVORY_ARTIFACT_DIR:-}" ]] && options+=(--artifact "$ARKVORY_ARTIFACT_DIR")
needs_database=true
for option in "$@"; do
  [[ "$option" == compose || "$option" == --config ]] && needs_database=false
done
if $needs_database; then
  read -r -s -p 'PostgreSQL connection URL: ' database_url
  printf '\n'
  printf '%s' "$database_url" | python3 -c 'import json,sys; open(sys.argv[1],"x").write(json.dumps({"ARKVORY_DATABASE_URL":sys.stdin.read()}))' "$work/native.json"
  unset database_url
  options+=(--config "$work/native.json")
fi
[[ -n "${ARKVORY_RELEASE_VERSION:-}" ]] && options+=(--version "$ARKVORY_RELEASE_VERSION")
exec "$node" "$work/arkvory-setup.mjs" install --root "$root" "${options[@]}"
