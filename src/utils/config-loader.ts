export interface Config {
  tag: {
    product: string;
    tier: string
  };
  githubAuthSecretArn: string;
  deploymentIamArn: string;
  githubWebhookSecret: string;
  pipelineSetupFuncArn: string;
  pipelineExecuteFuncArn: string;
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
      githubAuthSecretArn: this.strictEnv('GITHUB_AUTH_SECRET_ARN'),
      deploymentIamArn: this.strictEnv('DEPLOYMENT_IAM_ARN'),
      githubWebhookSecret: this.strictEnv('GITHUB_WEBHOOK_SECRET'),
      pipelineSetupFuncArn: this.strictEnv('PIPELINE_SETUP_FUNCTION_ARN'),
      pipelineExecuteFuncArn: this.strictEnv('PIPELINE_EXECUTE_FUNCTION_ARN'),
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

  public static getDefaultEnvsAsString(extraVars?: {[key: string]: string}): string {
    const envObj: {[key: string]: string; } = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('DEFAULT_')) {
        envObj[key.replace('DEFAULT_', '')] = process.env[key] as string;
      }
    }
    if (extraVars) {
      for (const key of Object.keys(extraVars)) {
        envObj[key] = extraVars[key];
      }
    }
    return JSON.stringify(envObj);
  }
}
