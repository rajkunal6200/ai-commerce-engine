import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import path from 'node:path';

let projectId: string | undefined = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config?.projectId) {
      projectId = config.projectId;
    }
  }
} catch {
  // Graceful fallback when config is absent
}

if (!getApps().length) {
  initializeApp(projectId ? { projectId } : {});
}

export const adminAuth = getAuth();
