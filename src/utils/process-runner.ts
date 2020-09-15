import { spawn, SpawnOptionsWithoutStdio } from 'child_process';

interface IProcessRunOptions {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  spawnOptions?: SpawnOptionsWithoutStdio;
}
export class ProcessRunner {
  public static runProcess(
    processPath: string,
    args: string[],
    options: IProcessRunOptions = process
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log(`ENV: ${JSON.stringify(options.spawnOptions?.env)}`);
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
}
