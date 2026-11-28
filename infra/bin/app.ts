import { App } from "aws-cdk-lib";
import { MorphStack } from "../lib/morph-stack.ts";

const app = new App();
new MorphStack(app, "Morph", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  description: "Morph service + Ledgerly demo",
});
