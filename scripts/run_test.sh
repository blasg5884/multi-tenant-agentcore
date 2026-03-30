#!/bin/bash
# 必要な環境変数:
#   EMAIL    - 認証するユーザーのメールアドレス
#   PASSWORD - パスワード

: "${EMAIL:?EMAIL is not set}"
: "${PASSWORD:?PASSWORD is not set}"

STACK_NAME="AgentcoreStack"
REGION="ap-northeast-1"

# CloudFormationスタックから出力を取得
stack_outputs=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs" \
  --output json)

USER_POOL_ID=$(echo "${stack_outputs}" | jq -r '.[] | select(.OutputKey=="UserPoolId") | .OutputValue')
CLIENT_ID=$(echo "${stack_outputs}" | jq -r '.[] | select(.OutputKey=="UserPoolClientId") | .OutputValue')
INVOKE_AGENT_ARN=$(echo "${stack_outputs}" | jq -r '.[] | select(.OutputKey=="AbacRuntimeArn") | .OutputValue')

# Cognito認証
authentication_result=$(aws cognito-idp initiate-auth \
  --client-id "${CLIENT_ID}" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters \
    USERNAME="${EMAIL}",PASSWORD="${PASSWORD}" | jq -r .AuthenticationResult)

ID_TOKEN=$(jq -r .IdToken <<< "${authentication_result}")
ACCESS_TOKEN=$(jq -r .AccessToken <<< "${authentication_result}")

# Agent ARNをURLエンコード
ESCAPED_AGENT_ARN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${INVOKE_AGENT_ARN}', safe=''))")

BEDROCK_AGENTCORE_URL="https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${ESCAPED_AGENT_ARN}/invocations?qualifier=DEFAULT"

# Bedrock Agent Runtime APIを呼び出し
curl -Ss -X POST "${BEDROCK_AGENTCORE_URL}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken: ${ID_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "'$1'"}' | jq -r .
