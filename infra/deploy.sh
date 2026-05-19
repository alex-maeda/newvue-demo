#!/usr/bin/env bash
#
# Deploy a new image set to the demo EC2 via SSM.
# Invoked by .gitlab-ci.yml deploy stage.
#
# Required env vars (set in GitLab CI/CD variables):
#   AWS_REGION             — EC2 region (e.g. us-east-1)
#   EC2_INSTANCE_ID        — target instance (i-...)
#   APP_DIR                — path on EC2 where docker-compose.demo.yml lives
#                            (defaults to /newvue-demo)
#
# Required predefined CI vars (automatic):
#   CI_COMMIT_SHORT_SHA, CI_REGISTRY, CI_REGISTRY_USER,
#   CI_REGISTRY_PASSWORD, CI_REGISTRY_IMAGE
#
set -euo pipefail

: "${AWS_REGION:?must be set}"
: "${EC2_INSTANCE_ID:?must be set}"
: "${CI_COMMIT_SHORT_SHA:?must be set}"
: "${CI_REGISTRY:?must be set}"
: "${CI_REGISTRY_USER:?must be set}"
: "${CI_REGISTRY_PASSWORD:?must be set}"
: "${CI_REGISTRY_IMAGE:?must be set}"

APP_DIR="${APP_DIR:-/newvue-demo}"
TAG="${CI_COMMIT_SHORT_SHA}"

echo "Deploying tag=${TAG} to ${EC2_INSTANCE_ID} in ${AWS_REGION}"

# Build the remote command as a JSON array of shell lines.
# Using jq -R to safely escape the registry password if it contains special chars.
PARAMS_JSON=$(jq -n \
  --arg dir "$APP_DIR" \
  --arg tag "$TAG" \
  --arg registry "$CI_REGISTRY" \
  --arg registry_image "$CI_REGISTRY_IMAGE" \
  --arg user "$CI_REGISTRY_USER" \
  --arg pass "$CI_REGISTRY_PASSWORD" \
  '{
    commands: [
      "set -e",
      "cd \($dir)",
      "echo \($pass) | docker login -u \($user) --password-stdin \($registry)",
      "export IMAGE_TAG=\($tag)",
      "export REGISTRY=\($registry_image)",
      "docker compose -f docker-compose.demo.yml pull",
      "docker compose -f docker-compose.demo.yml up -d",
      "docker image prune -f"
    ]
  }')

CMD_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "GitLab CI deploy ${TAG}" \
  --parameters "$PARAMS_JSON" \
  --query 'Command.CommandId' \
  --output text)

echo "SSM command id: ${CMD_ID}"

# Poll for completion
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$EC2_INSTANCE_ID" || true

RESULT=$(aws ssm get-command-invocation \
  --region "$AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$EC2_INSTANCE_ID")

STATUS=$(echo "$RESULT" | jq -r '.Status')
RC=$(echo "$RESULT" | jq -r '.ResponseCode')

echo "------ stdout ------"
echo "$RESULT" | jq -r '.StandardOutputContent'
echo "------ stderr ------"
echo "$RESULT" | jq -r '.StandardErrorContent'
echo "--------------------"
echo "Status: ${STATUS}  ResponseCode: ${RC}"

if [ "$STATUS" != "Success" ] || [ "$RC" != "0" ]; then
  echo "Deploy failed."
  exit 1
fi

echo "Deploy succeeded. Run docs/SMOKE_TEST.md against https://demo.dev.newvueai.app/"
