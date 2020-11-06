import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import { Lambda, CodePipeline, AWSError, S3, CodeBuild } from 'aws-sdk';
import { GithubPayload, isSignatureValid } from './github-payload';
import { ProcessRunner } from './utils/process-runner';
import { ConfigurationLoader } from './utils/config-loader';
import { PromiseResult } from 'aws-sdk/lib/request';
import { PipelineSummary } from 'aws-sdk/clients/codepipeline';
import { ExpectedENV as CDKExpectedENV } from '../cdk/util/config-loader';

const lambda = (process.env.IS_OFFLINE) ? new Lambda({
  endpoint: 'http://localhost:3002',
}) : new Lambda();

const cdkOutDir = process.env.IS_OFFLINE? 'tmp' : '/tmp';
const s3 = new S3();

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
      switch (githubEvent) {
        case 'create': {
          console.log('[create] event recieved, running pipeline setup');
          await lambda.invoke({
            FunctionName: env.pipelineSetupFuncArn,
            Payload: event.body,
            InvocationType: 'Event',
          }).promise();
          break;
        }
        case 'push': {
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
            }
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
        break;
        case 'delete': {
          console.log('[delete] event recieved, running the teardown');
          await lambda.invoke({
            FunctionName: env.environmentTeardownFuncArn,
            Payload: event.body,
            InvocationType: 'Event',
          }).promise();
          break;
        }
        default: {
          throw new Error(`Received an event of unexpected type [${githubEvent}]. Consider unsubsribing this webhook from it.`);
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
  
  await runCDK({ branch, owner, repo }, [
    'deploy', '"*"', '--require-approval', 'never', '--output', cdkOutDir]
  );

};

export const pipelineExecutionHandler: Handler<GithubPayload> = async (payload) => {
  const ref = payload.ref;

  if (!ref) {
    throw new Error('no ref in payload');
  }

  const branch = ref.replace('refs/heads/', '');
  const pipelineService = new CodePipeline();
  const pipelineName = await getPipelineNameByBranch(pipelineService, branch);
  
  if (!pipelineName) {
    throw new Error(`Couldn't find a matching pipeline for branch [${branch}]`);
  }

  await pipelineService.startPipelineExecution({
    name: pipelineName
  }).promise();
}

export const environmentTeardownHandler: Handler = async (event) => {
  const payload = event as GithubPayload;
  if (!payload.ref) {
    throw new Error('no ref in payload');
  }
  const ref = payload.ref;
  const branch = ref.replace('refs/heads/', '');

  const branchName = branch.replace(/\//g, '-');
  const bucketName = `artifacts-${payload.repository.name.toLowerCase()}`
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
  const codeBuild = new CodeBuild();
  const location = `${bucketName}/${key}`;

  const teardownStartPromise = codeBuild.startBuild({
    projectName: env.teardownCodebuildProjectName,
    sourceLocationOverride: location,
    environmentVariablesOverride: [
      { name: 'BRANCH_NAME', value: branch.replace(/\//g, '-'), type: 'PLAINTEXT' }
    ]
  }).promise();

  const pipelineService = new CodePipeline();

  const pipelineName = await getPipelineNameByBranch(pipelineService, branch);
  if (pipelineName) {

    // if there is a pipeline for this branch
    // we need to stop all currently running stages there

    const pipelineState = await pipelineService.getPipelineState({
      name: pipelineName
    }).promise();
    const activeExecutions: string[] = [];
    pipelineState.stageStates?.forEach(stageState => {
        if (stageState.latestExecution?.status === 'InProgress' && stageState.latestExecution.pipelineExecutionId){
          activeExecutions.push(stageState.latestExecution.pipelineExecutionId);
        }
      })
    await Promise.all(activeExecutions.map(pipelineExecutionId =>
      pipelineService.stopPipelineExecution({
        pipelineName,
        pipelineExecutionId
      }).promise())
    );

    // tear down everything that has been created for that branch by this function

    const repo = payload.repository.name;
    const owner = payload.repository.owner.name || payload.repository.owner.login;
    await runCDK({ branch, owner, repo }, [
      'destroy', `"${branch.replace(/\//g, '-')}-*"`,
      '--exclusively', '--force', '--output', cdkOutDir]
    );
  }
  await teardownStartPromise;
};

/**
 * Finds code pipeline based on the branch name
 * @param pipelineService CodePipeline service instance to use
 * @param branch branch name
 */
async function getPipelineNameByBranch(pipelineService: CodePipeline, branch: string): Promise<string | undefined> {
  const branchSanitized = branch.replace(/\//g, '-');
  const expectedPipelineName = branchSanitized.toLowerCase();
  let matchingPipeline: PipelineSummary | undefined; 

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
  
  
  return matchingPipeline?.name;
}

/**
 * Run CDK process
 * @param repositoryInfo information about the repo 
 * @param args arguments to run cdk command with
 */
async function runCDK({ branch, owner, repo }: {
  /** Branch */
  branch: string,
  /** Repository owner login */
  owner: string,
  /** Repository name */
  repo: string
}, args: string[]): Promise<void> {

  const processEnvironment: CDKExpectedENV & NodeJS.ProcessEnv = {
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
    processEnvironment.AWS_PROFILE = process.env.AWS_PROFILE;
  } else {
    processEnvironment.AWS_REGION = process.env.AWS_REGION;
    processEnvironment.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
    processEnvironment.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
    processEnvironment.AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
  }
    
  await ProcessRunner.runProcess(
    'node',
    ['node_modules/aws-cdk/bin/cdk', ...args],
    {
      stdout: process.stdout,
      stdin: process.stdin,
      stderr: process.stderr,
      spawnOptions: {
        env: processEnvironment
      }
    }
  );
}
