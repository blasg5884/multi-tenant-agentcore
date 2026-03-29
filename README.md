# multi-tenant-agentcore

Amazon Bedrock AgentCore Runtime でマルチテナントを実現するサンプルです。
属性ベースのアクセス制御（ABAC）を用いて、テナントごとに S3 オブジェクトへのアクセスを分離します。

## 構成

```
.
├── cdk/                  # AWS リソースのデプロイ (TypeScript)
└── agents/abac_agent/    # ABAC エージェント (Python)
```

## cdk

AWS CDK (TypeScript) で以下のリソースをデプロイします。

- Amazon Cognito User Pool（`custom:tenant_id` カスタム属性 + Pre Token Generation Lambda）
- Amazon S3 バケット（マルチテナント用）
- IAM ロール `ABACTenantRole`（S3 オブジェクトタグと PrincipalTag を照合する ABAC ポリシー）
- Bedrock AgentCore Runtime（`abac_agent`）

```bash
cd cdk
npm install
cdk bootstrap   # 初回のみ
cdk deploy
```

## agents/abac_agent

Bedrock AgentCore Runtime 上で動作する Python エージェントです。

- `Authorization` ヘッダーのアクセストークンで Cognito 認証を検証
- `X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken` ヘッダーの ID トークンで `AssumeRoleWithWebIdentity` を実行
- 取得した一時認証情報（PrincipalTag に `custom:tenant_id` が付与済み）で S3 にアクセス
- IAM ポリシーの条件によりテナント自身のオブジェクトのみ操作可能

```bash
cd agents/abac_agent
pip install -r requirements.txt
```

## 動作フロー

1. ユーザーが Cognito で認証 → `custom:tenant_id` クレーム入りトークンを取得
2. AgentCore Runtime を呼び出し（アクセストークン + ID トークンをヘッダーに付与）
3. エージェントが ID トークンで STS に `AssumeRoleWithWebIdentity`
4. `PrincipalTag/custom:tenant_id` と S3 オブジェクトタグが照合され、テナントデータのみアクセス許可

## 注意事項

CDK による AgentCore のデプロイには alpha 版の L2 Construct (`@aws-cdk/aws-bedrock-agentcore-alpha`) を使用しています。今後の変更により動作しなくなる可能性があります。
