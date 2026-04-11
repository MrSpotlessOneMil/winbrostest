import { getLiveSettings, saveLiveSettings } from './live-data';

export interface Settings {
  spreadsheetId: string;
  hourlyRate: number;
  costPerJob: number;
}

// In-memory fallback settings
let fallbackSettings: Settings = {
  spreadsheetId: '',
  hourlyRate: 25,
  costPerJob: 50
};

export async function getSettings(): Promise<Settings> {
  // Try live database first
  const liveSettings = await getLiveSettings();
  if (liveSettings) {
    return liveSettings;
  }
  // Fall back to in-memory
  return fallbackSettings;
}

export async function saveSettings(newSettings: Settings): Promise<void> {
  // Try to save to live database
  const saved = await saveLiveSettings(newSettings);
  if (!saved) {
    // Fall back to in-memory
    fallbackSettings = { ...newSettings };
  }
}
