import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as secrets_manager from '@aws-cdk/aws-secretsmanager';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as s3 from '@aws-cdk/aws-s3';
import * as iam from '@aws-cdk/aws-iam';
import { App, Stack, StackProps } from '@aws-cdk/core';

export type CodebuildEnvs = {[name: string]: codebuild.BuildEnvironmentVariable; };

interface PipelineStackProps extends StackProps {
  githubInfo: GithubInfo;
  artifactBucketArn: string;
  pipelineIamRoleArn: string;
  defaultDeploymentEnvVariables: CodebuildEnvs;
}

interface GithubInfo {
  branchName: string;
  orginalBranchName: string;
  repoName: string;
  authSecretArn: string;
  ownerName: string;
}

export class PipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const gitSecret = secrets_manager.Secret.fromSecretArn(this, 'GithubAuthSecretArn', props.githubInfo.authSecretArn);

    const artifactBucket = s3.Bucket.fromBucketArn(this, 'GetS3ArtifactBucket', props.artifactBucketArn);

    const iamRole = iam.Role.fromRoleArn(this, 'GetPipelineIAMRole', props.pipelineIamRoleArn);

    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'Source',
      repo: props.githubInfo.repoName,
      output: sourceOutput,
      branch: props.githubInfo.orginalBranchName,
      owner: props.githubInfo.ownerName,
      oauthToken: gitSecret.secretValue,
      trigger: codepipeline_actions.GitHubTrigger.NONE,
    });

    const build = new codebuild.PipelineProject(this, 'CodebuildPipeline', {
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: `${props.githubInfo.repoName}${props.githubInfo.branchName}`
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
      role: iamRole,
      projectName: `${props.githubInfo.branchName}-CodeBuild`,
      environment: {
        privileged: true,
        buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
        computeType: codebuild.ComputeType.MEDIUM,
      }
    });
    

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Build',
      input: sourceOutput,
      project: build,
      environmentVariables: props.defaultDeploymentEnvVariables,
    });

    new codepipeline.Pipeline(this, `GithubCodePipeline`, {
      pipelineName: `${props.githubInfo.branchName}`,
      role: iamRole,
      restartExecutionOnUpdate: true,
      artifactBucket: artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [ sourceAction ],
        },
        {
          stageName: 'Build',
          actions: [ buildAction ],
        }
      ],
    });
  }
}