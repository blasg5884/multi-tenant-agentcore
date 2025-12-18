import * as cdk from "aws-cdk-lib";
import * as path from "path";
import { Construct } from "constructs";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as iam from "aws-cdk-lib/aws-iam";

export class AgentcoreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.join(__dirname, "../../agents"),
    );

    const runtime = new agentcore.Runtime(this, "StrandsAgentRuntime", {
      runtimeName: "weather_check_agent",
      agentRuntimeArtifact: agentRuntimeArtifact,
      description: "Strands Agent with weather tool",
    });

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:aws:bedrock:${this.region}::*`
        ],
      }),
    );

    new cdk.CfnOutput(this, "RuntimeArn", {
      value: runtime.agentRuntimeArn,
      description: "ARN of the AgentCore Runtime",
      exportName: "AgentRuntimeArn",
    });

    new cdk.CfnOutput(this, "RuntimeId", {
      value: runtime.agentRuntimeId,
      description: "ID of the AgentCore Runtime",
      exportName: "AgentRuntimeId",
    });
  }
}