"""
ABAC (Attribute-Based Access Control) Agent
Cognitoユーザー属性（custom:tenant_id）に基づいてS3バケットへのアクセスを制御するエージェント
"""

import base64
import boto3
import json
import os

from strands import Agent, tool
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from botocore.exceptions import ClientError

app = BedrockAgentCoreApp()

BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
ABAC_ROLE_ARN = os.environ.get("ABAC_ROLE_ARN", "")


def get_tenant_id_from_token(id_token: str) -> str:
    """
    IDトークンからテナントID（custom:tenant_id属性）を取得

    Args:
        id_token: Cognito IDトークン

    Returns:
        テナントID
    """

    try:
        # JWTトークンをデコード（検証なし、本番環境では検証が必要）
        parts = id_token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid token format")

        payload = parts[1]
        payload += "=" * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        claims = json.loads(decoded)
 
        tenant_id = claims.get("custom:tenant_id", "")
        if not tenant_id:
            raise ValueError("custom:tenant_id attribute not found in token")
        return tenant_id
    except Exception as e:
        raise e


def get_s3_client_with_assumed_role(id_token: str) -> boto3.client:
    """
    IDトークンからtenant_idを取得し、一段階のAssumeRoleでABACロールを引き受け、S3クライアントを取得

    Args:
        id_token: Cognito IDトークン

    Returns:
        S3クライアント
    """
    sts_client = boto3.client("sts")
    try:
        tenant_id = get_tenant_id_from_token(id_token)
        app.logger.info(f"Assuming role with tenant_id: {tenant_id}")

        # 一段階のAssumeRoleでセッションタグを設定
        response = sts_client.assume_role(
            RoleArn=ABAC_ROLE_ARN,
            RoleSessionName="abac-agent-session",
            Tags=[{"Key": "custom:tenant_id", "Value": tenant_id}],
        )
        app.logger.info(f"Successfully assumed role with session tags")

        # 一時的な認証情報でS3クライアントを作成
        credentials = response["Credentials"]
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=credentials["AccessKeyId"],
            aws_secret_access_key=credentials["SecretAccessKey"],
            aws_session_token=credentials["SessionToken"],
        )
        return s3_client
    except Exception as e:
        raise e


@tool
def list_files(prefix: str) -> str:
    """
    自テナントのS3オブジェクト一覧を取得

    Args:
        prefix: S3オブジェクトのプレフィックス

    Returns:
        ファイル一覧の文字列
    """
    try:
        app.logger.info(f"Listing files with prefix: {prefix}")

        response = s3_client.list_objects_v2(
            Bucket=BUCKET_NAME,
            Prefix=prefix,
        )

        files = [obj['Key'] for obj in response["Contents"]]
        return f"ファイル一覧:\n" + "\n".join(files)
    except ClientError as e:
        app.logger.exception("S3 access error")
        return f"An unexpected error occurred"
    except Exception as e:
        app.logger.exception("Unexpected error")
        return f"An unexpected error occurred"


@app.entrypoint
def entrypoint(payload, context: RequestContext):
    """
    ABACエージェントのメインエントリーポイント

    Args:
        payload: 入力ペイロード
        context: リクエストコンテキスト

    Returns:
        エージェントからのメッセージ
    """
    try:
        id_token = context.request_headers.get(
            "x-amzn-bedrock-agentcore-runtime-custom-idtoken", ""
        )
        if not id_token:
            raise ValueError("ID token not found")
        tenant_id = get_tenant_id_from_token(id_token)
        app.logger.info(f"Tenant ID: {tenant_id}")

        global s3_client
        s3_client = get_s3_client_with_assumed_role(id_token)

        message = payload.get("prompt", "")
        model_id = "anthropic.claude-3-5-sonnet-20240620-v1:0"

        model = BedrockModel(
            model_id=model_id,
            max_tokens=2048,
            temperature=0.1,
        )

        agent = Agent(
            model=model,
            tools=[
                list_files,
            ],
            system_prompt=f"""あなたはマルチテナントS3アクセス管理エージェントです。
ユーザーの依頼に丁寧に答えてください。
ユーザーの依頼に応じて、以下のツールを使用してS3バケットにアクセスできます:
1. list_files: 指定されたプレフィックスのファイル一覧を取得
""",
        )
        return agent(message)
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    app.run()
