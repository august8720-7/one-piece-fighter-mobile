import type { IncomingMessage, ServerResponse } from 'node:http';
export function createMobileHandler(release: string): (request: IncomingMessage, response: ServerResponse) => void;
export function lanAddresses(port: number): string[];
