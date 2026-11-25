import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Statement } from '../core/reports';
import { generatePdfBuffer, statementFileName } from './statements';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

/** Exports a PDF to device storage and opens the native share sheet on Android. */
export async function exportAndSharePdf(statement: Statement): Promise<string> {
  if (!Capacitor.isNativePlatform()) throw new Error('Native sharing is available on Android only');
  const bytes = await generatePdfBuffer(statement);
  const fileName = statementFileName(statement);
  const path = `statements/${fileName}`;
  await Filesystem.writeFile({ path, data: toBase64(bytes), directory: Directory.Cache, recursive: true });
  const uri = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: statement.title, text: statement.subtitle, url: uri.uri, dialogTitle: 'Share MyKhata statement' });
  return uri.uri;
}
