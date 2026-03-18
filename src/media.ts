/**
 * Media handling — download + AES decrypt files from WeCom.
 *
 * WeCom AI Bot encrypts all media (images, files, voice) with AES-256-CBC.
 * The aesKey is provided in the message body for each attachment.
 */

import type { WSClient } from "@wecom/aibot-node-sdk";
import { getWeComClient } from "./send.js";

export interface DownloadedMedia {
  buffer: Buffer;
  filename?: string;
  contentType?: string;
}

/**
 * Download and decrypt a media file from WeCom.
 *
 * Uses the WSClient.downloadFile() method which handles:
 * 1. HTTP GET to fetch encrypted buffer
 * 2. AES-256-CBC decryption with PKCS#7 padding (32-byte blocks)
 * 3. Filename extraction from Content-Disposition header
 */
export async function downloadWeComMedia(params: {
  accountId: string;
  url: string;
  aesKey: string;
}): Promise<DownloadedMedia> {
  const { accountId, url, aesKey } = params;
  const client = getWeComClient(accountId);
  if (!client) {
    throw new Error(
      `WeCom client for account "${accountId}" not available for media download`,
    );
  }

  const result = await client.downloadFile(url, aesKey);
  return {
    buffer: result.buffer,
    filename: result.filename,
  };
}

/**
 * Download an image from a WeCom message.
 *
 * Convenience wrapper around downloadWeComMedia.
 */
export async function downloadWeComImage(params: {
  accountId: string;
  imageUrl: string;
  imageAesKey: string;
}): Promise<DownloadedMedia> {
  return downloadWeComMedia({
    accountId: params.accountId,
    url: params.imageUrl,
    aesKey: params.imageAesKey,
  });
}

/**
 * Download a file from a WeCom message.
 */
export async function downloadWeComFile(params: {
  accountId: string;
  fileUrl: string;
  fileAesKey: string;
}): Promise<DownloadedMedia> {
  return downloadWeComMedia({
    accountId: params.accountId,
    url: params.fileUrl,
    aesKey: params.fileAesKey,
  });
}

/**
 * Download a voice message from WeCom.
 */
export async function downloadWeComVoice(params: {
  accountId: string;
  voiceUrl: string;
  voiceAesKey: string;
}): Promise<DownloadedMedia> {
  return downloadWeComMedia({
    accountId: params.accountId,
    url: params.voiceUrl,
    aesKey: params.voiceAesKey,
  });
}
