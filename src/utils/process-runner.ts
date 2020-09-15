import { spawn, SpawnOptionsWithoutStdio } from 'child_process';

interface IProcessRunOptions {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  spawnOptions?: SpawnOptionsWithoutStdio;
}
export class ProcessRunner {

  private static enviroment: {[key: string]: string }; 
  
  public static runProcess(
    processPath: string,
    args: string[],
    options: IProcessRunOptions = process
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (options.spawnOptions) {
        options.spawnOptions.env = {
          PATH: process.env.PATH,
          ...this.enviroment
        };
      }
      const instance = spawn(
        processPath,
        args,
        options.spawnOptions
      );
      let data = '';
      let error = '';
      instance.stdout.on('data', (datum: string) => {
        options.stdout.write(datum);
        data += datum;
      });
      instance.stderr.on('data', (datum: string) => {
        options.stderr.write(datum);
        error += datum;
      });
      instance.on('exit', (code: number) => {
        if (code !== 0) {
          reject(error);
        } else {
          resolve(data);
        }
      });
    });
  }

  public static setEnvironmentVars(envVars: { [key: string]: string }): void {
    const envVarsString: {[key: string]: string } = {};
    for (const key of Object.keys(envVars)) {
      envVarsString[key] = envVars[key];
    }

    this.enviroment = envVarsString;
  }
}
