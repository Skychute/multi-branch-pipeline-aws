#!/bin/bash
set -e

export PRODUCT="Connect-Portal"
export TIER="Development"
export AWS_REGION='ap-southeast-2'
export GITHUB_AUTH_SECRET_ARN="arn:aws:secretsmanager:ap-southeast-2:578348324857:secret:skychuterobot-github-cTTP0z"
export BRANCH_NAME="feature-LPX-49"
export GITHUB_OWNER_ID="16297290"
export GITHUB_REPO_NAME="connect-portal"
export DEFAULT_DEPLOYMENT_ENVS=`cat deployment-environment.json`
export DEPLOYMENT_IAM_ARN="arn:aws:iam::578348324857:role/codebuild-default"

npx cdk deploy "*" --require-approval never
