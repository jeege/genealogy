#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：scripts/publish-image.sh [--engine container|buildx] [--version 2026.10.16] [--push]
默认仅构建 linux/amd64、linux/arm64，显式 --push 才推送版本标签和 latest。
container 使用本机镜像存储；buildx 默认输出 docker-output/<版本>.tar OCI 归档。
可选环境：GENEALOGY_REPOSITORY、BUILD_CPUS（默认 6）、BUILD_MEMORY（默认 8G）。
EOF
}

engine=''
version="$(date +%Y.%m.%d)"
push=false
while (($#)); do
  case "$1" in
    --engine|--version)
      if (($# < 2)); then usage >&2; exit 1; fi
      if [[ "$1" == --engine ]]; then engine="$2"; else version="$2"; fi
      shift 2 ;;
    --push) push=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
if [[ -z "$engine" ]]; then
  if [[ "$(uname -s)" == Darwin ]] && command -v container >/dev/null 2>&1; then engine=container; else engine=buildx; fi
fi
if [[ ! "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ || "$version" == latest ]]; then
  echo '版本标签无效；请使用独立于 latest 的版本号。' >&2
  exit 1
fi
repository="${GENEALOGY_REPOSITORY:-onehacker/pure-genealogy}"
# Apple container 推送要求显式 registry；Docker Hub 短名与自定义短名统一补全。
registry="${repository%%/*}"
if [[ "$registry" != *.* && "$registry" != *:* && "$registry" != localhost ]]; then
  repository="docker.io/$repository"
fi
# Apple container 以物理路径传递 context；1.1.0 的 /tmp 挂载还有额外限制。
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"

case "$engine" in
  container)
    case "$root" in
      /tmp|/tmp/*|/private/tmp|/private/tmp/*)
        echo 'Apple container 1.1.0 在 /tmp 构建会漏传子目录。请把项目移到用户目录再运行。' >&2
        exit 1 ;;
    esac
    container build --platform linux/amd64 --platform linux/arm64 \
      --cpus "${BUILD_CPUS:-6}" --memory "${BUILD_MEMORY:-8G}" \
      --tag "$repository:$version" "$root"
    container image tag "$repository:$version" "$repository:latest"
    if "$push"; then
      container image push "$repository:$version"
      container image push "$repository:latest"
    fi
    ;;
  buildx)
    output=(--output "type=oci,dest=$root/docker-output/$version.tar")
    if "$push"; then output=(--push); else mkdir -p "$root/docker-output"; fi
    docker buildx build --platform linux/amd64,linux/arm64 \
      --tag "$repository:$version" --tag "$repository:latest" "${output[@]}" "$root"
    ;;
  *) echo 'engine 必须是 container 或 buildx。' >&2; exit 1 ;;
esac
echo "完成：${repository}:${version}、${repository}:latest（push=${push}）"
