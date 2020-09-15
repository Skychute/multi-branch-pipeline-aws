#!/bin/bash
set -e

export PRODUCT="Connect-Portal"
export TIER="Development"
export AWS_REGION='ap-southeast-2'
export GITHUB_AUTH_SECRET_ARN="arn:aws:secretsmanager:ap-southeast-2:578348324857:secret:skychuterobot-github-cTTP0z"
export BRANCH_NAME="feature-LPX-49"
export GITHUB_OWNER_ID="16297290"
export GITHUB_REPO_NAME="connect-portal"
export DEFAULT_DEPLOYMENT_ENVS="{\"AWS_REGION\":\"ap-southeast-2\",\"AWS_ACCOUNT_ID\":\"578348324857\",\"HOSTED_ZONE_ID\":\"Z40G7MSJXO6OC\",\"HOSTED_ZONE_NAME\":\"skychute.com.au\",\"HASURA_ADMIN_SECRET\":\"bU3A&(VsD3(=]C(dUK-:sh7>Y?P7i}a\",\"HASURA_JWT_SECRET\":\"{\\\"type\\\":\\\"HS256\\\", \\\"key\\\": \\\"123123123123123123123123123123123123123123123123123123123123123\\\"}\",\"HASURA_GRAPHQL_PATH\":\"/v1/graphql\",\"BRANCH_NAME\":\"#{SourceVariables.BranchName}\"}"
export DEPLOYMENT_IAM_ARN="arn:aws:iam::578348324857:role/codebuild-default"

npx cdk deploy "*" --require-approval never
