export function waitForStream(stream: NodeJS.ReadableStream | NodeJS.WritableStream, endEvent = 'finish'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      stream.once(endEvent, resolve).once('error', reject);
    });
  }