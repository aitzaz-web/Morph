// Everything Morph needs on AWS, plus the Ledgerly demo as a separate "customer" app.
//
//   Internet ── Load balancer ─┬─ :80   (or :443)  → Ledgerly (Fargate)
//                              └─ :8080 (or :8443) → Morph service (Fargate) ── Postgres (RDS, private)
//
// Two ports on one load balancer keep costs down while still giving Ledgerly and Morph different
// origins, like a real customer and Morph would have. No NAT gateway: the containers sit in public
// subnets but only accept traffic from the load balancer. The database has no internet access at all.
//
// Optional context (cdk deploy -c key=value):
//   certificateArn  an ACM certificate to serve HTTPS (on 443 and 8443). Without it, plain HTTP.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class MorphStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const certificateArn = this.node.tryGetContext("certificateArn") as string | undefined;
    const https = !!certificateArn;

    // ---- Network ----
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ---- Secrets ----
    const generated = (name: string, description: string, length = 48) =>
      new secrets.Secret(this, name, {
        description,
        generateSecretString: { passwordLength: length, excludePunctuation: true },
      });
    const jwtSecret = generated("JwtSecret", "Morph: signs end-user session tokens");
    const adminKey = generated("AdminKey", "Morph: admin API key (creating companies)", 40);
    const ledgerlySession = generated("LedgerlySessionSecret", "Ledgerly demo: signs its login cookie", 32);
    // Set by hand after deploy (see infra/README.md). Created with a placeholder so the stack deploys.
    const llmKeys = new secrets.Secret(this, "LlmKeys", {
      description: "Morph: AI provider keys, JSON {\"OPENAI_API_KEY\": \"...\", \"ANTHROPIC_API_KEY\": \"...\"}",
      generateSecretString: { secretStringTemplate: JSON.stringify({ OPENAI_API_KEY: "...", ANTHROPIC_API_KEY: "..." }), generateStringKey: "unused" },
    });
    const ledgerlyMorphKey = new secrets.Secret(this, "LedgerlyMorphKey", {
      description: "Ledgerly demo: its Morph secret key (sk_...), from `morph admin create-tenant`",
      generateSecretString: { secretStringTemplate: JSON.stringify({ MORPH_SECRET_KEY: "sk_unset" }), generateStringKey: "unused" },
    });

    // ---- Database ----
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc, description: "Morph Postgres", allowAllOutbound: false });
    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: "morph",
      credentials: rds.Credentials.fromGeneratedSecret("morph"),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
    });
    const dbSecret = db.secret!;

    // ---- Load balancer ----
    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc, description: "Public load balancer" });
    const ports = https ? { ledgerly: 443, morph: 8443 } : { ledgerly: 80, morph: 8080 };
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(ports.ledgerly));
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(ports.morph));
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", { vpc, internetFacing: true, securityGroup: albSg });
    const scheme = https ? "https" : "http";
    const ledgerlyUrl = `${scheme}://${alb.loadBalancerDnsName}`;
    const morphUrl = `${scheme}://${alb.loadBalancerDnsName}:${ports.morph}`;
    const certificates = https ? [acm.Certificate.fromCertificateArn(this, "Cert", certificateArn!)] : undefined;
    const listener = (name: string, port: number) =>
      alb.addListener(name, { port, protocol: https ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP, certificates, open: false });

    // ---- Containers ----
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    const service = (name: string, opts: {
      dockerfile: string;
      port: number;
      environment: Record<string, string>;
      secrets: Record<string, ecs.Secret>;
    }) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: 512,
        memoryLimitMiB: 1024,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      });
      task.addContainer(name, {
        image: ecs.ContainerImage.fromAsset(ROOT, { file: opts.dockerfile, platform: Platform.LINUX_ARM64 }),
        portMappings: [{ containerPort: opts.port }],
        environment: { PORT: String(opts.port), ...opts.environment },
        secrets: opts.secrets,
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: name, logRetention: logs.RetentionDays.ONE_MONTH }),
      });
      const sg = new ec2.SecurityGroup(this, `${name}Sg`, { vpc, description: `${name} containers` });
      sg.addIngressRule(albSg, ec2.Port.tcp(opts.port), "from the load balancer only");
      const svc = new ecs.FargateService(this, `${name}Service`, {
        cluster,
        taskDefinition: task,
        desiredCount: 1,
        assignPublicIp: true, // to pull images and call AI providers without a NAT gateway
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [sg],
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
      });
      return { svc, sg };
    };

    const morph = service("Morph", {
      dockerfile: "docker/service.Dockerfile",
      port: 8787,
      environment: { DATABASE_SSL: "true", MORPH_EFFORT: "medium" },
      secrets: {
        PGHOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
        PGPORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
        PGUSER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
        PGPASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
        PGDATABASE: ecs.Secret.fromSecretsManager(dbSecret, "dbname"),
        MORPH_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        MORPH_ADMIN_KEY: ecs.Secret.fromSecretsManager(adminKey),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmKeys, "OPENAI_API_KEY"),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(llmKeys, "ANTHROPIC_API_KEY"),
      },
    });
    dbSg.addIngressRule(morph.sg, ec2.Port.tcp(5432), "from the Morph service only");

    const ledgerly = service("Ledgerly", {
      dockerfile: "docker/ledgerly.Dockerfile",
      port: 8788,
      environment: { NODE_ENV: "production", MORPH_URL: morphUrl, MORPH_PUBLIC_URL: morphUrl, SECURE_COOKIES: String(https) },
      secrets: {
        SESSION_SECRET: ecs.Secret.fromSecretsManager(ledgerlySession),
        MORPH_SECRET_KEY: ecs.Secret.fromSecretsManager(ledgerlyMorphKey, "MORPH_SECRET_KEY"),
      },
    });

    listener("LedgerlyListener", ports.ledgerly).addTargets("Ledgerly", {
      port: 8788,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [ledgerly.svc],
      healthCheck: { path: "/api/health", healthyHttpCodes: "200" },
      deregistrationDelay: Duration.seconds(10),
    });
    listener("MorphListener", ports.morph).addTargets("Morph", {
      port: 8787,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [morph.svc],
      healthCheck: { path: "/v1/health", healthyHttpCodes: "200" },
      deregistrationDelay: Duration.seconds(10),
    });

    new CfnOutput(this, "LedgerlyUrl", { value: ledgerlyUrl });
    new CfnOutput(this, "MorphUrl", { value: morphUrl });
    new CfnOutput(this, "AdminKeySecret", { value: adminKey.secretName });
    new CfnOutput(this, "LlmKeysSecret", { value: llmKeys.secretName });
    new CfnOutput(this, "LedgerlyMorphKeySecret", { value: ledgerlyMorphKey.secretName });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "MorphServiceName", { value: morph.svc.serviceName });
    new CfnOutput(this, "LedgerlyServiceName", { value: ledgerly.svc.serviceName });
  }
}
