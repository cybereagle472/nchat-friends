/**
 * Privacy Settings Service (Cloudflare Worker backend)
 *
 * Manages user privacy preferences for last seen, profile photo, about,
 * read receipts and online status. Backed by worker/src/routes/privacy.ts
 * + the `privacy_settings` D1 table — these settings are also actually
 * *enforced* server-side wherever another user's profile is returned
 * (see worker/src/lib/privacy.ts), not just stored for display.
 */

import { apiFetch } from '../lib/apiClient';

export type PrivacyOption = 'everyone' | 'contacts' | 'nobody';

export interface PrivacySettings {
  user_id: string;
  last_seen: PrivacyOption;
  profile_photo: PrivacyOption;
  about: PrivacyOption;
  read_receipts: boolean;
  online_status: boolean;
}

// Shape returned/accepted by the Worker — snake_case DB column names.
interface WirePrivacySettings {
  user_id: string;
  last_seen_visibility: PrivacyOption;
  profile_photo_visibility: PrivacyOption;
  about_visibility: PrivacyOption;
  status_visibility: PrivacyOption;
  read_receipts: number;
  online_status_enabled: number;
}

function fromWire(w: WirePrivacySettings): PrivacySettings {
  return {
    user_id: w.user_id,
    last_seen: w.last_seen_visibility,
    profile_photo: w.profile_photo_visibility,
    about: w.about_visibility,
    read_receipts: !!w.read_receipts,
    online_status: !!w.online_status_enabled,
  };
}

class PrivacyService {
  /**
   * Get privacy settings for the current user.
   */
  async getSettings(): Promise<{
    success: boolean;
    data?: PrivacySettings;
    error?: string;
  }> {
    try {
      const { settings } = await apiFetch<{ settings: WirePrivacySettings }>('/privacy');
      return { success: true, data: fromWire(settings) };
    } catch (error: any) {
      console.error('Failed to get privacy settings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update privacy settings for the current user.
   */
  async updateSettings(
    updates: Partial<Omit<PrivacySettings, 'user_id'>>
  ): Promise<{ success: boolean; data?: PrivacySettings; error?: string }> {
    try {
      const body: Record<string, unknown> = {};
      if (updates.last_seen !== undefined) body.last_seen_visibility = updates.last_seen;
      if (updates.profile_photo !== undefined) body.profile_photo_visibility = updates.profile_photo;
      if (updates.about !== undefined) body.about_visibility = updates.about;
      if (updates.read_receipts !== undefined) body.read_receipts = updates.read_receipts;
      if (updates.online_status !== undefined) body.online_status_enabled = updates.online_status;

      const { settings } = await apiFetch<{ settings: WirePrivacySettings }>('/privacy', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return { success: true, data: fromWire(settings) };
    } catch (error: any) {
      console.error('Failed to update privacy settings:', error);
      return { success: false, error: error.message };
    }
  }
}

export const privacyService = new PrivacyService();
export default privacyService;
