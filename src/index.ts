import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import { Lambda, CodePipeline, AWSError } from 'aws-sdk';
import { GithubPayload, isSignatureValid } from './github-payload';
import { ProcessRunner } from './utils/process-runner';
import { ConfigurationLoader } from './utils/config-loader';
import { PromiseResult } from 'aws-sdk/lib/request';
import { PipelineSummary } from 'aws-sdk/clients/codepipeline';

const lambda = (process.env.IS_OFFLINE) ? new Lambda({
  endpoint: 'http://localhost:3002',
}) : new Lambda();

const env = ConfigurationLoader.load();

export const pipelineHandler: APIGatewayProxyHandler = async (event) => {
  try {
    if (!event.body) {
      throw new Error('Request body is empty');
    }
  
    const sig = event.headers['X-Hub-Signature'];
    if (!sig) {
      throw new Error('GitHub signature is missing');
    }
    const isValidPayload = isSignatureValid(event.body, sig);
    if (!isValidPayload) {
      throw new Error('GitHub signature is invalid');
    }
    const githubEvent = event.headers['X-GitHub-Event'];
    try {
      if (['create'].includes(githubEvent)) {
        await lambda.invoke({
          FunctionName: env.pipelineSetupFuncArn,
          Payload: event.body,
          InvocationType: 'Event',
        }).promise();
      }
      if (githubEvent === 'push') {
        await lambda.invoke({
          FunctionName: env.pipelineExecuteFuncArn,
          Payload: event.body,
          InvocationType: 'Event',
        }).promise();
      }
    } catch (e) {
      console.log(e);
    }
    return {
      statusCode: 200,
      body: 'accepted',
    };
  } catch (error) {
    console.log(error, error.stack);
    return {
      statusCode: 500,
      body: (error as Error).message
    };
  }
};

export const pipelineSetupHandler: Handler<GithubPayload> = async (payload) => {
  // console.log(payload);

  if (!payload.ref) {
    throw new Error('no ref in payload');
  }

  const ref = payload.ref;

  const branch = ref.replace('refs/heads/', '');
  const repo = payload.repository.name;
  const owner = payload.repository.owner.name || payload.repository.owner.login;
  const cdkEnvironment: NodeJS.ProcessEnv = {
    PRODUCT: env.tag.product,
    TIER: env.tag.tier,
    GITHUB_AUTH_SECRET_ARN: env.githubAuthSecretArn,
    BRANCH_NAME: branch.replace(/\//g, '-'),
    ORIGINAL_BRANCH_NAME: branch,
    GITHUB_OWNER_NAME: owner,
    GITHUB_REPO_NAME: repo,
    DEFAULT_DEPLOYMENT_ENVS: ConfigurationLoader.getDefaultEnvsAsString({ BRANCH_NAME: branch }),
    DEPLOYMENT_IAM_ARN: env.deploymentIamArn,
    PATH: process.env.PATH
  };
  if (process.env.IS_OFFLINE && process.env.AWS_PROFILE) {
    cdkEnvironment.AWS_PROFILE = process.env.AWS_PROFILE;
  }
  await ProcessRunner.runProcess(
    'node',
    ["node_modules/aws-cdk/bin/cdk", "deploy", '"*"', '--require-approval', 'never', '--output', '/tmp'],
    {
      stdout: process.stdout,
      stdin: process.stdin,
      stderr: process.stderr,
      spawnOptions: {
        env: cdkEnvironment
      }
    }
  );

};

export const pipelineExecutionHandler: Handler<GithubPayload> = async (payload) => {
  // console.log(payload);
  const ref = payload.ref;

  if (!ref) {
    throw new Error('no ref in payload');
  }

  const branch = ref.replace('refs/heads/', '');
  const branchSanitized = branch.replace(/\//g, '-');
  const expectedPipelineName = branchSanitized.toLowerCase();
  let a: Required<PipelineSummary>;
  let matchingPipeline: PipelineSummary | undefined; 
  const pipelineService = new CodePipeline();

  // iterating over existing pipelines
  // until we find a matching one
  // or run out of pipelines
  let pipelineResult: PromiseResult<CodePipeline.ListPipelinesOutput, AWSError>;
  do {
    pipelineResult = await pipelineService.listPipelines({}).promise();
    if (pipelineResult.$response.error) {
      throw pipelineResult.$response.error
    }
    if (!pipelineResult.$response.data) {
      break;
    }
    const pipelines = pipelineResult.$response.data.pipelines;
    if (pipelines) {
      matchingPipeline = pipelines.find(p => p.name && p.name.toLowerCase() === expectedPipelineName);
    }
  } while (!matchingPipeline && pipelineResult.nextToken)
  
  if (!matchingPipeline || !matchingPipeline.name) {
    console.warn(`Couldn't find a matching pipeline for branch ${branchSanitized}`);
    return;
  }
  await pipelineService.startPipelineExecution({
    name: matchingPipeline.name
  }).promise();
}
