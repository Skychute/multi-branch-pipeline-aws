export interface Config {
  tag: {
    product: string;
    tier: string
  };
  github: {
    branchName: string;
    repoName: string;
    authSecretArn: string;
    ownerId: string;
  };
  deploymentIamArn: string;
  defaultDeploymentEnv: { [key: string]: string; };
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
        ownerId: this.strictEnv('GITHUB_OWNER_ID'),
        repoName: this.strictEnv('GITHUB_REPO_NAME'),
      },
      defaultDeploymentEnv: JSON.parse(this.strictEnv('DEFAULT_DEPLOYMENT_ENVS')),
      deploymentIamArn: this.strictEnv('DEPLOYMENT_IAM_ARN'),
    };
    return this._config;
  }

  protected static strictEnv(key: string, defaultValue?: string): string {
    const value = this.env(key, defaultValue);
    if (value === undefined) {
      throw new Error(`No default value has been provided for variable ${key}`);
    }

    return value;
  }

  protected static env(key: string, defaultValue: string | undefined): string;
  protected static env(key: string): string | undefined;
  protected static env(key: string, defaultValue?: string): string | undefined {
    const value = process.env[key];
    if (value === undefined) {
      console.warn(`Environment variable ${key} is not set`);
      return defaultValue;
    }

    return value;
  }
}
