/** `version` of a package.json; anything else in the file is not our business. */
export async function readVersion(packageJson: string): Promise<string> {
  const data: unknown = await Bun.file(packageJson).json()
  if (data && typeof data === 'object' && 'version' in data && typeof data.version === 'string') return data.version
  throw new Error(`no version in ${packageJson}`)
}
