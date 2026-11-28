# Deploying to AWS

One CDK stack (`lib/morph-stack.ts`) creates everything: a VPC, Postgres on RDS (private, encrypted,
7-day backups), Morph's service and the Ledgerly demo as Fargate containers, one load balancer
(Ledgerly on port 80, Morph on 8080), secrets in Secrets Manager, and logs in CloudWatch.

Rough cost when idle: ~$45/month (RDS t4g.micro ~$13, load balancer ~$17, two small Fargate tasks ~$15).

## Before the first deploy

1. An AWS account, with a **budget alert** set up (Billing → Budgets).
2. The AWS CLI installed and signed in: `brew install awscli`, then `aws configure sso` (or `aws configure`).
3. Docker running (CDK builds the container images locally and uploads them).
4. Once per account and region: `cd infra && npx cdk bootstrap`.

## Deploy

```bash
cd infra
npx cdk deploy            # prints LedgerlyUrl, MorphUrl and the secret names at the end
```

Add `-c certificateArn=arn:aws:acm:...` to serve HTTPS on 443 and 8443 (needs a domain and an ACM certificate).

## After the first deploy

The stack can't know your AI key or Ledgerly's Morph key, so set them once (names come from the deploy output):

```bash
# 1. Your AI key(s)
aws secretsmanager put-secret-value --secret-id <LlmKeysSecret> \
  --secret-string '{"OPENAI_API_KEY":"sk-...","ANTHROPIC_API_KEY":"..."}'

# 2. Register Ledgerly with Morph, allowing its URL to call Morph from the browser
export MORPH_URL=<MorphUrl>
export MORPH_ADMIN_KEY=$(aws secretsmanager get-secret-value --secret-id <AdminKeySecret> --query SecretString --output text)
npx morph admin create-tenant --name Ledgerly --origin <LedgerlyUrl>     # prints sk_...

# 3. Give Ledgerly its key and upload its manifest
aws secretsmanager put-secret-value --secret-id <LedgerlyMorphKeySecret> --secret-string '{"MORPH_SECRET_KEY":"sk_..."}'
cd ../examples/ledgerly && MORPH_SECRET_KEY=sk_... npm run morph:push

# 4. Restart both services so they read the new secrets
aws ecs update-service --cluster <ClusterName> --service <MorphServiceName> --force-new-deployment
aws ecs update-service --cluster <ClusterName> --service <LedgerlyServiceName> --force-new-deployment
```

Then open `<LedgerlyUrl>`.

## Later deploys

`npx cdk deploy` again. It rebuilds the images and rolls the containers; failed deploys roll back
automatically. The service applies database migrations on start.

## Known gaps

- Plain HTTP until you add a domain and certificate. Don't use real data before that.
- The database connection uses TLS but doesn't verify RDS's certificate yet (`packages/service/src/db/connect.ts`).
- Rate limits are per container; fine with one Morph container, needs a shared store beyond that.
- Deleting the stack keeps a final database snapshot, and deletion protection is on: turn it off in the console first.
