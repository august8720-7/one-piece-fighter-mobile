export function browserLaunch(url: string, platform?: string): {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
};
export function openLocalUrl(url: string): void;
