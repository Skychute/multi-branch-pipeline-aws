import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import { Lambda, CodePipeline, AWSError } from 'aws-sdk';
import { GithubPayload, isSignatureValid } from './github-payload';
import { ProcessRunner } from './utils/process-runner';
import { ConfigurationLoader } from './utils/config-loader';
import { PromiseResult } from 'aws-sdk/lib/request';
import { PipelineSummary } from 'aws-sdk/clients/codepipeline';
import { ExpectedENV as CDKExpectedENV } from '../cdk/util/config-loader';
import unzipper from 'unzipper';
import { waitForStream } from './utils/await-stream';

const lambda = (process.env.IS_OFFLINE) ? new Lambda({
  endpoint: 'http://localhost:3002',
}) : new Lambda();

const s3 = new S3({
  // endpoint: 'http://localhost:3002' 
});

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
    const parsedBody = JSON.parse(event.body) as GithubPayload;
    const githubEvent = event.headers['X-GitHub-Event'];
    try {
      if (['create'].includes(githubEvent)) {
        console.log('[create] event recieved, running pipeline setup');
        await lambda.invoke({
          FunctionName: env.pipelineSetupFuncArn,
          Payload: event.body,
          InvocationType: 'Event',
        }).promise();
      }
      if (githubEvent === 'push') {
        // when delete or create event occur, they also trigger a push event immediately before or after
        // we shouldn't trigger the pipeline on 'create' push because it doesn't exist yet
        // we shouldn't trigger the pipeline on 'delete' push because it the branch is no longer there 
        switch (true) {
          case parsedBody.deleted: {
            console.log('[push-deleted] event recieved, nothing to do');
            break;
          }
          case parsedBody.created: {
            console.log('[push-created] event recieved, nothing to do');
            break;
          }// TODO: check PRs
          default: {
            console.log('[push-commit] event recieved, triggering the pipeline');
            await lambda.invoke({
              FunctionName: env.pipelineExecuteFuncArn,
              Payload: event.body,
              InvocationType: 'Event',
            }).promise();
          }
        }
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

  if (!payload.ref) {
    throw new Error('no ref in payload');
  }

  const ref = payload.ref;

  const branch = ref.replace('refs/heads/', '');
  const repo = payload.repository.name;
  const owner = payload.repository.owner.name || payload.repository.owner.login;
  const cdkEnvironment: CDKExpectedENV & NodeJS.ProcessEnv = {
    PRODUCT: env.tag.product,
    TIER: env.tag.tier,
    GITHUB_AUTH_SECRET_ARN: env.githubAuthSecretArn,
    BRANCH_NAME: branch.replace(/\//g, '-'),
    ORIGINAL_BRANCH_NAME: branch,
    GITHUB_OWNER_NAME: owner,
    GITHUB_REPO_NAME: repo,
    DEFAULT_DEPLOYMENT_ENVS: ConfigurationLoader.getDefaultEnvsAsString({ BRANCH_NAME: branch }),
    DEPLOYMENT_IAM_ARN: env.deploymentIamArn,
    PATH: process.env.PATH,
    PIPELINE_CHATBOT_ADDRESS: env.pipelineNotificationChatbotAddress
  };
  if (process.env.IS_OFFLINE && process.env.AWS_PROFILE) {
    cdkEnvironment.AWS_PROFILE = process.env.AWS_PROFILE;
  } else {
    cdkEnvironment.AWS_REGION = process.env.AWS_REGION;
    cdkEnvironment.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
    cdkEnvironment.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
    cdkEnvironment.AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
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
  const ref = payload.ref;

  if (!ref) {
    throw new Error('no ref in payload');
  }

  const branch = ref.replace('refs/heads/', '');
  const branchSanitized = branch.replace(/\//g, '-');
  const expectedPipelineName = branchSanitized.toLowerCase();
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
  } while (!matchingPipeline && pipelineResult.nextToken);
  
  if (!matchingPipeline || !matchingPipeline.name) {
    throw new Error(`Couldn't find a matching pipeline for branch [${branchSanitized}]`);
  }
  await pipelineService.startPipelineExecution({
    name: matchingPipeline.name
  }).promise();
}

export const pipelineDestroyHandler: Handler = async (event) => {
  console.log(event);
  const payload = event as GithubPayload;
  if (!payload.ref) {
    return {
      statusCode: 500,
      body: 'no ref in payload',
    }
  }
  const ref = payload.ref;
  const branch = ref.replace('refs/heads/', '');

  const branchName = branch.replace(/\//g, '-');
  const bucketName = 'artifacts-connect-portal'; // TODO: MAKE ENV
  const objListOutput = await s3.listObjectsV2({
    Bucket: bucketName,
    Prefix: `${branchName}/Artifact_S/`,
  }).promise();
  if (!objListOutput.$response.data || !objListOutput.$response.data.Contents?.length) {
    throw new Error('Could not find contents!');
  }
  const objectContent = objListOutput.$response.data.Contents;
  objectContent.sort((a, b) => {
    if (!a.LastModified) return 1;
    if (!b.LastModified) return -1;
    return b.LastModified.valueOf() - a.LastModified.valueOf();
  });
  if (!objectContent[0].Key) {
    throw new Error('Could not find key!');
  }
  const key = objectContent[0].Key;
  const artifactZipStream = s3.getObject({
    Bucket: bucketName,
    Key: key,
  }).createReadStream();
  await waitForStream(artifactZipStream.pipe(unzipper.Extract({ path: 'tmp/artifact'})));
  await ProcessRunner.runProcess(
    'sh',
    [`tmp/artifact/scripts/destroy.sh`],
    {
      stdout: process.stdout,
      stdin: process.stdin,
      stderr: process.stderr,
      spawnOptions: {
        env: {
          BRANCH_NAME: branch.replace(/\//g, '-'),
        }
      }
    }
  );
};
