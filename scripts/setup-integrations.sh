#!/usr/bin/env bash
# 在目标服务器上初始化集成服务凭据（由 scripts/remote.js script 上传执行）。
# 幂等：可重复运行；不会把密码打印到日志。
set -euo pipefail

TARGET=/data/platform
ENV_FILE="$TARGET/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "缺少 $ENV_FILE，请先完成部署"
  exit 1
fi
set -a
. "$ENV_FILE"
set +a

PW="${OPENLIST_PASSWORD:-}"
ADMIN="${GITEA_ADMIN:-admin}"
GITEA_PORT="${GITEA_PORT:-3002}"
if [ -z "$PW" ]; then
  echo "缺少 OPENLIST_PASSWORD"
  exit 1
fi

wait_http() {
  local name="$1" url="$2" expected="$3" code=""
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
    [ "$code" = "$expected" ] && { echo "$name 就绪 ($code)"; return 0; }
    sleep 2
  done
  echo "$name 未就绪 (最后状态 $code)"
  return 1
}

echo "=== 等待服务 ==="
wait_http Gitea "http://127.0.0.1:${GITEA_PORT}/api/v1/version" 200
wait_http OpenList "http://127.0.0.1:5244/api/public/settings" 200
wait_http code-server "http://127.0.0.1:8080/healthz" 200

echo "=== Gitea 管理员（已存在则跳过） ==="
docker exec --user 1000 dp-gitea gitea admin user create \
  --admin --username "$ADMIN" --password "$PW" --email admin@example.com 2>&1 | tail -4 || true

echo "=== 生成 Gitea 访问令牌（幂等） ==="
token="${GITEA_TOKEN:-}"
if [ -n "$token" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Authorization: token ${token}" "http://127.0.0.1:${GITEA_PORT}/api/v1/user")" = "200" ]; then
  echo "复用 .env 中已有的有效 Token"
else
  # Gitea 的 token 名称必须唯一，重复运行要用新名字。
  tname="devplatform-$(date +%s)"
  resp=$(curl -s -u "${ADMIN}:${PW}" -X POST \
    "http://127.0.0.1:${GITEA_PORT}/api/v1/users/${ADMIN}/tokens" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"${tname}\",\"scopes\":[\"all\"]}")
  token=$(printf '%s' "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sha1",""))' 2>/dev/null || true)
  if [ -z "$token" ]; then
    echo "生成 Gitea Token 失败：${resp:0:200}"
    exit 1
  fi
fi
sed -i "s#^GITEA_TOKEN=.*#GITEA_TOKEN=${token}#" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Gitea Token 已写入 .env"

echo "=== 设置 OpenList 管理员密码并重启生效 ==="
docker exec -w /opt/openlist dp-openlist ./openlist admin set "$PW" >/dev/null 2>&1 || true
docker restart dp-openlist >/dev/null
wait_http OpenList "http://127.0.0.1:5244/api/public/settings" 200

# 平台优先使用 OPENLIST_TOKEN；用 admin token 比密码登录更可靠（不受密码缓存影响）。
ol_token=$(docker exec -w /opt/openlist dp-openlist ./openlist admin token 2>/dev/null \
  | awk -F': ' '/^Admin token:/{print $2}' | tail -1 | tr -d '\r')
if [ -n "$ol_token" ]; then
  if grep -q "^OPENLIST_TOKEN=" "$ENV_FILE"; then
    sed -i "s#^OPENLIST_TOKEN=.*#OPENLIST_TOKEN=${ol_token}#" "$ENV_FILE"
  else
    echo "OPENLIST_TOKEN=${ol_token}" >> "$ENV_FILE"
  fi
  echo "OpenList Token 已写入 .env"
else
  echo "未能获取 OpenList Token，存储模块将回退到密码登录"
fi
chmod 600 "$ENV_FILE"

echo "=== 验证 ==="
curl -s -o /dev/null -w "gitea(token 调用 user API)=%{http_code}\n" \
  -H "Authorization: token ${token}" "http://127.0.0.1:${GITEA_PORT}/api/v1/user"
if [ -n "$ol_token" ]; then
  curl -s -o /dev/null -w "openlist(token 调用 /api/me)=%{http_code}\n" \
    -H "Authorization: ${ol_token}" http://127.0.0.1:5244/api/me
fi
curl -s -o /dev/null -w "code-server(healthz)=%{http_code}\n" http://127.0.0.1:8080/healthz
echo "完成。重新执行 remote.js deploy 可让平台容器加载新凭据。"
