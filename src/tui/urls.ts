/**
 * Discovered dashboard URL — a tiny module-level store.
 *
 * Discovery is async and finishes after `setup`, while the footer badge and
 * the swarm panel read the result later. A plain module variable keeps both
 * consumers in sync without another reactive primitive.
 */

let discoveredUrl: string | undefined;

export function setDiscoveredUrl(url: string | undefined): void {
  discoveredUrl = url;
}

export function getDiscoveredUrl(): string | undefined {
  return discoveredUrl;
}
