#!/usr/bin/env bash
# Mainnet app host: run on the EC2 instance, from deploy/aws, as ec2-user.
# Safe to run again. It stops at the first thing you still have to do, says what,
# and carries on from there next time:
#   1. adds swap (the image build needs it on a 4 GB host)
#   2. writes .env.db (DATABASE_URL) from the RDS-managed secret
#   3. stops until .env.core-api, .env.dashboard-api, .env.chain-worker and
#      .env.cloudflared are filled in
#   4. builds the image, migrates, starts everything
set -euo pipefail
cd "$(dirname "$0")"

REGION=ap-southeast-2
DB_ID=mayarin-mainnet

if ! swapon --show | grep -q /swapfile; then
  sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "swap added"
fi

if [ ! -s .env.db ]; then
  endpoint=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].Endpoint.Address' --output text)
  secret_arn=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
  # The password is URL-encoded because RDS generates one full of symbols.
  # Nothing is printed. RDS 16 forces SSL, hence sslmode=require.
  aws secretsmanager get-secret-value --region "$REGION" --secret-id "$secret_arn" \
    --query SecretString --output text |
    ENDPOINT="$endpoint" python3 -c '
import json, os, sys, urllib.parse
secret = json.load(sys.stdin)
user = secret["username"]
password = urllib.parse.quote(secret["password"], safe="")
host = os.environ["ENDPOINT"]
print("DATABASE_URL=postgres://" + user + ":" + password + "@" + host + ":5432/mayarin?sslmode=require")
' >.env.db
  chmod 600 .env.db
  echo ".env.db written"
fi

missing=0
for f in .env.core-api .env.dashboard-api .env.chain-worker .env.cloudflared; do
  if [ ! -s "$f" ]; then
    touch "$f"
    chmod 600 "$f"
    echo "fill in: deploy/aws/$f"
    missing=1
  fi
done
if [ "$missing" = 1 ]; then
  echo "Paste each file's contents, then run this script again:"
  echo "  cat > .env.core-api   (paste, then Ctrl-D)"
  exit 1
fi

docker compose build core-api
docker compose run --rm core-api bun run packages/db/src/migrate.ts
docker compose up -d
docker compose ps
