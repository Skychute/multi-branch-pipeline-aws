#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from '@aws-cdk/core';
import { BuildEnvironmentVariableType } from '@aws-cdk/aws-codebuild';

import { BucketStack } from '../lib/bucket-stack';
import { PipelineStack, CodebuildEnvs } from '../lib/pipeline-stack';
import { ConfigurationLoader } from '../util/config-loader';

const app = new cdk.App();

const env = ConfigurationLoader.load();

const Product = env.tag.product;
const Tier = env.tag.tier;

const defaultDeploymentEnv: CodebuildEnvs = {};
for (const key of Object.keys(env.defaultDeploymentEnv)) {
  defaultDeploymentEnv[key] = {
    value: env.defaultDeploymentEnv[key],
    type: BuildEnvironmentVariableType.PLAINTEXT
  };
}
const bucketStack = new BucketStack(app, `${env.github.repoName}-ArtifactBucketStack`, {
  repoName: env.github.repoName,
  tags: {
    Product,
    Tier,
    Purpose: 'Bucket for pipeline artifacts',
  },
});

new PipelineStack(app, `${env.github.branchName}-PipelineStack`, {
  artifactBucketArn: bucketStack.bucketArn,
  githubInfo: {
    authSecretArn: env.github.authSecretArn,
    branchName: env.github.branchName,
    ownerName: env.github.ownerName,
    repoName: env.github.repoName,
    orginalBranchName: env.github.orginalBranchName,
  },
  defaultDeploymentEnvVariables: defaultDeploymentEnv,
  pipelineIamRoleArn: env.deploymentIamArn,
  tags: {
    Product,
    Tier,
    Purpose: 'Deployment pipeline'
  }
});

