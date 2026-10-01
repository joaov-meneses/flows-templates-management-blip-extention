export type InactivityBlock = {
  blockKey: string;
  id: string;
  title: string;
  expiration: string | null;
};

export type InactivityAnalysis = {
  revision: string;
  totalBlocks: number;
  eligibleBlocks: number;
  configuredBlocks: number;
  blocks: InactivityBlock[];
};

export type InactivityApplyResponse = InactivityAnalysis & {
  updated: number;
  kept: number;
  published: boolean;
  publicationIndex?: number;
  publicationError?: string;
};
