export interface Config {
  tag: {
    product: string;
    tier: string
  };
  github: {
    branchName: string;
    orginalBranchName: string;
    repoName: string;
    authSecretArn: string;
    ownerName: string;
  };
  deploymentIamArn: string;
  defaultDeploymentEnv: { [key: string]: string; };
  chatBotAddress: string;
}
export interface ExpectedENV {
  PRODUCT: string;
  TIER: string;

  GITHUB_AUTH_SECRET_ARN: string;
  BRANCH_NAME: string;
  GITHUB_OWNER_NAME: string;
  GITHUB_REPO_NAME: string;
  ORIGINAL_BRANCH_NAME: string;

  DEFAULT_DEPLOYMENT_ENVS: string;
  DEPLOYMENT_IAM_ARN: string;
  PIPELINE_CHATBOT_ADDRESS: string;

}
export class ConfigurationLoader {
  private constructor() {
    // Static Class
  }
  private static _config: Config;
  public static load(): Config {
    if (this._config) {
      return this._config;
    }
    this._config = {
      tag: {
        product: this.strictEnv('PRODUCT'),
        tier: this.strictEnv('TIER'),
      },
      github: {
        authSecretArn: this.strictEnv('GITHUB_AUTH_SECRET_ARN'),
        branchName: this.strictEnv('BRANCH_NAME'),
        ownerName: this.strictEnv('GITHUB_OWNER_NAME'),
        repoName: this.strictEnv('GITHUB_REPO_NAME'),
        orginalBranchName: this.strictEnv('ORIGINAL_BRANCH_NAME'),
      },
      defaultDeploymentEnv: JSON.parse(this.strictEnv('DEFAULT_DEPLOYMENT_ENVS')),
      deploymentIamArn: this.strictEnv('DEPLOYMENT_IAM_ARN'),
      chatBotAddress: this.strictEnv('PIPELINE_CHATBOT_ADDRESS'),
    };
    return this._config;
  }

  protected static strictEnv(key: keyof ExpectedENV, defaultValue?: string): string {
    const value = this.env(key, defaultValue);
    if (value === undefined) {
      throw new Error(`No default value has been provided for variable ${key}`);
    }

    return value;
  }

  protected static env<T extends string>(key: T, defaultValue: string | undefined): string;
  protected static env<T extends string>(key: T): string | undefined;
  protected static env<T extends string>(key: T, defaultValue?: string): string | undefined {
    const value = process.env[key];
    if (value === undefined) {
      console.warn(`Environment variable ${key} is not set`);
      return defaultValue;
    }

    return value;
  }
}
