export function artefactsBucketNameForRepo(repoName: string): string {
  return `artifacts-${repoName.toLowerCase()}`
}