import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import { Lambda } from 'aws-sdk';
import { GithubPayload, isSignatureValid } from './github-payload';
import { ProcessRunner } from './utils/process-runner';
import { ConfigurationLoader } from './utils/config-loader';

const lambda = new Lambda({
  // region: 'ap-southeast-2',
  endpoint: 'http://localhost:3002',
})

const env = ConfigurationLoader.load();

export const pipelineHandler: APIGatewayProxyHandler = async (event) => {
  if (!event.body) {
    return {
      statusCode: 500,
      body: 'Request body empty',
    }
  }

  const sig = event.headers['X-Hub-Signature']
  const isValidPayload = isSignatureValid(event.body, sig);
  if (!isValidPayload) {
    return {
      statusCode: 500,
      body: "Signatures didn't match!",
    }
  }

  try {
    await lambda.invoke({
      FunctionName: env.pipelineSetupFuncArn,
      Payload: event.body,
      InvocationType: 'Event',
      // LogType: 'None',
    }).promise();
  } catch (e) {
    console.log(e);
  }

  return {
    statusCode: 200,
    body: 'accepted',
  };
};


export const pipelineSetupHandler: Handler = async (event) => {
  console.log(event);
  const payload = event as GithubPayload;

  if (!payload.ref) {
    return {
      statusCode: 500,
      body: 'no ref in payload',
    }
  }

  const ref = payload.ref;

  if (!ref.includes('refs/heads/')) {
    return {
      statusCode: 500,
      body: 'ref does not include heads',
    }
  }

  const branch = ref.replace('refs/heads/', '').replace(/\//g, '-');
  const repo = payload.repository.name;
  const owner = payload.repository.owner.id.toString();

  await ProcessRunner.runProcess(
    'npx',
    ["cdk", "deploy", '"*"', '--require-approval', 'never'],
    {
      stdout: process.stdout,
      stdin: process.stdin,
      stderr: process.stderr,
      spawnOptions: {
        env: {
          PRODUCT: env.tag.product,
          TIER: env.tag.tier,
          GITHUB_AUTH_SECRET_ARN: env.githubAuthSecretArn,
          BRANCH_NAME: branch,
          GITHUB_OWNER_ID: owner,
          GITHUB_REPO_NAME: repo,
          DEFAULT_DEPLOYMENT_ENVS: ConfigurationLoader.getDefaultEnvsAsString(),
          DEPLOYMENT_IAM_ARN: env.deploymentIamArn,
          PATH: process.env.PATH
        }
      }
    }
  );

  return {
    statusCode: 200,
    body: 'success',
  };
};
