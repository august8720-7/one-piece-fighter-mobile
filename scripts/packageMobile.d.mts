export interface MobilePackageFile { file: string; bytes: number; sha256: string }
export interface MobilePackageManifest {
  schemaVersion: 1;
  createdAt: string;
  source: string;
  site: string;
  deliveryVersion: string;
  deliveryManifestSha256: string;
  uiManifestSha256: string;
  fileCount: number;
  totalBytes: number;
  files: MobilePackageFile[];
}
export interface MobilePackageResult extends MobilePackageManifest { release: string }
export function safeRelative(name: string): string;
export function strictFile(root: string, relative: string): string;
export function createMobilePackage(options: { projectRoot?: string; candidate: string; outputRoot?: string; now?: Date }): MobilePackageResult;
export function verifyPackagedSite(release: string): MobilePackageManifest;
