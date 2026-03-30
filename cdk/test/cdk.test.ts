import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AgentcoreStack } from "../lib/agentcore-stack";

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new AgentcoreStack(app, "TestStack");
  template = Template.fromStack(stack);
});

describe("S3", () => {
  test("MultiTenantBucket が作成される", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
});

describe("Cognito", () => {
  test("UserPool が作成される", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "multi-tenant-agentcore-pool",
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  test("UserPoolClient が作成される", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "multi-tenant-agentcore-client",
      GenerateSecret: false,
      PreventUserExistenceErrors: "ENABLED",
    });
  });

  test("UserPoolDomain が作成される", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: "multi-tenant-agentcore",
    });
  });

});

describe("IAM", () => {
  test("ABACTenantRole が作成される", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "ABACTenantRole",
    });
  });
});

describe("Lambda", () => {
  test("PreTokenGeneration Lambda が作成される", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "multi-tenant-pre-token-generation",
      Runtime: "python3.12",
      Handler: "index.lambda_handler",
    });
  });
});

describe("CfnOutputs", () => {
  test("必要な CfnOutput が存在する", () => {
    const outputs = template.findOutputs("*");
    const expectedKeys = [
      "UserPoolId",
      "UserPoolArn",
      "UserPoolClientId",
      "AbacRuntimeArn",
      "AbacRuntimeId",
      "MultiTenantBucketName",
      "ABACRoleArn",
    ];
    for (const key of expectedKeys) {
      expect(outputs).toHaveProperty(key);
    }
  });
});
