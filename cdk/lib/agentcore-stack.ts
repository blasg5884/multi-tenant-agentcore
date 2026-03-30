import * as cdk from "aws-cdk-lib";
import * as path from "path";
import { Construct } from "constructs";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";

export class AgentcoreStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly multiTenantBucket: s3.Bucket;
  public readonly abacRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for multi-tenant data
    this.multiTenantBucket = new s3.Bucket(this, "MultiTenantBucket", {
      bucketName: `multi-tenant-data-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.userPool = new cognito.UserPool(this, "MultiTenantUserPool", {
      userPoolName: "multi-tenant-agentcore-pool",
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
        username: false,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        tenant_id: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 50,
          mutable: true,
        }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Pre Token Generation Lambda V3_0 for adding tenant_id to access and ID tokens
    const preTokenGenerationFn = new lambda.Function(
      this,
      "PreTokenGenerationFunction",
      {
        functionName: "multi-tenant-pre-token-generation",
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.lambda_handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../lambda/pre-token-generation")
        ),
        description: "Add tenant_id to Cognito access and ID token claims (V3_0)",
        timeout: cdk.Duration.seconds(10),
      }
    );

    // Add Pre Token Generation V3_0 trigger to User Pool (AWS recommended version)
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenGenerationFn
    );

    // Create User Pool Client for OAuth
    this.userPoolClient = new cognito.UserPoolClient(
      this,
      "MultiTenantUserPoolClient",
      {
        userPool: this.userPool,
        userPoolClientName: "multi-tenant-agentcore-client",
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
            implicitCodeGrant: false,
          },
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
        },
        generateSecret: false,
        preventUserExistenceErrors: true,
      },
    );

    // User Pool Domain for OAuth
    this.userPoolDomain = new cognito.UserPoolDomain(
      this,
      "MultiTenantUserPoolDomain",
      {
        userPool: this.userPool,
        cognitoDomain: {
          domainPrefix: "multi-tenant-agentcore",
        },
      },
    );

    // Create IAM Role for ABAC (Attribute-Based Access Control)
    // Cognito User Pool の ID トークンを AssumeRoleWithWebIdentity で使用する場合、
    // Federated プリンシパルは cognito-idp.amazonaws.com を使用し、
    // aud条件は User Pool ID を指定する必要があります。
    // ID トークンの aud クレームには User Pool ID が含まれるため。
    this.abacRole = new iam.Role(this, "ABACTenantRole", {
      roleName: "ABACTenantRole",
      assumedBy: new iam.AccountRootPrincipal(),
      description: "Role for ABAC with tag-based access control",
    });

    this.abacRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
        ],
        resources: [`${this.multiTenantBucket.bucketArn}/\${aws:PrincipalTag/custom:tenant_id}/*`],
        conditions: {
          StringEquals: {
            "s3:ExistingObjectTag/tenant_id": "${aws:PrincipalTag/custom:tenant_id}",
          },
        },
      }),
    );

    this.abacRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:ListBucket"],
        resources: [this.multiTenantBucket.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": [
              "",
              "${aws:PrincipalTag/custom:tenant_id}",
              "${aws:PrincipalTag/custom:tenant_id}/*",
            ]
          }
        },
      }),
    );

    const bedrockInvokePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::*`
      ],
    })

    const abacAgentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.join(__dirname, "../../agents/abac_agent"),
    );

    const abacAgentRuntime = new agentcore.Runtime(this, "AbacAgentRuntime", {
      runtimeName: "abac_agent",
      agentRuntimeArtifact: abacAgentRuntimeArtifact,
      description: "ABAC access-controlled agents",
      authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        this.userPool,
        [this.userPoolClient]
      ),
      requestHeaderConfiguration: {
        allowlistedHeaders: ["Authorization", "X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken"]
      },
      environmentVariables: {
        USER_POOL_ID: this.userPool.userPoolId,
        USER_CLIENT_ID: this.userPoolClient.userPoolClientId,
        BUCKET_NAME: this.multiTenantBucket.bucketName,
        ABAC_ROLE_ARN: this.abacRole.roleArn,
      },
    });

    abacAgentRuntime.addToRolePolicy(bedrockInvokePolicy)
    abacAgentRuntime.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["sts:AssumeRole", "sts:TagSession"],
      resources: ["*"],
    }))

    this.abacRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole", "sts:TagSession"],
        principals: [new iam.AccountRootPrincipal()],
      })
    );

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: "MultiTenantUserPoolId",
    });

    new cdk.CfnOutput(this, "UserPoolArn", {
      value: this.userPool.userPoolArn,
      description: "Cognito User Pool ARN",
      exportName: "MultiTenantUserPoolArn",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: "MultiTenantUserPoolClientId",
    });

    new cdk.CfnOutput(this, "AbacRuntimeArn", {
      value: abacAgentRuntime.agentRuntimeArn,
      description: "ARN of the ABAC AgentCore Runtime",
      exportName: "AbacAgentRuntimeArn",
    });

    new cdk.CfnOutput(this, "AbacRuntimeId", {
      value: abacAgentRuntime.agentRuntimeId,
      description: "ID of the ABAC AgentCore Runtime",
      exportName: "AbacAgentRuntimeId",
    });

    new cdk.CfnOutput(this, "MultiTenantBucketName", {
      value: this.multiTenantBucket.bucketName,
      description: "Multi-Tenant S3 Bucket Name",
      exportName: "MultiTenantBucketName",
    });

    new cdk.CfnOutput(this, "ABACRoleArn", {
      value: this.abacRole.roleArn,
      description: "IAM Role ARN for ABAC",
      exportName: "ABACRoleArn",
    });
  }
}
