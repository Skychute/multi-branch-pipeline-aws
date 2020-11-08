import * as s3 from '@aws-cdk/aws-s3';
import { App, Stack, StackProps } from '@aws-cdk/core';
import { artefactsBucketNameForRepo } from '../util/stack-utils';

interface BucketStackProps extends StackProps {
  repoName: string;
}

export class BucketStack extends Stack {
  public bucketArn: string;
  constructor(app: App, id: string, props: BucketStackProps) {
    super(app, id, props);
    const bucketName = artefactsBucketNameForRepo(props.repoName);
    const bucket = new s3.Bucket(this, 'CreateArtifactBucket', {
      bucketName,
    });
    this.bucketArn = bucket.bucketArn;
  }
}